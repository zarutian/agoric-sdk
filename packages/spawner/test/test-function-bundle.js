import '@agoric/install-ses';
import { test } from 'tape-promise/tape';
import { importBundle } from '@agoric/import-bundle';
import { bundleFunction } from './make-function-bundle';

function start(terms, inviteMaker) {
  return inviteMaker.make('foo', 8);
}

// verify that our utility function works as intended

test('bundleFunction', async t => {
  const b = await bundleFunction(start);
  const ns = await importBundle(b);
  const inviteMaker = {
    make(_foo, _eight) {
      return 'yes';
    },
  };
  t.equal(ns.default('terms', inviteMaker), 'yes');
  t.end();
});
