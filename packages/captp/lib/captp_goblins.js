/* global harden */

import { E, HandledPromise } from '@agoric/eventual-send';
import { isPromise, makePromiseKit } from '@agoric/promise-kit';

export { E };

import { makeMarshallKit } from "./syrup.js";

const tagSym = new Symbol("tagSym");
const recordableStruct = (tagstr, memberNames, onUnmarshall) => {
  // þrjár leiðir að tilurð: make, makeFromObj, og unmarshall
  const sym = Symbol.for(tagstr);
  const make = (..args) => {
    const struct = {};
    struct[tagSym] = sym;
    memberNames.forEach((mn, i) => struct[mn] = args[i]);
    return harden(struct);
  }

  return harden({ make, makeFromObj, unmarshall, marshall });
}

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
    const pendingReads = [];
    const bytereader = (numOfBytes) => {
      const { promise, resolver } = makePromiseKit();
      const reread = () => {
        if (BigInt(buffer.byteLength) < BigInt(numOfBytes)) { return false; }
        const bytes = buffer.slice(0, numOfBytes);
        buffer = buffer.slice(numOfBytes);
        resolver.resolve(bytes);
        return true;
      };
      if (!reread()) {
        pendingReads.push(reread);
      }
      return promise;
    }
    const dispatch = (chunk) => {
      buffer = buffer.concat(chunk);
      do {
        const reread = pendingReads.shift();
        const framhald = reread();
        if (!framhald) { pendingReads.unshift(reread); }
      } while (framhald);
      return undefined
    };
    return { bytereader, dispatch };
  })();

  return harden({ abort, dispatch, getBootstrap, serialize, unserialize });
}
