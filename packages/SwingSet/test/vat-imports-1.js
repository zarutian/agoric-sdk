import harden from '@agoric/harden';

function build(E, log) {
  const obj0 = {
    bootstrap(argv, _vats) {
      if (argv[0] === 'harden') {
        log('harden-1');
        // eslint-disable-next-line global-require
        const harden2 = require('@agoric/harden');
        const o1 = { o2: {} };
        harden2(o1);
        log(Object.isFrozen(o1));
        log(Object.isFrozen(o1.o2));
      } else if (argv[0] === 'ses') {
        log('ses-1');
        // eslint-disable-next-line global-require
        const { lockdown } = require('ses');
        if (typeof(lockdown) === 'function') {
          log('lockdown-is-function');
        } else {
          log(`error: lockdown is ${typeof(lockdown)}`);
        }
      }
    },
  };
  return harden(obj0);
}

export default function setup(syscall, state, helpers) {
  const { log, makeLiveSlots } = helpers;
  return makeLiveSlots(syscall, state, E => build(E, log), helpers.vatID);
}
