// @ts-check
/* global globalThis */

import { assert, details as X } from '@agoric/assert';
import { importBundle } from '@endo/import-bundle';
import { makeLiveSlots } from '../../liveslots/liveslots.js';
import { makeManagerKit } from './manager-helper.js';
import {
  makeSupervisorDispatch,
  makeSupervisorSyscall,
  makeVatConsole,
} from '../../supervisors/supervisor-helper.js';

export function makeLocalVatManagerFactory(tools) {
  const { allVatPowers, kernelKeeper, vatEndowments, gcTools, kernelSlog } =
    tools;

  const baseVP = {
    makeMarshal: allVatPowers.makeMarshal,
  };
  // testLog is also a vatPower, only for unit tests

  function prepare(vatID, vatSyscallHandler, compareSyscalls, useTranscript) {
    const mk = makeManagerKit(
      vatID,
      kernelSlog,
      kernelKeeper,
      vatSyscallHandler,
      true,
      compareSyscalls,
      useTranscript,
    );

    function finish(dispatch) {
      assert.typeof(dispatch, 'function');
      // this 'deliverToWorker' never throws, even if liveslots has an internal error
      mk.setDeliverToWorker(makeSupervisorDispatch(dispatch));

      async function shutdown() {
        // local workers don't need anything special to shut down between turns
      }

      return mk.getManager(shutdown);
    }
    const syscall = makeSupervisorSyscall(mk.syscallFromWorker, true);
    return { syscall, finish };
  }

  function createFromSetup(vatID, setup, managerOptions, vatSyscallHandler) {
    assert.typeof(setup, 'function', 'setup is not an in-realm function');

    const { compareSyscalls, useTranscript } = managerOptions;
    const { syscall, finish } = prepare(
      vatID,
      vatSyscallHandler,
      compareSyscalls,
      useTranscript,
    );
    const { testLog } = allVatPowers;
    const helpers = harden({}); // DEPRECATED, todo remove from setup()
    const state = null; // TODO remove from setup()
    const vatPowers = harden({ ...baseVP, testLog });

    const dispatch = setup(syscall, state, helpers, vatPowers);
    return finish(dispatch);
  }

  async function createFromBundle(
    vatID,
    bundle,
    managerOptions,
    vatSyscallHandler,
  ) {
    const {
      enableDisavow = false,
      enableSetup = false,
      vatConsole,
      liveSlotsConsole,
      enableVatstore = false,
      virtualObjectCacheSize,
      compareSyscalls,
      useTranscript,
    } = managerOptions;
    assert(vatConsole, 'vats need managerOptions.vatConsole');

    const { syscall, finish } = prepare(
      vatID,
      vatSyscallHandler,
      compareSyscalls,
      useTranscript,
    );

    const vatPowers = harden({
      ...baseVP,
      testLog: allVatPowers.testLog,
    });

    const makeLogMaker = logger => {
      const makeLog = level => {
        const log = logger[level];
        assert.typeof(log, 'function', X`logger[${level}] must be a function`);
        return log;
      };
      return makeLog;
    };

    const workerEndowments = harden({
      ...vatEndowments,
      console: makeVatConsole(makeLogMaker(vatConsole)),
      assert,
      TextEncoder,
      TextDecoder,
      Base64: globalThis.Base64, // Available only on XSnap
      URL: globalThis.URL, // Unavailable only on XSnap
    });

    async function buildVatNamespace(
      lsEndowments,
      inescapableGlobalProperties,
    ) {
      const vatNS = await importBundle(bundle, {
        filePrefix: `vat-${vatID}/...`,
        endowments: { ...workerEndowments, ...lsEndowments },
        inescapableGlobalProperties,
      });
      return vatNS;
    }

    if (enableSetup) {
      const vatNS = await buildVatNamespace({}, {});
      const setup = vatNS.default;
      assert(setup, X`vat source bundle lacks (default) setup() function`);
      assert.typeof(setup, 'function');
      const helpers = harden({}); // DEPRECATED, todo remove from setup()
      const state = null; // TODO remove from setup()
      const dispatch = setup(syscall, state, helpers, vatPowers);
      return finish(dispatch);
    } else {
      const ls = makeLiveSlots(
        syscall,
        vatID,
        vatPowers,
        virtualObjectCacheSize,
        enableDisavow,
        enableVatstore,
        gcTools,
        makeVatConsole(makeLogMaker(liveSlotsConsole)),
        buildVatNamespace,
      );
      assert(ls.dispatch);
      return finish(ls.dispatch);
    }
  }

  const localVatManagerFactory = harden({
    createFromBundle,
    createFromSetup,
  });
  return localVatManagerFactory;
}
