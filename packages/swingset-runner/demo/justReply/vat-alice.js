import { E } from '@agoric/eventual-send';

const log = console.log;

export function buildRootObject(_vatPowers) {
  return harden({
    sayHelloTo(other) {
      log(`=> Alice.sayHelloTo`);
      const answer = E(other).hello();
      answer.then(
        r => log(`=> alice.hello() answer resolved to '${r}'`),
        e => log(`=> alice.hello() answer rejected as '${e}'`),
      );
      return `Alice started\n`;
    },
  });
}
