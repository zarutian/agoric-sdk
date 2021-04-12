import path from 'path';
import anylogger from 'anylogger';

import {
  buildMailbox,
  buildMailboxStateMap,
  buildTimer,
  buildBridge,
  swingsetIsInitialized,
  initializeSwingset,
  makeSwingsetController,
  loadBasedir,
  loadSwingsetConfigFile,
} from '@agoric/swingset-vat';
import { assert, details as X } from '@agoric/assert';
import { getBestSwingStore } from './check-lmdb';
import {
  DEFAULT_METER_PROVIDER,
  exportKernelStats,
  makeSlogCallbacks,
} from './kernel-stats';

const console = anylogger('launch-chain');

const SWING_STORE_META_KEY = 'cosmos/meta';

// This is how many cranks we run per block, as per #2299.
// TODO Make it dependent upon metering instead.
const FIXME_MAX_CRANKS_PER_BLOCK = 1000;

async function buildSwingset(
  mailboxStorage,
  bridgeOutbound,
  storage,
  vatsDir,
  argv,
  { debugName = undefined, slogCallbacks },
) {
  const debugPrefix = debugName === undefined ? '' : `${debugName}:`;
  let config = loadSwingsetConfigFile(`${vatsDir}/chain-config.json`);
  if (config === null) {
    config = loadBasedir(vatsDir);
  }
  const mbs = buildMailboxStateMap(mailboxStorage);
  const timer = buildTimer();
  const mb = buildMailbox(mbs);
  const bd = buildBridge(bridgeOutbound);
  config.devices = {
    bridge: {
      sourceSpec: bd.srcPath,
    },
    mailbox: {
      sourceSpec: mb.srcPath,
    },
    timer: {
      sourceSpec: timer.srcPath,
    },
  };
  const deviceEndowments = {
    bridge: { ...bd.endowments },
    mailbox: { ...mb.endowments },
    timer: { ...timer.endowments },
  };

  async function ensureSwingsetInitialized() {
    if (swingsetIsInitialized(storage)) {
      return;
    }
    await initializeSwingset(config, argv, storage, { debugPrefix });
  }
  await ensureSwingsetInitialized();
  const controller = await makeSwingsetController(storage, deviceEndowments, {
    slogCallbacks,
  });

  // We DON'T want to run the kernel yet, only when the application decides
  // (either on bootstrap block (-1) or in endBlock).

  const bridgeInbound = bd.deliverInbound;
  return { controller, mb, bridgeInbound, timer };
}

export async function launch(
  kernelStateDBDir,
  mailboxStorage,
  doOutboundBridge,
  vatsDir,
  argv,
  debugName = undefined,
  meterProvider = DEFAULT_METER_PROVIDER,
) {
  console.info('Launching SwingSet kernel');

  const tempdir = path.resolve(kernelStateDBDir, 'check-lmdb-tempdir');
  const { openSwingStore } = getBestSwingStore(tempdir);
  const { storage, commit } = openSwingStore(kernelStateDBDir);

  function bridgeOutbound(dstID, obj) {
    // console.error('would outbound bridge', dstID, obj);
    return doOutboundBridge(dstID, obj);
  }

  // Not to be confused with the gas model, this meter is for OpenTelemetry.
  const metricMeter = meterProvider.getMeter('ag-chain-cosmos');
  const METRIC_LABELS = { app: 'ag-chain-cosmos' };

  const slogCallbacks = makeSlogCallbacks({
    metricMeter,
    labels: METRIC_LABELS,
  });

  console.debug(`buildSwingset`);
  const { controller, mb, bridgeInbound, timer } = await buildSwingset(
    mailboxStorage,
    bridgeOutbound,
    storage,
    vatsDir,
    argv,
    {
      debugName,
      slogCallbacks,
    },
  );

  const {
    schedulerCrankTimeHistogram,
    schedulerBlockTimeHistogram,
  } = exportKernelStats({
    controller,
    metricMeter,
    log: console,
    labels: METRIC_LABELS,
  });

  // ////////////////////////////
  // TODO: This is where we would add the scheduler.
  //
  // Note that the "bootstrap until no more progress" state will call this
  // function without any arguments.
  async function crankScheduler(maximumCranks = Infinity) {
    let now = Date.now();
    const blockStart = now;
    let stepped = true;
    let numCranks = 0;
    while (stepped && numCranks < maximumCranks) {
      const crankStart = now;
      // eslint-disable-next-line no-await-in-loop
      stepped = await controller.step();
      now = Date.now();
      schedulerCrankTimeHistogram.record(now - crankStart);
      numCranks += 1;
    }
    schedulerBlockTimeHistogram.record((now - blockStart) / 1000);
  }

  async function endBlock(_blockHeight, _blockTime) {
    await crankScheduler(FIXME_MAX_CRANKS_PER_BLOCK);
  }

  async function saveChainState() {
    // Save the mailbox state.
    await mailboxStorage.commit();
  }

  async function saveOutsideState(savedHeight, savedActions, savedChainSends) {
    storage.set(
      SWING_STORE_META_KEY,
      JSON.stringify([savedHeight, savedActions, savedChainSends]),
    );
    await commit();
  }

  async function deliverInbound(sender, messages, ack) {
    assert(Array.isArray(messages), X`inbound given non-Array: ${messages}`);
    if (!mb.deliverInbound(sender, messages, ack)) {
      return;
    }
    console.debug(`mboxDeliver:   ADDED messages`);
  }

  async function doBridgeInbound(source, body) {
    // console.log(`doBridgeInbound`);
    // the inbound bridge will push messages onto the kernel run-queue for
    // delivery+dispatch to some handler vat
    bridgeInbound(source, body);
  }

  async function beginBlock(blockHeight, blockTime) {
    const addedToQueue = timer.poll(blockTime);
    console.debug(
      `polled; blockTime:${blockTime}, h:${blockHeight}; ADDED =`,
      addedToQueue,
    );
  }

  const [initSavedHeight, savedActions, savedChainSends] = JSON.parse(
    storage.get(SWING_STORE_META_KEY) || '[-1, [], []]',
  );

  let savedHeight = initSavedHeight;

  // We need to fully bootstrap the chain before we can be open to receive
  // outside messages.
  async function ensureBootstrapComplete() {
    if (savedHeight >= 0) {
      return;
    }
    // Run the kernel until there is no more progress possible without inbound
    // messages.
    await crankScheduler();

    // Commit the results, with the savedHeight updated so that we don't do it
    // again.  All future cranks will be with the scheduler in a normal block
    // context.
    savedHeight = 0;
    await saveOutsideState(savedHeight, savedActions, savedChainSends);
  }
  await ensureBootstrapComplete();

  return {
    deliverInbound,
    doBridgeInbound,
    // bridgeOutbound,
    beginBlock,
    endBlock,
    saveChainState,
    saveOutsideState,
    savedHeight,
    savedActions,
    savedChainSends,
  };
}
