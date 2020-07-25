/* global harden */

import { E } from '@agoric/eventual-send';

console.log(`=> loading bootstrap.js`);

export function buildRootObject(_vatPowers) {
  return harden({
    bootstrap(argv, vats) {
      const pa = E(vats.bob).genPromise1();
      E(vats.bob).genPromise2();
      E(vats.bob).usePromise([pa]);
    },
  });
}
