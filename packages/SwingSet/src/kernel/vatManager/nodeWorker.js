/* global harden */

// import { Worker } from 'worker_threads'; // not from a Compartment
import { assert } from '@agoric/assert';
import { makePromiseKit } from '@agoric/promise-kit';
import { makeTranscriptManager } from './transcript';

import { createSyscall } from './syscall';

// start a "Worker" (Node's tool for starting new threads) and load a bundle
// into it

/*
import { waitUntilQuiescent } from '../../waitUntilQuiescent';
function wait10ms() {
  const { promise: queueEmptyP, resolve } = makePromiseKit();
  setTimeout(() => resolve(), 10);
  return queueEmptyP;
}
*/

// eslint-disable-next-line no-unused-vars
function parentLog(first, ...args) {
  // console.error(`--parent: ${first}`, ...args);
}

export function makeNodeWorkerVatManagerFactory(tools) {
  const { makeNodeWorker, kernelKeeper } = tools;

  function createFromBundle(vatID, bundle, managerOptions) {
    const { vatParameters } = managerOptions;
    assert(!managerOptions.metered, 'not supported yet');
    assert(!managerOptions.notifyTermination, 'not supported yet');
    assert(!managerOptions.enableSetup, 'not supported at all');
    if (managerOptions.enableInternalMetering) {
      // TODO: warn+ignore, rather than throw, because the kernel enables it
      // for all vats, because the Spawner still needs it. When the kernel
      // stops doing that, turn this into a regular assert
      console.log(`node-worker does not support enableInternalMetering`);
    }
    const vatKeeper = kernelKeeper.allocateVatKeeperIfNeeded(vatID);
    const transcriptManager = makeTranscriptManager(
      kernelKeeper,
      vatKeeper,
      vatID,
    );

    // prepare to accept syscalls from the worker

    // TODO: make the worker responsible for checking themselves: we send
    // both the delivery and the expected syscalls, and the supervisor
    // compares what the bundle does with what it was told to expect.
    // Modulo flow control, we just stream transcript entries at the
    // worker and eventually get back an "ok" or an error. When we do
    // that, doSyscall won't even see replayed syscalls from the worker.

    const { doSyscall, setVatSyscallHandler } = createSyscall(
      transcriptManager,
    );
    function handleSyscall(vatSyscallObject) {
      const type = vatSyscallObject[0];
      if (type === 'callNow') {
        throw Error(`nodeWorker cannot block, cannot use syscall.callNow`);
      }
      doSyscall(vatSyscallObject);
    }

    // start the worker and establish a connection

    const { promise: workerP, resolve: gotWorker } = makePromiseKit();

    function sendToWorker(msg) {
      assert(msg instanceof Array);
      workerP.then(worker => worker.postMessage(msg));
    }

    const {
      promise: dispatchReadyP,
      resolve: dispatchIsReady,
    } = makePromiseKit();
    let waiting;

    function handleUpstream([type, ...args]) {
      parentLog(`received`, type);
      if (type === 'setUplinkAck') {
        parentLog(`upload ready`);
      } else if (type === 'gotBundle') {
        parentLog(`bundle loaded`);
      } else if (type === 'dispatchReady') {
        parentLog(`dispatch() ready`);
        // wait10ms().then(dispatchIsReady); // stall to let logs get printed
        dispatchIsReady();
      } else if (type === 'syscall') {
        parentLog(`syscall`, args);
        const vatSyscallObject = args;
        handleSyscall(vatSyscallObject);
      } else if (type === 'deliverDone') {
        parentLog(`deliverDone`);
        if (waiting) {
          const resolve = waiting;
          waiting = null;
          resolve();
        }
      } else {
        parentLog(`unrecognized uplink message ${type}`);
      }
    }

    const worker = makeNodeWorker();
    worker.on('message', handleUpstream);
    gotWorker(worker);

    parentLog(`instructing worker to load bundle..`);
    sendToWorker(['setBundle', bundle, vatParameters]);

    function deliver(delivery) {
      parentLog(`sending delivery`, delivery);
      assert(!waiting, `already waiting for delivery`);
      const pr = makePromiseKit();
      waiting = pr.resolve;
      sendToWorker(['deliver', ...delivery]);
      return pr.promise;
    }

    function replayTranscript() {
      throw Error(`replayTranscript not yet implemented`);
    }

    function shutdown() {
      // this returns a Promise that fulfills with 1 if we used
      // worker.terminate(), otherwise with the `exitCode` passed to
      // `process.exit(exitCode)` within the worker.
      return worker.terminate();
    }

    const manager = harden({
      replayTranscript,
      setVatSyscallHandler,
      deliver,
      shutdown,
    });

    return dispatchReadyP.then(() => manager);
  }

  return harden({ createFromBundle });
}
