/* global harden */
import { assert, details } from '@agoric/assert';
import { insistMessage } from '../message';
import { insistKernelType, parseKernelSlot } from './parseKernelSlots';
import { insistVatType, parseVatSlot } from '../parseVatSlots';
import { insistCapData } from '../capdata';
import { kdebug, legibilizeMessageArgs } from './kdebug';
import { deleteCListEntryIfEasy } from './cleanup';

/*
 * Return a function that converts KernelDelivery objects into VatDelivery
 * objects
 */
function makeTranslateKernelDeliveryToVatDelivery(vatID, kernelKeeper) {
  const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(vatID);
  const { mapKernelSlotToVatSlot } = vatKeeper;

  // msg is { method, args, result }, all slots are kernel-centric
  function translateMessage(target, msg) {
    insistMessage(msg);
    const targetSlot = mapKernelSlotToVatSlot(target);
    const { type } = parseVatSlot(targetSlot);
    if (type === 'object') {
      assert(parseVatSlot(targetSlot).allocatedByVat, 'deliver() to wrong vat');
    } else if (type === 'promise') {
      const p = kernelKeeper.getKernelPromise(target);
      assert(p.decider === vatID, 'wrong decider');
    }
    const inputSlots = msg.args.slots.map(slot => mapKernelSlotToVatSlot(slot));
    let resultSlot = null;
    if (msg.result) {
      insistKernelType('promise', msg.result);
      const p = kernelKeeper.getKernelPromise(msg.result);
      assert(
        p.state === 'unresolved',
        details`result ${msg.result} already resolved`,
      );
      assert(
        !p.decider,
        details`result ${msg.result} already has decider ${p.decider}`,
      );
      resultSlot = vatKeeper.mapKernelSlotToVatSlot(msg.result);
      insistVatType('promise', resultSlot);
      kernelKeeper.setDecider(msg.result, vatID);
    }

    const vatMessage = harden({
      method: msg.method,
      args: { ...msg.args, slots: inputSlots },
      result: resultSlot,
    });
    const vatDelivery = harden(['message', targetSlot, vatMessage]);
    return vatDelivery;
  }

  function translateNotify(kpid, kp) {
    assert(kp.state !== 'unresolved', details`spurious notification ${kpid}`);
    const vpid = mapKernelSlotToVatSlot(kpid);
    const vp = { state: kp.state };
    if (kp.state === 'fulfilledToPresence') {
      vp.slot = mapKernelSlotToVatSlot(kp.slot);
      vatKeeper.deleteCListEntry(kpid, vpid);
    } else if (kp.state === 'redirected') {
      throw new Error('not implemented yet');
    } else if (kp.state === 'fulfilledToData' || kp.state === 'rejected') {
      vp.data = {
        ...kp.data,
        slots: kp.data.slots.map(slot => mapKernelSlotToVatSlot(slot)),
      };
      deleteCListEntryIfEasy(vatID, vatKeeper, kpid, vpid, kp.data);
    } else {
      throw new Error(`unknown kernelPromise state '${kp.state}'`);
    }
    const vatDelivery = harden(['notify', vpid, vp]);
    return vatDelivery;
  }

  function kernelDeliveryToVatDelivery(kd) {
    const [type, ...args] = kd;
    switch (type) {
      case 'message':
        return translateMessage(...args);
      case 'notify':
        return translateNotify(...args);
      default:
        throw Error(`unknown kernelDelivery.type ${type}`);
    }
    // returns ['message', target, msg] or ['notify', vpid, vp]
  }

  return kernelDeliveryToVatDelivery;
}

/*
 * return a function that converts VatSyscall objects into KernelSyscall
 * objects
 */
