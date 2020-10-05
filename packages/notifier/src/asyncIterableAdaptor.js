// @ts-check
// eslint-disable-next-line spaced-comment
/// <reference types="ses"/>

import { E } from '@agoric/eventual-send';

import './types';

/**
 * Adaptor from a notifierP to an async iterable.
 * The notifierP can be any object that has an eventually invokable
 * `getUpdateSince` method that behaves according to the notifier
 * spec. This can be a notifier, a promise for a local or remote
 * notfier, or a presence of a remote notifier.
 *
 * It is also used internally by notifier.js so that a notifier itself is an
 * async iterable.
 *
 * An async iterable is an object with a `[Symbol.asyncIterator]()` method
 * that returns an async iterator. The async iterator we return here has only
 * a `next()` method, without the optional `return` and `throw` methods. The
 * omitted methods, if present, would be used by the for/await/of loop to
 * inform the iterator of early termination. But this adaptor would not do
 * anything useful in reaction to this notification.
 *
 * An async iterator's `next()` method returns a promise for an iteration
 * result. An iteration result is a record with `value` and `done` properties.
 *
 * TBU: This part of the comment does not apply with this Less Lossy Lamport version. -Zarutian
 * The purpose of building on the notifier protocol is to have a lossy
 * adaptor, where intermediate results can be missed in favor of more recent
 * results which are therefore less stale. See
 * https://github.com/Agoric/documentation/blob/master/main/distributed-programming.md#notifiers
 */
 /** @type {Number} */
 const nrOfPrefetches = 42; 
 /**
 * @template T
 * @param {ERef<BaseNotifier<T>>} notifierP
 * @returns {AsyncIterable<T>}
 */
export const makeAsyncIterableFromNotifier = notifierP => {
  return harden({
    [Symbol.asyncIterator]: () => {
      /** @type {UpdateCount} */
      let localUpdateCount = 1n;
      /** @type {UpdateCount} */
      let lastUpdateCountRecieved = 0n;
      /** @type {Map<UpdateCount, Promise<{value: T, done: boolean}>>} */
      const myIterationResultPromises = new Map();
      const doFetchNext = (upc) => {
        let u = upc;
        for (let i = 1; i <= nrOfPrefetches; i++) {
          if (!myIterationResultPromises.has(upc)) {
            const p = E(notifierP)
              .getUpdateSince(upc)
              .then(({ value, updateCount }) => {
                const done = updateCount === undefined;
                if (!done) {
                  if (lastUpdateCountRecieved < updateCount) {
                    lastUpdateCountRecieved = updateCount;
                  }
                }
                return harden({ value, done });
             });
             myIterationResultPromises.set(upc, p);
          }
          upc = upc + 1n;
        }
        return myIterationResultPromises.get(upc);
      }
      doFetchNext(localUpdateCount);
      return harden({
        next: () => {
            // See
            // https://2ality.com/2016/10/asynchronous-iteration.html#queuing-next()-invocations
            // for an explicit use that sends `next()` without waiting.
            const p = doFetchNext(localUpdateCount);
            (() => {
              // This construct is needed to capture the current value of localUpdateCount
              const upc = localUpdateCount;
              p.finally(() => myIterationResultPromises.delete(upc));
            })();
            localUpdateCount = localUpdateCount + 1n;
            return p;
        }
      });
    },
  });
};

/**
 * This reads from `asyncIteratable` updating `updater` with each successive
 * value. The `updater` the same API as the `updater` of a notifier kit,
 * but can simply be an observer to react to these updates. As an observer,
 * the `updater` may only be interested in certain occurrences (`updateState`,
 * `finish`, `fail`), so for convenience, `updateFromIterable` feature
 * tests for those methods before calling them.
 *
 * @template T
 * @param {Partial<Updater<T>>} updater
 * @param {AsyncIterable<T>} asyncIterable
 * @returns {Promise<undefined>}
 */
// See https://github.com/Agoric/agoric-sdk/issues/1345 for why
// `updateFromIterable` currently needs a local `asyncIterable` rather than
// a possibly remote `asyncIterableP`.
export const updateFromIterable = (updater, asyncIterable) => {
  const iterator = asyncIterable[Symbol.asyncIterator]();
  return new Promise(ack => {
    const recur = () => {
      E.when(
        iterator.next(),
        ({ value, done }) => {
          if (done) {
            updater.finish && updater.finish(value);
            ack();
          } else {
            updater.updateState && updater.updateState(value);
            recur();
          }
        },
        reason => {
          updater.fail && updater.fail(reason);
          ack();
        },
      );
    };
    recur();
  });
};

/**
 * As updates come in from the possibly remote `notifierP`, update
 * the local `updater`. Since the updates come from a notifier, they
 * are lossy, i.e., once a more recent state can be reported, less recent
 * states are assumed irrelevant and dropped.
 *
 * @template T
 * @param {Partial<Updater<T>>} updater
 * @param {ERef<Notifier<T>>} notifierP
 * @returns {Promise<undefined>}
 */
export const updateFromNotifier = (updater, notifierP) =>
  updateFromIterable(updater, makeAsyncIterableFromNotifier(notifierP));
