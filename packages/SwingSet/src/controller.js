// eslint-disable-next-line no-redeclare
// global setImmediate Compartment harden process
// we have 'setImmediate' here because we know we're running under Node.js
// 'Compartment' and 'harden' show up once we call lockdown()

import fs from 'fs';
import path from 'path';
import Nat from '@agoric/nat';
import { lockdown } from './ses.esm.js';

import makeDefaultEvaluateOptions from '@agoric/default-evaluate-options';
import bundleSource from '@agoric/bundle-source';

// eslint-disable-next-line import/extensions
import kernelSourceFunc from './bundles/kernel';
import buildKernelNonSES from './kernel/index.js';
import { insist } from './insist.js';
import { insistStorageAPI } from './storageAPI.js';
import { insistCapData } from './capdata.js';
import { parseVatSlot } from './parseVatSlots.js';
import { buildStorageInMemory } from './hostStorage.js';

const ADMIN_DEVICE_PATH = require.resolve('./kernel/vatAdmin/vatAdmin-src');
const ADMIN_VAT_PATH = require.resolve('./kernel/vatAdmin/vatAdminWrapper');

function byName(a, b) {
  if (a.name < b.name) {
    return -1;
  }
  if (a.name > b.name) {
    return 1;
  }
  return 0;
}

/**
 * Scan a directory for files defining the vats to bootstrap for a swingset.
 * Looks for files with names of the pattern `vat-NAME.js` as well as a file
 * named 'bootstrap.js'.
 *
 * @param basedir  The directory to scan
 *
 * @return an object {
 *    vats, // map from NAME to the full path to the corresponding .js file
 *    bootstrapIndexJS, // path to the bootstrap.js file, or undefined if none
 * }
 *
 * TODO: bootstrapIndexJS is a terrible name.  Rename to something like
 * bootstrapSourcePath (renaming mildly complicated because it's referenced in
 * lots of places).
 */
export function loadBasedir(basedir) {
  console.log(`= loading config from basedir ${basedir}`);
  const vats = new Map(); // name -> { sourcepath, options }
  const subs = fs.readdirSync(basedir, { withFileTypes: true });
  subs.sort(byName);
  subs.forEach(dirent => {
    if (dirent.name.endsWith('~')) {
      // Special case crap filter to ignore emacs backup files and the like.
      // Note that the regular filename parsing below will ignore such files
      // anyway, but this skips logging them so as to reduce log spam.
      return;
    }
    if (
      dirent.name.startsWith('vat-') &&
      dirent.isFile() &&
      dirent.name.endsWith('.js')
    ) {
      const name = dirent.name.slice('vat-'.length, -'.js'.length);
      const vatSourcePath = path.resolve(basedir, dirent.name);
      vats.set(name, { sourcepath: vatSourcePath, options: {} });
    } else {
      console.log('ignoring ', dirent.name);
    }
  });
  let bootstrapIndexJS = path.resolve(basedir, 'bootstrap.js');
  try {
    fs.statSync(bootstrapIndexJS);
  } catch (e) {
    // TODO this will catch the case of the file not existing but doesn't check
    // that it's a plain file and not a directory or something else unreadable.
    // Consider putting in a more sophisticated check if this whole directory
    // scanning thing is something we decide we want to have long term.
    bootstrapIndexJS = undefined;
  }
  return { vats, bootstrapIndexJS };
}

function makeSESEvaluator() {
  lockdown(); // creates Compartment
  const endowments = {
    console: console, // lazy for now
  };
  // todo: makeDefaultEvaluateOptions and transforms and stuff
  const c = new Compartment(endowments);
  return src => {
    //return c.evaluate(src, { require: r })().default;
    return c.evaluate(src);
  };
}

