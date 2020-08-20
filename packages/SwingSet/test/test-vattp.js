import '@agoric/install-ses';
import { test } from 'tape-promise/tape';
import { buildVatController } from '../src/index';
import { buildMailboxStateMap, buildMailbox } from '../src/devices/mailbox';

test('vattp', async t => {
  const s = buildMailboxStateMap();
  const mb = buildMailbox(s);
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-vattp/bootstrap-test-vattp'),
      },
    },
    devices: [['mailbox', mb.srcPath, mb.endowments]],
  };

  const c = await buildVatController(config, ['1']);
  await c.run();
  t.deepEqual(s.exportToData(), {});

  t.equal(
    mb.deliverInbound(
      'remote1',
      [
        [1, 'msg1'],
        [2, 'msg2'],
      ],
      0,
    ),
    true,
  );
  await c.run();
  t.deepEqual(c.dump().log, [
    'not sending anything',
    'ch.receive msg1',
    'ch.receive msg2',
  ]);
  t.deepEqual(s.exportToData(), { remote1: { outbox: [], inboundAck: 2 } });

  t.equal(
    mb.deliverInbound(
      'remote1',
      [
        [1, 'msg1'],
        [2, 'msg2'],
      ],
      0,
    ),
    false,
  );
  await c.run();
  t.deepEqual(s.exportToData(), { remote1: { outbox: [], inboundAck: 2 } });

  t.end();
});

test('vattp 2', async t => {
  const s = buildMailboxStateMap();
  const mb = buildMailbox(s);
  const config = {
    bootstrap: 'bootstrap',
    vats: {
      bootstrap: {
        sourceSpec: require.resolve('./files-vattp/bootstrap-test-vattp'),
      },
    },
    devices: [['mailbox', mb.srcPath, mb.endowments]],
  };

  const c = await buildVatController(config, ['2']);
  await c.run();
  t.deepEqual(s.exportToData(), {
    remote1: { outbox: [[1, 'out1']], inboundAck: 0 },
  });

  t.equal(mb.deliverInbound('remote1', [], 1), true);
  await c.run();
  t.deepEqual(c.dump().log, []);
  t.deepEqual(s.exportToData(), { remote1: { outbox: [], inboundAck: 0 } });

  t.equal(mb.deliverInbound('remote1', [[1, 'msg1']], 1), true);
  await c.run();
  t.deepEqual(c.dump().log, ['ch.receive msg1']);
  t.deepEqual(s.exportToData(), { remote1: { outbox: [], inboundAck: 1 } });

  t.equal(mb.deliverInbound('remote1', [[1, 'msg1']], 1), false);

  t.equal(
    mb.deliverInbound(
      'remote1',
      [
        [1, 'msg1'],
        [2, 'msg2'],
      ],
      1,
    ),
    true,
  );
  await c.run();
  t.deepEqual(c.dump().log, ['ch.receive msg1', 'ch.receive msg2']);
  t.deepEqual(s.exportToData(), { remote1: { outbox: [], inboundAck: 2 } });

  t.end();
});
