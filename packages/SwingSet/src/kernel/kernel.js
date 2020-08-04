/* global harden */

import { makeMarshal, Remotable, getInterfaceOf } from '@agoric/marshal';
import { assert, details } from '@agoric/assert';
import { importBundle } from '@agoric/import-bundle';
import { makeVatManagerFactory } from './vatManager/vatManager';
import makeDeviceManager from './deviceManager';
import { wrapStorage } from './state/storageWrapper';
import makeKernelKeeper from './state/kernelKeeper';
import { kdebug, kdebugEnable, legibilizeMessageArgs } from './kdebug';
import { insistKernelType, parseKernelSlot } from './parseKernelSlots';
import { makeVatSlot, parseVatSlot } from '../parseVatSlots';
import { insistStorageAPI } from '../storageAPI';
import { insistCapData } from '../capdata';
import { insistMessage } from '../message';
import { insistDeviceID, insistVatID } from './id';
import { makeMessageResult } from './messageResult';
import { makeMeterManager } from './metering';
import { makeKernelSyscallHandler } from './kernelSyscall';

import { makeDynamicVatCreator } from './dynamicVat';
import { makeVatTranslators } from './vatTranslator';
import { makeDeviceTranslators } from './deviceTranslator';

function abbreviateReviver(_, arg) {
  if (typeof arg === 'string' && arg.length >= 40) {
    // truncate long strings
    return `${arg.slice(0, 15)}...${arg.slice(arg.length - 15)}`;
  }
  return arg;
}

