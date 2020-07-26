
/* global harden */
import { E } from "@agoric/eventual-send";
import { jsonlogic } from "@jsonlogic/jsonlogic";

const makeConditionor = (timerService, environ, defaultInterval=300) => {
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
      Cs.forEach((value, handle) => {
        const { condition, callback } = value;
        // prevent plan interference?
        Promise.resolve(condition).then((cond) => {
          E(jl).apply(cond, environ).then((result) => {
            void E(callback).do(result);
          });
        });
      });
    }
  }));
  return harden({ onTrue, onChange });
}

export default makeConditionor;
