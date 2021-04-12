/* global harden */
/* global Map */

const BiMap => (iterable = [], self) => {
  const key2val = new Map(iterable);
  const val2key = new Map((new Array(iterable)).map(([key, val]) => [val, key]));
  
  return harden({
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
    }
  });
};


export { BiMap, WeakBiMap };
