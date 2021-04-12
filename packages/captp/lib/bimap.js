/* global harden */
/* global Map */
/* global WeakMap */

const BiMap => (iterable = [], self) => {
  const key2val = new Map(iterable);
  const val2key = new Map((new Array(iterable)).map(([key, val]) => [val, key]));
  const realSelf = harden({
    get [Symbol.species]() { return BiMap },
    get size() { return key2val.size; },
    clear() {
      key2val.clear();
      val2key.clear();
      return undefined;
    },
    delete(key) {
      const had = key2val.has(key);
      const val = key2val.get(key);
      key2val.delete(key);
      val2key.delete(val);
      return had;
    },
    get(key) { return key2val.get(key); },
    getByValue(val) { return val2key.get(val); },
    has(key) { return key2val.has(key); },
    hasByValue(val) { return val2key.has(val); },
    set(key, val) {
      key2val.set(key, val);
      val2key.set(val, key);
      return realSelf;
    },
    [Symbol.iterator]() { return key2val[Symbol.iterator](); },
    keys() { return key2val.keys(); },
    values() { return val2key.keys(); },
    entries() { return key2val.entries(); },
    forEach(callback, thisValue) {
      return key2val.forEach((val, key, map) => callback.call(thisValue, val, key, realSelf));
    },
  });
  return realSelf;
};

/* global WeakRef */ // see https://github.com/tc39/proposal-weakrefs/blob/master/README.md
/* global FinalizationRegistry */
const WeakValueFinalizingMap = (iterable, finalizer, periodicRepeater = () => {}) => {
  const m   = new Map();
  const fin = (key) => {
    m.delete(key);
    finalizer(key);
  });
  const gc = () => {
    void m.forEach((v, k) => {
      if (v.deref() === undefined) { fin(k); }
    });
  };
  periodicRepeater(gc);
  const fr = new FinalizationRegistry(fin);
  const realSelf = harden({
    set(key, value) {
      // tbd: gc(); // here or omitt it?
      if (m.has(key)) { fr.unregister(key); }
      fr.register(value, key, key);
      m.set(key, new WeakRef(value));
      return realSelf;
    },
    has(key) {
      if (!m.has(key)) { return false; }
      const value = m.get(key).deref();
      if (value === undefined) {
        fin(key); return false;
      } else {
        return true;
      }
    },
    get(key) {
      if (!m.has(key)) { return undefined; }
      const value = m.get(key).deref();
      if (value === undefined) { fin(key); }
      return value;
    },
    [Symbol.iterator]() {
    },
    // todo: fully replicate the interface of Map
  });
  return realSelf;
};

export { BiMap, WeakBiMap, WeakValueFinalizingMap };
