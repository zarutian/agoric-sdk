/* global harden */

import { E, HandledPromise } from '@agoric/eventual-send';
import { isPromise } from '@agoric/promise-kit';

export { E };

import { makeMarshallKit } from "./syrup.js";

/**
 * Create a CapTP connection.
 *
 * @param {string} ourId our name for the current side
 * @param {(obj: Record<string, any>) => void} rawSend send a Uint8Array packet
 * @param {any} bootstrapObj the object to export to the other side
 * @param {Partial<CapTPOptions>} opts options to the connection
 */
export function makeCapTP(ourId, rawSend, bootstrapObj = undefined, opts = {}) {
  const bytewriter = rawSend;
  const {bytereader, dispatch} = (() => {
    var buffer = new Uint8Array(0);
    const pendingReads = []; // Tja hvernig ætti'tta að fara?
    const dispatch = (chunk) => {
      return undefined
    };
    return { bytereader, dispatch };
  })();

  return harden({ abort, dispatch, getBootstrap, serialize, unserialize });
}
