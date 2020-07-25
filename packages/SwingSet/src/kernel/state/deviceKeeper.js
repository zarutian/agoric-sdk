/* global harden */

/**
 * Kernel's keeper of persistent state for a device.
 */

import Nat from '@agoric/nat';
import { assert, details } from '@agoric/assert';
import { parseKernelSlot } from '../parseKernelSlots';
import { makeVatSlot, parseVatSlot } from '../../parseVatSlots';
import { insistDeviceID } from '../id';

/**
 * Establish a device's state.
 *
 * @param storage  The storage in which the persistent state will be kept
 * @param deviceID  The device ID string of the device in question
 *
 * TODO move into makeDeviceKeeper?
 */
export function initializeDeviceState(storage, deviceID) {
  storage.set(`${deviceID}.o.nextID`, '10');
}

/**
 * Produce a device keeper for a device.
 *
 * @param storage  The storage in which the persistent state will be kept
 * @param deviceID  The device ID string of the device in question
 * @param addKernelDeviceNode  Kernel function to add a new device node to the
 *    kernel's mapping tables.
 *
 * @return an object to hold and access the kernel's state for the given device
 */
export function makeDeviceKeeper(storage, deviceID, addKernelDeviceNode) {
  insistDeviceID(deviceID);

  /**
   * Provide the kernel slot corresponding to a given device slot, including
   * creating the kernel slot if it doesn't already exist.
   *
   * @param devSlot  The device slot of interest
   *
   * @return the kernel slot that devSlot maps to
   *
   * @throws if devSlot is not a kind of thing that can be exported by devices
   *    or is otherwise invalid.
   */
  function mapDeviceSlotToKernelSlot(devSlot) {
    assert(`${devSlot}` === devSlot, details`non-string devSlot: ${devSlot}`);
    // kdebug(`mapOutbound ${devSlot}`);
    const devKey = `${deviceID}.c.${devSlot}`;
    if (!storage.has(devKey)) {
      const { type, allocatedByVat } = parseVatSlot(devSlot);

      if (allocatedByVat) {
        let kernelSlot;
        if (type === 'object') {
          throw new Error(`devices cannot export Objects`);
        } else if (type === 'promise') {
          throw new Error(`devices cannot export Promises`);
        } else if (type === 'device') {
          kernelSlot = addKernelDeviceNode(deviceID);
        } else {
          throw new Error(`unknown type ${type}`);
        }
        const kernelKey = `${deviceID}.c.${kernelSlot}`;
        storage.set(kernelKey, devSlot);
        storage.set(devKey, kernelSlot);
      } else {
        // the vat didn't allocate it, and the kernel didn't allocate it
        // (else it would have been in the c-list), so it must be bogus
        throw new Error(`unknown devSlot ${devSlot}`);
      }
    }

    return storage.get(devKey);
  }

  /**
   * Provide the device slot corresponding to a given kernel slot, including
   * creating the device slot if it doesn't already exist.
   *
   * @param kernelSlot  The kernel slot of interest
   *
   * @return the device slot kernelSlot maps to
   *
   * @throws if kernelSlot is not a kind of thing that can be imported by
   *    devices or is otherwise invalid.
   */
  function mapKernelSlotToDeviceSlot(kernelSlot) {
    assert(`${kernelSlot}` === kernelSlot, 'non-string kernelSlot');
    const kernelKey = `${deviceID}.c.${kernelSlot}`;
    if (!storage.has(kernelKey)) {
      const { type } = parseKernelSlot(kernelSlot);

      let id;
      if (type === 'object') {
        id = Nat(Number(storage.get(`${deviceID}.o.nextID`)));
        storage.set(`${deviceID}.o.nextID`, `${id + 1}`);
      } else if (type === 'device') {
        throw new Error('devices cannot import other device nodes');
      } else if (type === 'promise') {
        throw new Error('devices cannot import Promises');
      } else {
        throw new Error(`unknown type ${type}`);
      }
      const devSlot = makeVatSlot(type, false, id);

      const devKey = `${deviceID}.c.${devSlot}`;
      storage.set(devKey, kernelSlot);
      storage.set(kernelKey, devSlot);
    }

    return storage.get(kernelKey);
  }

  /**
   * Obtain the device's state.
   *
   * @return this device's state, or undefined if it has none.
   */
  function getDeviceState() {
    // this should return an object, generally CapData, or undefined
    const key = `${deviceID}.deviceState`;
    if (storage.has(key)) {
      return JSON.parse(storage.get(key));
      // todo: formalize the CapData, and store .deviceState.body, and
      // .deviceState.slots as 'vatSlot[,vatSlot..]'
    }
    return undefined;
  }

  /**
   * Set this device's state.
   *
   * @param value The value to set the state to.  This should be serializable.
   *    (NOTE: the intent is that the structure here will eventually be more
   *    codified than it is now).
   */
  function setDeviceState(value) {
    storage.set(`${deviceID}.deviceState`, JSON.stringify(value));
  }

  /**
   * Produce a dump of this device's state for debugging purposes.
   *
   * @return an array of this device's state information
   */
  function dumpState() {
    const res = [];
    const prefix = `${deviceID}.c.`;
    for (const k of storage.getKeys(prefix, `${deviceID}.c/`)) {
      // The bounds passed to getKeys() here work because '/' is the next
      // character in ASCII after '.'
      if (k.startsWith(prefix)) {
        const slot = k.slice(prefix.length);
        if (!slot.startsWith('k')) {
          const devSlot = slot;
          const kernelSlot = storage.get(k);
          res.push([kernelSlot, deviceID, devSlot]);
        }
      }
    }
    return harden(res);
  }

  return harden({
    mapDeviceSlotToKernelSlot,
    mapKernelSlotToDeviceSlot,
    getDeviceState,
    setDeviceState,
    dumpState,
  });
}
