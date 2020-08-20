import fs from 'fs';
import path from 'path';
import temp from 'temp';
import { exec } from 'child_process';
import { promisify } from 'util';
// import { createHash } from 'crypto';

import anylogger from 'anylogger';

// import connect from 'lotion-connect';
// import djson from 'deterministic-json';

import {
  loadBasedir,
  loadSwingsetConfigFile,
  buildCommand,
  buildVatController,
  buildMailboxStateMap,
  buildMailbox,
  buildTimer,
} from '@agoric/swingset-vat';
import { getBestSwingStore } from '../check-lmdb';

import { deliver, addDeliveryTarget } from './outbound';
import { makeHTTPListener } from './web';
import { makeWithQueue } from './vats/queue';

import { connectToChain } from './chain-cosmos-sdk';
import { connectToFakeChain } from './fake-chain';

// import { makeChainFollower } from './follower';
// import { makeDeliverator } from './deliver-with-ag-cosmos-helper';

const log = anylogger('start');

let swingSetRunning = false;

const fsWrite = promisify(fs.write);
const fsClose = promisify(fs.close);
const rename = promisify(fs.rename);
const unlink = promisify(fs.unlink);
const symlink = promisify(fs.symlink);

async function atomicReplaceFile(filename, contents) {
  const info = await new Promise((resolve, reject) => {
    temp.open(
      {
        dir: path.dirname(filename),
        prefix: `${path.basename(filename)}.`,
      },
      (err, inf) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(inf);
      },
    );
  });
  try {
    // Write the contents, close, and rename.
    await fsWrite(info.fd, contents);
    await fsClose(info.fd);
    await rename(info.path, filename);
  } catch (e) {
    // Unlink on error.
    try {
      await unlink(info.path);
    } catch (e2) {
      // do nothing, we're already failing
    }
    throw e;
  }
}

async function buildSwingset(
  kernelStateDBDir,
  mailboxStateFile,
  vatsDir,
  argv,
  broadcast,
) {
  const initialMailboxState = JSON.parse(fs.readFileSync(mailboxStateFile));

  const mbs = buildMailboxStateMap();
  mbs.populateFromData(initialMailboxState);
  const mb = buildMailbox(mbs);
  const cm = buildCommand(broadcast);
  const timer = buildTimer();

  let config = loadSwingsetConfigFile(`${vatsDir}/solo-config.json`);
  if (config === null) {
    config = loadBasedir(vatsDir);
  }
  config.devices = [
    ['mailbox', mb.srcPath, mb.endowments],
    ['command', cm.srcPath, cm.endowments],
    ['timer', timer.srcPath, timer.endowments],
  ];

  const tempdir = path.resolve(kernelStateDBDir, 'check-lmdb-tempdir');
  const { openSwingStore } = getBestSwingStore(tempdir);
  const { storage, commit } = openSwingStore(kernelStateDBDir);

  const controller = await buildVatController(config, argv, {
    hostStorage: storage,
  });

  async function saveState() {
    const ms = JSON.stringify(mbs.exportToData());
    await atomicReplaceFile(mailboxStateFile, ms);
    commit();
  }

  function deliverOutbound() {
    deliver(mbs);
  }

  async function processKernel() {
    await controller.run();
    if (swingSetRunning) {
      await saveState();
      deliverOutbound();
    }
  }

  const withInputQueue = makeWithQueue();

  // Use the input queue to make sure it doesn't overlap with
  // other inbound messages.
  const queuedDeliverInboundToMbx = withInputQueue(
    async function deliverInboundToMbx(sender, messages, ack) {
      if (!Array.isArray(messages)) {
        throw new Error(`inbound given non-Array: ${messages}`);
      }
      // console.debug(`deliverInboundToMbx`, messages, ack);
      if (mb.deliverInbound(sender, messages, ack, true)) {
        await processKernel();
      }
    },
  );

  // Use the input queue to make sure it doesn't overlap with
  // other inbound messages.
  const queuedBoxedDeliverInboundCommand = withInputQueue(
    async function deliverInboundCommand(obj) {
      // this promise could take an arbitrarily long time to resolve, so don't
      // wait on it
      const p = cm.inboundCommand(obj);

      // Register a handler in this turn so that we don't get complaints about
      // asynchronously-handled callbacks.
      p.catch(_ => {});

      // The turn passes...
      await processKernel();

      // We box the promise, so that this queue isn't stalled.
      // The queue protects the above cm.inboundCommand and
      // processKernel calls.
      //
      // The promise to the box is resolved as the return value of
      // this function (which releases the input queue shortly after
      // the processKernel call has completed).
      //
      // The caller can determine if they want to wait for the
      // unboxed promise (which represents the results of the inbound
      // command), which may not ever resolve.
      return [
        p.catch(e => {
          // Rethrow any inboundCommand rejection in the new turn so that our
          // caller must handle it (or be an unhandledRejection).
          throw e;
        }),
      ];
    },
  );

  // Our typical user will always want to wait for the results of
  // the boxed promise, so by default, extract it and await it.
  const queuedDeliverInboundCommand = obj =>
    queuedBoxedDeliverInboundCommand(obj).then(([p]) => p);

  let intervalMillis;

  // Use the input queue to make sure it doesn't overlap with
  // other inbound messages.
  const queuedMoveTimeForward = withInputQueue(
    async function moveTimeForward() {
      const now = Math.floor(Date.now() / intervalMillis);
      try {
        if (timer.poll(now)) {
          await processKernel();
          log.debug(`timer-provoked kernel crank complete ${now}`);
        }
      } catch (err) {
        log.error(`timer-provoked kernel crank failed at ${now}:`, err);
      } finally {
        // We only rearm the timeout if moveTimeForward has completed, to
        // make sure we don't have two copies of controller.run() executing
        // at the same time.
        setTimeout(queuedMoveTimeForward, intervalMillis);
      }
    },
  );

  // now let the bootstrap functions run
  await processKernel();

  return {
    deliverInboundToMbx: queuedDeliverInboundToMbx,
    deliverInboundCommand: queuedDeliverInboundCommand,
    deliverOutbound,
    startTimer: interval => {
      intervalMillis = interval;
      setTimeout(queuedMoveTimeForward, intervalMillis);
    },
  };
}

