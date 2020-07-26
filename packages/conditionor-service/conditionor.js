
/* global harden */
import { E } from "@agoric/eventual-send";
import { jsonlogic } from "@jsonlogic/jsonlogic";

const makeConditionor = (timerService, zoeService, defaultInterval=300) => {
  const Cs = new Map();
  const newC = (condition, callback) => {
    const handle = harden({ cancel: () => {
      try {
        const { callback } = Cs.get(handle);
        void E(callback).cancelled();
      }
      Cs.delete(handle);
    } });
    Cs.set(handle, { condition, callback });
    return handle;
  }
  const onTrue   = (condition, callback) => {
    const handle = newC(condition, harden({
      do: (result) => {
        if (result) {
          void E(callback).do(result);
          handle.cancel();
        }
      },
      cancelled: () => { void E(callback).cancelled(); }
    });
    return handle;
  };
  const onChange = newC;
  const repeater = E(timerService).createRepeater(0, defaultInterval);
  E(repeater).schedule(harden({
    wake: (time) => {
    }
  }));
  return harden({ onTrue, onChange });
}

export default makeConditionor;
