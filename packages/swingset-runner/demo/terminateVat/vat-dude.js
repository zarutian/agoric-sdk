import { E } from '@agoric/eventual-send';

export function buildRootObject() {
  let count = 0;
  return harden({
    async elsewhere(other) {
      const val = await E(other).query();
      console.log(`other returns ${val}`);
    },
    dude(truth) {
      if (truth) {
        count += 1;
        return `DUDE${'!'.repeat(count - 1)}`;
      } else {
        throw Error('Sorry, dude');
      }
    },
  });
}
