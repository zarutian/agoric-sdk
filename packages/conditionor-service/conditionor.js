
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
    "*": function() {
      return Array.prototype.reduce.call(arguments, (a, b) => {
        return parseFloat(a, 10) * parseFloat(b, 10);
      });
    },
    "-": (a, b) => ((b === undefined) ? -a : (a - b)),
    "/": (a, b) => (a / b),
    "min": function () {
      return Math.min.apply(this, arguments);
    },
    "max": function () {
      return Math.max.apply(this, arguments);
    },
    "merge": function () {
      return Array.prototype.reduce.call(arguments, (a, b) => (a.concat(b)), []);
    },
    "var": function(a, b) {
      var not_found = (b === undefined) ? null : b;
      var data = this;
      if (typeof a === "undefined" || a === "" || a === null) {
        return data;
      }
      var sub_props = String(a).split(".");
      for (var i = 0; i < sub_props.length; i++) {
        if (data === null) {
          return not_found;
        }
        // Descending into data
        data = data[sub_props[i]];
        if (data === undefined) {
          return not_found;
        }
      }
      return data;
    },
    "missing": function() {
      /*
      Missing can receive many keys as many arguments, like {"missing:[1,2]}
      Missing can also receive *one* argument that is an array of keys,
      which typically happens if it's actually acting on the output of another command
      (like 'if' or 'merge')
      */
      var missing = [];
      var keys = Array.isArray(arguments[0]) ? arguments[0] : arguments;
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = jsonLogic.apply({"var": key}, this);
        if(value === null || value === "") {
          missing.push(key);
        }
      }
      return missing;
    },
    "missing_some": function (need_count, options) {
      // missing_some takes two arguments, how many (minimum) items must be present, and an array of keys (just like 'missing') to check for presence.
      var are_missing = jsonLogic.apply({"missing": options}, this);
      if (options.length - are_missing.length >= need_count) {
        return [];
      } else {
        return are_missing;
      }
    },
    "method": (obj, method, args) => (obj[method].apply(obj, args))
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
