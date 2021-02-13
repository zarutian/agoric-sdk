import { assert, details as X } from '@agoric/assert';
import { makeVatSlot } from '../../parseVatSlots';
import { getRemote } from './remote';
import { makeState, makeStateKit } from './state';
import { deliverToController } from './controller';
import { insistCapData } from '../../capdata';

import { makeCListKit } from './clist';
import { makeDeliveryKit } from './delivery';

export const debugState = new WeakMap();

export function buildCommsDispatch(syscall) {
  const state = makeState();
  const stateKit = makeStateKit(state);
  const clistKit = makeCListKit(state, syscall, stateKit);

  function transmit(remoteID, msg) {
    const remote = getRemote(state, remoteID);
    // the vat-tp "integrity layer" is a regular vat, so it expects an argument
    // encoded as JSON
    const args = harden({ body: JSON.stringify([msg]), slots: [] });
    syscall.send(remote.transmitterID, 'transmit', args); // sendOnly
  }

  const deliveryKit = makeDeliveryKit(
    state,
    syscall,
    transmit,
    clistKit,
    stateKit,
  );
  clistKit.setDeliveryKit(deliveryKit);

  const { sendFromKernel, resolveFromKernel, messageFromRemote } = deliveryKit;

  // our root object (o+0) is the Comms Controller
  const controller = makeVatSlot('object', true, 0);

  function deliver(target, method, args, result) {
    insistCapData(args);
    if (target === controller) {
      return deliverToController(
        state,
        clistKit,
        method,
        args,
        result,
        syscall,
      );
    }
    // console.debug(`comms.deliver ${target} r=${result}`);
    // dumpState(state);
    if (state.objectTable.has(target) || state.promiseTable.has(target)) {
      assert(
        method.indexOf(':') === -1 && method.indexOf(';') === -1,
        X`illegal method name ${method}`,
      );
      return sendFromKernel(target, method, args, result);
    }
    if (state.remoteReceivers.has(target)) {
      assert(method === 'receive', X`unexpected method ${method}`);
      // the vat-tp integrity layer is a regular vat, so when they send the
      // received message to us, it will be embedded in a JSON array
      const remoteID = state.remoteReceivers.get(target);
      const message = JSON.parse(args.body)[0];
      return messageFromRemote(remoteID, message);
    }

    // TODO: if promise target not in PromiseTable: resolve result to error
    //   this will happen if someone pipelines to our controller/receiver
    assert.fail(X`unknown target ${target}`);
  }

  function notify(resolutions) {
    const willBeResolved = new Set();
    for (const resolution of resolutions) {
      const [vpid, value] = resolution;
      willBeResolved.add(vpid);
      assert(typeof value === 'object');
      insistCapData(value.data);
      // console.debug(`comms.notify(${vpid}, ${value})`);
      // dumpState(state);
    }
    resolveFromKernel(resolutions, willBeResolved);

    // XXX question: do we need to call retirePromiseIDIfEasy (or some special
    // comms vat version of it) here?
  }

  const dispatch = harden({ deliver, notify });
  debugState.set(dispatch, { state, clistKit });

  return dispatch;
}
