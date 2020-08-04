/* global harden */

import { E } from '@agoric/eventual-send';
import { makePromiseKit } from '@agoric/promise-kit';

export function buildRootObject(vatPowers) {
  const log = vatPowers.testLog;
  return harden({
    bootstrap(argv, vats) {
      const mode = argv[0];
      if (mode === 'harden-promise-1') {
        const { promise: p1 } = makePromiseKit();
        harden(p1);
        const allP = [];
        // in bug #95, this first call returns a (correctly) frozen Promise,
        // but for the wrong reasons
        const p2 = E(vats.left).checkHarden(p1);
        log(`p2 frozen ${Object.isFrozen(p2)}`);
        allP.push(p2);
        // but this one does not:
        const p3 = E(p2).checkHarden(p1);
        log(`p3 frozen ${Object.isFrozen(p3)}`);
        allP.push(p3);
        // TODO: this one doesn't get frozen, but we wish it did
        // const p4 = vats.left!checkHarden(p1);
        // log(`p4 frozen ${Object.isFrozen(p4)}`);
        // allP.push(p4);
        Promise.all(allP).then(_ => {
          log(`b.harden-promise-1.finish`);
        });
      } else {
        throw Error(`unknown mode ${mode}`);
      }
    },
  });
}
