import '@agoric/install-ses';
import { test } from 'tape-promise/tape';
import { buildVatController } from '../src/index';

async function beginning(t, mode) {
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve(`./vat-exomessages.js`),
      },
    },
  };
  const controller = await buildVatController(config, [mode]);
  t.equal(controller.bootstrapResult.status(), 'pending');
  return controller;
}

async function bootstrapSuccessfully(t, mode, body, slots) {
  const controller = await beginning(t, mode);
  await controller.run();
  t.equal(controller.bootstrapResult.status(), 'fulfilled');
  t.deepEqual(controller.bootstrapResult.resolution(), {
    body,
    slots,
  });
  t.end();
}

test('bootstrap returns data', async t => {
  await bootstrapSuccessfully(
    t,
    'data',
    '"a big hello to all intelligent lifeforms everywhere"',
    [],
  );
});

test('bootstrap returns presence', async t => {
  // prettier-ignore
  await bootstrapSuccessfully(
    t,
    'presence',
    '{"@qclass":"slot",index:0}',
    ['ko25'],
  );
});

test('bootstrap returns void', async t => {
  await bootstrapSuccessfully(t, 'void', '{"@qclass":"undefined"}', []);
});

async function testFailure(t) {
  const controller = await beginning(t, 'reject');
  let failureHappened = false;
  try {
    await controller.run();
  } catch (e) {
    failureHappened = true;
    t.equal(e.message, 'kernel panic bootstrap failure');
  }
  t.ok(failureHappened);
  t.equal(controller.bootstrapResult.status(), 'rejected');
  t.deepEqual(controller.bootstrapResult.resolution(), {
    body: '{"@qclass":"error","name":"Error","message":"gratuitous error"}',
    slots: [],
  });
  t.end();
}

test('bootstrap failure', async t => {
  await testFailure(t);
});

async function extraMessage(t, mode, status, body, slots) {
  const controller = await beginning(t, 'data');
  await controller.run();
  const args = { body: `["${mode}"]`, slots: [] };
  const extraResult = controller.queueToVatExport(
    'bootstrap',
    'o+0',
    'extra',
    args,
    'ignore',
  );
  await controller.run();
  t.equal(extraResult.status(), status);
  t.deepEqual(extraResult.resolution(), {
    body,
    slots,
  });
  t.end();
}

test('extra message returns data', async t => {
  await extraMessage(
    t,
    'data',
    'fulfilled',
    '"a big hello to all intelligent lifeforms everywhere"',
    [],
  );
});

test('extra message returns presence', async t => {
  // prettier-ignore
  await extraMessage(
    t,
    'presence',
    'fulfilled',
    '{"@qclass":"slot",index:0}',
    ['ko25'],
  );
});

test('extra message returns void', async t => {
  await extraMessage(t, 'void', 'fulfilled', '{"@qclass":"undefined"}', []);
});

test('extra message rejects', async t => {
  await extraMessage(
    t,
    'reject',
    'rejected',
    '{"@qclass":"error","name":"Error","message":"gratuitous error"}',
    [],
  );
});
