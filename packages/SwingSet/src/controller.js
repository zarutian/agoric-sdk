// eslint-disable-next-line no-redeclare
/* global setImmediate process Compartment harden */
// we have 'setImmediate' and 'process' because we know we're running under
// Node.js. Compartment and harden become available after calling lockdown()

import fs from 'fs';
import path from 'path';
import harden from '@agoric/harden';
//import { lockdown } from 'ses/dist/ses.cjs.js';
//import { lockdown } from 'ses';
import { lockdown } from '../../ses.esm.js';
import { assert } from '@agoric/assert';

import makeDefaultEvaluateOptions from '@agoric/default-evaluate-options';
import bundleSource from '@agoric/bundle-source';
//import EvaluateNS from '@agoric/evaluate';
//const { evaluateProgram, importBundle } = EvaluateNS;
import { evaluateProgram, importBundle } from '@agoric/evaluate';
import { initSwingStore } from '@agoric/swing-store-simple';
import { HandledPromise } from '@agoric/eventual-send';

import { makeMeteringTransformer } from '@agoric/transform-metering';
import * as babelCore from '@babel/core';

import buildKernelNonSES from './kernel/index';
import { insistStorageAPI } from './storageAPI';
import { insistCapData } from './capdata';
import { parseVatSlot } from './parseVatSlots';
import makeConsole from './makeConsole';

// FIXME: Put this somewhere better.
process.on('unhandledRejection', e =>
  console.log('UnhandledPromiseRejectionWarning:', e),
);

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

function makeKernelCompartmentEndowments(registerEndOfCrank) {
  // All code in the Agoric environment can use `@agoric/harden` and `SES`,
  // and this (coupled with bundle-source leaving both as "externals")
  // ensures they all get the same one
  function req(what) {
    if (what === '@agoric/harden') {
      return harden;
    }
    if (what === 'ses' || what == 'packages/ses.esm.js') {
      // The API contract of `lockdown()` is that `harden` and `Compartment`
      // will be available your global scope after `lockdown()` returns. All
      // JS code under SwingSet runs in a SES environment, so those values
      // are always available, even before calling `lockdown()`, so we can
      // return a dummy `lockdown` here.
      function lockdown() {
        // TODO: compare options, throw if they don't match what we did
      }

      return harden({ lockdown });
    }
    throw Error(`unknown require(${what})`);
  }

  const endowments = {
    // All code in the Agoric environment is allowed to write to the shared
    // console (which can only be read by privileged external code, and hence
    // does not provide a communication channel between otherwise isolated
    // objects)
    console: makeConsole(console),
    require: req,
    // We must put HandledPromise on the kernel compartment, so the same
    // instance of HandledPromise can copied from the global lexical scope
    // there into all new Compartments, to keep `@agoric/eventual-send` from
    // shimming in a new copy (with a distinct WeakMap, causing E(x).foo() to
    // fail with a "o['foo'] is not a function" error).
    HandledPromise,
    // registerEndOfCrank is an interim solution to metering, wherein static
    // vats (specifically Zoe and/or the 'spawner' vat) cooperate in
    // enforcing meter restrictions on subordinate contract code. They use
    // this hook to tell the kernel to refill the contract's meter when the
    // crank is complete (?verify?). It should go away after #534 is done and
    // we do metering on a per-vat basis rather than within a single vat.
    registerEndOfCrank,
  };
  return harden(endowments);
}

// The '@agoric/eventual-send' module (which provides the E() wrapper) also
// creates+uses HandledPromise, and will shim one into place if there isn't
// already one on the global. Each shim closes over a separate WeakMap, and
// HandledPromises from separate shims are not interoperable. liveslots.js
// (loaded by the kernel and made available to vats via the 'helper' object)
// registers handles on HandledPromises. Vats may import "E" from
// eventual-send and use it to make calls, which uses HandledPromise
// internally. If these two versions get different copies of HandledPromise,
// E(x).foo() will fail with a "o['foo'] is not a function" error. We provide
// HandledPromise as an endowment here so that both vats and the kernel (via
// liveslots.js) get the same one.


function makeImmutableCompartment(endowments) {
  const modules = undefined; // unimplemented too
  const transforms = [];
  const c = new Compartment(endowments, modules, { transforms });
  harden(c.global);
  return c;
}

var did_lockdown = false;

