/* global harden */
import { E } from '@agoric/eventual-send';

console.log(`=> loading bootstrap.js`);

export function buildRootObject(vatPowers) {
  const log = vatPowers.testLog;
  return harden({
    bootstrap(vats) {
      console.log('=> bootstrap() called');
      E(vats.user)
        .talkToBot(vats.bot, 'encouragementBot')
        .then(
          r =>
            log(
              `=> the promise given by the call to user.talkToBot resolved to '${r}'`,
            ),
          err =>
            log(
              `=> the promise given by the call to user.talkToBot was rejected '${err}''`,
            ),
        );
    },
  });
}
