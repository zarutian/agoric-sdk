

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

  return harden({ abort, dispatch, getBootstrap, serialize, unserialize });
}