export async function buildVatController(config, withSES = true, argv = []) {
  if (!withSES) {
    throw Error('SES is now mandatory');
  }
  // todo: move argv into the config

  // We currently set noTameMath because
  // bundleSource>rollup>assignChunkColouringHashes uses Math.random
  // unless --preserveModules or --inlineDynamicImports is used

  if (!did_lockdown) {
    lockdown({
      noTameMath: true,
      noTameError: true,
    }); // creates Compartment

    // we must either set this handler, or use noTameError, because Node's
    // default handler attempts to get a stack-trace-free Error object by
    // modifying the Error object
    process.on('unhandledRejection', (error, p) => {
      console.log('unhandled rejection, boo');
      console.log('error is', error.toString());
      return true;
    });
    did_lockdown = true;
  }

  // The kernel source code neither needs tildot nor metering
  // transformations. Static vat source code needs tildot, but not metering.
  // Dynamic vat source code needs both. All three types need endowments for
  // `console` and `HandledPromise`, as well as the ability to import (via
  // `require`) `harden` and `ses` (so they can use `@agoric/evaluate`).

  // Both the kernel source code and static vats are processed by
  // bundle-source when the kernel starts up. Dynamic vats are converted from
  // on-disk files to a transmissible data artifact by bundle-source on the
  // developer's machine, during contract deployment.

  // Tildot transformations are done by bundle-source, but metering
  // transformations must be done locally (in kernel.js createVatDynamically)
  // because we can't rely upon the developer's machine to enforce the
  // metering rules correctly.

  const endOfCrankHooks = new Set();
  const registerEndOfCrank = hook => endOfCrankHooks.add(hook);

  const endowments = makeKernelCompartmentEndowments(registerEndOfCrank);
  //const c = makeImmutableCompartment(endowments);

  // take a vat/device source path, and return the setup function
  async function evaluateToSetup(sourceIndex, filePrefix = undefined) {
    if (!(sourceIndex[0] === '.' || path.isAbsolute(sourceIndex))) {
      throw Error(
        'sourceIndex must be relative (./foo) or absolute (/foo) not bare (foo)',
      );
    }

    // The module which defines the static vat/device is expected to have a
    // default export (`.default` on the namespace object) which is a setup()
    // function, called like `dispatch = setup(syscall, state, helpers)`.
    const sourceBundle = await bundleSource(`${sourceIndex}`, 'nestedEvaluate');
    const setup = (await importBundle(sourceBundle, { endowments,
                                                      filePrefix })).default;
    return setup;
  }

  const hostStorage = config.hostStorage || initSwingStore().storage;
  insistStorageAPI(hostStorage);

  const runEndOfCrank = () => {
    endOfCrankHooks.forEach(h => {
      try {
        h();
      } catch (e) {
        try {
          console.log('cannot run hook:', e);
        } catch (e2) {
          // Nothing to do.
        }
      }
    });
    endOfCrankHooks.clear();
  };

  // `kernelEndowments` holds authorities that the kernel gets but which vats
  // do not. These are passed as arguments to the `buildKernel` function,
  // rather than being added to the global lexical scope.
  const kernelEndowments = {
    setImmediate,
    hostStorage,
    runEndOfCrank,
    vatAdminDevSetup: await evaluateToSetup(ADMIN_DEVICE_PATH, '/SwingSet/src'),
    vatAdminVatSetup: await evaluateToSetup(ADMIN_VAT_PATH, '/SwingSet/src'),
  };

  const kernelSourcePath = require.resolve('./kernel/index.js');
  const kernelBundle = await bundleSource(kernelSourcePath, 'nestedEvaluate');
  const buildKernel = (await importBundle(kernelBundle, { endowments,
                                                          filePrefix: kernelSourcePath })).default;
  const kernel = buildKernel(kernelEndowments);

  async function addGenesisVat(name, sourceIndex, options = {}) {
    console.log(`= adding vat '${name}' from ${sourceIndex}`);
    const setup = await evaluateToSetup(sourceIndex, `/SwingSet-vat-${name}`);
    kernel.addGenesisVat(name, setup, options);
  }

  async function addGenesisDevice(name, sourceIndex, endowments) {
    const setup = await evaluateToSetup(sourceIndex, `/SwingSet-dev-${name}`);
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
      return kernel.run();
    },

    async step() {
      return kernel.step();
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
      assert.typeof(method, 'string');
      insistCapData(args);
      kernel.addExport(vatID, exportID);
      kernel.queueToExport(vatID, exportID, method, args);
    },
  });

  return controller;
}