export default function buildKernel(kernelEndowments) {
  const {
    waitUntilQuiescent,
    hostStorage,
    makeVatEndowments,
    replaceGlobalMeter,
    transformMetering,
    transformTildot,
  } = kernelEndowments;
  insistStorageAPI(hostStorage);
  const { enhancedCrankBuffer, commitCrank } = wrapStorage(hostStorage);
  const kernelKeeper = makeKernelKeeper(enhancedCrankBuffer);

  const meterManager = makeMeterManager(replaceGlobalMeter);

  let started = false;
  // this holds externally-added vats, which are present at startup, but not
  // vats that are added later from within the kernel
  const genesisVats = new Map(); // name -> { setup, options }
  // we name this 'genesisDevices' for parallelism, but actually all devices
  // must be present at genesis
  const genesisDevices = new Map(); // name -> { setup, options }

  const ephemeral = {
    vats: new Map(), // vatID -> { manager, enablePipelining }
    devices: new Map(), // deviceID -> { manager }
    log: [],
  };

  // This is a low-level output-only string logger used by old unit tests to
  // see whether vats made progress or not. The array it appends to is
  // available as c.dump().log . New unit tests should instead use the
  // 'result' value returned by c.queueToExport()
  function testLog(...args) {
    const rendered = args.map(arg =>
      typeof arg === 'string' ? arg : JSON.stringify(arg, abbreviateReviver),
    );
    ephemeral.log.push(rendered.join(''));
  }
  harden(testLog);

  // track results of externally-injected messages (queueToExport, bootstrap)
  const pendingMessageResults = new Map(); // kpid -> messageResult

  // runQueue entries are {type, vatID, more..}. 'more' depends on type:
  // * deliver: target, msg
  // * notifyFulfillToData/notifyFulfillToPresence/notifyReject:
  //   kernelPromiseID

  // in the kernel table, promises and resolvers are both indexed by the same
  // value. kernelPromises[promiseID] = { decider, subscribers }

  // The 'staticVatPowers' are given to vats as arguments of setup().
  // Liveslots provides them, and more, as the only argument to
  // buildRootObject(). They represent controlled authorities that come from
  // the kernel but that do not go through the syscall mechanism (so they
  // aren't included in the replay transcript), so they must not be
  // particularly stateful. If any of them behave differently from one
  // invocation to the next, the vat code which uses it will not be a
  // deterministic function of the transcript, breaking our
  // orthogonal-persistence model. They can have access to state, but they
  // must not let it influence the data they return to the vat.

  // These will eventually be provided by the in-worker supervisor instead.

  // We need to give the vat the correct Remotable and getKernelPromise so
  // that they can access our own @agoric/marshal, not a separate instance in
  // a bundle. TODO: ideally the powerless ones (Remotable, getInterfaceOf,
  // maybe transformMetering) are imported by the vat, not passed in an
  // argument. The powerful one (makeGetMeter) should only be given to the
  // root object, to share with (or withhold from) other objects as it sees
  // fit. TODO: makeGetMeter and transformMetering will go away once #1288
  // lands and zoe no longer needs to do metering within a vat.
  const staticVatPowers = harden({
    Remotable,
    getInterfaceOf,
    makeGetMeter: meterManager.makeGetMeter,
    transformMetering: (...args) =>
      meterManager.runWithoutGlobalMeter(transformMetering, ...args),
    transformTildot: (...args) =>
      meterManager.runWithoutGlobalMeter(transformTildot, ...args),
    testLog,
  });

  // dynamic vats don't get control over their own metering, nor testLog
  const dynamicVatPowers = harden({
    Remotable,
    getInterfaceOf,
    transformTildot: (...args) =>
      meterManager.runWithoutGlobalMeter(transformTildot, ...args),
  });

  function vatNameToID(name) {
    const vatID = kernelKeeper.getVatIDForName(name);
    insistVatID(vatID);
    return vatID;
  }

  function deviceNameToID(name) {
    const deviceID = kernelKeeper.getDeviceIDForName(name);
    insistDeviceID(deviceID);
    return deviceID;
  }

  function addImport(forVatID, what) {
    if (!started) {
      throw new Error('must do kernel.start() before addImport()');
      // because otherwise we can't get the vatManager
    }
    insistVatID(forVatID);
    const kernelSlot = `${what}`;
    parseKernelSlot(what);
    const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(forVatID);
    return vatKeeper.mapKernelSlotToVatSlot(kernelSlot);
  }

  function addExport(fromVatID, vatSlot) {
    if (!started) {
      throw new Error('must do kernel.start() before addExport()');
      // because otherwise we can't get the vatKeeper
    }
    insistVatID(fromVatID);
    assert(parseVatSlot(vatSlot).allocatedByVat);
    const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(fromVatID);
    return vatKeeper.mapVatSlotToKernelSlot(vatSlot);
  }

  const kernelSyscallHandler = makeKernelSyscallHandler({
    kernelKeeper,
    ephemeral,
    pendingMessageResults,
    // eslint-disable-next-line no-use-before-define
    notify,
    // eslint-disable-next-line no-use-before-define
    notifySubscribersAndQueue,
  });

  // If `kernelPanic` is set to non-null, vat execution code will throw it as an
  // error at the first opportunity
  let kernelPanic = null;

  function panic(problem, err) {
    console.error(`##### KERNEL PANIC: ${problem} #####`);
    kernelPanic = err || new Error(`kernel panic ${problem}`);
  }

  // returns a message-result reader, with .status() (that returns one of
  // 'pending', 'fulfilled', or 'rejected') and .resolution() (that returns a
  // value only if status is not 'pending')
  //
  // 'policy' is one of 'ignore', 'logAlways', 'logFailure', or 'panic'
  //
  function queueToExport(vatID, vatSlot, method, args, policy = 'ignore') {
    // queue a message on the end of the queue, with 'absolute' kernelSlots.
    // Use 'step' or 'run' to execute it
    if (!started) {
      throw new Error('must do kernel.start() before queueToExport()');
    }
    insistVatID(vatID);
    parseVatSlot(vatSlot);
    insistCapData(args);
    args.slots.forEach(s => parseKernelSlot(s)); // typecheck

    const resultPromise = kernelKeeper.addKernelPromise();
    const [resultRead, resultWrite] = makeMessageResult(method, policy, panic);
    pendingMessageResults.set(resultPromise, resultWrite);

    const msg = harden({ method, args, result: resultPromise });
    const kernelSlot = addExport(vatID, vatSlot);
    kernelSyscallHandler.send(kernelSlot, msg);
    return resultRead;
  }

  async function deliverToVat(vatID, target, msg) {
    insistMessage(msg);
    const vat = ephemeral.vats.get(vatID);
    assert(vat, details`unknown vatID ${vatID}`);
    kernelKeeper.incStat('dispatches');
    kernelKeeper.incStat('dispatchDeliver');
    const kd = harden(['message', target, msg]);
    const vd = vat.translators.kernelDeliveryToVatDelivery(kd);
    try {
      await vat.manager.deliver(vd);
    } catch (e) {
      // log so we get a stack trace
      console.error(`error in kernel.deliver:`, e);
      throw e;
    }
  }

  function getKernelResolveablePromise(kpid) {
    insistKernelType('promise', kpid);
    const p = kernelKeeper.getKernelPromise(kpid);
    assert(p.state === 'unresolved', details`${kpid} was already resolved`);
    assert(!p.decider, details`${kpid} is decided by ${p.decider}, not kernel`);
    return p;
  }

  function notify(vatID, kpid) {
    const m = harden({ type: 'notify', vatID, kpid });
    kernelKeeper.incrementRefCount(kpid, `enq|notify`);
    kernelKeeper.addToRunQueue(m);
  }

  function notifySubscribersAndQueue(kpid, resolvingVatID, subscribers, queue) {
    insistKernelType('promise', kpid);
    for (const vatID of subscribers) {
      if (vatID !== resolvingVatID) {
        notify(vatID, kpid);
      }
    }
    // re-deliver msg to the now-settled promise, which will forward or
    // reject depending on the new state of the promise
    for (const msg of queue) {
      // todo: this is slightly lazy, sending the message back to the same
      // promise that just got resolved. When this message makes it to the
      // front of the run-queue, we'll look up the resolution. Instead, we
      // could maybe look up the resolution *now* and set the correct target
      // early. Doing that might make it easier to remove the Promise Table
      // entry earlier.
      kernelSyscallHandler.send(kpid, msg);
    }
  }

  function makeError(s) {
    // TODO: create a @qclass=error, once we define those
    // or maybe replicate whatever happens with {}.foo()
    // or 3.foo() etc: "TypeError: {}.foo is not a function"
    return harden({ body: JSON.stringify(s), slots: [] });
  }

  function deliverToError(kpid, errorData) {
    // todo: see if this can be merged with reject()
    insistCapData(errorData);
    const p = getKernelResolveablePromise(kpid);
    const { subscribers, queue } = p;
    kernelKeeper.rejectKernelPromise(kpid, errorData);
    notifySubscribersAndQueue(kpid, undefined, subscribers, queue);
  }

  async function deliverToTarget(target, msg) {
    insistMessage(msg);
    const { type } = parseKernelSlot(target);
    if (type === 'object') {
      const vatID = kernelKeeper.ownerOfKernelObject(target);
      insistVatID(vatID);
      await deliverToVat(vatID, target, msg);
    } else if (type === 'promise') {
      const kp = kernelKeeper.getKernelPromise(target);
      if (kp.state === 'fulfilledToPresence') {
        await deliverToTarget(kp.slot, msg);
      } else if (kp.state === 'redirected') {
        // await deliverToTarget(kp.redirectTarget, msg); // probably correct
        throw new Error('not implemented yet');
      } else if (kp.state === 'fulfilledToData') {
        if (msg.result) {
          const s = `data is not callable, has no method ${msg.method}`;
          await deliverToError(msg.result, makeError(s));
        }
        // todo: maybe log error?
      } else if (kp.state === 'rejected') {
        // TODO would it be simpler to redirect msg.kpid to kp?
        if (msg.result) {
          await deliverToError(msg.result, kp.data);
        }
      } else if (kp.state === 'unresolved') {
        if (!kp.decider) {
          kernelKeeper.addMessageToPromiseQueue(target, msg);
        } else {
          insistVatID(kp.decider);
          const vat = ephemeral.vats.get(kp.decider);
          if (vat.enablePipelining) {
            await deliverToVat(kp.decider, target, msg);
          } else {
            kernelKeeper.addMessageToPromiseQueue(target, msg);
          }
        }
      } else {
        throw new Error(`unknown kernelPromise state '${kp.state}'`);
      }
    } else {
      throw Error(`unable to send() to slot.type ${type}`);
    }
  }

  function statNameForNotify(state) {
    switch (state) {
      case 'fulfilledToPresence':
        return 'dispatchNotifyFulfillToPresence';
      case 'fulfilledToData':
        return 'dispatchNotifyFulfillToData';
      case 'rejected':
        return 'dispatchReject';
      default:
        throw Error(`unknown promise state ${state}`);
    }
  }

  async function processNotify(message) {
    const { vatID, kpid } = message;
    insistVatID(vatID);
    insistKernelType('promise', kpid);
    const vat = ephemeral.vats.get(vatID);
    assert(vat, details`unknown vatID ${vatID}`);
    kernelKeeper.incStat('dispatches');
    const p = kernelKeeper.getKernelPromise(kpid);
    kernelKeeper.incStat(statNameForNotify(p.state));
    const kd = harden(['notify', kpid, p]);
    const vd = vat.translators.kernelDeliveryToVatDelivery(kd);
    try {
      await vat.manager.deliver(vd);
    } catch (e) {
      // log so we get a stack trace
      console.error(`error in kernel.processNotify:`, e);
      throw e;
    }
  }

  function legibilizeMessage(message) {
    if (message.type === 'send') {
      const msg = message.msg;
      const argList = legibilizeMessageArgs(msg.args).join(', ');
      const result = msg.result ? msg.result : 'null';
      return `@${message.target} <- ${msg.method}(${argList}) : @${result}`;
    } else if (message.type === 'notify') {
      return `notify(vatID: ${message.vatID}, kpid: @${message.kpid})`;
    } else {
      return `unknown message type ${message.type}`;
    }
  }

  let processQueueRunning;
  async function processQueueMessage(message) {
    kdebug(`processQ ${JSON.stringify(message)}`);
    kdebug(legibilizeMessage(message));
    if (processQueueRunning) {
      console.error(`We're currently already running at`, processQueueRunning);
      throw Error(`Kernel reentrancy is forbidden`);
    }
    try {
      processQueueRunning = Error('here');
      if (message.type === 'send') {
        kernelKeeper.decrementRefCount(message.target, `deq|msg|t`);
        kernelKeeper.decrementRefCount(message.msg.result, `deq|msg|r`);
        let idx = 0;
        for (const argSlot of message.msg.args.slots) {
          kernelKeeper.decrementRefCount(argSlot, `deq|msg|s${idx}`);
          idx += 1;
        }
        await deliverToTarget(message.target, message.msg);
      } else if (message.type === 'notify') {
        kernelKeeper.decrementRefCount(message.kpid, `deq|notify`);
        await processNotify(message);
      } else {
        throw Error(`unable to process message.type ${message.type}`);
      }
      kernelKeeper.purgeDeadKernelPromises();
      kernelKeeper.saveStats();
      commitCrank();
      kernelKeeper.incrementCrankNumber();
    } finally {
      processQueueRunning = undefined;
    }
  }

  // this is for unit tests
  function addGenesisVatSetup(name, setup, options = {}) {
    if (typeof setup !== 'function') {
      throw Error(`setup is not a function, rather ${setup}`);
    }
    const knownOptions = new Set(['enablePipelining']);
    for (const k of Object.getOwnPropertyNames(options)) {
      if (!knownOptions.has(k)) {
        throw Error(`unknown option ${k}`);
      }
    }

    if (started) {
      throw Error(`addGenesisVat() cannot be called after kernel.start`);
    }
    if (genesisVats.has(name)) {
      throw Error(`vatID ${name} already added`);
    }

    genesisVats.set(name, { setup, options });
  }

  function addGenesisVat(name, bundle, options = {}) {
    // todo: consider having vats indicate 'enablePipelining' by exporting a
    // boolean, rather than options= . We'd have to retrieve the flag from
    // the VatManager, since it isn't available until the bundle is evaluated
    if (typeof bundle !== 'object') {
      throw Error(`bundle is not an object, rather ${bundle}`);
    }
    const knownOptions = new Set(['enablePipelining']);
    for (const k of Object.getOwnPropertyNames(options)) {
      if (!knownOptions.has(k)) {
        throw Error(`unknown option ${k}`);
      }
    }
    if (started) {
      throw Error(`addGenesisVat() cannot be called after kernel.start`);
    }
    if (genesisVats.has(name)) {
      throw Error(`vatID ${name} already added`);
    }
    genesisVats.set(name, { bundle, options });
  }

  function addGenesisDevice(name, bundle, endowments) {
    console.debug(`kernel.addDevice(${name})`);
    if (typeof bundle !== 'object') {
      throw Error(`bundle is not an object, rather ${bundle}`);
    }
    if (started) {
      throw new Error(`addDevice() cannot be called after kernel.start`);
    }
    if (genesisDevices.has(name)) {
      throw new Error(`deviceName ${name} already added`);
    }
    genesisDevices.set(name, { bundle, endowments });
  }

  // todo: we condition on having vatAdminDeviceBundle because some kernel
  // tests don't use controller.buildVatController (they don't care about
  // vats and devices), so this isn't called. We should fix those tests.
  let vatAdminDeviceBundle;
  function addVatAdminDevice(bundle) {
    vatAdminDeviceBundle = bundle;
  }

  function makeVatRootObjectSlot() {
    return makeVatSlot('object', true, 0);
  }

  function callBootstrap(bootstrapVatID, argvString) {
    // we invoke obj[0].bootstrap with an object that contains 'vats' and
    // 'argv'.
    insistVatID(bootstrapVatID);
    const argv = JSON.parse(`${argvString}`);
    // each key of 'vats' will be serialized as a reference to its obj0
    const vrefs = new Map();
    const vatObj0s = {};
    const vatSlot = makeVatRootObjectSlot();
    kernelKeeper.getAllVatNames().forEach(name => {
      const vatID = kernelKeeper.getVatIDForName(name);
      // we happen to give _bootstrap to itself, because unit tests that
      // don't have any other vats (bootstrap-only configs) then get a
      // non-empty object as vatObj0s, since an empty object would be
      // serialized as pass-by-presence. It wouldn't make much sense for the
      // bootstrap object to call itself, though.
      const vref = harden({
        toString() {
          return name;
        },
      }); // marker
      vatObj0s[name] = vref;
      const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(vatID);
      const kernelSlot = vatKeeper.mapVatSlotToKernelSlot(vatSlot);
      vrefs.set(vref, kernelSlot);
      console.debug(`adding vref ${name} [${vatID}]`);
    });

    const drefs = new Map();
    // we cannot serialize empty objects as pass-by-copy, because we decided
    // to make them pass-by-presence for use as EQ-able markers (eg for
    // Purses). So if we don't have any devices defined, we must add a dummy
    // entry to this object so it will serialize as pass-by-copy. We can
    // remove the dummy entry after we add the 'addVat' device
    const deviceObj0s = { _dummy: 'dummy' };
    kernelKeeper.getAllDeviceNames().forEach(name => {
      const deviceID = kernelKeeper.getDeviceIDForName(name);
      const dref = harden({});
      deviceObj0s[name] = dref;
      const devSlot = makeVatSlot('device', true, 0);
      const devKeeper = kernelKeeper.allocateDeviceKeeperIfNeeded(deviceID);
      const kernelSlot = devKeeper.mapDeviceSlotToKernelSlot(devSlot);
      drefs.set(dref, kernelSlot);
      console.debug(`adding dref ${name} [${deviceID}]`);
    });
    if (Object.getOwnPropertyNames(deviceObj0s) === 0) {
      throw new Error('pass-by-copy rules require at least one device');
    }

    function convertValToSlot(val) {
      if (vrefs.has(val)) {
        return vrefs.get(val);
      }
      if (drefs.has(val)) {
        return drefs.get(val);
      }
      console.error(`oops ${val}`, val);
      throw Error('bootstrap got unexpected pass-by-presence');
    }

    const m = makeMarshal(convertValToSlot);
    const args = harden([argv, vatObj0s, deviceObj0s]);
    // queueToExport() takes kernel-refs (ko+NN, kd+NN) in s.slots
    const rootSlot = makeVatRootObjectSlot();
    return queueToExport(
      bootstrapVatID,
      rootSlot,
      'bootstrap',
      m.serialize(args),
      'panic',
    );
  }

  const vatManagerFactory = makeVatManagerFactory({
    dynamicVatPowers,
    kernelKeeper,
    makeVatEndowments,
    meterManager,
    staticVatPowers,
    testLog,
    transformMetering,
    waitUntilQuiescent,
  });

  /*
   * Take an existing VatManager (which is already configured to talk to a
   * VatWorker, loaded with some vat code) and connect it to the rest of the
   * kernel. The vat must be ready to go: any initial buildRootObject
   * construction should have happened by this point. However the kernel
   * might tell the manager to replay the transcript later, if it notices
   * we're reloading a saved state vector.
   */
  function addVatManager(vatID, manager, options) {
    // addVatManager takes a manager, not a promise for one
    assert(
      manager.deliver && manager.setVatSyscallHandler,
      `manager lacks .deliver, isPromise=${manager instanceof Promise}`,
    );
    const { enablePipelining = false } = options;
    // This should create the vatKeeper. Other users get it from the
    // kernelKeeper, so we don't need a reference ourselves.
    kernelKeeper.allocateVatKeeperIfNeeded(vatID);
    const translators = makeVatTranslators(vatID, kernelKeeper);

    ephemeral.vats.set(
      vatID,
      harden({
        translators,
        manager,
        enablePipelining: Boolean(enablePipelining),
      }),
    );

    // This handler never throws. The VatSyscallResult it returns is one of:
    // * success, no response data: ['ok', null]
    // * success, capdata (callNow) ['ok', capdata]
    // * error: you are dead ['error, description]
    // the VatManager+VatWorker will see the error case, but liveslots will
    // not
    function vatSyscallHandler(vatSyscallObject) {
      let ksc;
      try {
        // this can fail if the vat asks for something not on their clist,
        // which is fatal to the vat
        ksc = translators.vatSyscallToKernelSyscall(vatSyscallObject);
      } catch (vaterr) {
        console.error(`vat ${vatID} error during translation: ${vaterr}`);
        console.error(`vat terminated`);
        // TODO: mark the vat as dead, reject subsequent syscalls, withhold
        // deliveries, notify adminvat
        return harden(['error', 'clist violation: prepare to die']);
      }

      let vres;
      try {
        // this can fail if kernel or device code is buggy
        const kres = kernelSyscallHandler.doKernelSyscall(ksc);
        // kres is a KernelResult ([successFlag, capdata]), but since errors
        // here are signalled with exceptions, kres is either ['ok', capdata]
        // or ['ok', null]. Vats (liveslots) record the response in the
        // transcript (which is why we use 'null' instead of 'undefined',
        // TODO clean this up), but otherwise most syscalls ignore it. The
        // one syscall that pays attention is callNow(), which assumes it's
        // capdata.
        vres = translators.kernelSyscallResultToVatSyscallResult(kres);
        // here, vres is either ['ok', null] or ['ok', capdata]
      } catch (err) {
        // kernel/device errors cause a kernel panic
        panic(`error during syscall/device.invoke: ${err}`, err);
        // the kernel is now in a shutdown state, but it may take a while to
        // grind to a halt
        return harden(['error', 'you killed my kernel. prepare to die']);
      }

      return vres;
    }
    manager.setVatSyscallHandler(vatSyscallHandler);
  }

  const createVatDynamically = makeDynamicVatCreator({
    allocateUnusedVatID: kernelKeeper.allocateUnusedVatID,
    vatNameToID,
    vatManagerFactory,
    addVatManager,
    addExport,
    queueToExport,
  });

  function buildDeviceManager(deviceID, name, buildRootDeviceNode, endowments) {
    const deviceKeeper = kernelKeeper.allocateDeviceKeeperIfNeeded(deviceID);
    // Wrapper for state, to give to the device to access its state.
    // Devices are allowed to get their state at startup, and set it anytime.
    // They do not use orthogonal persistence or transcripts.
    const state = harden({
      get() {
        return deviceKeeper.getDeviceState();
      },
      set(value) {
        deviceKeeper.setDeviceState(value);
      },
    });
    const manager = makeDeviceManager(
      name,
      buildRootDeviceNode,
      state,
      endowments,
      testLog,
    );
    return manager;
  }

  // plug a new DeviceManager into the kernel
  function addDeviceManager(deviceID, name, manager) {
    const translators = makeDeviceTranslators(deviceID, name, kernelKeeper);
    function deviceSyscallHandler(deviceSyscallObject) {
      const ksc = translators.deviceSyscallToKernelSyscall(deviceSyscallObject);
      // devices can only do syscall.sendOnly, which has no results
      kernelSyscallHandler.doKernelSyscall(ksc);
    }
    manager.setDeviceSyscallHandler(deviceSyscallHandler);

    ephemeral.devices.set(deviceID, {
      translators,
      manager,
    });
  }

  function collectVatStats(vatID) {
    insistVatID(vatID);
    const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(vatID);
    return vatKeeper.vatStats();
  }

  async function start(bootstrapVatName, argvString) {
    if (started) {
      throw new Error('kernel.start already called');
    }
    started = true;
    const wasInitialized = kernelKeeper.getInitialized();
    console.debug(`wasInitialized = ${wasInitialized}`);

    // if the state is not yet initialized, populate the starting state
    if (!wasInitialized) {
      kernelKeeper.createStartingKernelState();
    }

    // instantiate all vats
    for (const name of genesisVats.keys()) {
      const { setup, bundle, options } = genesisVats.get(name);
      const vatID = kernelKeeper.allocateVatIDForNameIfNeeded(name);
      console.debug(`Assigned VatID ${vatID} for genesis vat ${name}`);
      // eslint-disable-next-line no-await-in-loop
      const manager = await (setup
        ? vatManagerFactory.createFromSetup(setup, vatID)
        : vatManagerFactory.createFromBundle(bundle, vatID, {
            metered: false,
            vatPowerType: 'static',
            allowSetup: true, // TODO: only needed by comms, disallow elsewhere
          }));
      addVatManager(vatID, manager, options);
    }

    if (vatAdminDeviceBundle) {
      // if we have a device bundle, then vats[vatAdmin] will be present too
      const endowments = {
        create: createVatDynamically,
        stats: collectVatStats,
        /* TODO: terminate */
      };
      genesisDevices.set('vatAdmin', {
        bundle: vatAdminDeviceBundle,
        endowments,
      });
    }

    // instantiate all devices
    for (const name of genesisDevices.keys()) {
      const deviceID = kernelKeeper.allocateDeviceIDForNameIfNeeded(name);
      console.debug(`Assigned DeviceID ${deviceID} for genesis device ${name}`);
      const { bundle, endowments: devEndowments } = genesisDevices.get(name);
      // eslint-disable-next-line no-await-in-loop
      const NS = await importBundle(bundle, {
        filePrefix: `dev-${name}`,
        endowments: makeVatEndowments(`dev-${name}`),
      });
      assert(
        typeof NS.buildRootDeviceNode === 'function',
        `device ${name} lacks buildRootDeviceNode`,
      );
      const manager = buildDeviceManager(
        deviceID,
        name,
        NS.buildRootDeviceNode,
        devEndowments,
      );
      addDeviceManager(deviceID, name, manager);
    }

    // And enqueue the bootstrap() call. If we're reloading from an
    // initialized state vector, this call will already be in the bootstrap
    // vat's transcript, so we don't re-queue it.
    let bootstrapResult = null;
    if (!wasInitialized && bootstrapVatName) {
      const bootstrapVatID = vatNameToID(bootstrapVatName);
      console.debug(`=> queueing bootstrap()`);
      bootstrapResult = callBootstrap(bootstrapVatID, argvString);
    }

    // if it *was* initialized, replay the transcripts
    if (wasInitialized) {
      console.info('Replaying SwingSet transcripts');
      const oldLength = kernelKeeper.getRunQueueLength();
      for (const vatID of ephemeral.vats.keys()) {
        console.debug(`Replaying transcript of vatID ${vatID}`);
        const vat = ephemeral.vats.get(vatID);
        // eslint-disable-next-line no-await-in-loop
        await vat.manager.replayTranscript();
        console.debug(`finished replaying vatID ${vatID} transcript `);
      }
      const newLength = kernelKeeper.getRunQueueLength();
      if (newLength !== oldLength) {
        throw new Error(
          `replayTranscript added run-queue entries, wasn't supposed to`,
        );
      }
      kernelKeeper.loadStats();
    }

    kernelKeeper.setInitialized();
    kernelKeeper.saveStats();
    commitCrank(); // commit "crank 0"
    kernelKeeper.incrementCrankNumber();
    return bootstrapResult;
  }

  async function step() {
    if (kernelPanic) {
      throw kernelPanic;
    }
    if (!started) {
      throw new Error('must do kernel.start() before step()');
    }
    // process a single message
    if (!kernelKeeper.isRunQueueEmpty()) {
      await processQueueMessage(kernelKeeper.getNextMsg());
      if (kernelPanic) {
        throw kernelPanic;
      }
      return 1;
    } else {
      return 0;
    }
  }

  async function run() {
    if (kernelPanic) {
      throw kernelPanic;
    }
    if (!started) {
      throw new Error('must do kernel.start() before run()');
    }
    let count = 0;
    while (!kernelKeeper.isRunQueueEmpty()) {
      // eslint-disable-next-line no-await-in-loop
      await processQueueMessage(kernelKeeper.getNextMsg());
      if (kernelPanic) {
        throw kernelPanic;
      }
      count += 1;
    }
    return count;
  }

  const kernel = harden({
    // these are meant for the controller
    addGenesisVat,
    addGenesisDevice,
    addVatAdminDevice,
    start,

    step,
    run,

    // the rest are for testing and debugging

    addGenesisVatSetup,

    log(str) {
      ephemeral.log.push(`${str}`);
    },

    getStats() {
      return kernelKeeper.getStats();
    },
    dump() {
      // note: dump().log is not deterministic, since log() does not go
      // through the syscall interface (and we replay transcripts one vat at
      // a time, so any log() calls that were interleaved during their
      // original execution will be sorted by vat in the replace). Logs are
      // not kept in the persistent state, only in ephemeral state.
      return { log: ephemeral.log, ...kernelKeeper.dump() };
    },
    kdebugEnable,

    addImport,
    addExport,
    vatNameToID,
    deviceNameToID,
    queueToExport,
  });

  return kernel;
}
