/* eslint no-await-in-loop: "off" */
/* eslint dot-notation: "off" */
/* eslint object-shorthand: "off" */

import '@agoric/install-ses';
import { test } from 'tape-promise/tape';
import path from 'path';
import { buildVatController, loadBasedir } from '../src/index';
import { buildLoopbox } from '../src/devices/loopbox';
import { buildPatterns } from './message-patterns';

// This exercises all the patterns in 'message-patterns.js' twice (once with
// vatA/vatB connected directly through the kernel, and a second time with
// comms vats in the path). To enable/disable specific tests, edit the
// entries in that file.

// use test['only'] so 'grep test(.)only' won't have false matches
const modes = {
  test: test,
  only: test['only'],
  skip: test['skip'],
};

// eslint-disable-next-line no-unused-vars
async function runWithTrace(c) {
  let count = 0;
  while (c.dump().runQueue.length) {
    console.log('-');
    console.log(`--- turn starts`, count);
    count += 1;
    await c.step();
    // console.log(c.dump().kernelTable);
    for (const q of c.dump().runQueue) {
      if (q.type === 'send') {
        console.log(
          ` send ${q.msg.result} = ${q.target}!${
            q.msg.method
          }(${q.msg.args.slots.join(',')} ${q.msg.args.body})`,
        );
      } else if (q.type === 'notify') {
        console.log(` notify ${q.vatID}: ${q.kpid}`);
      }
    }
  }
}

export async function runVatsLocally(t, name) {
  console.log(`------ testing pattern (local) -- ${name}`);
  const bdir = path.resolve(__dirname, 'basedir-message-patterns');
  const config = await loadBasedir(bdir);
  config.bootstrap = 'bootstrap';
  config.vats.bootstrap = { sourceSpec: path.join(bdir, 'bootstrap-local.js') };
  const c = await buildVatController(config, [name]);
  // await runWithTrace(c);
  await c.run();
  return c.dump().log;
}

function testLocalPatterns() {
  const bp = buildPatterns();
  for (const name of Array.from(bp.patterns.keys()).sort()) {
    const mode = bp.patterns.get(name).local;
    modes[mode](`test pattern ${name} locally`, async t => {
      const logs = await runVatsLocally(t, name);
      t.deepEqual(logs, bp.expected[name]);
      t.end();
    });
  }
}
testLocalPatterns();

const commsSourcePath = require.resolve('../src/vats/comms');
const vatTPSourcePath = require.resolve('../src/vats/vat-tp');

export async function runVatsInComms(t, enablePipelining, name) {
  console.log(`------ testing pattern (comms) -- ${name}`);
  const enableSetup = true;
  const bdir = path.resolve(__dirname, 'basedir-message-patterns');
  const config = await loadBasedir(bdir);
  config.bootstrap = 'bootstrap';
  config.vats.bootstrap = { sourceSpec: path.join(bdir, 'bootstrap-comms.js') };
  config.vats.leftcomms = {
    sourceSpec: commsSourcePath,
    creationOptions: {
      enablePipelining,
      enableSetup,
    },
  };
  config.vats.rightcomms = {
    sourceSpec: commsSourcePath,
    creationOptions: {
      enablePipelining,
      enableSetup,
    },
  };
  config.vats.leftvattp = { sourceSpec: vatTPSourcePath };
  config.vats.rightvattp = { sourceSpec: vatTPSourcePath };
  const { passOneMessage, loopboxSrcPath, loopboxEndowments } = buildLoopbox(
    'queued',
  );
  config.devices = [['loopbox', loopboxSrcPath, loopboxEndowments]];
  const c = await buildVatController(config, [name]);
  // await runWithTrace(c);
  await c.run();
  while (passOneMessage()) {
    await c.run();
  }
  return c.dump().log;
}

function testCommsPatterns() {
  const enablePipelining = true;
  const bp = buildPatterns();
  for (const name of Array.from(bp.patterns.keys()).sort()) {
    const mode = bp.patterns.get(name).comms;
    modes[mode](`test pattern ${name} locally`, async t => {
      const logs = await runVatsInComms(t, enablePipelining, name);
      let expected = bp.expected[name];
      if (enablePipelining && name in bp.expected_pipelined) {
        expected = bp.expected_pipelined[name];
      }
      t.deepEqual(logs, expected);
      t.end();
    });
  }
}
testCommsPatterns();
