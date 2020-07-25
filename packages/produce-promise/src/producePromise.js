/* global harden */
// @ts-check

import { HandledPromise } from '@agoric/eventual-send';

/**
 * @template U,V
 * @typedef {Object} PromiseRecord A reified Promise
 * @property {(value?: U) => void} resolve
 * @property {(reason?: V) => void} reject
 * @property {Promise.<U, V>} promise
 */

/**
 * producePromise() builds a HandledPromise object, and returns a record
 * containing the promise itself, as well as separate facets for resolving
 * and rejecting it.
 *
 * @template U,V
 * @returns {PromiseRecord.<U,V>}
 */
export function producePromise() {
  let res;
  let rej;
  // We use a HandledPromise so that we can run HandledPromise.unwrap(p)
  // even if p doesn't travel through a comms system (like SwingSet's).
  const p = new HandledPromise((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  // Node.js adds the `domain` property which is not a standard
  // property on Promise. Because we do not know it to be ocap-safe,
  // we remove it.
  if (p.domain) {
    // deleting p.domain may break functionality. To retain current
    // functionality at the expense of safety, set unsafe to true.
    const unsafe = false;
    if (unsafe) {
      const originalDomain = p.domain;
      Object.defineProperty(p, 'domain', {
        get() {
          return originalDomain;
        },
      });
    } else {
      delete p.domain;
    }
  }
  return harden({ promise: p, resolve: res, reject: rej });
}
harden(producePromise);

/**
 * Determine if the argument is a Promise.
 *
 * @param {Promise} maybePromise The value to examine
 * @returns {boolean} Whether it is a promise
 */
export function isPromise(maybePromise) {
  return HandledPromise.resolve(maybePromise) === maybePromise;
}
harden(isPromise);