function makeTranslateVatSyscallToKernelSyscall(vatID, kernelKeeper) {
  const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(vatID);
  const { mapVatSlotToKernelSlot } = vatKeeper;

  function translateSend(targetSlot, method, args, resultSlot) {
    assert(`${targetSlot}` === targetSlot, 'non-string targetSlot');
    insistCapData(args);
    // TODO: disable send-to-self for now, qv issue #43
    const target = mapVatSlotToKernelSlot(targetSlot);
    const argList = legibilizeMessageArgs(args).join(', ');
    // prettier-ignore
    kdebug(`syscall[${vatID}].send(vat:${targetSlot}=ker:${target}).${method}(${argList})`);
    const kernelSlots = args.slots.map(slot => mapVatSlotToKernelSlot(slot));
    const kernelArgs = harden({ ...args, slots: kernelSlots });
    let result = null;
    if (resultSlot) {
      insistVatType('promise', resultSlot);
      result = mapVatSlotToKernelSlot(resultSlot);
      insistKernelType('promise', result);
      // The promise must be unresolved, and this Vat must be the decider.
      // The most common case is that 'resultSlot' is a new exported promise
      // (p+NN). But it might be a previously-imported promise (p-NN) that
      // they got in a deliver() call, which gave them resolution authority.
      const p = kernelKeeper.getKernelPromise(result);
      assert(
        p.state === 'unresolved',
        details`send() result ${result} is already resolved`,
      );
      assert(
        p.decider === vatID,
        details`send() result ${result} is decided by ${p.decider} not ${vatID}`,
      );
      kernelKeeper.clearDecider(result);
      // resolution authority now held by run-queue
    }

    const msg = harden({
      method,
      args: kernelArgs,
      result,
    });
    insistMessage(msg);
    const ks = harden(['send', target, msg]);
    return ks;
  }

  function translateCallNow(target, method, args) {
    insistCapData(args);
    const dev = mapVatSlotToKernelSlot(target);
    const { type } = parseKernelSlot(dev);
    if (type !== 'device') {
      throw new Error(`doCallNow must target a device, not ${dev}`);
    }
    const kernelSlots = args.slots.map(slot => mapVatSlotToKernelSlot(slot));
    const kernelData = harden({ ...args, slots: kernelSlots });
    // prettier-ignore
    kdebug(`syscall[${vatID}].callNow(${target}/${dev}).${method}(${JSON.stringify(args)})`);
    return harden(['invoke', dev, method, kernelData]);
  }

  function translateSubscribe(promiseID) {
    const id = mapVatSlotToKernelSlot(promiseID);
    kdebug(`syscall[${vatID}].subscribe(vat:${promiseID}=ker:${id})`);
    if (!kernelKeeper.hasKernelPromise(id)) {
      throw new Error(`unknown kernelPromise id '${id}'`);
    }
    const ks = harden(['subscribe', vatID, id]);
    return ks;
  }

  function translateFulfillToPresence(promiseID, slot) {
    insistVatType('promise', promiseID);
    const kpid = mapVatSlotToKernelSlot(promiseID);
    const targetSlot = mapVatSlotToKernelSlot(slot);
    kdebug(
      `syscall[${vatID}].fulfillToPresence(${promiseID} / ${kpid}) = ${slot} / ${targetSlot})`,
    );
    vatKeeper.deleteCListEntry(kpid, promiseID);
    return harden(['fulfillToPresence', vatID, kpid, targetSlot]);
  }

  function translateFulfillToData(promiseID, data) {
    insistVatType('promise', promiseID);
    insistCapData(data);
    const kpid = mapVatSlotToKernelSlot(promiseID);
    const kernelSlots = data.slots.map(slot => mapVatSlotToKernelSlot(slot));
    const kernelData = harden({ ...data, slots: kernelSlots });
    kdebug(
      `syscall[${vatID}].fulfillData(${promiseID}/${kpid}) = ${
        data.body
      } ${JSON.stringify(data.slots)}/${JSON.stringify(kernelSlots)}`,
    );
    deleteCListEntryIfEasy(vatID, vatKeeper, kpid, promiseID, kernelData);
    return harden(['fulfillToData', vatID, kpid, kernelData]);
  }

  function translateReject(promiseID, data) {
    insistVatType('promise', promiseID);
    insistCapData(data);
    const kpid = mapVatSlotToKernelSlot(promiseID);
    const kernelSlots = data.slots.map(slot => mapVatSlotToKernelSlot(slot));
    const kernelData = harden({ ...data, slots: kernelSlots });
    kdebug(
      `syscall[${vatID}].reject(${promiseID}/${kpid}) = ${
        data.body
      } ${JSON.stringify(data.slots)}/${JSON.stringify(kernelSlots)}`,
    );
    deleteCListEntryIfEasy(vatID, vatKeeper, kpid, promiseID, kernelData);
    return harden(['reject', vatID, kpid, kernelData]);
  }

  // vsc is [type, ...args]
  // ksc is:
  //  ['send', ktarget, kmsg]
  function vatSyscallToKernelSyscall(vsc) {
    const [type, ...args] = vsc;
    switch (type) {
      case 'send':
        return translateSend(...args);
      case 'callNow':
        return translateCallNow(...args); // becomes invoke()
      case 'subscribe':
        return translateSubscribe(...args);
      case 'fulfillToPresence':
        return translateFulfillToPresence(...args);
      case 'fulfillToData':
        return translateFulfillToData(...args);
      case 'reject':
        return translateReject(...args);
      default:
        throw Error(`unknown vatSyscall type ${type}`);
    }
  }

  return vatSyscallToKernelSyscall;
}

/*
 * return a function that converts KernelSyscallResult objects into
 * VatSyscallResult objects
 */
function makeTranslateKernelSyscallResultToVatSyscallResult(
  vatID,
  kernelKeeper,
) {
  const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(vatID);

  const { mapKernelSlotToVatSlot } = vatKeeper;

  // Most syscalls return ['ok', null], but callNow() returns ['ok',
  // capdata]. KernelSyscallResult is never ['error', reason] because errors
  // (which are kernel-fatal) are signalled with exceptions.
  function kernelSyscallResultToVatSyscallResult(kres) {
    const [successFlag, kdata] = kres;
    assert(successFlag === 'ok', 'unexpected KSR error');
    if (kdata) {
      const slots = kdata.slots.map(slot => mapKernelSlotToVatSlot(slot));
      const vdata = { ...kdata, slots };
      const vres = harden(['ok', vdata]);
      return vres;
    }
    return harden(['ok', null]);
  }

  return kernelSyscallResultToVatSyscallResult;
}

export function makeVatTranslators(vatID, kernelKeeper) {
  const mKD = makeTranslateKernelDeliveryToVatDelivery;
  const mVS = makeTranslateVatSyscallToKernelSyscall;
  const mKSR = makeTranslateKernelSyscallResultToVatSyscallResult;

  return harden({
    kernelDeliveryToVatDelivery: mKD(vatID, kernelKeeper),
    vatSyscallToKernelSyscall: mVS(vatID, kernelKeeper),
    kernelSyscallResultToVatSyscallResult: mKSR(vatID, kernelKeeper),
  });
}
