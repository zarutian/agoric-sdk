
/* global harden */
import { E } from "@agoric/eventual-send";

const makeConditionor = (timerService, zoeService, defaultInterval=300000) => {
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
  const onTrue   = (condition, callback) => {};
  const onChange = (condition, callback) => {};
  return harden({ onTrue, onChange });
}

export default makeConditionor;