export default async function start(basedir, argv) {
  const mailboxStateFile = path.resolve(
    basedir,
    'swingset-kernel-mailbox.json',
  );
  const connections = JSON.parse(
    fs.readFileSync(path.join(basedir, 'connections.json')),
  );

  let broadcastJSON;
  function broadcast(obj) {
    if (broadcastJSON) {
      broadcastJSON(obj);
    } else {
      log.error(`Called broadcast before HTTP listener connected.`);
    }
  }

  const vatsDir = path.join(basedir, 'vats');
  const stateDBDir = path.join(basedir, 'swingset-kernel-state');
  const d = await buildSwingset(
    stateDBDir,
    mailboxStateFile,
    vatsDir,
    argv,
    broadcast,
  );

  const {
    deliverInboundToMbx,
    deliverInboundCommand,
    deliverOutbound,
    startTimer,
  } = d;

  let hostport;
  await Promise.all(
    connections.map(async c => {
      switch (c.type) {
        case 'chain-cosmos-sdk':
          {
            log(`adding follower/sender for GCI ${c.GCI}`);
            // c.rpcAddresses are strings of host:port for the RPC ports of several
            // chain nodes
            const deliverator = await connectToChain(
              basedir,
              c.GCI,
              c.rpcAddresses,
              c.myAddr,
              deliverInboundToMbx,
              c.chainID,
            );
            addDeliveryTarget(c.GCI, deliverator);
          }
          break;
        case 'fake-chain': {
          log(`adding follower/sender for fake chain ${c.role} ${c.GCI}`);
          const deliverator = await connectToFakeChain(
            basedir,
            c.GCI,
            c.role,
            c.fakeDelay,
            deliverInboundToMbx,
          );
          addDeliveryTarget(c.GCI, deliverator);
          break;
        }
        case 'http':
          log(`adding HTTP/WS listener on ${c.host}:${c.port}`);
          if (broadcastJSON) {
            throw new Error(`duplicate type=http in connections.json`);
          }
          hostport = `${c.host}:${c.port}`;
          broadcastJSON = await makeHTTPListener(
            basedir,
            c.port,
            c.host,
            deliverInboundCommand,
          );
          break;
        default:
          throw new Error(`unknown connection type in ${c}`);
      }
    }),
  );

  // Start timer here!
  startTimer(1200);

  // Remove wallet traces.
  await unlink('html/wallet').catch(_ => {});

  log.info(`swingset running`);
  swingSetRunning = true;
  deliverOutbound();

  if (!hostport) {
    return;
  }

  const { wallet } = JSON.parse(fs.readFileSync('options.json', 'utf-8'));

  // Symlink the wallet.
  const pjs = require.resolve(`${wallet}/package.json`);
  const {
    'agoric-wallet': {
      htmlBasedir = 'ui/build',
      deploy = ['contract/deploy.js', 'api/deploy.js'],
    } = {},
  } = JSON.parse(fs.readFileSync(pjs, 'utf-8'));

  const agWallet = path.dirname(pjs);
  const agWalletHtml = path.resolve(agWallet, htmlBasedir);

  const deploys = typeof deploy === 'string' ? [deploy] : deploy;
  // TODO: Shell-quote the deploy list.
  const agWalletDeploy = deploys
    .map(dep => path.resolve(agWallet, dep))
    .join(' ');

  const agoricCli = require.resolve('.bin/agoric');

  // Launch the agoric wallet deploys (if any).
  exec(
    `${agoricCli} deploy --provide=wallet --hostport=${hostport} ${agWalletDeploy}`,
    (err, _stdout, stderr) => {
      if (err) {
        console.error(err);
        return;
      }
      if (stderr) {
        // Report the error.
        process.stderr.write(stderr);
      }
      // Now that the deploy is done, link the wallet!
      symlink(agWalletHtml, 'html/wallet').catch(e => {
        console.error('Cannot link html/wallet:', e);
      });
    },
  );
}