export async function buildVatController(config, withSES = true, argv = []) {
  if (!withSES) {
    throw Error('SES is now mandatory');
  }
  // todo: move argv into the config

  process.on('unhandledRejection', (error, p) => {
    console.log('unhandled rejection, boo');
    console.log('error is', error.toString());
    return true;
  });

  const sesEvaluator = makeSESEvaluator();

  // Evaluate source in a SES context to produce a setup function.
  async function evaluateToSetup(sourceIndex) {
    if (!(sourceIndex[0] === '.' || path.isAbsolute(sourceIndex))) {
      throw Error(
        'sourceIndex must be relative (./foo) or absolute (/foo) not bare (foo)',
      );
    }

    // we load the sourceIndex (and everything it imports), and expect to get
    // two symbols from each Vat: 'start' and 'dispatch'. The code in
    // bootstrap.js gets a 'controller' object which can invoke start()
    // (which is expected to initialize some state and export some facetIDs)
    const { source, sourceMap } = await bundleSource(`${sourceIndex}`);
    const actualSource = `(${source})\n${sourceMap}`;
    const setup = sesEvaluator(actualSource)().default;
    return setup;
  }

  const hostStorage = config.hostStorage || buildStorageInMemory().storage;
  insistStorageAPI(hostStorage);
  const kernelEndowments = {
    setImmediate,
    hostStorage,
    //vatAdminDevSetup: await evaluateToSetup(ADMIN_DEVICE_PATH),
    //vatAdminVatSetup: await evaluateToSetup(ADMIN_VAT_PATH),
  };

  const kernelSource = `(${kernelSourceFunc})`;
  console.log("BK HERE 1");
  const buildKernel = sesEvaluator(kernelSource)().default;
  console.log("BK HERE 2");
  const kernel = buildKernel(kernelEndowments);

  async function addGenesisVat(name, sourceIndex, options = {}) {
    console.log(`= adding vat '${name}' from ${sourceIndex}`);
    const setup = await evaluateToSetup(sourceIndex);
    kernel.addGenesisVat(name, setup, options);
  }

  async function addGenesisDevice(name, sourceIndex, endowments) {
    const setup = await evaluateToSetup(sourceIndex);
    kernel.addGenesisDevice(name, setup, endowments);
  }

  if (config.devices) {
    for (const [name, srcpath, endowments] of config.devices) {
      // eslint-disable-next-line no-await-in-loop
      await addGenesisDevice(name, srcpath, endowments);
    }
  }

  if (config.vats) {
    for (const name of config.vats.keys()) {
      const v = config.vats.get(name);
      // eslint-disable-next-line no-await-in-loop
      await addGenesisVat(name, v.sourcepath, v.options || {});
    }
  }

  let bootstrapVatName;
  if (config.bootstrapIndexJS) {
    bootstrapVatName = '_bootstrap';
    await addGenesisVat(bootstrapVatName, config.bootstrapIndexJS, {});
  }

  // start() may queue bootstrap if state doesn't say we did it already. It
  // also replays the transcripts from a previous run, if any, which will
  // execute vat code (but all syscalls will be disabled)
  await kernel.start(bootstrapVatName, JSON.stringify(argv));

  // the kernel won't leak our objects into the Vats, we must do
  // the same in this wrapper
  const controller = harden({
    log(str) {
      kernel.log(str);
    },

    dump() {
      return JSON.parse(JSON.stringify(kernel.dump()));
    },

    async run() {
      await kernel.run();
    },

    async step() {
      await kernel.step();
    },

    // these are for tests

    vatNameToID(vatName) {
      return kernel.vatNameToID(vatName);
    },
    deviceNameToID(deviceName) {
      return kernel.deviceNameToID(deviceName);
    },

    queueToVatExport(vatName, exportID, method, args) {
      const vatID = kernel.vatNameToID(vatName);
      parseVatSlot(exportID);
      insist(method === `${method}`);
      insistCapData(args);
      kernel.addExport(vatID, exportID);
      kernel.queueToExport(vatID, exportID, method, args);
    },
  });

  return controller;
}
