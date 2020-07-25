/* global harden */

import { buildPatterns } from '../message-patterns';

export function buildRootObject(vatPowers) {
  const bert = harden({ toString: () => 'obj-bert' });
  const bill = harden({ toString: () => 'obj-bill' });

  const root = harden({
    init() {
      const { setB, objB } = buildPatterns(vatPowers.testLog);
      const b = harden({ bob: objB, bert, bill });
      setB(b);
      return harden({ bob: objB, bert });
    },
  });
  return root;
}
