/* global globalThis */
import { test } from 'tape-promise/tape';
import '@agoric/install-ses';
import fs from 'fs';
import anylogger from 'anylogger';

import main from '../lib/main';

test('sanity', async t => {
  try {
    const stubAnylogger = () => {
      const l = () => {};
      for (const level of Object.keys(anylogger.levels)) {
        l[level] = () => {};
      }
      return l;
    };
    const myMain = args => {
      const oldConsole = console;
      try {
        globalThis.console = stubAnylogger();
        return main('foo', args, {
          anylogger: stubAnylogger,
          stdout: () => {},
          fs: { readFile: fs.promises.readFile },
        });
      } finally {
        globalThis.console = oldConsole;
      }
    };
    t.equal(await myMain(['help']), 0, 'help exits zero');
    t.equal(await myMain(['--help']), 0, '--help exits zero');
    t.equal(await myMain(['--version']), 0, '--version exits zero');
    t.equal(await myMain(['zorgar']), 1, 'unknown command fails');
  } catch (e) {
    t.isNot(e, e, 'unexpected exception');
  } finally {
    t.end();
  }
});
