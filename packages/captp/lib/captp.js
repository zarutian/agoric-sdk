/* global harden */

// This logic was mostly lifted from @agoric/swingset-vat liveSlots.js
// Defects in it are mfig's fault.
import { Remotable, makeMarshal, QCLASS } from '@agoric/marshal';
import { E, HandledPromise } from '@agoric/eventual-send';
import { isPromise } from '@agoric/promise-kit';

export { E, HandledPromise };

export function makeCapTP(ourId, rawSend, bootstrapObj = undefined) {
  let unplug = false;
  function send(...args) {
    if (unplug !== false) {
      throw unplug;
    }
    return rawSend(...args);
  }

  // convertValToSlot and convertSlotToVal both perform side effects,
  // populating the c-lists (imports/exports/questions/answers) upon
  // marshalling/unmarshalling.  As we traverse the datastructure representing
  // the message, we discover what we need to import/export and send relevant
  // messages across the wire.
  const { serialize, unserialize } = makeMarshal(
    // eslint-disable-next-line no-use-before-define
    convertValToSlot,
    // eslint-disable-next-line no-use-before-define
    convertSlotToVal,
  );

  // Used to construct slot names for promises/non-promises.
  // In this verison of CapTP we use strings for export/import slot names.
  // prefixed with 'p' if promises and 'o' otherwise;
  let lastPromiseID = 0;
  let lastExportID = 0;
  // Since we decide the numbers for questions, we use this to increment
  // the question key
  let lastQuestionID = 0;

  const valToSlot = new WeakMap(); // exports looked up by val
  const slotToVal = new Map(); // exports looked up by slot
  const questions = new Map(); // chosen by us
  const answers = new Map(); // chosen by our peer
  const imports = new Map(); // chosen by our peer

  // Called at marshalling time.  Either retrieves an existing export, or if
  // not yet exported, records this exported object.  If a promise, sets up a
  // promise listener to inform the other side when the promise is
  // fulfilled/broken.
  function convertValToSlot(val) {
    if (!valToSlot.has(val)) {
      // new export
      let slot;
      if (isPromise(val)) {
        // This is a promise, so we're going to increment the lastPromiseId
        // and use that to construct the slot name.  Promise slots are prefaced
        // with 'p+'.
        lastPromiseID += 1;
        const promiseID = lastPromiseID;
        slot = `p+${promiseID}`;
        // Set up promise listener to inform other side when this promise
        // is fulfilled/broken
        val.then(
          res =>
            send({
              type: 'CTP_RESOLVE',
              promiseID,
              res: serialize(harden(res)),
            }),
          rej =>
            send({
              type: 'CTP_RESOLVE',
              promiseID,
              rej: serialize(harden(rej)),
            }),
        );
      } else {
        // Since this isn't a promise, we instead increment the lastExportId
        // and use that to construct the slot name.
        // Non-promises are prefaced with 'o+'.
        lastExportID += 1;
        const exportID = lastExportID;
        slot = `o+${exportID}`;
      }
      // Now record the export in both valToSlot and slotToVal so we can look it
      // up from either the value or the slot name later.
      valToSlot.set(val, slot);
      slotToVal.set(slot, val);
    }
    // At this point, the value is guaranteed to be exported, so return the
    // associated slot number.
    return valToSlot.get(val);
  }

  // Generate a new question in the questions table and set up a new
  // remote handled promise.
  // Returns: [questionId, pr]
  //   where `pr` is the HandledPromise for this question.
  function makeQuestion() {
    lastQuestionID += 1;
    const questionID = lastQuestionID;
    // eslint-disable-next-line no-use-before-define
    const pr = makeRemote(questionID);
    questions.set(questionID, pr);
    return [questionID, pr];
  }

  // Make a remote promise for `target` (an id in the questions table)
  function makeRemote(target) {
    // This handler is set up such that it will transform both
    // attribute access and method invocation of this remote promise
    // as also being questions / remote handled promises
    const handler = {
      get(_o, prop) {
        if (unplug !== false) {
          throw unplug;
        }
        const [questionID, pr] = makeQuestion();
        send({
          type: 'CTP_CALL',
          questionID,
          target,
          method: serialize(harden([prop])),
        });
        return harden(pr.p);
      },
      applyMethod(_o, prop, args) {
        if (unplug !== false) {
          throw unplug;
        }
        // Support: o~.[prop](...args) remote method invocation
        const [questionID, pr] = makeQuestion();
        send({
          type: 'CTP_CALL',
          questionID,
          target,
          method: serialize(harden([prop, args])),
        });
        return harden(pr.p);
      },
    };

    const pr = {};
    pr.p = new HandledPromise((res, rej, resolveWithPresence) => {
      pr.rej = rej;
      pr.resPres = () => resolveWithPresence(handler);
      pr.res = res;
    }, handler);
    return harden(pr);
  }

  // Set up import
  function convertSlotToVal(theirSlot) {
    let val;
    // Invert slot direction from other side.

    // Inverted to prevent namespace collisions between slots we
    // allocate and the ones the other side allocates.  If we allocate
    // a slot, serialize it to the other side, and they send it back to
    // us, we need to reference just our own slot, not one from their
    // side.
    const otherDir = theirSlot[1] === '+' ? '-' : '+';
    const slot = `${theirSlot[0]}${otherDir}${theirSlot.slice(2)}`;
    if (!slotToVal.has(slot)) {
      // Make a new handled promise for the slot.
      const pr = makeRemote(slot);
      if (slot[0] === 'o') {
        // A new remote presence
        const pres = pr.resPres();
        val = Remotable(`Presence ${ourId} ${slot}`, undefined, pres);
      } else {
        // A new promise
        imports.set(Number(slot.slice(2)), pr);
        val = pr.p;
      }
      slotToVal.set(slot, val);
      valToSlot.set(val, slot);
    }
    return slotToVal.get(slot);
  }

  // Message handler used for CapTP dispatcher
  const handler = {
    // Remote is asking for bootstrap object
    CTP_BOOTSTRAP(obj) {
      const { questionID } = obj;
      const bootstrap =
        typeof bootstrapObj === 'function' ? bootstrapObj() : bootstrapObj;
      // console.log('sending bootstrap', bootstrap);
      answers.set(questionID, bootstrap);
      send({
        type: 'CTP_RETURN',
        answerID: questionID,
        result: serialize(bootstrap),
      });
    },
    // Remote is invoking a method or retrieving a property.
    CTP_CALL(obj) {
      // questionId: Remote promise (for promise pipelining) this call is
      //   to fulfill
      // target: Slot id of the target to be invoked.  Checks against
      //   answers first; otherwise goes through unserializer
      const { questionID, target } = obj;
      const [prop, args] = unserialize(obj.method);
      let val;
      if (answers.has(target)) {
        val = answers.get(target);
      } else {
        val = unserialize({
          body: JSON.stringify({
            [QCLASS]: 'slot',
            index: 0,
          }),
          slots: [target],
        });
      }
      // If `args` is supplied, we're applying a method... otherwise this is
      // property access
      const hp = args
        ? HandledPromise.applyMethod(val, prop, args)
        : HandledPromise.get(val, prop);
      // Answer with our handled promise
      answers.set(questionID, hp);
      // Set up promise resolver for this handled promise to send
      // message to other vat when fulfilled/broken.
      hp.then(res =>
        send({
          type: 'CTP_RETURN',
          answerID: questionID,
          result: serialize(harden(res)),
        }),
      ).catch(rej =>
        send({
          type: 'CTP_RETURN',
          answerID: questionID,
          exception: serialize(harden(rej)),
        }),
      );
    },
    // Answer to one of our questions.
    CTP_RETURN(obj) {
      const { result, exception, answerID } = obj;
      const pr = questions.get(answerID);
      if ('exception' in obj) {
        pr.rej(unserialize(exception));
      } else {
        pr.res(unserialize(result));
      }
      questions.delete(answerID);
    },
    // Resolution to an imported promise
    CTP_RESOLVE(obj) {
      const { promiseID, res, rej } = obj;
      const pr = imports.get(promiseID);
      if ('rej' in obj) {
        pr.rej(unserialize(rej));
      } else {
        pr.res(unserialize(res));
      }
      imports.delete(promiseID);
    },
    // The other side has signaled something has gone wrong.
    // Pull the plug!
    CTP_ABORT(obj) {
      const { exception } = obj;
      for (const pr of questions.values()) {
        pr.rej(exception);
      }
      for (const pr of imports.values()) {
        pr.rej(exception);
      }
      send(obj);
      unplug = exception;
    },
  };

  // Get a reference to the other side's bootstrap object.
  const getBootstrap = async () => {
    if (unplug !== false) {
      throw unplug;
    }
    const [questionID, pr] = makeQuestion();
    send({
      type: 'CTP_BOOTSTRAP',
      questionID,
    });
    return harden(pr.p);
  };
  harden(handler);

  // Return a dispatch function.
  const dispatch = obj => {
    if (unplug !== false) {
      return false;
    }
    const fn = handler[obj.type];
    if (fn) {
      fn(obj);
      return true;
    }
    return false;
  };

  // Abort a connection.
  const abort = (
    exception = Error(`disconnected from ${JSON.stringify(ourId)}`),
  ) => dispatch({ type: 'CTP_ABORT', exception });

  return harden({ abort, dispatch, getBootstrap });
}
