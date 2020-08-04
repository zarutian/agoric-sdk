/* global harden */
import { assert, details } from '@agoric/assert';
import { insistKernelType, parseKernelSlot } from './parseKernelSlots';
import { insistMessage } from '../message';
import { insistCapData } from '../capdata';
import { insistDeviceID, insistVatID } from './id';

export function makeKernelSyscallHandler(tools) {
  const {
    kernelKeeper,
    ephemeral,
    pendingMessageResults,
    notify,
    notifySubscribersAndQueue,
  } = tools;

  const OKNULL = harden(['ok', null]);

  function send(target, msg) {
    parseKernelSlot(target);
    insistMessage(msg);
    const m = harden({ type: 'send', target, msg });
    kernelKeeper.incrementRefCount(target, `enq|msg|t`);
    kernelKeeper.incrementRefCount(msg.result, `enq|msg|r`);
    kernelKeeper.incStat('syscalls');
    kernelKeeper.incStat('syscallSend');
    let idx = 0;
    for (const argSlot of msg.args.slots) {
      kernelKeeper.incrementRefCount(argSlot, `enq|msg|s${idx}`);
      idx += 1;
    }
    kernelKeeper.addToRunQueue(m);
    return OKNULL;
  }

  function invoke(deviceSlot, method, args) {
    insistKernelType('device', deviceSlot);
    insistCapData(args);
    kernelKeeper.incStat('syscalls');
    kernelKeeper.incStat('syscallCallNow');
    const deviceID = kernelKeeper.ownerOfKernelDevice(deviceSlot);
    insistDeviceID(deviceID);
    const dev = ephemeral.devices.get(deviceID);
    if (!dev) {
      throw new Error(`unknown deviceRef ${deviceSlot}`);
    }
    const ki = harden([deviceSlot, method, args]);
    const di = dev.translators.kernelInvocationToDeviceInvocation(ki);
    const dr = dev.manager.invoke(di);
    const kr = dev.translators.deviceResultToKernelResult(dr);
    assert(kr.length === 2);
    assert(kr[0] === 'ok');
    insistCapData(kr[1]);
    return kr;
  }

  function subscribe(vatID, kpid) {
    insistVatID(vatID);
    kernelKeeper.incStat('syscalls');
    kernelKeeper.incStat('syscallSubscribe');
    const p = kernelKeeper.getKernelPromise(kpid);
    if (p.state === 'unresolved') {
      kernelKeeper.addSubscriberToPromise(kpid, vatID);
    } else {
      // otherwise it's already resolved, you probably want to know how
      notify(vatID, kpid);
    }
    return OKNULL;
  }

  function getResolveablePromise(kpid, resolvingVatID) {
    insistKernelType('promise', kpid);
    insistVatID(resolvingVatID);
    const p = kernelKeeper.getKernelPromise(kpid);
    assert(p.state === 'unresolved', details`${kpid} was already resolved`);
    assert(
      p.decider === resolvingVatID,
      details`${kpid} is decided by ${p.decider}, not ${resolvingVatID}`,
    );
    return p;
  }

  function notePendingMessageResolution(kpid, status, resolution) {
    const result = pendingMessageResults.get(kpid);
    pendingMessageResults.delete(kpid);
    result.noteResolution(status, resolution);
  }

  function fulfillToPresence(vatID, kpid, targetSlot) {
    insistVatID(vatID);
    insistKernelType('promise', kpid);
    insistKernelType('object', targetSlot);
    kernelKeeper.incStat('syscalls');
    kernelKeeper.incStat('syscallFulfillToPresence');
    const p = getResolveablePromise(kpid, vatID);
    const { subscribers, queue } = p;
    kernelKeeper.fulfillKernelPromiseToPresence(kpid, targetSlot);
    notifySubscribersAndQueue(kpid, vatID, subscribers, queue);
    // todo: some day it'd be nice to delete the promise table entry now. To
    // do that correctly, we must make sure no vats still hold pointers to
    // it, which means vats must drop their refs when they get notified about
    // the resolution ("you knew it was resolved, you shouldn't be sending
    // any more messages to it, send them to the resolution instead"), and we
    // must wait for those notifications to be delivered.
    if (pendingMessageResults.has(kpid)) {
      const data = {
        body: '{"@qclass":"slot",index:0}',
        slots: [targetSlot],
      };
      notePendingMessageResolution(kpid, 'fulfilled', data);
    }
    return OKNULL;
  }

  function fulfillToData(vatID, kpid, data) {
    insistVatID(vatID);
    insistKernelType('promise', kpid);
    insistCapData(data);
    kernelKeeper.incStat('syscalls');
    kernelKeeper.incStat('syscallFulfillToData');
    const p = getResolveablePromise(kpid, vatID);
    const { subscribers, queue } = p;
    let idx = 0;
    for (const dataSlot of data.slots) {
      kernelKeeper.incrementRefCount(dataSlot, `fulfill|s${idx}`);
      idx += 1;
    }
    kernelKeeper.fulfillKernelPromiseToData(kpid, data);
    notifySubscribersAndQueue(kpid, vatID, subscribers, queue);
    if (pendingMessageResults.has(kpid)) {
      notePendingMessageResolution(kpid, 'fulfilled', data);
    }
    return OKNULL;
  }

  function reject(vatID, kpid, data) {
    insistVatID(vatID);
    insistKernelType('promise', kpid);
    insistCapData(data);
    kernelKeeper.incStat('syscalls');
    kernelKeeper.incStat('syscallReject');
    const p = getResolveablePromise(kpid, vatID);
    const { subscribers, queue } = p;
    let idx = 0;
    for (const dataSlot of data.slots) {
      kernelKeeper.incrementRefCount(dataSlot, `reject|s${idx}`);
      idx += 1;
    }
    kernelKeeper.rejectKernelPromise(kpid, data);
    notifySubscribersAndQueue(kpid, vatID, subscribers, queue);
    if (pendingMessageResults.has(kpid)) {
      notePendingMessageResolution(kpid, 'rejected', data);
    }
    return OKNULL;
  }

  function doKernelSyscall(ksc) {
    const [type, ...args] = ksc;
    switch (type) {
      case 'send':
        return send(...args);
      case 'invoke':
        return invoke(...args);
      case 'subscribe':
        return subscribe(...args);
      case 'fulfillToPresence':
        return fulfillToPresence(...args);
      case 'fulfillToData':
        return fulfillToData(...args);
      case 'reject':
        return reject(...args);
      default:
        throw Error(`unknown vatSyscall type ${type}`);
    }
  }

  const kernelSyscallHandler = harden({
    send,
    invoke,
    subscribe,
    fulfillToPresence,
    fulfillToData,
    reject,
    doKernelSyscall,
  });
  return kernelSyscallHandler;
}
