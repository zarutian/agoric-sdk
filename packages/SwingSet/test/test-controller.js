/* global harden */

import '@agoric/install-ses';
import { test } from 'tape-promise/tape';
import path from 'path';
import { buildVatController, loadBasedir } from '../src/index';
import { checkKT } from './util';

function capdata(body, slots = []) {
  return harden({ body, slots });
}

function removeTriple(arr, a, b, c) {
  for (let i = 0; i < arr.length; i += 1) {
    const elem = arr[i];
    if (elem[0] === a && elem[1] === b && elem[2] === c) {
      arr.splice(i, 1);
      return;
    }
  }
}

test('load empty', async t => {
  const config = {
    vats: new Map(),
    bootstrapIndexJS: undefined,
  };
  const controller = await buildVatController(config);
  await controller.run();
  t.ok(true);
  t.end();
});

async function simpleCall(t) {
  const config = {
    vats: new Map([
      ['vat1', { sourcepath: require.resolve('./vat-controller-1') }],
    ]),
  };
  const controller = await buildVatController(config);
  const data = controller.dump();
  const vat1 = controller.vatNameToID('vat1');
  const vat2 = controller.vatNameToID('vatAdmin');
  t.deepEqual(data.vatTables, [
    { vatID: vat1, state: { transcript: [] } },
    { vatID: vat2, state: { transcript: [] } },
  ]);
  t.deepEqual(data.kernelTable, []);

  controller.queueToVatExport('vat1', 'o+1', 'foo', capdata('args'));
  t.deepEqual(controller.dump().runQueue, [
    {
      msg: {
        method: 'foo',
        args: capdata('args'),
        result: 'kp40',
      },
      target: 'ko20',
      type: 'send',
    },
  ]);
  await controller.run();
  t.deepEqual(JSON.parse(controller.dump().log[0]), {
    facetID: 'o+1',
    method: 'foo',
    args: capdata('args'),
  });

  controller.log('2');
  t.equal(controller.dump().log[1], '2');

  t.end();
}

test('simple call', async t => {
  await simpleCall(t);
});

test('reject module-like sourceIndex', async t => {
  const vats = new Map();
  // the keys of 'vats' have a 'sourcepath' property which are vat source
  // index strings: something that require() or rollup can use to
  // import/stringify the source graph that should be loaded into the vat. We
  // want this to be somewhere on local disk, so it should start with '/' or
  // '.'. If it doesn't, the name will be treated as something to load from
  // node_modules/ (i.e. something installed from npm), so we want to reject
  // that.
  vats.set('vat1', { sourcepath: 'vatsource' });
  t.rejects(
    async () => buildVatController({ vats }),
    /sourceIndex must be relative/,
  );
  t.end();
});

test('bootstrap', async t => {
  const config = await loadBasedir(
    path.resolve(__dirname, 'basedir-controller-2'),
  );
  // the controller automatically runs the bootstrap function.
  // basedir-controller-2/bootstrap.js logs "bootstrap called" and queues a call to
  // left[0].bootstrap
  const c = await buildVatController(config);
  t.deepEqual(c.dump().log, ['bootstrap called']);
  t.end();
});

test('bootstrap export', async t => {
  const config = await loadBasedir(
    path.resolve(__dirname, 'basedir-controller-3'),
  );
  const c = await buildVatController(config);
  const bootstrapVatID = c.vatNameToID('_bootstrap');
  const leftVatID = c.vatNameToID('left');
  const rightVatID = c.vatNameToID('right');
  // console.log(c.dump());
  // console.log('SLOTS: ', c.dump().runQueue[0].slots);

  // the expected kernel object indices
  const boot0 = 'ko20';
  const left0 = 'ko21';
  const right0 = 'ko22';
  const adminDev = 'kd30';
  const vatAdminSvc = 'ko23';
  const kt = [
    [adminDev, 'd7', 'd+0'],
    [boot0, bootstrapVatID, 'o+0'],
    [left0, leftVatID, 'o+0'],
    [right0, rightVatID, 'o+0'],
    [vatAdminSvc, 'v4', 'o+0'],
  ];
  checkKT(t, c, kt);

  t.deepEqual(c.dump().runQueue, [
    {
      msg: {
        result: 'kp40',
        method: 'bootstrap',
        args: {
          body:
            '[[],{"_bootstrap":{"@qclass":"slot","index":0},"left":{"@qclass":"slot","index":1},"right":{"@qclass":"slot","index":2},"vatAdmin":{"@qclass":"slot","index":3}},{"_dummy":"dummy","vatAdmin":{"@qclass":"slot","index":4}}]',
          slots: [boot0, left0, right0, vatAdminSvc, adminDev],
        },
      },
      target: boot0,
      type: 'send',
    },
  ]);

  t.deepEqual(c.dump().log, []);
  // console.log('--- c.step() running bootstrap.obj0.bootstrap');
  await c.step();
  // kernel promise for result of the foo() that bootstrap sends to vat-left
  const fooP = 'kp41';
  t.deepEqual(c.dump().log, ['bootstrap.obj0.bootstrap()']);
  kt.push([left0, bootstrapVatID, 'o-50']);
  kt.push([right0, bootstrapVatID, 'o-51']);
  kt.push([fooP, bootstrapVatID, 'p+5']);
  kt.push([adminDev, 'v3', 'd-70']);
  kt.push([vatAdminSvc, 'v3', 'o-52']);
  checkKT(t, c, kt);
  t.deepEqual(c.dump().runQueue, [
    {
      type: 'send',
      target: left0,
      msg: {
        method: 'foo',
        args: {
          body: '[1,{"@qclass":"slot","index":0}]',
          slots: [right0],
        },
        result: fooP,
      },
    },
  ]);

  await c.step();
  const barP = 'kp42';
  t.deepEqual(c.dump().log, ['bootstrap.obj0.bootstrap()', 'left.foo 1']);
  kt.push([right0, leftVatID, 'o-50']);
  kt.push([barP, leftVatID, 'p+5']);
  checkKT(t, c, kt);

  t.deepEqual(c.dump().runQueue, [
    {
      type: 'send',
      target: right0,
      msg: {
        method: 'bar',
        args: {
          body: '[2,{"@qclass":"slot","index":0}]',
          slots: [right0],
        },
        result: barP,
      },
    },
    { type: 'notify', vatID: bootstrapVatID, kpid: fooP },
  ]);

  await c.step();

  t.deepEqual(c.dump().log, [
    'bootstrap.obj0.bootstrap()',
    'left.foo 1',
    'right.obj0.bar 2 true',
  ]);

  checkKT(t, c, kt);

  t.deepEqual(c.dump().runQueue, [
    { type: 'notify', vatID: bootstrapVatID, kpid: fooP },
    { type: 'notify', vatID: leftVatID, kpid: barP },
  ]);

  await c.step();

  t.deepEqual(c.dump().log, [
    'bootstrap.obj0.bootstrap()',
    'left.foo 1',
    'right.obj0.bar 2 true',
  ]);
  removeTriple(kt, fooP, bootstrapVatID, 'p+5'); // pruned promise
  checkKT(t, c, kt);

  t.deepEqual(c.dump().runQueue, [
    { type: 'notify', vatID: leftVatID, kpid: barP },
  ]);

  await c.step();

  t.deepEqual(c.dump().log, [
    'bootstrap.obj0.bootstrap()',
    'left.foo 1',
    'right.obj0.bar 2 true',
  ]);

  removeTriple(kt, barP, leftVatID, 'p+5'); // pruned promise
  checkKT(t, c, kt);
  t.deepEqual(c.dump().runQueue, []);

  t.end();
});
