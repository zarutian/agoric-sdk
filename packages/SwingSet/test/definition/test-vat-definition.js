/* global harden */
import '@agoric/install-ses';
import tap from 'tap';
import { buildVatController } from '../../src/index';

const mUndefined = { '@qclass': 'undefined' };

function capdata(body, slots = []) {
  return harden({ body, slots });
}

function capargs(args, slots = []) {
  return capdata(JSON.stringify(args), slots);
}

tap.test('create with setup and buildRootObject', async t => {
  const config = {
    vats: {
      setup: {
        sourceSpec: require.resolve('./vat-setup.js'),
      },
      liveslots: {
        sourceSpec: require.resolve('./vat-liveslots.js'),
      },
    },
  };
  const c = await buildVatController(config, []);
  let r = c.queueToVatExport('setup', 'o+0', 'increment', capargs([]), 'panic');
  await c.run();
  t.deepEqual(r.resolution(), capargs(mUndefined), 'setup incr');
  r = c.queueToVatExport('setup', 'o+0', 'read', capargs([]), 'panic');
  await c.run();
  t.deepEqual(r.resolution(), capargs(1), 'setup read');
  r = c.queueToVatExport('setup', 'o+0', 'tildot', capargs([]), 'panic');
  await c.run();
  t.deepEqual(
    r.resolution(),
    capargs('HandledPromise.applyMethod(x, "foo", [arg1]);'),
    'setup tildot',
  );
  r = c.queueToVatExport('setup', 'o+0', 'remotable', capargs([]), 'panic');
  await c.run();
  t.deepEqual(
    r.resolution(),
    capargs('iface1'),
    'setup Remotable/getInterfaceOf',
  );

  r = c.queueToVatExport('liveslots', 'o+0', 'increment', capargs([]), 'panic');
  await c.run();
  t.deepEqual(r.resolution(), capargs(mUndefined), 'ls incr');
  r = c.queueToVatExport('liveslots', 'o+0', 'read', capargs([]), 'panic');
  await c.run();
  t.deepEqual(r.resolution(), capargs(1), 'ls read');
  r = c.queueToVatExport('liveslots', 'o+0', 'tildot', capargs([]), 'panic');
  await c.run();
  t.deepEqual(
    r.resolution(),
    capargs('HandledPromise.applyMethod(x, "foo", [arg1]);'),
    'ls tildot',
  );
  r = c.queueToVatExport('liveslots', 'o+0', 'remotable', capargs([]), 'panic');
  await c.run();
  t.deepEqual(r.resolution(), capargs('iface1'), 'ls Remotable/getInterfaceOf');
});
