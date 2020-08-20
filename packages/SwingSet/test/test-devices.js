/* global harden */

import '@agoric/install-ses';
import { test } from 'tape-promise/tape';
import { initSwingStore, getAllState } from '@agoric/swing-store-simple';

import { buildVatController } from '../src/index';
import { buildMailboxStateMap, buildMailbox } from '../src/devices/mailbox';
import buildCommand from '../src/devices/command';

function capdata(body, slots = []) {
  return harden({ body, slots });
}

function capargs(args, slots = []) {
  return capdata(JSON.stringify(args), slots);
}

test('d0', async t => {
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-0'),
        creationOptions: { enableSetup: true },
      },
    },
    devices: [['d0', require.resolve('./files-devices/device-0'), {}]],
  };
  const c = await buildVatController(config);
  await c.step();
  // console.log(util.inspect(c.dump(), { depth: null }));
  t.deepEqual(JSON.parse(c.dump().log[0]), [
    {
      bootstrap: { '@qclass': 'slot', index: 0 },
      comms: { '@qclass': 'slot', index: 1 },
      timer: { '@qclass': 'slot', index: 2 },
      vatAdmin: { '@qclass': 'slot', index: 3 },
      vattp: { '@qclass': 'slot', index: 4 },
    },
    {
      _dummy: 'dummy',
      d0: { '@qclass': 'slot', index: 5 },
      vatAdmin: { '@qclass': 'slot', index: 6 },
    },
  ]);
  t.deepEqual(JSON.parse(c.dump().log[1]), [
    'o+0',
    'o-50',
    'o-51',
    'o-52',
    'o-53',
    'd-70',
    'd-71',
  ]);
  t.end();
});

test('d1', async t => {
  const sharedArray = [];
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-1'),
        creationOptions: { enableSetup: true },
      },
    },
    devices: [
      [
        'd1',
        require.resolve('./files-devices/device-1'),
        {
          shared: sharedArray,
        },
      ],
    ],
  };
  const c = await buildVatController(config);
  await c.step();
  c.queueToVatExport('bootstrap', 'o+0', 'step1', capargs([]));
  await c.step();
  t.deepEqual(c.dump().log, [
    'callNow',
    'invoke 1 2',
    JSON.stringify(capargs({ ret: 3 })),
  ]);
  t.deepEqual(sharedArray, ['pushed']);
  t.end();
});

async function test2(t, mode) {
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-2'),
      },
      left: {
        sourceSpec: require.resolve('./files-devices/vat-left.js'),
      },
    },
    devices: [['d2', require.resolve('./files-devices/device-2'), {}]],
  };
  const c = await buildVatController(config, [mode]);
  await c.step();
  if (mode === '1') {
    t.deepEqual(c.dump().log, ['calling d2.method1', 'method1 hello', 'done']);
  } else if (mode === '2') {
    t.deepEqual(c.dump().log, [
      'calling d2.method2',
      'method2',
      'method3 true',
      'value',
    ]);
  } else if (mode === '3') {
    t.deepEqual(c.dump().log, ['calling d2.method3', 'method3', 'ret true']);
  } else if (mode === '4') {
    t.deepEqual(c.dump().log, [
      'calling d2.method4',
      'method4',
      'ret method4 done',
    ]);
    await c.step();
    t.deepEqual(c.dump().log, [
      'calling d2.method4',
      'method4',
      'ret method4 done',
      'd2.m4 foo',
      'method4.bar hello',
      'd2.m4 did bar',
    ]);
  } else if (mode === '5') {
    t.deepEqual(c.dump().log, ['calling v2.method5', 'called']);
    await c.step();
    t.deepEqual(c.dump().log, [
      'calling v2.method5',
      'called',
      'left5',
      'method5 hello',
      'left5 did d2.method5, got ok',
    ]);
    await c.step();
    t.deepEqual(c.dump().log, [
      'calling v2.method5',
      'called',
      'left5',
      'method5 hello',
      'left5 did d2.method5, got ok',
      'ret done',
    ]);
  }
  t.end();
}

test('d2.1', async t => {
  await test2(t, '1');
});

test('d2.2', async t => {
  await test2(t, '2');
});

test('d2.3', async t => {
  await test2(t, '3');
});

test('d2.4', async t => {
  await test2(t, '4');
});

test('d2.5', async t => {
  await test2(t, '5');
});

test('device state', async t => {
  const { storage } = initSwingStore();
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-3'),
      },
    },
    devices: [['d3', require.resolve('./files-devices/device-3'), {}]],
  };

  // The initial state should be missing (null). Then we set it with the call
  // from bootstrap, and read it back.
  const c1 = await buildVatController(config, ['write+read'], {
    hostStorage: storage,
  });
  const d3 = c1.deviceNameToID('d3');
  await c1.run();
  t.deepEqual(c1.dump().log, ['undefined', 'w+r', 'called', 'got {"s":"new"}']);
  const s = getAllState(storage);
  t.deepEqual(JSON.parse(s[`${d3}.deviceState`]), capargs({ s: 'new' }));
  t.deepEqual(JSON.parse(s[`${d3}.o.nextID`]), 10);

  t.end();
});

