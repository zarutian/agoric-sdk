
/* global harden */
import { E } from "@agoric/eventual-send";
// import { jsonLogic } from "json-logic";
// see https://github.com/jwadhams/json-logic-js/blob/master/logic.js
// -inline start-
// a bit enhanced to deal with eventual-send
const jsonLogic = (() => {
  const jsonLogic = {};
  const operations = {
    "==":  (a, b) => (a == b),
    "===": (a, b) => (a === b),
    "!=":  (a, b) => (a != b),
    "!==": (a, b) => (a !== b),
    ">":   (a, b) => (a > b),
    ">=":  (a, b) => (a >= b),
    "<":   (a, b, c) => ((c === undefined) ? a < b : (a < b) && (b < c)),
    "<=":  (a, b, cl => ((c === undefined) ? a <= b : (a <= b) && (b <= c)),
    "!!":  (a) => (jsonLogic.truthy(a)),
    "!":   (a) => (!jsonLogic.truthy(a)),
    "%":   (a, b) => (a % b),
    "log": (a) => { console.log(a); return a; },
    "in":  (a, b) => {
      if(!b || typeof b.indexOf === "undefined") { return false; }
      return (b.indexOf(a) !== -1);
    },
    "cat": function() {
      return Array.prototype.join.call(arguments, "");
    },
    "substr": (source, start, end) => {
      if (end < 0){
        // JavaScript doesn't support negative end, this emulates PHP behavior
        var temp = String(source).substr(start);
        return temp.substr(0, temp.length + end);
      }
      return String(source).substr(start, end);
    },
    "+": function() {
      return Array.prototype.reduce.call(arguments, (a, b) => {
        return parseFloat(a, 10) + parseFloat(b, 10);
      }, 0);
    },
  };
  return jsonLogic;
})();
// -inline end-

const makeConditionorKit = (timerService, environ, interval=300) => {
  const jl = jsonLogic;
  const Cs = new Map();
  const newC = (condition, callback) => {
    const handle = harden({
      cancel: () => {
        try {
          const { callback } = Cs.get(handle);
          void E(callback).cancelled();
        }
        Cs.delete(handle);
      },
      toString: () => "«a handle from ConditionorService»"
    });
    Cs.set(handle, { condition, callback, lastResult: false });
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
    }));
    return handle;
  };
  const onChange = (condition, callback) => {
    const handle = newC(condition, harden({
      do: (result) => {
        const record = Cs.get(handle);
        const { lastResult } = record;
        if (lastResult != result) {
          void E(callback).do(result);
          record.lastResult = result;
        }
      },
      cancelled: () => { void E(callback).cancelled(); }
    }));
  }
  const repeater = E(timerService).createRepeater(0, interval);
  E(repeater).schedule(harden({
    wake: (time) => {
      environ.timeOfCheck = harden({ time, timer: timerService, interval });
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
  return harden({
    ConditionorService: harden({
      onTrue, onChange
      checkInterval: interval,
      toString: () => "«Conditionor service»"
    }),
    disable: () => repeater.disable(),
    getCs: () => Cs
  });
}

export default makeConditionorKit;