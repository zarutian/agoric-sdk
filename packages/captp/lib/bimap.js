/* global harden */
/* global Map */

const BiMap => (iterable = [], self) => {
  const key2val = new Map(iterable);
  const val2key = new Map((new Array(iterable)).map(([key, val]) => [val, key]));
  
  return harden({
    get [Symbol.species]() { return BiMap },
    get size() { return key2val.size; },
  });
};


export { BiMap, WeakBiMap };