test('mailbox outbound', async t => {
  const s = buildMailboxStateMap();
  const mb = buildMailbox(s);
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-2'),
      },
    },
    devices: [['mailbox', mb.srcPath, mb.endowments]],
  };

  const c = await buildVatController(config, ['mailbox1']);
  await c.run();
  t.deepEqual(s.exportToData(), {
    peer1: {
      inboundAck: 13,
      outbox: [
        [2, 'data2'],
        [3, 'data3'],
      ],
    },
    peer2: {
      inboundAck: 0,
      outbox: [],
    },
    peer3: {
      inboundAck: 0,
      outbox: [[5, 'data5']],
    },
  });

  const s2 = buildMailboxStateMap();
  s2.populateFromData(s.exportToData());
  t.deepEqual(s.exportToData(), s2.exportToData());

  t.end();
});

test('mailbox inbound', async t => {
  const s = buildMailboxStateMap();
  const mb = buildMailbox(s);
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-2'),
      },
    },
    devices: [['mailbox', mb.srcPath, mb.endowments]],
  };

  let rc;

  const c = await buildVatController(config, ['mailbox2']);
  await c.run();
  rc = mb.deliverInbound(
    'peer1',
    [
      [1, 'msg1'],
      [2, 'msg2'],
    ],
    0,
  );
  t.ok(rc);
  await c.run();
  t.deepEqual(c.dump().log, ['dm-peer1', 'm-1-msg1', 'm-2-msg2']);

  // delivering the same messages should not trigger sends, but the ack is new
  rc = mb.deliverInbound(
    'peer1',
    [
      [1, 'msg1'],
      [2, 'msg2'],
    ],
    3,
  );
  t.ok(rc);
  await c.run();
  t.deepEqual(c.dump().log, ['dm-peer1', 'm-1-msg1', 'm-2-msg2', 'da-peer1-3']);

  // no new messages/acks makes deliverInbound return 'false'
  rc = mb.deliverInbound(
    'peer1',
    [
      [1, 'msg1'],
      [2, 'msg2'],
    ],
    3,
  );
  t.notOk(rc);
  await c.run();
  t.deepEqual(c.dump().log, ['dm-peer1', 'm-1-msg1', 'm-2-msg2', 'da-peer1-3']);

  // but new messages should be sent
  rc = mb.deliverInbound(
    'peer1',
    [
      [1, 'msg1'],
      [2, 'msg2'],
      [3, 'msg3'],
    ],
    3,
  );
  t.ok(rc);
  await c.run();
  t.deepEqual(c.dump().log, [
    'dm-peer1',
    'm-1-msg1',
    'm-2-msg2',
    'da-peer1-3',
    'dm-peer1',
    'm-3-msg3',
  ]);

  // and a higher ack should be sent
  rc = mb.deliverInbound(
    'peer1',
    [
      [1, 'msg1'],
      [2, 'msg2'],
      [3, 'msg3'],
    ],
    4,
  );
  t.ok(rc);
  await c.run();
  t.deepEqual(c.dump().log, [
    'dm-peer1',
    'm-1-msg1',
    'm-2-msg2',
    'da-peer1-3',
    'dm-peer1',
    'm-3-msg3',
    'da-peer1-4',
  ]);

  rc = mb.deliverInbound('peer2', [[4, 'msg4']], 5);
  t.ok(rc);
  await c.run();
  t.deepEqual(c.dump().log, [
    'dm-peer1',
    'm-1-msg1',
    'm-2-msg2',
    'da-peer1-3',
    'dm-peer1',
    'm-3-msg3',
    'da-peer1-4',
    'dm-peer2',
    'm-4-msg4',
    'da-peer2-5',
  ]);

  t.end();
});

test('command broadcast', async t => {
  const broadcasts = [];
  const cm = buildCommand(body => broadcasts.push(body));
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-2'),
      },
    },
    devices: [['command', cm.srcPath, cm.endowments]],
  };

  const c = await buildVatController(config, ['command1']);
  await c.run();
  t.deepEqual(broadcasts, [{ hello: 'everybody' }]);

  t.end();
});

test('command deliver', async t => {
  const cm = buildCommand(() => {});
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-devices/bootstrap-2'),
      },
    },
    devices: [['command', cm.srcPath, cm.endowments]],
  };

  const c = await buildVatController(config, ['command2']);
  await c.run();

  t.deepEqual(c.dump().log.length, 0);
  const p1 = cm.inboundCommand({ piece: 'missing', doReject: false });
  await c.run();
  const r1 = await p1;
  t.deepEqual(r1, { response: 'body' });
  t.deepEqual(c.dump().log, ['handle-0-missing']);

  const p2 = cm.inboundCommand({ piece: 'errory', doReject: true });
  let rejection;
  p2.then(
    res => t.fail(`expected to reject, but got ${res}`),
    rej => (rejection = rej),
  );
  await c.run();
  t.deepEqual(c.dump().log, ['handle-0-missing', 'handle-1-errory']);
  t.deepEqual(rejection, { response: 'body' });

  t.end();
});
