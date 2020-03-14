// Adapted from SES/Caja - Copyright (C) 2011 Google Inc.
// Copyright (C) 2018 Agoric

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// based upon:
// https://github.com/google/caja/blob/master/src/com/google/caja/ses/startSES.js
// https://github.com/google/caja/blob/master/src/com/google/caja/ses/repairES5.js
// then copied from proposal-frozen-realms deep-freeze.js
// then copied from SES/src/bundle/deepFreeze.js

/**
 * @typedef HardenerOptions
 * @type {object}
 * @property {WeakSet=} fringeSet WeakSet to use for the fringeSet
 * @property {Function=} naivePrepareObject Call with object before hardening
 */

/**
 * Create a `harden` function.
 *
 * @param {Iterable} initialFringe Objects considered already hardened
 * @param {HardenerOptions=} options Options for creation
 */
function makeHardener(initialFringe, options = {}) {
  const { freeze, getOwnPropertyDescriptors, getPrototypeOf } = Object;
  const { ownKeys } = Reflect;

  // Objects that we won't freeze, either because we've frozen them already,
  // or they were one of the initial roots (terminals). These objects form
  // the "fringe" of the hardened object graph.
  let { fringeSet } = options;
  if (fringeSet) {
    if (
      typeof fringeSet.add !== 'function' ||
      typeof fringeSet.has !== 'function'
    ) {
      throw new TypeError(
        `options.fringeSet must have add() and has() methods`,
      );
    }

    // Populate the supplied fringeSet with our initialFringe.
    if (initialFringe) {
      for (const fringe of initialFringe) {
        fringeSet.add(fringe);
      }
    }
  } else {
    // Use a new empty fringe.
    fringeSet = new WeakSet(initialFringe);
  }

  const naivePrepareObject = options && options.naivePrepareObject;

  const { harden } = {
    harden(root) {
      const toFreeze = new Set();
      const prototypes = new Map();
      const paths = new WeakMap();

      // If val is something we should be freezing but aren't yet,
      // add it to toFreeze.
      function enqueue(val, path) {
        if (Object(val) !== val) {
          // ignore primitives
          return;
        }
        const type = typeof val;
        if (type !== 'object' && type !== 'function') {
          // future proof: break until someone figures out what it should do
          throw new TypeError(`Unexpected typeof: ${type}`);
        }
        if (fringeSet.has(val) || toFreeze.has(val)) {
          // Ignore if this is an exit, or we've already visited it
          return;
        }
        // console.log(`adding ${val} to toFreeze`, val);
        toFreeze.add(val);
        paths.set(val, path);
      }

      function freezeAndTraverse(obj) {
        // Apply the naive preparer if they specified one.
        if (naivePrepareObject) {
          naivePrepareObject(obj);
        }

        // Now freeze the object to ensure reactive
        // objects such as proxies won't add properties
        // during traversal, before they get frozen.

        // Object are verified before being enqueued,
        // therefore this is a valid candidate.
        // Throws if this fails (strict mode).
        freeze(obj);

        // we rely upon certain commitments of Object.freeze and proxies here

        // get stable/immutable outbound links before a Proxy has a chance to do
        // something sneaky.
        const proto = getPrototypeOf(obj);
        const descs = getOwnPropertyDescriptors(obj);
        const path = paths.get(obj) || 'unknown';

        // console.log(`adding ${proto} to prototypes under ${path}`);
        if (proto !== null && !prototypes.has(proto)) {
          prototypes.set(proto, path);
          paths.set(proto, `${path}.__proto__`);
        }

        ownKeys(descs).forEach(name => {
          const pathname = `${path}.${String(name)}`;
          // todo uncurried form
          // todo: getOwnPropertyDescriptors is guaranteed to return well-formed
          // descriptors, but they still inherit from Object.prototype. If
          // someone has poisoned Object.prototype to add 'value' or 'get'
          // properties, then a simple 'if ("value" in desc)' or 'desc.value'
          // test could be confused. We use hasOwnProperty to be sure about
          // whether 'value' is present or not, which tells us for sure that this
          // is a data property.
          const desc = descs[name];
          if ('value' in desc) {
            // todo uncurried form
            enqueue(desc.value, `${pathname}`);
          } else {
            enqueue(desc.get, `${pathname}(get)`);
            enqueue(desc.set, `${pathname}(set)`);
          }
        });
      }

      function dequeue() {
        // New values added before forEach() has finished will be visited.
        toFreeze.forEach(freezeAndTraverse); // todo curried forEach
      }

      function checkPrototypes() {
        prototypes.forEach((path, p) => {
          if (!(toFreeze.has(p) || fringeSet.has(p))) {
            // all reachable properties have already been frozen by this point
            let msg;
            try {
              msg = `prototype ${p} of ${path} is not already in the fringeSet`;
            } catch (e) {
              // `${(async _=>_).__proto__}` fails in most engines
              msg =
                'a prototype of something is not already in the fringeset (and .toString failed)';
              try {
                console.log(msg);
                console.log('the prototype:', p);
                console.log('of something:', path);
              } catch (_e) {
                // console.log might be missing in restrictive SES realms
              }
            }
            throw new TypeError(msg);
          }
        });
      }

      function commit() {
        // todo curried forEach
        // we capture the real WeakSet.prototype.add above, in case someone
        // changes it. The two-argument form of forEach passes the second
        // argument as the 'this' binding, so we add to the correct set.
        toFreeze.forEach(fringeSet.add, fringeSet);
      }

      enqueue(root);
      dequeue();
      // console.log("fringeSet", fringeSet);
      // console.log("prototype set:", prototypes);
      // console.log("toFreeze set:", toFreeze);
      checkPrototypes();
      commit();

      return root;
    },
  };

  return harden;
}

function assert(condition, errorMessage) {
  if (!condition) {
    throw new TypeError(errorMessage);
  }
}

const { getPrototypeOf } = Object;

/**
 * checkAnonIntrinsics()
 * Ensure that the rootAnonIntrinsics are consistent with specs. These
 * tests are necesary to ensure that sampling was correctly done.
 */

function checkAnonIntrinsics(intrinsics) {
  const {
    FunctionPrototypeConstructor,
    ArrayIteratorPrototype,
    AsyncFunction,
    AsyncGenerator,
    AsyncGeneratorFunction,
    AsyncGeneratorPrototype,
    AsyncIteratorPrototype,
    Generator,
    GeneratorFunction,
    IteratorPrototype,
    MapIteratorPrototype,
    RegExpStringIteratorPrototype,
    SetIteratorPrototype,
    StringIteratorPrototype,
    ThrowTypeError,
    TypedArray,
  } = intrinsics;

  // 9.2.4.1 %ThrowTypeError%

  assert(
    getPrototypeOf(ThrowTypeError) === Function.prototype,
    'ThrowTypeError.__proto__ should be Function.prototype',
  );

  // 21.1.5.2 The %StringIteratorPrototype% Object

  assert(
    getPrototypeOf(StringIteratorPrototype) === IteratorPrototype,
    'StringIteratorPrototype.__proto__ should be IteratorPrototype',
  );

  // 21.2.7.1 The %RegExpStringIteratorPrototype% Object

  assert(
    getPrototypeOf(RegExpStringIteratorPrototype) === IteratorPrototype,
    'RegExpStringIteratorPrototype.__proto__ should be IteratorPrototype',
  );

  // 22.2.1 The %TypedArray% Intrinsic Object

  // http://bespin.cz/~ondras/html/classv8_1_1ArrayBufferView.html
  // has me worried that someone might make such an intermediate
  // object visible.
  assert(
    getPrototypeOf(TypedArray) === Function.prototype,

    'TypedArray.__proto__ should be Function.prototype',
  );

  // 23.1.5.2 The %MapIteratorPrototype% Object

  assert(
    getPrototypeOf(MapIteratorPrototype) === IteratorPrototype,
    'MapIteratorPrototype.__proto__ should be IteratorPrototype',
  );

  // 23.2.5.2 The %SetIteratorPrototype% Object

  assert(
    getPrototypeOf(SetIteratorPrototype) === IteratorPrototype,
    'SetIteratorPrototype.__proto__ should be IteratorPrototype',
  );

  // 25.1.2 The %IteratorPrototype% Object

  assert(
    getPrototypeOf(IteratorPrototype) === Object.prototype,
    'IteratorPrototype.__proto__ should be Object.prototype',
  );

  // 25.1.3 The %AsyncIteratorPrototype% Object

  assert(
    getPrototypeOf(AsyncIteratorPrototype) === Object.prototype,
    'AsyncIteratorPrototype.__proto__ should be Object.prototype',
  );

  // 22.1.5.2 The %ArrayIteratorPrototype% Object

  assert(
    getPrototypeOf(ArrayIteratorPrototype) === IteratorPrototype,
    'AsyncIteratorPrototype.__proto__ should be IteratorPrototype',
  );

  // 25.2.2 Properties of the GeneratorFunction Constructor

  // Use Function.prototype.constructor in case Function has been tamed
  assert(
    getPrototypeOf(GeneratorFunction) === FunctionPrototypeConstructor,
    'GeneratorFunction.__proto__ should be Function',
  );

  assert(
    GeneratorFunction.name === 'GeneratorFunction',
    'GeneratorFunction.name should be "GeneratorFunction"',
  );

  // 25.2.3 Properties of the GeneratorFunction Prototype Object

  assert(
    getPrototypeOf(Generator) === Function.prototype,
    'Generator.__proto__ should be Function.prototype',
  );

  // 25.3.1 The AsyncGeneratorFunction Constructor

  // Use Function.prototype.constructor in case Function has been tamed
  assert(
    getPrototypeOf(AsyncGeneratorFunction) === FunctionPrototypeConstructor,
    'AsyncGeneratorFunction.__proto__ should be Function',
  );
  assert(
    AsyncGeneratorFunction.name === 'AsyncGeneratorFunction',
    'AsyncGeneratorFunction.name should be "AsyncGeneratorFunction"',
  );

  // 25.3.3 Properties of the AsyncGeneratorFunction Prototype Object

  assert(
    getPrototypeOf(AsyncGenerator) === Function.prototype,
    'AsyncGenerator.__proto__ should be Function.prototype',
  );

  // 25.5.1 Properties of the AsyncGenerator Prototype Object

  assert(
    getPrototypeOf(AsyncGeneratorPrototype) === AsyncIteratorPrototype,
    'AsyncGeneratorPrototype.__proto__ should be AsyncIteratorPrototype',
  );

  // 25.7.1 The AsyncFunction Constructor

  // Use Function.prototype.constructor in case Function has been tamed
  assert(
    getPrototypeOf(AsyncFunction) === FunctionPrototypeConstructor,
    'AsyncFunction.__proto__ should be Function',
  );
  assert(
    AsyncFunction.name === 'AsyncFunction',
    'AsyncFunction.name should be "AsyncFunction"',
  );
}

const { getOwnPropertyDescriptor, getPrototypeOf: getPrototypeOf$1 } = Object;

/**
 * Object.getConstructorOf()
 * Helper function to improve readability, similar to Object.getPrototypeOf().
 */
function getConstructorOf(obj) {
  return getPrototypeOf$1(obj).constructor;
}

/**
 * getAnonymousIntrinsics()
 * Get the intrinsics not otherwise reachable by named own property
 * traversal from the global object.
 */
function getAnonymousIntrinsics() {
  const FunctionPrototypeConstructor = Function.prototype.constructor;

  const SymbolIterator = (typeof Symbol && Symbol.iterator) || '@@iterator';
  const SymbolMatchAll = (typeof Symbol && Symbol.matchAll) || '@@matchAll';

  // 9.2.4.1 %ThrowTypeError%

  // eslint-disable-next-line prefer-rest-params
  const ThrowTypeError = getOwnPropertyDescriptor(arguments, 'callee').get;

  // 21.1.5.2 The %StringIteratorPrototype% Object

  // eslint-disable-next-line no-new-wrappers
  const StringIteratorObject = new String()[SymbolIterator]();
  const StringIteratorPrototype = getPrototypeOf$1(StringIteratorObject);

  // 21.2.7.1 The %RegExpStringIteratorPrototype% Object

  const RegExpStringIterator = new RegExp()[SymbolMatchAll]();
  const RegExpStringIteratorPrototype = getPrototypeOf$1(RegExpStringIterator);

  // 22.1.5.2 The %ArrayIteratorPrototype% Object

  // eslint-disable-next-line no-array-constructor
  const ArrayIteratorObject = new Array()[SymbolIterator]();
  const ArrayIteratorPrototype = getPrototypeOf$1(ArrayIteratorObject);

  // 22.2.1 The %TypedArray% Intrinsic Object

  const TypedArray = getPrototypeOf$1(Float32Array);

  // 23.1.5.2 The %MapIteratorPrototype% Object

  const MapIteratorObject = new Map()[SymbolIterator]();
  const MapIteratorPrototype = getPrototypeOf$1(MapIteratorObject);

  // 23.2.5.2 The %SetIteratorPrototype% Object

  const SetIteratorObject = new Set()[SymbolIterator]();
  const SetIteratorPrototype = getPrototypeOf$1(SetIteratorObject);

  // 25.1.2 The %IteratorPrototype% Object

  const IteratorPrototype = getPrototypeOf$1(ArrayIteratorPrototype);

  // 25.2.1 The GeneratorFunction Constructor

  function* GeneratorFunctionInstance() {} // eslint-disable-line no-empty-function
  const GeneratorFunction = getConstructorOf(GeneratorFunctionInstance);

  // 25.2.3 Properties of the GeneratorFunction Prototype Object

  const Generator = GeneratorFunction.prototype;

  // 25.3.1 The AsyncGeneratorFunction Constructor

  async function* AsyncGeneratorFunctionInstance() {} // eslint-disable-line no-empty-function
  const AsyncGeneratorFunction = getConstructorOf(
    AsyncGeneratorFunctionInstance,
  );

  // 25.3.2.2 AsyncGeneratorFunction.prototype
  const AsyncGenerator = AsyncGeneratorFunction.prototype;
  // 25.5.1 Properties of the AsyncGenerator Prototype Object
  const AsyncGeneratorPrototype = AsyncGenerator.prototype;
  const AsyncIteratorPrototype = getPrototypeOf$1(AsyncGeneratorPrototype);

  // 25.7.1 The AsyncFunction Constructor

  async function AsyncFunctionInstance() {} // eslint-disable-line no-empty-function
  const AsyncFunction = getConstructorOf(AsyncFunctionInstance);

  // VALIDATION

  const intrinsics = {
    FunctionPrototypeConstructor,
    ArrayIteratorPrototype,
    AsyncFunction,
    AsyncGenerator,
    AsyncGeneratorFunction,
    AsyncGeneratorPrototype,
    AsyncIteratorPrototype,
    Generator,
    GeneratorFunction,
    IteratorPrototype,
    MapIteratorPrototype,
    RegExpStringIteratorPrototype,
    SetIteratorPrototype,
    StringIteratorPrototype,
    ThrowTypeError,
    TypedArray,
  };

  return intrinsics;
}

/**
 * intrinsicNames
 * The following list contains all intrisics names as defined in the specs, except
 * that the leading an trailing '%' characters have been removed. We want to design
 * from the specs so we can better track changes to the specs.
 */
const intrinsicNames = [
  // 6.1.7.4 Well-Known Intrinsic Objects
  // Table 8: Well-Known Intrinsic Objects
  'Array',
  'ArrayBuffer',
  'ArrayBufferPrototype',
  'ArrayIteratorPrototype',
  'ArrayPrototype',
  // TODO ArrayProto_*
  // 'ArrayProto_entries',
  // 'ArrayProto_forEach',
  // 'ArrayProto_keys',
  // 'ArrayProto_values',
  // 25.1.4.2 The %AsyncFromSyncIteratorPrototype% Object
  // TODO Beleived to not be directly accessible to ECMAScript code.
  // 'AsyncFromSyncIteratorPrototype',
  'AsyncFunction',
  'AsyncFunctionPrototype',
  'AsyncGenerator',
  'AsyncGeneratorFunction',
  'AsyncGeneratorPrototype',
  'AsyncIteratorPrototype',
  'Atomics',
  'BigInt',
  // TOTO: Missing in the specs.
  'BigIntPrototype',
  'BigInt64Array',
  // TOTO: Missing in the specs.
  'BigInt64ArrayPrototype',
  'BigUint64Array',
  // TOTO: Missing in the specs.
  'BigUint64ArrayPrototype',
  'Boolean',
  'BooleanPrototype',
  'DataView',
  'DataViewPrototype',
  'Date',
  'DatePrototype',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'Error',
  'ErrorPrototype',
  'eval',
  'EvalError',
  'EvalErrorPrototype',
  'Float32Array',
  'Float32ArrayPrototype',
  'Float64Array',
  'Float64ArrayPrototype',
  // 13.7.5.16.2 The %ForInIteratorPrototype% Object
  // Documneted as "never directly accessible to ECMAScript code."
  // 'ForInIteratorPrototype',
  'Function',
  'FunctionPrototype',
  'Generator',
  'GeneratorFunction',
  'GeneratorPrototype',
  'Int8Array',
  'Int8ArrayPrototype',
  'Int16Array',
  'Int16ArrayPrototype',
  'Int32Array',
  'Int32ArrayPrototype',
  'isFinite',
  'isNaN',
  'IteratorPrototype',
  'JSON',
  // TODO
  // 'JSONParse',
  // 'JSONStringify',
  'Map',
  'MapIteratorPrototype',
  'MapPrototype',
  'Math',
  'Number',
  'NumberPrototype',
  'Object',
  'ObjectPrototype',
  // TODO
  // 'ObjProto_toString',
  // 'ObjProto_valueOf',
  'parseFloat',
  'parseInt',
  'Promise',
  'PromisePrototype',
  // TODO
  // 'PromiseProto_then',
  // 'Promise_all',
  // 'Promise_reject',
  // 'Promise_resolve',
  'Proxy',
  'RangeError',
  'RangeErrorPrototype',
  'ReferenceError',
  'ReferenceErrorPrototype',
  'Reflect',
  'RegExp',
  'RegExpPrototype',
  'RegExpStringIteratorPrototype',
  'Set',
  'SetIteratorPrototype',
  'SetPrototype',
  'SharedArrayBuffer',
  'SharedArrayBufferPrototype',
  'String',
  'StringIteratorPrototype',
  'StringPrototype',
  'Symbol',
  'SymbolPrototype',
  'SyntaxError',
  'SyntaxErrorPrototype',
  'ThrowTypeError',
  'TypedArray',
  'TypedArrayPrototype',
  'TypeError',
  'TypeErrorPrototype',
  'Uint8Array',
  'Uint8ArrayPrototype',
  'Uint8ClampedArray',
  'Uint8ClampedArrayPrototype',
  'Uint16Array',
  'Uint16ArrayPrototype',
  'Uint32Array',
  'Uint32ArrayPrototype',
  'URIError',
  'URIErrorPrototype',
  'WeakMap',
  'WeakMapPrototype',
  'WeakSet',
  'WeakSetPrototype',

  // B.2.1 Additional Properties of the Global Object
  // Table 87: Additional Well-known Intrinsic Objects
  'escape',
  'unescape',

  // ESNext
  'FunctionPrototypeConstructor',
  'Compartment',
  'CompartmentPrototype',
  'harden',
];

const { getOwnPropertyDescriptor: getOwnPropertyDescriptor$1 } = Object;

/**
 * getNamedIntrinsic()
 * Get the intrinsic from the global object.
 */
function getNamedIntrinsic(root, name) {
  // Assumption: the intrinsic name matches a global object with the same name.
  const desc = getOwnPropertyDescriptor$1(root, name);

  // Abort if an accessor is found on the object instead of a data property.
  // We should never get into this non standard situation.
  assert(
    !('get' in desc || 'set' in desc),
    `unexpected accessor on global property: ${name}`,
  );

  return desc.value;
}

/**
 * checkIntrinsics()
 * Ensure that the intrinsics are consistent with defined.
 */
function checkIntrinsics(intrinsics) {
  Object.keys(intrinsics).forEach(name => {
    if (intrinsics[name] === undefined) {
      throw new TypeError(`Malformed intrinsic: ${name}`);
    }
  });
}

// The intrinsics are the defiend in the global specifications.

const { apply } = Reflect;
const uncurryThis = fn => (thisArg, ...args) => apply(fn, thisArg, args);
const hasOwnProperty$1 = uncurryThis(Object.prototype.hasOwnProperty);

const suffix = 'Prototype';

/**
 * getIntrinsics()
 * Return a record-like object similar to the [[intrinsics]] slot of the realmRec
 * excepts for the following simpifications:
 * - we omit the intrinsics not reachable by JavaScript code.
 * - we omit intrinsics that are direct properties of the global object (except for the
 *   "prototype" property), and properties that are direct properties of the prototypes
 *   (except for "constructor").
 * - we use the name of the associated global object property instead of the intrinsic
 *   name (usually, <intrinsic name> === '%' + <global property name>+ '%').
 */
function getIntrinsics() {
  const intrinsics = { __proto__: null };

  const anonIntrinsics = getAnonymousIntrinsics();
  checkAnonIntrinsics(anonIntrinsics);

  for (const name of intrinsicNames) {
    if (hasOwnProperty$1(anonIntrinsics, name)) {
      intrinsics[name] = anonIntrinsics[name];
      // eslint-disable-next-line no-continue
      continue;
    }

    if (hasOwnProperty$1(globalThis, name)) {
      intrinsics[name] = getNamedIntrinsic(globalThis, name);
      // eslint-disable-next-line no-continue
      continue;
    }

    const hasSuffix = name.endsWith(suffix);
    if (hasSuffix) {
      const prefix = name.slice(0, -suffix.length);

      if (hasOwnProperty$1(anonIntrinsics, prefix)) {
        const intrinsic = anonIntrinsics[prefix];
        intrinsics[name] = intrinsic.prototype;
        // eslint-disable-next-line no-continue
        continue;
      }

      if (hasOwnProperty$1(globalThis, prefix)) {
        const intrinsic = getNamedIntrinsic(globalThis, prefix);
        intrinsics[name] = intrinsic.prototype;
        // eslint-disable-next-line no-continue
        continue;
      }
    }
  }

  checkIntrinsics(intrinsics);

  return intrinsics;
}

/**
 * @fileoverview Exports {@code whitelist}, a recursively defined
 * JSON record enumerating all intrinsics and their properties
 * according to ECMA specs.
 *
 * @author JF Paradis
 */

/**
 * <p>Each JSON record enumerates the disposition of the properties on
 *    some corresponding intrinsic object.
 *
 * <p>All records are made of key-value pairs where the key
 *    is the property to process, and the value is the associated
 *    dispositions a.k.a. the "permit". Those permits can be:
 * <ul>
 * <li>The boolean value "false", in which case this property is
 *     blacklisted and simply removed. Properties not mentioned
 *     are also considered blacklisted and are removed.
 * <li>A string value equal to a primitive ("number", "string", etc),
 *     in which case the property whitelisted if its value property
 *     is of the given type. For example, {@code "Infinity"} leads to
 *     "number" and property values that fail {@code typeof "number"}.
 *     are removed.
 * <li>A string value equal to a primitive ("number", "string", etc),
 *     in which case the property whitelisted if its value property
 *     is of the given type. For example, {@code "Infinity"} leads to
 *     "number" and the property is remove if its property value
 *     fails {@code typeof "number"}.
 * <li>A string value equal to an intinsic name ("ObjectPrototype",
 *     "Array", etc), in which case the property whitelisted if its
 *     value property is equal to the value of the corresponfing
 *     intrinsics. For example, {@code Map.prototype} leads to
 *     "MapPrototype" and the property is removed if its value is
 *     not equal to %MapPrototype%
 * <li>Another record, in which case this property is simply
 *     whitelisted and that next record represents the disposition of
 *     the object which is its value. For example, {@code "Object"}
 *     leads to another record explaining what properties {@code
 *     "Object"} may have and how each such property.
 *
 * <p>Notes:
 * <li>"**proto**" is used to refer to "__proto__" without creating
 *     an actual prototype.
 * <li>"ObjectPrototype" is the default "**proto**" (when not specified).
 * <li>Constants "fn" and "getter" are used to keep the structure DRY.
 * <li>Symbol properties are listed using the @@name form.
 */

// 19.2.4 Function Instances
const FunctionInstance = {
  // Mentioned in "19.2.4.3 prototype"
  '**proto**': 'FunctionPrototype',
  // 19.2.4.1 length
  length: 'number',
  // 19.2.4.2 name
  name: 'string',
  // 19.2.4.3 prototype
  // Do not specify "prototype" here, since only Function instances that can
  // be used as a constructor have a prototype property. For constructors,
  // since prototpye properties are instance-specific, we define it there.
};

// Aliases
const fn = FunctionInstance;

const getter = {
  get: fn,
  set: 'undefined',
};

// Possible but not encpintered in the specs
// const setter = {
//   get: 'undefined',
//   set: fn,
// };

// 19.5.6 NativeError Object Structure
function NativeError(prototype) {
  return {
    // 19.5.6.2 Properties of the NativeError Constructors
    '**proto**': 'Error',

    // 19.5.6.2.1 NativeError.prototype
    prototype,

    // Add function instance properties to avoid mixin.
    // 19.2.4.1 length
    length: 'number',
    // 19.2.4.2 name
    name: 'string',
  };
}

function NativeErrorPrototype(constructor) {
  return {
    // 19.5.6.3 Properties of the NativeError Prototype Objects
    '**proto**': 'ErrorPrototype',
    // 19.5.6.3.1 NativeError.prototype.constructor
    constructor,
    // 19.5.6.3.2 NativeError.prototype.message
    message: 'string',
    // 19.5.6.3.3 NativeError.prototype.name
    name: 'string',
    // TODO: not mentioned.
    toString: fn,
  };
}

// 22.2.4 The TypedArray Constructors
function TypedArray(prototype) {
  return {
    // 22.2.5 Properties of the TypedArray Constructors
    '**proto**': 'TypedArray',

    // Add function instance properties
    // 19.2.4.1 length
    length: 'number',
    // 19.2.4.2 name
    name: 'string',

    // 22.2.5.1 TypedArray.BYTES_PER_ELEMENT
    BYTES_PER_ELEMENT: 'number',
    // 22.2.5.2 TypedArray.prototype
    prototype,
  };
}

function TypedArrayPrototype(constructor) {
  return {
    // 22.2.6 Properties of the TypedArray Prototype Objects
    '**proto**': 'TypedArrayPrototype',
    // 22.2.6.1 TypedArray.prototype.BYTES_PER_ELEMENT
    BYTES_PER_ELEMENT: 'number',
    // 22.2.6.2TypedArray.prototype.constructor
    constructor,
  };
}

var whitelist = {
  // ECMA https://tc39.es/ecma262

  // The intrinsics object has not prototype to avoid conflicts.
  '**proto**': null,

  // 9.2.4.1% ThrowTypeError%
  ThrowTypeError: fn,

  // *** 18 The Global Object

  // *** 18.1 Value Properties of the Global Object

  // 18.1.1 Infinity
  Infinity: 'number',
  // 18.1.2 NaN
  NaN: 'number',
  // 18.1.3 undefined
  undefined: 'undefined',

  // *** 18.2 Function Properties of the Global Object

  // 18.2.1 eval
  eval: fn,
  // 18.2.2 isFinite
  isFinite: fn,
  // 18.2.3 isNaN
  isNaN: fn,
  // 18.2.4 parseFloat
  parseFloat: fn,
  // 18.2.5 parseInt
  parseInt: fn,
  // 18.2.6.2 decodeURI
  decodeURI: fn,
  // 18.2.6.3 decodeURIComponent
  decodeURIComponent: fn,
  // 18.2.6.4 encodeURI
  encodeURI: fn,
  // 18.2.6.5 encodeURIComponent
  encodeURIComponent: fn,

  // *** 19 Fundamental Objects

  Object: {
    // 19.1.2 Properties of the Object Constructor
    '**proto**': 'FunctionPrototype',
    // 19.1.2.1 Object.assign
    assign: fn,
    // 19.1.2.2 Object.create
    create: fn,
    // 19.1.2.3 Object.definePropertie
    defineProperties: fn,
    // 19.1.2.4 Object.defineProperty
    defineProperty: fn,
    // 19.1.2.5 Object.entries
    entries: fn,
    // 19.1.2.6 Object.freeze
    freeze: fn,
    // 19.1.2.7 Object.fromEntries
    fromEntries: fn,
    // 19.1.2.8 Object.getOwnPropertyDescriptor
    getOwnPropertyDescriptor: fn,
    // 19.1.2.9 Object.getOwnPropertyDescriptors
    getOwnPropertyDescriptors: fn,
    // 19.1.2.10 Object.getOwnPropertyNames
    getOwnPropertyNames: fn,
    // 19.1.2.11 Object.getOwnPropertySymbols
    getOwnPropertySymbols: fn,
    // 19.1.2.12 Object.getPrototypeOf
    getPrototypeOf: fn,
    // 19.1.2.13 Object.is
    is: fn,
    // 19.1.2.14 Object.isExtensible
    isExtensible: fn,
    // 19.1.2.15 Object.isFrozen
    isFrozen: fn,
    // 19.1.2.16 Object.isSealed
    isSealed: fn,
    // 19.1.2.17 Object.keys
    keys: fn,
    // 19.1.2.18 Object.preventExtensions
    preventExtensions: fn,
    // 19.1.2.19 Object.prototype
    prototype: 'ObjectPrototype',
    // 19.1.2.20 Object.seal
    seal: fn,
    // 19.1.2.21 Object.setPrototypeOf
    setPrototypeOf: fn,
    // 19.1.2.22 Object.values
    values: fn,
  },

  ObjectPrototype: {
    // 19.1.3 Properties of the Object Prototype Object
    '**proto**': null,
    // 19.1.3.1 Object.prototype.constructor
    constructor: 'Object',
    // 19.1.3.2 Object.prototype.hasOwnProperty
    hasOwnProperty: fn,
    // 19.1.3.3 Object.prototype.isPrototypeOf
    isPrototypeOf: fn,
    // 19.1.3.4 Object.prototype.propertyIsEnumerable
    propertyIsEnumerable: fn,
    // 19.1.3.5 Object.prototype.toLocaleString
    toLocaleString: fn,
    // 19.1.3.6 Object.prototype.toString
    toString: fn,
    // 19.1.3.7 Object.prototype.valueOf
    valueOf: fn,

    // B.2.2 Additional Properties of the Object.prototype Object

    // B.2.2.1 Object.prototype.__proto__
    // '**proto**': accessors,
    // B.2.2.2 Object.prototype.__defineGetter__
    __defineGetter__: fn,
    // B.2.2.3 Object.prototype.__defineSetter__
    __defineSetter__: fn,
    // B.2.2.4 Object.prototype.__lookupGetter__
    __lookupGetter__: fn,
    // B.2.2.5 Object.prototype.__lookupSetter__
    __lookupSetter__: fn,
  },

  Function: {
    // 19.2.2 Properties of the Function Constructor
    '**proto**': 'FunctionPrototype',
    // 19.2.2.1 Function.length
    length: 'number',
    // 19.2.2.2 Function.prototype
    prototype: 'FunctionPrototype',
  },

  FunctionPrototype: {
    // 19.2.3 Properties of the Function Prototype Object
    length: 'number',
    name: 'string',
    // 19.2.3.1 Function.prototype.apply
    apply: fn,
    // 19.2.3.2 Function.prototype.bind
    bind: fn,
    // 19.2.3.3 Function.prototype.call
    call: fn,
    // 19.2.3.4 Function.prototype.constructor
    constructor: 'FunctionPrototypeConstructor', // TODO test
    // 19.2.3.5 Function.prototype.toString
    toString: fn,
    // 19.2.3.6 Function.prototype [ @@hasInstance ]
    '@@hasInstance': fn,
  },

  Boolean: {
    // 19.3.2 Properties of the Boolean Constructor
    '**proto**': 'FunctionPrototype',
    // 19.3.2.1 Boolean.prototype
    prototype: 'BooleanPrototype',
  },

  BooleanPrototype: {
    // 19.3.3.1 Boolean.prototype.constructor
    constructor: 'Boolean',
    // 19.3.3.2 Boolean.prototype.toString
    toString: fn,
    // 19.3.3.3 Boolean.prototype.valueOf
    valueOf: fn,
  },

  Symbol: {
    // 19.4.2 Properties of the Symbol Constructor
    '**proto**': 'FunctionPrototype',
    // 19.4.2.1 Symbol.asyncIterator
    asyncIterator: 'symbol',
    // 19.4.2.2 Symbol.for
    for: fn,
    // 19.4.2.3 Symbol.hasInstance
    hasInstance: 'symbol',
    // 19.4.2.4 Symbol.isConcatSpreadable
    isConcatSpreadable: 'symbol',
    // 19.4.2.5 Symbol.iterator
    iterator: 'symbol',
    // 19.4.2.6 Symbol.keyFor
    keyFor: fn,
    // 19.4.2.7 Symbol.match
    match: 'symbol',
    // 19.4.2.8 Symbol.matchAll
    matchAll: 'symbol',
    // 19.4.2.9 Symbol.prototype
    prototype: 'SymbolPrototype',
    // 19.4.2.10 Symbol.replace
    replace: 'symbol',
    // 19.4.2.11 Symbol.search
    search: 'symbol',
    // 19.4.2.12 Symbol.species
    species: 'symbol',
    // 19.4.2.13 Symbol.split
    split: 'symbol',
    // 19.4.2.14 Symbol.toPrimitive
    toPrimitive: 'symbol',
    // 19.4.2.15 Symbol.toStringTag
    toStringTag: 'symbol',
    // 19.4.2.16 Symbol.unscopables
    unscopables: 'symbol',
  },

  SymbolPrototype: {
    // 19.4.3 Properties of the Symbol Prototype Object

    // 19.4.3.1 Symbol.prototype.constructor
    constructor: 'Symbol',
    // 19.4.3.2 get Symbol.prototype.description
    description: getter,
    // 19.4.3.3 Symbol.prototype.toString
    toString: fn,
    // 19.4.3.4 Symbol.prototype.valueOf
    valueOf: fn,
    // 19.4.3.5 Symbol.prototype [ @@toPrimitive ]
    '@@toPrimitive': fn,
    // 19.4.3.6 Symbol.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  Error: {
    // 19.5.2 Properties of the Error Constructor
    '**proto**': 'FunctionPrototype',
    // 19.5.2.1 Error.prototype
    prototype: 'ErrorPrototype',
    // Non standard
    captureStackTrace: fn,
    // Non standard
    stackTraceLimit: 'number',
  },

  ErrorPrototype: {
    // 19.5.3.1 Error.prototype.constructor
    constructor: 'Error',
    // 19.5.3.2 Error.prototype.message
    message: 'string',
    // 19.5.3.3 Error.prototype.name
    name: 'string',
    // 19.5.3.4 Error.prototype.toString
    toString: fn,
  },

  // 19.5.6.1.1 NativeError

  EvalError: NativeError('EvalErrorPrototype'),
  RangeError: NativeError('RangeErrorPrototype'),
  ReferenceError: NativeError('ReferenceErrorPrototype'),
  SyntaxError: NativeError('SyntaxErrorPrototype'),
  TypeError: NativeError('TypeErrorPrototype'),
  URIError: NativeError('URIErrorPrototype'),

  EvalErrorPrototype: NativeErrorPrototype('EvalError'),
  RangeErrorPrototype: NativeErrorPrototype('RangeError'),
  ReferenceErrorPrototype: NativeErrorPrototype('ReferenceError'),
  SyntaxErrorPrototype: NativeErrorPrototype('SyntaxError'),
  TypeErrorPrototype: NativeErrorPrototype('TypeError'),
  URIErrorPrototype: NativeErrorPrototype('URIError'),

  // *** 20 Numbers and Dates

  Number: {
    // 20.1.2 Properties of the Number Constructor
    '**proto**': 'FunctionPrototype',
    // 20.1.2.1 Number.EPSILON
    EPSILON: 'number',
    // 20.1.2.2 Number.isFinite
    isFinite: fn,
    // 20.1.2.3 Number.isInteger
    isInteger: fn,
    // 20.1.2.4 Number.isNaN
    isNaN: fn,
    // 20.1.2.5 Number.isSafeInteger
    isSafeInteger: fn,
    // 20.1.2.6 Number.MAX_SAFE_INTEGER
    MAX_SAFE_INTEGER: 'number',
    // 20.1.2.7 Number.MAX_VALUE
    MAX_VALUE: 'number',
    // 20.1.2.8 Number.MIN_SAFE_INTEGER
    MIN_SAFE_INTEGER: 'number',
    // 20.1.2.9 Number.MIN_VALUE
    MIN_VALUE: 'number',
    // 20.1.2.10 Number.NaN
    NaN: 'number',
    // 20.1.2.11 Number.NEGATIVE_INFINITY
    NEGATIVE_INFINITY: 'number',
    // 20.1.2.12 Number.parseFloat
    parseFloat: fn,
    // 20.1.2.13 Number.parseInt
    parseInt: fn,
    // 20.1.2.14 Number.POSITIVE_INFINITY
    POSITIVE_INFINITY: 'number',
    // 20.1.2.15 Number.prototype
    prototype: 'NumberPrototype',
  },

  NumberPrototype: {
    // 20.1.3 Properties of the Number Prototype Object

    // 20.1.3.1 Number.prototype.constructor
    constructor: 'Number',
    // 20.1.3.2 Number.prototype.toExponential
    toExponential: fn,
    // 20.1.3.3 Number.prototype.toFixed
    toFixed: fn,
    // 20.1.3.4 Number.prototype.toLocaleString
    toLocaleString: fn,
    // 20.1.3.5 Number.prototype.toPrecision
    toPrecision: fn,
    // 20.1.3.6 Number.prototype.toString
    toString: fn,
    // 20.1.3.7 Number.prototype.valueOf
    valueOf: fn,
  },

  BigInt: {
    // 20.2.2Properties of the BigInt Constructor
    '**proto**': 'FunctionPrototype',
    // 20.2.2.1 BigInt.asIntN
    asIntN: fn,
    // 20.2.2.2 BigInt.asUintN
    asUintN: fn,
    // 20.2.2.3 BigInt.prototype
    prototype: 'BigIntPrototype',
  },

  BigIntPrototype: {
    // 20.2.3.1 BigInt.prototype.constructor
    constructor: 'BigInt',
    // 20.2.3.2 BigInt.prototype.toLocaleString
    toLocaleString: fn,
    // 20.2.3.3 BigInt.prototype.toString
    toString: fn,
    // 20.2.3.4 BigInt.prototype.valueOf
    valueOf: fn,
    // 20.2.3.5 BigInt.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  Math: {
    // 20.3.1.1 Math.E
    E: 'number',
    // 20.3.1.2 Math.LN10
    LN10: 'number',
    // 20.3.1.3 Math.LN2
    LN2: 'number',
    // 20.3.1.4 Math.LOG10E
    LOG10E: 'number',
    // 20.3.1.5 Math.LOG2E
    LOG2E: 'number',
    // 20.3.1.6 Math.PI
    PI: 'number',
    // 20.3.1.7 Math.SQRT1_2
    SQRT1_2: 'number',
    // 20.3.1.8 Math.SQRT2
    SQRT2: 'number',
    // 20.3.1.9 Math [ @@toStringTag ]
    '@@toStringTag': 'string',
    // 20.3.2.1 Math.abs
    abs: fn,
    // 20.3.2.2 Math.acos
    acos: fn,
    // 20.3.2.3 Math.acosh
    acosh: fn,
    // 20.3.2.4 Math.asin
    asin: fn,
    // 20.3.2.5 Math.asinh
    asinh: fn,
    // 20.3.2.6 Math.atan
    atan: fn,
    // 20.3.2.7 Math.atanh
    atanh: fn,
    // 20.3.2.8 Math.atan2
    atan2: fn,
    // 20.3.2.9 Math.cbrt
    cbrt: fn,
    // 20.3.2.10 Math.ceil
    ceil: fn,
    // 20.3.2.11 Math.clz32
    clz32: fn,
    // 20.3.2.12 Math.cos
    cos: fn,
    // 20.3.2.13 Math.cosh
    cosh: fn,
    // 20.3.2.14 Math.exp
    exp: fn,
    // 20.3.2.15 Math.expm1
    expm1: fn,
    // 20.3.2.16 Math.floor
    floor: fn,
    // 20.3.2.17 Math.fround
    fround: fn,
    // 20.3.2.18 Math.hypot
    hypot: fn,
    // 20.3.2.19 Math.imul
    imul: fn,
    // 20.3.2.20 Math.log
    log: fn,
    // 20.3.2.21 Math.log1p
    log1p: fn,
    // 20.3.2.22 Math.log10
    log10: fn,
    // 20.3.2.23 Math.log2
    log2: fn,
    // 20.3.2.24 Math.max
    max: fn,
    // 20.3.2.25 Math.min
    min: fn,
    // 20.3.2.26Math.pow
    pow: fn,
    // 20.3.2.27Math.random
    random: fn,
    // 20.3.2.28 Math.round
    round: fn,
    // 20.3.2.29 Math.sign
    sign: fn,
    // 20.3.2.30 Math.sin
    sin: fn,
    // 20.3.2.31 Math.sinh
    sinh: fn,
    // 20.3.2.32 Math.sqrt
    sqrt: fn,
    // 20.3.2.33 Math.tan
    tan: fn,
    // 20.3.2.34 Math.tanh
    tanh: fn,
    // 20.3.2.35 Math.trunc
    trunc: fn,
    // 20.3.2.35Math.trunc
  },

  Date: {
    // 20.4.3 Properties of the Date Constructor
    '**proto**': 'FunctionPrototype',
    // 20.4.3.1 Date.now
    now: fn,
    // 20.4.3.2 Date.parse
    parse: fn,
    // 20.4.3.3 Date.prototype
    prototype: 'DatePrototype',
    // 20.4.3.4 Date.UTC
    UTC: fn,
  },

  DatePrototype: {
    // 20.4.4.1 Date.prototype.constructor
    constructor: 'Date',
    // 20.4.4.2 Date.prototype.getDate
    getDate: fn,
    // 20.4.4.3 Date.prototype.getDay
    getDay: fn,
    // 20.4.4.4 Date.prototype.getFullYear
    getFullYear: fn,
    // 20.4.4.5 Date.prototype.getHours
    getHours: fn,
    // 20.4.4.6 Date.prototype.getMilliseconds
    getMilliseconds: fn,
    // 20.4.4.7 Date.prototype.getMinutes
    getMinutes: fn,
    // 20.4.4.8 Date.prototype.getMonth
    getMonth: fn,
    // 20.4.4.9 Date.prototype.getSeconds
    getSeconds: fn,
    // 20.4.4.10 Date.prototype.getTime
    getTime: fn,
    // 20.4.4.11 Date.prototype.getTimezoneOffset
    getTimezoneOffset: fn,
    // 20.4.4.12 Date.prototype.getUTCDate
    getUTCDate: fn,
    // 20.4.4.13 Date.prototype.getUTCDay
    getUTCDay: fn,
    // 20.4.4.14 Date.prototype.getUTCFullYear
    getUTCFullYear: fn,
    // 20.4.4.15 Date.prototype.getUTCHours
    getUTCHours: fn,
    // 20.4.4.16 Date.prototype.getUTCMilliseconds
    getUTCMilliseconds: fn,
    // 20.4.4.17 Date.prototype.getUTCMinutes
    getUTCMinutes: fn,
    // 20.4.4.18 Date.prototype.getUTCMonth
    getUTCMonth: fn,
    // 20.4.4.19 Date.prototype.getUTCSeconds
    getUTCSeconds: fn,
    // 20.4.4.20 Date.prototype.setDate
    setDate: fn,
    // 20.4.4.21 Date.prototype.setFullYear
    setFullYear: fn,
    // 20.4.4.22 Date.prototype.setHours
    setHours: fn,
    // 20.4.4.23 Date.prototype.setMilliseconds
    setMilliseconds: fn,
    // 20.4.4.24 Date.prototype.setMinutes
    setMinutes: fn,
    // 20.4.4.25 Date.prototype.setMonth
    setMonth: fn,
    // 20.4.4.26 Date.prototype.setSeconds
    setSeconds: fn,
    // 20.4.4.27 Date.prototype.setTime
    setTime: fn,
    // 20.4.4.28 Date.prototype.setUTCDate
    setUTCDate: fn,
    // 20.4.4.29 Date.prototype.setUTCFullYear
    setUTCFullYear: fn,
    // 20.4.4.30 Date.prototype.setUTCHours
    setUTCHours: fn,
    // 20.4.4.31 Date.prototype.setUTCMilliseconds
    setUTCMilliseconds: fn,
    // 20.4.4.32 Date.prototype.setUTCMinutes
    setUTCMinutes: fn,
    // 20.4.4.33 Date.prototype.setUTCMonth
    setUTCMonth: fn,
    // 20.4.4.34 Date.prototype.setUTCSeconds
    setUTCSeconds: fn,
    // 20.4.4.35 Date.prototype.toDateString
    toDateString: fn,
    // 20.4.4.36 Date.prototype.toISOString
    toISOString: fn,
    // 20.4.4.37 Date.prototype.toJSON
    toJSON: fn,
    // 20.4.4.38 Date.prototype.toLocaleDateString
    toLocaleDateString: fn,
    // 20.4.4.39 Date.prototype.toLocaleString
    toLocaleString: fn,
    // 20.4.4.40 Date.prototype.toLocaleTimeString
    toLocaleTimeString: fn,
    // 20.4.4.41 Date.prototype.toString
    toString: fn,
    // 20.4.4.42 Date.prototype.toTimeString
    toTimeString: fn,
    // 20.4.4.43 Date.prototype.toUTCString
    toUTCString: fn,
    // 20.4.4.44 Date.prototype.valueOf
    valueOf: fn,
    // 20.4.4.45 Date.prototype [ @@toPrimitive ]
    '@@toPrimitive': fn,

    // B.2.4 Additional Properties of the Date.prototype Object

    // B.2.4.1 Date.prototype.getYear
    getYear: fn,
    // B.2.4.2 Date.prototype.setYear
    setYear: fn,
    // B.2.4.3 Date.prototype.toGMTString
    toGMTString: fn,
  },

  // 21 Text Processing

  String: {
    // 21.1.2 Properties of the String Constructor
    '**proto**': 'FunctionPrototype',
    // 21.1.2.1 String.fromCharCode
    fromCharCode: fn,
    // 21.1.2.2 String.fromCodePoint
    fromCodePoint: fn,
    // 21.1.2.3 String.prototype
    prototype: 'StringPrototype',
    // 21.1.2.4 String.raw
    raw: fn,
  },

  StringPrototype: {
    // 21.1.3 Properties of the String Prototype Object
    length: 'number',
    // 21.1.3.1 String.prototype.charAt
    charAt: fn,
    // 21.1.3.2 String.prototype.charCodeAt
    charCodeAt: fn,
    // 21.1.3.3 String.prototype.codePointAt
    codePointAt: fn,
    // 21.1.3.4 String.prototype.concat
    concat: fn,
    // 21.1.3.5 String.prototype.constructor
    constructor: 'String',
    // 21.1.3.6 String.prototype.endsWith
    endsWith: fn,
    // 21.1.3.7 String.prototype.includes
    includes: fn,
    // 21.1.3.8 String.prototype.indexOf
    indexOf: fn,
    // 21.1.3.9 String.prototype.lastIndexOf
    lastIndexOf: fn,
    // 21.1.3.10 String.prototype.localeCompare
    localeCompare: fn,
    // 21.1.3.11 String.prototype.match
    match: fn,
    // 21.1.3.12 String.prototype.matchAll
    matchAll: fn,
    // 21.1.3.13 String.prototype.normalize
    normalize: fn,
    // 21.1.3.14 String.prototype.padEnd
    padEnd: fn,
    // 21.1.3.15 String.prototype.padStart
    padStart: fn,
    // 21.1.3.16 String.prototype.repeat
    repeat: fn,
    // 21.1.3.17 String.prototype.replace
    replace: fn,
    // 21.1.3.18 String.prototype.search
    search: fn,
    // 21.1.3.19 String.prototype.slice
    slice: fn,
    // 21.1.3.20 String.prototype.split
    split: fn,
    // 21.1.3.21 String.prototype.startsWith
    startsWith: fn,
    // 21.1.3.22 String.prototype.substring
    substring: fn,
    // 21.1.3.23 String.prototype.toLocaleLowerCase
    toLocaleLowerCase: fn,
    // 21.1.3.24 String.prototype.toLocaleUpperCase
    toLocaleUpperCase: fn,
    // 21.1.3.25 String.prototype.toLowerCase
    toLowerCase: fn,
    // 21.1.3.26 String.prototype.
    toString: fn,
    // 21.1.3.27 String.prototype.toUpperCase
    toUpperCase: fn,
    // 21.1.3.28 String.prototype.trim
    trim: fn,
    // 21.1.3.29 String.prototype.trimEnd
    trimEnd: fn,
    // 21.1.3.30 String.prototype.trimStart
    trimStart: fn,
    // 21.1.3.31 String.prototype.valueOf
    valueOf: fn,
    // 21.1.3.32 String.prototype [ @@iterator ]
    '@@iterator': fn,

    // B.2.3 Additional Properties of the String.prototype Object

    // B.2.3.1 String.prototype.substr
    substr: fn,
    // B.2.3.2 String.prototype.anchor
    anchor: fn,
    // B.2.3.3 String.prototype.big
    big: fn,
    // B.2.3.4 String.prototype.blink
    blink: fn,
    // B.2.3.5 String.prototype.bold
    bold: fn,
    // B.2.3.6 String.prototype.fixed
    fixed: fn,
    // B.2.3.7 String.prototype.fontcolor
    fontcolor: fn,
    // B.2.3.8 String.prototype.fontsize
    fontsize: fn,
    // B.2.3.9 String.prototype.italics
    italics: fn,
    // B.2.3.10 String.prototype.link
    link: fn,
    // B.2.3.11 String.prototype.small
    small: fn,
    // B.2.3.12 String.prototype.strike
    strike: fn,
    // B.2.3.13 String.prototype.sub
    sub: fn,
    // B.2.3.14 String.prototype.sup
    sup: fn,
    // B.2.3.15 String.prototype.trimLeft
    trimLeft: fn,
    // B.2.3.15 String.prototype.trimRight
    trimRight: fn,
  },

  StringIteratorPrototype: {
    // 21.1.5.2 he %StringIteratorPrototype% Object
    '**proto**': 'IteratorPrototype',
    // 21.1.5.2.1 %StringIteratorPrototype%.next ( )
    next: fn,
    // 21.1.5.2.2 %StringIteratorPrototype% [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  RegExp: {
    // 21.2.4 Properties of the RegExp Constructor
    '**proto**': 'FunctionPrototype',
    // 21.2.4.1 RegExp.prototype
    prototype: 'RegExpPrototype',
    // 21.2.4.2 get RegExp [ @@species ]
    '@@species': getter,
  },

  RegExpPrototype: {
    // 21.2.5 Properties of the RegExp Prototype Object
    // 21.2.5.1 RegExp.prototype.constructor
    constructor: 'RegExp',
    // 21.2.5.2 RegExp.prototype.exec
    exec: fn,
    // 21.2.5.3 get RegExp.prototype.dotAll
    dotAll: getter,
    // 21.2.5.4 get RegExp.prototype.flags
    flags: getter,
    // 21.2.5.5 get RegExp.prototype.global
    global: getter,
    // 21.2.5.6 get RegExp.prototype.ignoreCase
    ignoreCase: getter,
    // 21.2.5.7 RegExp.prototype [ @@match ]
    '@@match': fn,
    // 21.2.5.8 RegExp.prototype [ @@matchAll ]
    '@@matchAll': fn,
    // 21.2.5.9 get RegExp.prototype.multiline
    multiline: getter,
    // 21.2.5.10 RegExp.prototype [ @@replace ]
    '@@replace': fn,
    // 21.2.5.11 RegExp.prototype [ @@search ]
    '@@search': fn,
    // 21.2.5.12 get RegExp.prototype.source
    source: getter,
    // 21.2.5.13 RegExp.prototype [ @@split ]
    '@@split': fn,
    // 21.2.5.14 get RegExp.prototype.sticky
    sticky: getter,
    // 21.2.5.15 RegExp.prototype.test
    test: fn,
    // 21.2.5.16 RegExp.prototype.toString
    toString: fn,
    // 21.2.5.17 get RegExp.prototype.unicode
    unicode: getter,

    // B.2.5 Additional Properties of the RegExp.prototype Object

    // B.2.5.1 RegExp.prototype.compile
    compile: false, // UNSAFE and suppressed.
  },

  RegExpStringIteratorPrototype: {
    // 21.2.7.1 The %RegExpStringIteratorPrototype% Object
    '**proto**': 'IteratorPrototype',
    // 21.2.7.1.1 %RegExpStringIteratorPrototype%.next
    next: fn,
    // 21.2.7.1.2 %RegExpStringIteratorPrototype% [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  // 22 Indexed Collections

  Array: {
    // 22.1.2 Properties of the Array Constructor
    '**proto**': 'FunctionPrototype',
    // 22.1.2.1 Array.from
    from: fn,
    // 22.1.2.2 Array.isArray
    isArray: fn,
    // 22.1.2.3 Array.of
    of: fn,
    // 22.1.2.4 Array.prototype
    prototype: 'ArrayPrototype',
    // 22.1.2.5 get Array [ @@species ]
    '@@species': getter,
  },

  ArrayPrototype: {
    // 22.1.3 Properties of the Array Prototype Object
    length: 'number',
    // 22.1.3.1 Array.prototype.concat
    concat: fn,
    // 22.1.3.2 Array.prototype.constructor
    constructor: 'Array',
    // 22.1.3.3 Array.prototype.copyWithin
    copyWithin: fn,
    // 22.1.3.4 Array.prototype.entries
    entries: fn,
    // 22.1.3.5 Array.prototype.every
    every: fn,
    // 22.1.3.6 Array.prototype.fill
    fill: fn,
    // 22.1.3.7 Array.prototype.filter
    filter: fn,
    // 22.1.3.8 Array.prototype.find
    find: fn,
    // 22.1.3.9 Array.prototype.findIndex
    findIndex: fn,
    // 22.1.3.10 Array.prototype.flat
    flat: fn,
    // 22.1.3.11 Array.prototype.flatMap
    flatMap: fn,
    // 22.1.3.12 Array.prototype.forEach
    forEach: fn,
    // 22.1.3.13 Array.prototype.includes
    includes: fn,
    // 22.1.3.14 Array.prototype.indexOf
    indexOf: fn,
    // 22.1.3.15 Array.prototype.join
    join: fn,
    // 22.1.3.16 Array.prototype.keys
    keys: fn,
    // 22.1.3.17 Array.prototype.lastIndexOf
    lastIndexOf: fn,
    // 22.1.3.18 Array.prototype.map
    map: fn,
    // 22.1.3.19 Array.prototype.pop
    pop: fn,
    // 22.1.3.20 Array.prototype.push
    push: fn,
    // 22.1.3.21 Array.prototype.reduce
    reduce: fn,
    // 22.1.3.22 Array.prototype.reduceRight
    reduceRight: fn,
    // 22.1.3.23 Array.prototype.reverse
    reverse: fn,
    // 22.1.3.24 Array.prototype.shift
    shift: fn,
    // 22.1.3.25 Array.prototype.slice
    slice: fn,
    // 22.1.3.26 Array.prototype.some
    some: fn,
    // 22.1.3.27 Array.prototype.sort
    sort: fn,
    // 22.1.3.28 Array.prototype.splice
    splice: fn,
    // 22.1.3.29 Array.prototype.toLocaleString
    toLocaleString: fn,
    // 22.1.3.30 Array.prototype.toString
    toString: fn,
    // 22.1.3.31 Array.prototype.unshift
    unshift: fn,
    // 22.1.3.32 Array.prototype.values
    values: fn,
    // 22.1.3.33 Array.prototype [ @@iterator ]
    '@@iterator': fn,
    // 22.1.3.34 Array.prototype [ @@unscopables ]
    '@@unscopables': {
      '**proto**': null,
      copyWithin: 'boolean',
      entries: 'boolean',
      fill: 'boolean',
      find: 'boolean',
      findIndex: 'boolean',
      flat: 'boolean',
      flatMap: 'boolean',
      includes: 'boolean',
      keys: 'boolean',
      values: 'boolean',
    },
  },

  ArrayIteratorPrototype: {
    // 22.1.5.2 The %ArrayIteratorPrototype% Object
    '**proto**': 'IteratorPrototype',
    // 22.1.5.2.1 %ArrayIteratorPrototype%.next
    next: fn,
    // 22.1.5.2.2 %ArrayIteratorPrototype% [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  // *** 22.2 TypedArray Objects

  TypedArray: {
    // 22.2.2 Properties of the %TypedArray% Intrinsic Object
    '**proto**': 'FunctionPrototype',
    // 22.2.2.1 %TypedArray%.from
    from: fn,
    // 22.2.2.2 %TypedArray%.of
    of: fn,
    // 22.2.2.3 %TypedArray%.prototype
    prototype: 'TypedArrayPrototype',
    // 22.2.2.4 get %TypedArray% [ @@species ]
    '@@species': getter,
  },

  TypedArrayPrototype: {
    // 22.2.3.1 get %TypedArray%.prototype.buffer
    buffer: getter,
    // 22.2.3.2 get %TypedArray%.prototype.byteLength
    byteLength: getter,
    // 22.2.3.3 get %TypedArray%.prototype.byteOffset
    byteOffset: getter,
    // 22.2.3.4 %TypedArray%.prototype.constructor
    constructor: 'TypedArray',
    // 22.2.3.5 %TypedArray%.prototype.copyWithin
    copyWithin: fn,
    // 22.2.3.6 %TypedArray%.prototype.entries
    entries: fn,
    // 22.2.3.7 %TypedArray%.prototype.every
    every: fn,
    // 22.2.3.8 %TypedArray%.prototype.fill
    fill: fn,
    // 22.2.3.9 %TypedArray%.prototype.filter
    filter: fn,
    // 22.2.3.10 %TypedArray%.prototype.find
    find: fn,
    // 22.2.3.11 %TypedArray%.prototype.findIndex
    findIndex: fn,
    // 22.2.3.12 %TypedArray%.prototype.forEach
    forEach: fn,
    // 22.2.3.13 %TypedArray%.prototype.includes
    includes: fn,
    // 22.2.3.14 %TypedArray%.prototype.indexOf
    indexOf: fn,
    // 22.2.3.15 %TypedArray%.prototype.join
    join: fn,
    // 22.2.3.16 %TypedArray%.prototype.keys
    keys: fn,
    // 22.2.3.17 %TypedArray%.prototype.lastIndexOf
    lastIndexOf: fn,
    // 22.2.3.18 get %TypedArray%.prototype.length
    length: getter,
    // 22.2.3.19 %TypedArray%.prototype.map
    map: fn,
    // 22.2.3.20 %TypedArray%.prototype.reduce
    reduce: fn,
    // 22.2.3.21 %TypedArray%.prototype.reduceRight
    reduceRight: fn,
    // 22.2.3.22 %TypedArray%.prototype.reverse
    reverse: fn,
    // 22.2.3.23 %TypedArray%.prototype.set
    set: fn,
    // 22.2.3.24 %TypedArray%.prototype.slice
    slice: fn,
    // 22.2.3.25 %TypedArray%.prototype.some
    some: fn,
    // 22.2.3.26 %TypedArray%.prototype.sort
    sort: fn,
    // 22.2.3.27 %TypedArray%.prototype.subarray
    subarray: fn,
    // 22.2.3.28 %TypedArray%.prototype.toLocaleString
    toLocaleString: fn,
    // 22.2.3.29 %TypedArray%.prototype.toString
    toString: fn,
    // 22.2.3.30 %TypedArray%.prototype.values
    values: fn,
    // 22.2.3.31 %TypedArray%.prototype [ @@iterator ]
    '@@iterator': fn,
    // 22.2.3.32 get %TypedArray%.prototype [ @@toStringTag ]
    '@@toStringTag': getter,
  },

  // 22.2.4 The TypedArray Constructors

  BigInt64Array: TypedArray('BigInt64ArrayPrototype'),
  BigUint64Array: TypedArray('BigUint64ArrayPrototype'),
  Float32Array: TypedArray('Float32ArrayPrototype'),
  Float64Array: TypedArray('Float64ArrayPrototype'),
  Int16Array: TypedArray('Int16ArrayPrototype'),
  Int32Array: TypedArray('Int32ArrayPrototype'),
  Int8Array: TypedArray('Int8ArrayPrototype'),
  Uint16Array: TypedArray('Uint16ArrayPrototype'),
  Uint32Array: TypedArray('Uint32ArrayPrototype'),
  Uint8Array: TypedArray('Uint8ArrayPrototype'),
  Uint8ClampedArray: TypedArray('Uint8ClampedArrayPrototype'),

  BigInt64ArrayPrototype: TypedArrayPrototype('BigInt64Array'),
  BigUint64ArrayPrototype: TypedArrayPrototype('BigUint64Array'),
  Float32ArrayPrototype: TypedArrayPrototype('Float32Array'),
  Float64ArrayPrototype: TypedArrayPrototype('Float64Array'),
  Int16ArrayPrototype: TypedArrayPrototype('Int16Array'),
  Int32ArrayPrototype: TypedArrayPrototype('Int32Array'),
  Int8ArrayPrototype: TypedArrayPrototype('Int8Array'),
  Uint16ArrayPrototype: TypedArrayPrototype('Uint16Array'),
  Uint32ArrayPrototype: TypedArrayPrototype('Uint32Array'),
  Uint8ArrayPrototype: TypedArrayPrototype('Uint8Array'),
  Uint8ClampedArrayPrototype: TypedArrayPrototype('Uint8ClampedArray'),

  // *** 23 Keyed Collections

  Map: {
    // 23.1.2 Properties of the Map Constructor
    '**proto**': 'FunctionPrototype',
    // 23.2.2.2 get Set [ @@species ]
    '@@species': getter,
    prototype: 'MapPrototype',
  },

  MapPrototype: {
    // 23.1.3.1 Map.prototype.clear
    clear: fn,
    // 23.1.3.2 Map.prototype.constructor
    constructor: 'Map',
    // 23.1.3.3 Map.prototype.delete
    delete: fn,
    // 23.1.3.4 Map.prototype.entries
    entries: fn,
    // 23.1.3.5 Map.prototype.forEach
    forEach: fn,
    // 23.1.3.6 Map.prototype.get
    get: fn,
    // 23.1.3.7 Map.prototype.has
    has: fn,
    // 23.1.3.8 Map.prototype.keys
    keys: fn,
    // 23.1.3.9 Map.prototype.set
    set: fn,
    // 23.1.3.10 get Map.prototype.size
    size: getter,
    // 23.1.3.11 Map.prototype.values
    values: fn,
    // 23.1.3.12Map.prototype [ @@iterator ]
    '@@iterator': fn,
    // 23.1.3.13Map.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  MapIteratorPrototype: {
    // 23.1.5.2 The %MapIteratorPrototype% Object
    '**proto**': 'IteratorPrototype',
    // 23.1.5.2.1 %MapIteratorPrototype%.next
    next: fn,
    // 23.1.5.2.2 %MapIteratorPrototype% [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  Set: {
    // 23.2.2 Properties of the Set Constructor
    '**proto**': 'FunctionPrototype',
    // 23.2.2.1 Set.prototype
    prototype: 'SetPrototype',
    // 23.2.2.2 get Set [ @@species ]
    '@@species': getter,
  },

  SetPrototype: {
    // 23.2.3.1 Set.prototype.add
    add: fn,
    // 23.2.3.2 Set.prototype.clear
    clear: fn,
    // 23.2.3.3 Set.prototype.constructor
    constructor: 'Set',
    // 23.2.3.4 Set.prototype.delete
    delete: fn,
    // 23.2.3.5 Set.prototype.entries
    entries: fn,
    // 23.2.3.6Set.prototype.forEach
    forEach: fn,
    // 23.2.3.7 Set.prototype.has
    has: fn,
    // 23.2.3.8 Set.prototype.keys
    keys: fn,
    // 23.2.3.9 get Set.prototype.size
    size: getter,
    // 23.2.3.10 Set.prototype.values
    values: fn,
    // 3.2.3.11 Set.prototype [ @@iterator ]
    '@@iterator': fn,
    // 23.2.3.12 Set.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  SetIteratorPrototype: {
    // 23.2.5.2 The %SetIteratorPrototype% Object
    '**proto**': 'IteratorPrototype',
    // 23.2.5.2.1 %SetIteratorPrototype%.next
    next: fn,
    // 23.2.5.2.2 %SetIteratorPrototype% [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  WeakMap: {
    // 23.3.2 Properties of the WeakMap Constructor
    '**proto**': 'FunctionPrototype',
    // 23.3.2.1 WeakMap.prototype
    prototype: 'WeakMapPrototype',
  },

  WeakMapPrototype: {
    // 23.3.3.1 WeakMap.prototype.constructor
    constructor: 'WeakMap',
    // 23.3.3.2 WeakMap.prototype.delete
    delete: fn,
    // 23.3.3.3 WeakMap.prototype.get
    get: fn,
    // 23.3.3.4 WeakMap.prototype.has
    has: fn,
    // 23.3.3.5 WeakMap.prototype.set
    set: fn,
    // 23.3.3.6 WeakMap.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  WeakSet: {
    // 23.4.2Properties of the WeakSet Constructor
    '**proto**': 'FunctionPrototype',
    // 23.4.2.1 WeakSet.prototype
    prototype: 'WeakSetPrototype',
  },

  WeakSetPrototype: {
    // 23.4.3.1 WeakSet.prototype.add
    add: fn,
    // 23.4.3.2 WeakSet.prototype.constructor
    constructor: 'WeakSet',
    // 23.4.3.3 WeakSet.prototype.delete
    delete: fn,
    // 23.4.3.4 WeakSet.prototype.has
    has: fn,
    // 23.4.3.5 WeakSet.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  // *** 24 Structured Data

  ArrayBuffer: {
    // 24.1.3 Properties of the ArrayBuffer Constructor
    '**proto**': 'FunctionPrototype',
    // 24.1.3.1 ArrayBuffer.isView
    isView: fn,
    // 24.1.3.2 ArrayBuffer.prototype
    prototype: 'ArrayBufferPrototype',
    // 24.1.3.3 get ArrayBuffer [ @@species ]
    '@@species': getter,
  },

  ArrayBufferPrototype: {
    // 24.1.4.1 get ArrayBuffer.prototype.byteLength
    byteLength: getter,
    // 24.1.4.2 ArrayBuffer.prototype.constructor
    constructor: 'ArrayBuffer',
    // 24.1.4.3 ArrayBuffer.prototype.slice
    slice: fn,
    // 24.1.4.4 ArrayBuffer.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  // 24.2 SharedArrayBuffer Objects
  SharedArrayBuffer: false, // UNSAFE and purposely suppressed.

  DataView: {
    // 24.3.3 Properties of the DataView Constructor
    '**proto**': 'FunctionPrototype',
    // 24.3.3.1 DataView.prototype
    prototype: 'DataViewPrototype',
  },

  DataViewPrototype: {
    // 24.3.4.1 get DataView.prototype.buffer
    buffer: getter,
    // 24.3.4.2 get DataView.prototype.byteLength
    byteLength: getter,
    // 24.3.4.3 get DataView.prototype.byteOffset
    byteOffset: getter,
    // 24.3.4.4 DataView.prototype.constructor
    constructor: 'DataView',
    // 24.3.4.5 DataView.prototype.getBigInt64
    getBigInt64: fn,
    // 24.3.4.6 DataView.prototype.getBigUint64
    getBigUint64: fn,
    // 24.3.4.7 DataView.prototype.getFloat32
    getFloat32: fn,
    // 24.3.4.8 DataView.prototype.getFloat64
    getFloat64: fn,
    // 24.3.4.9 DataView.prototype.getInt8
    getInt8: fn,
    // 24.3.4.10 DataView.prototype.getInt16
    getInt16: fn,
    // 24.3.4.11 DataView.prototype.getInt32
    getInt32: fn,
    // 24.3.4.12 DataView.prototype.getUint8
    getUint8: fn,
    // 24.3.4.13 DataView.prototype.getUint16
    getUint16: fn,
    // 24.3.4.14 DataView.prototype.getUint32
    getUint32: fn,
    // 24.3.4.15 DataView.prototype.setBigInt64
    setBigInt64: fn,
    // 24.3.4.16 DataView.prototype.setBigUint64
    setBigUint64: fn,
    // 24.3.4.17 DataView.prototype.setFloat32
    setFloat32: fn,
    // 24.3.4.18 DataView.prototype.setFloat64
    setFloat64: fn,
    // 24.3.4.19 DataView.prototype.setInt8
    setInt8: fn,
    // 24.3.4.20 DataView.prototype.setInt16
    setInt16: fn,
    // 24.3.4.21 DataView.prototype.setInt32
    setInt32: fn,
    // 24.3.4.22 DataView.prototype.setUint8
    setUint8: fn,
    // 24.3.4.23 DataView.prototype.setUint16
    setUint16: fn,
    // 24.3.4.24 DataView.prototype.setUint32
    setUint32: fn,
    // 24.3.4.25 DataView.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  // 24.4 Atomics
  Atomics: false, // UNSAFE and suppressed.

  JSON: {
    // 24.5.1 JSON.parse
    parse: fn,
    // 24.5.2 JSON.stringify
    stringify: fn,
    // 24.5.3 JSON [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  // *** 25 Control Abstraction Objects

  IteratorPrototype: {
    // 25.1.2 The %IteratorPrototype% Object
    // 25.1.2.1 %IteratorPrototype% [ @@iterator ]
    '@@iterator': fn,
  },

  AsyncIteratorPrototype: {
    // 25.1.3 The %AsyncIteratorPrototype% Object
    // 25.1.3.1 %AsyncIteratorPrototype% [ @@asyncIterator ]
    '@@asyncIterator': fn,
  },

  GeneratorFunction: {
    // 25.2.2 Properties of the GeneratorFunction Constructor
    '**proto**': 'FunctionPrototypeConstructor',
    name: 'string',
    // 25.2.2.1 GeneratorFunction.length
    length: 'number',
    // 25.2.2.2 GeneratorFunction.prototype
    prototype: 'Generator',
  },

  Generator: {
    // 25.2.3 Properties of the GeneratorFunction Prototype Object
    '**proto**': 'FunctionPrototype',
    // 25.2.3.1 GeneratorFunction.prototype.constructor
    constructor: 'GeneratorFunction',
    // 25.2.3.2 GeneratorFunction.prototype.prototype
    prototype: 'GeneratorPrototype',
  },

  AsyncGeneratorFunction: {
    // 25.3.2 Properties of the AsyncGeneratorFunction Constructor
    '**proto**': 'FunctionPrototypeConstructor',
    name: 'string',
    // 25.3.2.1 AsyncGeneratorFunction.length
    length: 'number',
    // 25.3.2.2 AsyncGeneratorFunction.prototype
    prototype: 'AsyncGenerator',
  },

  AsyncGenerator: {
    // 25.3.3 Properties of the AsyncGeneratorFunction Prototype Object
    '**proto**': 'FunctionPrototype',
    // 25.3.3.1 AsyncGeneratorFunction.prototype.constructor
    constructor: 'AsyncGeneratorFunction',
    // 25.3.3.2 AsyncGeneratorFunction.prototype.prototype
    prototype: 'AsyncGeneratorPrototype',
    // 25.3.3.3 AsyncGeneratorFunction.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  GeneratorPrototype: {
    // 25.4.1 Properties of the Generator Prototype Object
    '**proto**': 'IteratorPrototype',
    // 25.4.1.1 Generator.prototype.constructor
    constructor: 'Generator',
    // 25.4.1.2 Generator.prototype.next
    next: fn,
    // 25.4.1.3 Generator.prototype.return
    return: fn,
    // 25.4.1.4 Generator.prototype.throw
    throw: fn,
    // 25.4.1.5 Generator.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  AsyncGeneratorPrototype: {
    // 25.5.1 Properties of the AsyncGenerator Prototype Object
    '**proto**': 'AsyncIteratorPrototype',
    // 25.5.1.1 AsyncGenerator.prototype.constructor
    constructor: 'AsyncGenerator',
    // 25.5.1.2 AsyncGenerator.prototype.next
    next: fn,
    // 25.5.1.3 AsyncGenerator.prototype.return
    return: fn,
    // 25.5.1.4 AsyncGenerator.prototype.throw
    throw: fn,
    // 25.5.1.5 AsyncGenerator.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  Promise: {
    // 25.6.4 Properties of the Promise Constructor
    '**proto**': 'FunctionPrototype',
    // 25.6.4.1 Promise.all
    all: fn,
    // 25.6.4.2 Promise.allSettled
    allSettled: fn,
    // 25.6.4.3Promise.prototype
    prototype: 'PromisePrototype',
    // 25.6.4.4 Promise.race
    race: fn,
    // 25.6.4.5 Promise.reject
    reject: fn,
    // 25.6.4.6 Promise.resolve
    resolve: fn,
    // 25.6.4.7 get Promise [ @@species ]
    '@@species': getter,
  },

  PromisePrototype: {
    // 25.6.5 Properties of the Promise Prototype Object
    // 25.6.5.1 Promise.prototype.catch
    catch: fn,
    // 25.6.5.2 Promise.prototype.constructor
    constructor: 'Promise',
    // 25.6.5.3 Promise.prototype.finally
    finally: fn,
    // 25.6.5.4 Promise.prototype.then
    then: fn,
    // 25.6.5.5 Promise.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  AsyncFunction: {
    // 25.7.2 Properties of the AsyncFunction Constructor
    '**proto**': 'FunctionPrototypeConstructor',
    name: 'string',
    // 25.7.2.1 AsyncFunction.length
    length: 'number',
    // 25.7.2.2 AsyncFunction.prototype
    prototype: 'AsyncFunctionPrototype',
  },

  AsyncFunctionPrototype: {
    // 25.7.3 Properties of the AsyncFunction Prototype Object
    '**proto**': 'FunctionPrototype',
    // 25.7.3.1 AsyncFunction.prototype.constructor
    constructor: 'AsyncFunction',
    // 25.7.3.2 AsyncFunction.prototype [ @@toStringTag ]
    '@@toStringTag': 'string',
  },

  // 26 Reflection

  Reflect: {
    // 26.1 The Reflect Object
    // Not a function object.
    // 26.1.1 Reflect.apply
    apply: fn,
    // 26.1.2 Reflect.construct
    construct: fn,
    // 26.1.3 Reflect.defineProperty
    defineProperty: fn,
    // 26.1.4 Reflect.deleteProperty
    deleteProperty: fn,
    // 26.1.5 Reflect.get
    get: fn,
    // 26.1.6 Reflect.getOwnPropertyDescriptor
    getOwnPropertyDescriptor: fn,
    // 26.1.7 Reflect.getPrototypeOf
    getPrototypeOf: fn,
    // 26.1.8 Reflect.has
    has: fn,
    // 26.1.9 Reflect.isExtensible
    isExtensible: fn,
    // 26.1.10 Reflect.ownKeys
    ownKeys: fn,
    // 26.1.11 Reflect.preventExtensions
    preventExtensions: fn,
    // 26.1.12 Reflect.set
    set: fn,
    // 26.1.13 Reflect.setPrototypeOf
    setPrototypeOf: fn,
  },

  Proxy: {
    // 26.2.2 Properties of the Proxy Constructor
    '**proto**': 'FunctionPrototype',
    // 26.2.2.1 Proxy.revocable
    revocable: fn,
  },

  // Appendix B

  // B.2.1 Additional Properties of the Global Object

  // B.2.1.1 escape
  escape: fn,
  // B.2.1.2 unescape (
  unescape: fn,

  // ESNext

  // New intrinsic like %Function% but disabled.
  FunctionPrototypeConstructor: {
    '**proto**': 'FunctionPrototype',
    length: 'number',
    prototype: 'FunctionPrototype',
  },

  Compartment: {
    '**proto**': 'FunctionPrototype',
    prototype: 'CompartmentPrototype',
  },

  CompartmentPrototype: {
    constructor: 'Compartment',
    evaluate: fn,
    global: getter,
  },

  harden: fn,
};

// Copyright (C) 2011 Google Inc.

const { getPrototypeOf: getPrototypeOf$2, getOwnPropertyDescriptor: getOwnPropertyDescriptor$2 } = Object;

const { apply: apply$1, ownKeys } = Reflect;
const uncurryThis$1 = fn => (thisArg, ...args) => apply$1(fn, thisArg, args);
const hasOwnProperty$2 = uncurryThis$1(Object.prototype.hasOwnProperty);

/**
 * asStringPropertyName()
 */
function asStringPropertyName(path, prop) {
  if (typeof prop === 'string') {
    return prop;
  }

  if (typeof prop === 'symbol') {
    return `@@${prop.toString().slice(14, -1)}`;
  }

  throw new TypeError(`Unexpected property name type ${path} ${prop}`);
}

/**
 * whitelistIntrinsics()
 * Removes all non-whitelisted properties found by recursively and
 * reflectively walking own property chains.
 */
function whitelistIntrinsics(intrinsics) {
  // These primities are allowed allowed for permits.
  const primitives = ['undefined', 'boolean', 'number', 'string', 'symbol'];

  /**
   * whitelistPrototype()
   * Validate the object's [[prototype]] against a permit.
   */
  function whitelistPrototype(path, obj, protoName) {
    const proto = getPrototypeOf$2(obj);

    // Null prototype.
    if (proto === null && protoName === null) {
      return;
    }

    // Assert: protoName, if provided, is a string.
    if (protoName !== undefined && typeof protoName !== 'string') {
      throw new TypeError(`Malformed whitelist permit ${path}.__proto__`);
    }

    // If permit not specified, default tp Object.prototype.
    if (proto === intrinsics[protoName || 'ObjectPrototype']) {
      return;
    }

    // We can't clean [[prototype]], therefore abort.
    throw new Error(`Unexpected intrinsic ${path}.__proto__`);
  }

  /**
   * isWhitelistPropertyValue()
   * Whitelist a single property value against a permit.
   */
  function isWhitelistPropertyValue(path, value, prop, permit) {
    if (typeof permit === 'object') {
      // eslint-disable-next-line no-use-before-define
      whitelistProperties(path, value, permit);
      // The property is whitelisted.
      return true;
    }

    if (permit === false) {
      // A boolan 'false' permit specifies the removal of a property.
      // We require a more specific permit instead of allowing 'true'.
      return false;
    }

    if (typeof permit === 'string') {
      // A string permit can have one of two meanings:

      if (prop === 'prototype' || prop === 'constructor') {
        // For prototype and constructor value properties, the permit
        // is the mame of an intrinsic.
        // Assumption: prototype and constructor cannot be primitives.
        // Assert: the permit is the name of an untrinsic.
        // Assert: the property value is equal to that intrinsic.

        if (hasOwnProperty$2(intrinsics, permit)) {
          return value === intrinsics[permit];
        }
      } else {
        // For all other properties, the permit is the name of a primitive.
        // Assert: the permit is the name of a primitive.
        // Assert: the property value type is equal to that primitive.

        // eslint-disable-next-line no-lonely-if
        if (primitives.includes(permit)) {
          // eslint-disable-next-line valid-typeof
          return typeof value === permit;
        }
      }
    }

    throw new TypeError(`Unexpected whitelist permit ${path}`);
  }

  /**
   * isWhitelistProperty()
   * Whitelist a single property against a permit.
   */
  function isWhitelistProperty(path, obj, prop, permit) {
    const desc = getOwnPropertyDescriptor$2(obj, prop);

    // Is this a value property?
    if (hasOwnProperty$2(desc, 'value')) {
      return isWhitelistPropertyValue(path, desc.value, prop, permit);
    }

    return (
      isWhitelistPropertyValue(`${path}<get>`, desc.get, prop, permit.get) &&
      isWhitelistPropertyValue(`${path}<set>`, desc.set, prop, permit.set)
    );
  }

  /**
   * getSubPermit()
   */
  function getSubPermit(permit, prop) {
    if (hasOwnProperty$2(permit, prop)) {
      return permit[prop];
    }

    if (permit['**proto**'] === 'FunctionPrototype') {
      if (hasOwnProperty$2(FunctionInstance, prop)) {
        return FunctionInstance[prop];
      }
    }

    return undefined;
  }

  /**
   * whitelistProperties()
   * Whitelist all properties against a permit.
   */
  function whitelistProperties(path, obj, permit) {
    const protoName = permit['**proto**'];
    whitelistPrototype(path, obj, protoName);

    for (const prop of ownKeys(obj)) {
      if (prop === '__proto__') {
        // Ignore, already checked above.
        // eslint-disable-next-line no-continue
        continue;
      }

      const propString = asStringPropertyName(path, prop);
      const subPath = `${path}.${propString}`;
      const subPermit = getSubPermit(permit, propString);

      if (subPermit) {
        // Property has a permit.
        if (isWhitelistProperty(subPath, obj, prop, subPermit)) {
          // Property is whitelisted.
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      // console.log(`Removing ${subPath}`);
      delete obj[prop];
    }
  }

  // Start path with 'intrinsics' to clarify that properties are not
  // removed from the global object by the whitelisting operation.
  whitelistProperties('intrinsics', intrinsics, whitelist);
}

// Adapted from SES/Caja - Copyright (C) 2011 Google Inc.
// https://github.com/google/caja/blob/master/src/com/google/caja/ses/startSES.js
// https://github.com/google/caja/blob/master/src/com/google/caja/ses/repairES5.js

/**
 * Replace the legacy accessors of Object to comply with strict mode
 * and ES2016 semantics, we do this by redefining them while in 'use strict'.
 *
 * todo: list the issues resolved
 *
 * This function can be used in two ways: (1) invoked directly to fix the primal
 * realm's Object.prototype, and (2) converted to a string to be executed
 * inside each new RootRealm to fix their Object.prototypes. Evaluation requires
 * the function to have no dependencies, so don't import anything from
 * the outside.
 */

function repairLegacyAccessors() {
  try {
    // Verify that the method is not callable.
    // eslint-disable-next-line no-underscore-dangle
    (0, Object.prototype.__lookupGetter__)('x');
  } catch (ignore) {
    // Throws, no need to patch.
    return;
  }

  const {
    defineProperty,
    defineProperties,
    getOwnPropertyDescriptor,
    getPrototypeOf,
    prototype: objectPrototype,
  } = Object;

  // On some platforms, the implementation of these functions act as
  // if they are in sloppy mode: if they're invoked badly, they will
  // expose the global object, so we need to repair these for
  // security. Thus it is our responsibility to fix this, and we need
  // to include repairAccessors. E.g. Chrome in 2016.

  function toObject(obj) {
    if (obj === undefined || obj === null) {
      throw new TypeError(`can't convert undefined or null to object`);
    }
    return Object(obj);
  }

  function asPropertyName(obj) {
    if (typeof obj === 'symbol') {
      return obj;
    }
    return `${obj}`;
  }

  function aFunction(obj, accessor) {
    if (typeof obj !== 'function') {
      throw TypeError(`invalid ${accessor} usage`);
    }
    return obj;
  }

  defineProperties(objectPrototype, {
    __defineGetter__: {
      value: function __defineGetter__(prop, func) {
        const O = toObject(this);
        defineProperty(O, prop, {
          get: aFunction(func, 'getter'),
          enumerable: true,
          configurable: true,
        });
      },
    },
    __defineSetter__: {
      value: function __defineSetter__(prop, func) {
        const O = toObject(this);
        defineProperty(O, prop, {
          set: aFunction(func, 'setter'),
          enumerable: true,
          configurable: true,
        });
      },
    },
    __lookupGetter__: {
      value: function __lookupGetter__(prop) {
        let O = toObject(this);
        prop = asPropertyName(prop);
        let desc;
        // eslint-disable-next-line no-cond-assign
        while (O && !(desc = getOwnPropertyDescriptor(O, prop))) {
          O = getPrototypeOf(O);
        }
        return desc && desc.get;
      },
    },
    __lookupSetter__: {
      value: function __lookupSetter__(prop) {
        let O = toObject(this);
        prop = asPropertyName(prop);
        let desc;
        // eslint-disable-next-line no-cond-assign
        while (O && !(desc = getOwnPropertyDescriptor(O, prop))) {
          O = getPrototypeOf(O);
        }
        return desc && desc.set;
      },
    },
  });
}

// This module replaces the original `Function` constructor, and the original
// `%GeneratorFunction%`, `%AsyncFunction%` and `%AsyncGeneratorFunction%`, with
// safe replacements that throw if invoked.
//
// These are all reachable via syntax, so it isn't sufficient to just
// replace global properties with safe versions. Our main goal is to prevent
// access to the `Function` constructor through these starting points.
//
// After modules block is done, the originals must no longer be reachable, unless
// a copy has been made, and funtions can only be created by syntax (using eval)
// or by invoking a previously saved reference to the originals.
//
// Typically, this module will not be used directly, but via the [lockdown-shim] which handles all necessary repairs and taming in SES.
//
// Relation to ECMA specifications
//
// The taming of constructors really wants to be part of the standard, because new
// constructors may be added in the future, reachable from syntax, and this
// list must be updated to match.
//
// In addition, the standard needs to define four new intrinsics for the safe
// replacement functions. See [./whitelist intrinsics].
//
// Adapted from SES/Caja
// Copyright (C) 2011 Google Inc.
// https://github.com/google/caja/blob/master/src/com/google/caja/ses/startSES.js
// https://github.com/google/caja/blob/master/src/com/google/caja/ses/repairES5.js

/**
 * tameFunctionConstructors()
 * This block replaces the original Function constructor, and the original
 * %GeneratorFunction% %AsyncFunction% and %AsyncGeneratorFunction%, with
 * safe replacements that throw if invoked.
 */

function tameFunctionConstructors() {
  try {
    // Verify that the method is not callable.
    (0, Function.prototype.constructor)('return 1');
  } catch (ignore) {
    // Throws, no need to patch.
    return;
  }

  const { defineProperties, getPrototypeOf, setPrototypeOf } = Object;

  /**
   * The process to repair constructors:
   * 1. Create an instance of the function by evaluating syntax
   * 2. Obtain the prototype from the instance
   * 3. Create a substitute tamed constructor
   * 4. Replace the original constructor with the tamed constructor
   * 5. Replace tamed constructor prototype property with the original one
   * 6. Replace its [[Prototype]] slot with the tamed constructor of Function
   */
  function repairFunction(name, declaration) {
    let FunctionInstance;
    try {
      // eslint-disable-next-line no-eval
      FunctionInstance = (0, eval)(declaration);
    } catch (e) {
      if (e instanceof SyntaxError) {
        // Prevent failure on platforms where async and/or generators
        // are not supported.
        return;
      }
      // Re-throw
      throw e;
    }
    const FunctionPrototype = getPrototypeOf(FunctionInstance);

    // Prevents the evaluation of source when calling constructor on the
    // prototype of functions.
    // eslint-disable-next-line func-names
    const constructor = function() {
      throw new TypeError('Not available');
    };
    defineProperties(constructor, {
      name: {
        value: name,
        writable: false,
        enumerable: false,
        configurable: true,
      },
      toString: {
        value: () => `function ${name}() { [native code] }`,
        writable: false,
        enumerable: false,
        configurable: true,
      },
    });

    defineProperties(FunctionPrototype, {
      constructor: { value: constructor },
    });

    // This line sets the tamed constructor's prototype data property to
    // the original one.
    defineProperties(constructor, {
      prototype: { value: FunctionPrototype },
    });

    // This line ensures that all functions meet "instanceof Function" in
    // a give realm.
    if (constructor !== Function.prototype.constructor) {
      setPrototypeOf(constructor, Function.prototype.constructor);
    }
  }

  // Here, the order of operation is important: Function needs to be repaired
  // first since the other repaired constructors need to inherit from the tamed
  // Function function constructor.

  repairFunction('Function', '(function(){})');
  repairFunction('GeneratorFunction', '(function*(){})');
  repairFunction('AsyncFunction', '(async function(){})');
  repairFunction('AsyncGeneratorFunction', '(async function*(){})');
}

const { defineProperties, getOwnPropertyDescriptors } = Object;

function tameGlobalDateObject() {
  // Tame the %Date% and %DatePrototype% intrinsic.

  // Use a concise method to obtain a named function without constructor.
  const DateStatic = {
    now() {
      return NaN;
    },
  };
  Date.now = DateStatic.now;

  // Use a concise method to obtain a named function without constructor.
  const DatePrototype = {
    toLocaleString() {
      return NaN;
    },
  };
  // eslint-disable-next-line no-extend-native
  Date.prototype.toLocaleString = DatePrototype.toLocaleString;

  // Date(anything) gives a string with the current time
  // new Date(x) coerces x into a number and then returns a Date
  // new Date() returns the current time, as a Date object
  // new Date(undefined) returns a Date object which stringifies to 'Invalid Date'

  // Capture the original constructor.
  const unsafeDate = Date; // TODO freeze

  // Tame the Date constructor.
  const tamedDate = function Date() {
    if (new.target === undefined) {
      // We were not called as a constructor
      // this would normally return a string with the current time
      return 'Invalid Date';
    }
    // constructor behavior: if we get arguments, we can safely pass them through
    if (arguments.length > 0) {
      // eslint-disable-next-line prefer-rest-params
      return Reflect.construct(unsafeDate, arguments, new.target);
      // todo: test that our constructor can still be subclassed
    }
    // SES fix: no arguments: return a Date object, but invalid value.
    return Reflect.construct(unsafeDate, [NaN], new.target);
  };

  // Copy static properties.
  const dateDescs = getOwnPropertyDescriptors(unsafeDate);
  defineProperties(tamedDate, dateDescs);

  // Copy prototype properties.
  const datePrototypeDescs = getOwnPropertyDescriptors(unsafeDate.prototype);
  datePrototypeDescs.constructor.value = tamedDate;
  defineProperties(tamedDate.prototype, datePrototypeDescs);

  // Done with Date constructor
  globalThis.Date = tamedDate;

  // Tame the %ObjectPrototype% intrinsic.

  // Use a concise method to obtain a named function without constructor.
  const ObjectPrototype = {
    toLocaleString() {
      throw new TypeError('Object.prototype.toLocaleString is disabled');
    },
  };

  // eslint-disable-next-line no-extend-native
  Object.prototype.toLocaleString = ObjectPrototype.toLocaleString;
}

const { getOwnPropertyDescriptor: getOwnPropertyDescriptor$3 } = Object;

function tameGlobalErrorObject() {
  // Tame static properties.
  delete Error.captureStackTrace;

  if (getOwnPropertyDescriptor$3(Error, 'captureStackTrace')) {
    throw Error('Cannot remove Error.captureStackTrace');
  }

  delete Error.stackTraceLimit;

  if (getOwnPropertyDescriptor$3(Error, 'stackTraceLimit')) {
    throw Error('Cannot remove Error.stackTraceLimit');
  }
}

function tameGlobalMathObject() {
  // Tame the %Math% intrinsic.

  // Use a concise method to obtain a named function without constructor.
  const MathStatic = {
    random() {
      throw TypeError('Math.random() is disabled');
    },
  };

  Math.random = MathStatic.random;
}

const {
  defineProperties: defineProperties$1,
  getOwnPropertyDescriptors: getOwnPropertyDescriptors$1,
  getOwnPropertyDescriptor: getOwnPropertyDescriptor$4,
} = Object;

function tameGlobalRegExpObject() {
  // Tame the %RegExp% intrinsic.

  delete RegExp.prototype.compile;

  // Capture the original constructor.
  const unsafeRegExp = RegExp; // TODO freeze

  // RegExp has non-writable static properties we need to remove.
  // Tame RegExp constructor.
  const tamedRegExp = function RegExp() {
    // eslint-disable-next-line prefer-rest-params
    return Reflect.construct(unsafeRegExp, arguments, new.target);
  };

  // Whitelist static properties.
  const desc = getOwnPropertyDescriptor$4(unsafeRegExp, Symbol.species);
  defineProperties$1(tamedRegExp, Symbol.species, desc);

  // Copy prototype properties.
  const prototypeDescs = getOwnPropertyDescriptors$1(unsafeRegExp.prototype);
  prototypeDescs.constructor.value = tamedRegExp;
  defineProperties$1(tamedRegExp.prototype, prototypeDescs);

  // Done with RegExp constructor.
  globalThis.RegExp = tamedRegExp;
}

/**
 * @fileoverview Exports {@code enablements}, a recursively defined
 * JSON record defining the optimum set of intrinsics properties
 * that need to be "repaired" before hardening is applied on
 * enviromments subject to the override mistake.
 *
 * @author JF Paradis
 */

/**
 * <p>Because "repairing" replaces data properties with accessors, every
 * time a repaired property is accessed, the associated getter is invoked,
 * which degrades the runtime performance of all code executing in the
 * repaired enviromment, compared to the non-repaired case. In order
 * to maintain performance, we only repair the properties of objects
 * for which hardening causes a breakage of their normal intended usage.
 *
 * There are three unwanted cases:
 * <ul>
 * <li>Overriding properties on objects typically used as records,
 *     namely {@code "Object"} and {@code "Array"}. In the case of arrays,
 *     the situation is unintential, a given program might not be aware
 *     that non-numerical properties are stored on the undelying object
 *     instance, not on the array. When an object is typically used as a
 *     map, we repair all of its prototype properties.
 * <li>Overriding properties on objects that provide defaults on their
 *     prototype and that programs typically set using an assignment, such as
 *     {@code "Error.prototype.message"} and {@code "Function.prototype.name"}
 *     (both default to "").
 * <li>Setting-up a prototype chain, where a constructor is set to extend
 *     another one. This is typically set by assignment, for example
 *     {@code "Child.prototype.constructor = Child"}, instead of invoking
 *     Object.defineProperty();
 *
 * <p>Each JSON record enumerates the disposition of the properties on
 * some corresponding intrinsic object.
 *
 * <p>For each such record, the values associated with its property
 * names can be:
 * <ul>
 * <li>true, in which case this property is simply repaired. The
 *     value associated with that property is not traversed. For
 * 	   example, {@code "Function.prototype.name"} leads to true,
 *     meaning that the {@code "name"} property of {@code
 *     "Function.prototype"} should be repaired (which is needed
 *     when inheriting from @code{Function} and setting the subclass's
 *     {@code "prototype.name"} property). If the property is
 *     already an accessor property, it is not repaired (because
 *     accessors are not subject to the override mistake).
 * <li>"*", in which case this property is not repaired but the
 *     value associated with that property are traversed and repaired.
 * <li>Another record, in which case this property is not repaired
 *     and that next record represents the disposition of the object
 *     which is its value. For example,{@code "FunctionPrototype"}
 *     leads to another record explaining which properties {@code
 *     Function.prototype} need to be repaired.
 *
 * <p>We factor out {@code true} into the constant {@code t} just to
 *    get a bit better readability.
 */

const t = true;

var enablements = {
  ObjectPrototype: '*',

  ArrayPrototype: '*',

  FunctionPrototype: {
    constructor: t, // set by "regenerator-runtime"
    bind: t, // set by "underscore"
    name: t,
    toString: t,
  },

  ErrorPrototype: {
    constructor: t, // set by "fast-json-patch"
    message: t,
    name: t, // set by "precond"
  },

  PromisePrototype: {
    constructor: t, // set by "core-js"
  },

  TypedArrayPrototype: '*',

  Generator: {
    constructor: t,
    name: t,
    toString: t,
  },

  IteratorPrototype: '*',
};

// Adapted from SES/Caja

const {
  defineProperties: defineProperties$2,
  getOwnPropertyNames,
  getOwnPropertyDescriptor: getOwnPropertyDescriptor$5,
  getOwnPropertyDescriptors: getOwnPropertyDescriptors$2,
} = Object;

const { ownKeys: ownKeys$1 } = Reflect;

function isObject(obj) {
  return obj !== null && typeof obj === 'object';
}

/**
 * For a special set of properties (defined in the enablement plan), it ensures
 * that the effect of freezing does not suppress the ability to override
 * these properties on derived objects by simple assignment.
 *
 * Because of lack of sufficient foresight at the time, ES5 unfortunately
 * specified that a simple assignment to a non-existent property must fail if
 * it would override a non-writable data property of the same name. (In
 * retrospect, this was a mistake, but it is now too late and we must live
 * with the consequences.) As a result, simply freezing an object to make it
 * tamper proof has the unfortunate side effect of breaking previously correct
 * code that is considered to have followed JS best practices, if this
 * previous code used assignment to override.
 */

// TODO exmplain parameters
function enablePropertyOverrides(intrinsics) {
  const detachedProperties = {};

  function enable(path, obj, prop, desc) {
    if ('value' in desc && desc.configurable) {
      const { value } = desc;

      detachedProperties[path] = value;

      // eslint-disable-next-line no-inner-declarations
      function getter() {
        return value;
      }

      // eslint-disable-next-line no-inner-declarations
      function setter(newValue) {
        if (obj === this) {
          throw new TypeError(
            `Cannot assign to read only property '${prop}' of '${path}'`,
          );
        }
        if (hasOwnProperty.call(this, prop)) {
          this[prop] = newValue;
        } else {
          defineProperties$2(this, {
            [prop]: {
              value: newValue,
              writable: true,
              enumerable: desc.enumerable,
              configurable: desc.configurable,
            },
          });
        }
      }

      defineProperties$2(obj, {
        [prop]: {
          get: getter,
          set: setter,
          enumerable: desc.enumerable,
          configurable: desc.configurable,
        },
      });
    }
  }

  function enableProperty(path, obj, prop) {
    const desc = getOwnPropertyDescriptor$5(obj, prop);
    if (!desc) {
      return;
    }
    enable(path, obj, prop, desc);
  }

  function enableAllProperties(path, obj) {
    const descs = getOwnPropertyDescriptors$2(obj);
    if (!descs) {
      return;
    }
    ownKeys$1(descs).forEach(prop => enable(path, obj, prop, descs[prop]));
  }

  function enableProperties(path, obj, plan) {
    for (const prop of getOwnPropertyNames(plan)) {
      const desc = getOwnPropertyDescriptor$5(obj, prop);
      if (!desc || desc.get || desc.set) {
        // No not a value property, nothing to do.
        // eslint-disable-next-line no-continue
        continue;
      }

      // Plan has no symbol keys and we use getOwnPropertyNames()
      // to avoid issues with stringification of property name.
      const subPath = `${path}.${prop}`;
      const subPlan = plan[prop];

      if (subPlan === true) {
        enableProperty(subPath, obj, prop);
      } else if (subPlan === '*') {
        enableAllProperties(subPath, desc.value);
      } else if (isObject(subPlan)) {
        enableProperties(subPath, desc.value, subPlan);
      } else {
        throw new TypeError(`Unexpected override enablement plan ${subPath}`);
      }
    }
  }

  // Do the repair.
  enableProperties('root', intrinsics, enablements);

  return detachedProperties;
}

/**
 * commons.js
 * Declare shorthand functions. Sharing these declarations across modules
 * improves on consistency and minification. Unused declarations are
 * dropped by the tree shaking process.
 *
 * We capture these, not just for brevity, but for security. If any code
 * modifies Object to change what 'assign' points to, the Compatment shim
 * would be corrupted.
 */

const {
  assign,
  freeze: objectFreeze,
  // Object.defineProperty is allowed to fail silentlty
  // so we use Object.defineProperties instead.
  defineProperties: defineProperties$3,
  getOwnPropertyDescriptor: getOwnPropertyDescriptor$6,
  getOwnPropertyNames: getOwnPropertyNames$1,
  getPrototypeOf: getPrototypeOf$3,
  setPrototypeOf,
  prototype: objectPrototype,
} = Object;

const { apply: apply$2, get: reflectGet, set: reflectSet } = Reflect;

const { isArray, prototype: arrayPrototype } = Array;
const { revocable: proxyRevocable } = Proxy;
const { prototype: regexpPrototype } = RegExp;
const { prototype: stringPrototype } = String;
const { prototype: weakmapPrototype } = WeakMap;

/**
 * uncurryThis()
 * This form of uncurry uses Reflect.apply()
 *
 * The original uncurry uses:
 * const bind = Function.prototype.bind;
 * const uncurryThis = bind.bind(bind.call);
 *
 * See those reference for a complete explanation:
 * http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
 * which only lives at
 * http://web.archive.org/web/20160805225710/http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
 */
const uncurryThis$2 = fn => (thisArg, ...args) => apply$2(fn, thisArg, args);

const objectHasOwnProperty = uncurryThis$2(objectPrototype.hasOwnProperty);
//
const arrayFilter = uncurryThis$2(arrayPrototype.filter);
const arrayJoin = uncurryThis$2(arrayPrototype.join);
const arrayPush = uncurryThis$2(arrayPrototype.push);
const arrayPop = uncurryThis$2(arrayPrototype.pop);
const arrayIncludes = uncurryThis$2(arrayPrototype.includes);
//
const regexpTest = uncurryThis$2(regexpPrototype.test);
//
const stringMatch = uncurryThis$2(stringPrototype.match);
const stringSearch = uncurryThis$2(stringPrototype.search);
const stringSlice = uncurryThis$2(stringPrototype.slice);
const stringSplit = uncurryThis$2(stringPrototype.split);
//
const weakmapGet = uncurryThis$2(weakmapPrototype.get);
const weakmapSet = uncurryThis$2(weakmapPrototype.set);
const weakmapHas = uncurryThis$2(weakmapPrototype.has);

/**
 * getConstructorOf()
 * Return the constructor from an instance.
 */
const getConstructorOf$1 = fn =>
  reflectGet(getPrototypeOf$3(fn), 'constructor');

/**
 * immutableObject
 * An immutable (frozen) exotic object and is safe to share.
 */
const immutableObject = objectFreeze({ __proto__: null });

/**
 * throwTantrum()
 * We'd like to abandon, but we can't, so just scream and break a lot of
 * stuff. However, since we aren't really aborting the process, be careful to
 * not throw an Error object which could be captured by child-Realm code and
 * used to access the (too-powerful) primal-realm Error object.
 */
function throwTantrum(message, err = undefined) {
  const msg = `please report internal shim error: ${message}`;

  // we want to log these 'should never happen' things.
  console.error(msg);
  if (err) {
    console.error(`${err}`);
    console.error(`${err.stack}`);
  }

  // eslint-disable-next-line no-debugger
  debugger;
  throw TypeError(msg);
}

/**
 * assert()
 */
function assert$1(condition, message) {
  if (!condition) {
    throwTantrum(message);
  }
}

/**
 * keywords
 * In JavaScript you cannot use these reserved words as variables.
 * See 11.6.1 Identifier Names
 */
const keywords = [
  // 11.6.2.1 Keywords
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',

  // Also reserved when parsing strict mode code
  'let',
  'static',

  // 11.6.2.2 Future Reserved Words
  'enum',

  // Also reserved when parsing strict mode code
  'implements',
  'package',
  'protected',
  'interface',
  'private',
  'public',

  // Reserved but not mentioned in specs
  'await',

  'null',
  'true',
  'false',

  'this',
  'arguments',
];

/**
 * identifierPattern
 * Simplified validation of indentifier names: may only contain alphanumeric
 * characters (or "$" or "_"), and may not start with a digit. This is safe
 * and does not reduces the compatibility of the shim. The motivation for
 * this limitation was to decrease the complexity of the implementation,
 * and to maintain a resonable level of performance.
 * Note: \w is equivalent [a-zA-Z_0-9]
 * See 11.6.1 Identifier Names
 */
const identifierPattern = new RegExp('^[a-zA-Z_$][\\w$]*$');

/**
 * isValidIdentifierName()
 * What variable names might it bring into scope? These include all
 * property names which can be variable names, including the names
 * of inherited properties. It excludes symbols and names which are
 * keywords. We drop symbols safely. Currently, this shim refuses
 * service if any of the names are keywords or keyword-like. This is
 * safe and only prevent performance optimization.
 */
function isValidIdentifierName(name) {
  // Ensure we have a valid identifier. We use regexpTest rather than
  // /../.test() to guard against the case where RegExp has been poisoned.
  return (
    name !== 'eval' &&
    !arrayIncludes(keywords, name) &&
    regexpTest(identifierPattern, name)
  );
}

/**
 * isImmutableDataProperty
 *
 */

function isImmutableDataProperty(obj, name) {
  const desc = getOwnPropertyDescriptor$6(obj, name);
  return (
    //
    // The getters will not have .writable, don't let the falsyness of
    // 'undefined' trick us: test with === false, not ! . However descriptors
    // inherit from the (potentially poisoned) global object, so we might see
    // extra properties which weren't really there. Accessor properties have
    // 'get/set/enumerable/configurable', while data properties have
    // 'value/writable/enumerable/configurable'.
    desc.configurable === false &&
    desc.writable === false &&
    //
    // Checks for data properties because they're the only ones we can
    // optimize (accessors are most likely non-constant). Descriptors can't
    // can't have accessors and value properties at the same time, therefore
    // this check is sufficient. Using explicit own property deal with the
    // case where Object.prototype has been poisoned.
    objectHasOwnProperty(desc, 'value')
  );
}

/**
 * getScopeConstants()
 * What variable names might it bring into scope? These include all
 * property names which can be variable names, including the names
 * of inherited properties. It excludes symbols and names which are
 * keywords. We drop symbols safely. Currently, this shim refuses
 * service if any of the names are keywords or keyword-like. This is
 * safe and only prevent performance optimization.
 */
function getScopeConstants(globalObject, localObject = {}) {
  // getOwnPropertyNames() does ignore Symbols so we don't need to
  // filter them out.
  const globalNames = getOwnPropertyNames$1(globalObject);
  const localNames = getOwnPropertyNames$1(localObject);

  // Collect all valid & immutable identifiers from the endowments.
  const localConstants = localNames.filter(
    name =>
      isValidIdentifierName(name) && isImmutableDataProperty(localObject, name),
  );

  // Collect all valid & immutable identifiers from the global that
  // are also not present in the endwoments (immutable or not).
  const globalConstants = globalNames.filter(
    name =>
      // Can't define a constant: it would prevent a
      // lookup on the endowments.
      !localNames.includes(name) &&
      isValidIdentifierName(name) &&
      isImmutableDataProperty(globalObject, name),
  );

  return [...globalConstants, ...localConstants];
}

/**
 * alwaysThrowHandler
 * This is an object that throws if any propery is called. It's used as
 * a proxy handler which throws on any trap called.
 * It's made from a proxy with a get trap that throws. It's safe to
 * create one and share it between all scopeHandlers.
 */
const alwaysThrowHandler = new Proxy(immutableObject, {
  get(shadow, prop) {
    throwTantrum(`unexpected scope handler trap called: ${String(prop)}`);
  },
});

/**
 * createScopeHandler()
 * ScopeHandler manages a Proxy which serves as the global scope for the
 * performEvaluate operation (the Proxy is the argument of a 'with' binding).
 * As described in createSafeEvaluator(), it has several functions:
 * - allow the very first (and only the very first) use of 'eval' to map to
 *   the real (unsafe) eval function, so it acts as a 'direct eval' and can
 *   access its lexical scope (which maps to the 'with' binding, which the
 *   ScopeHandler also controls).
 * - ensure that all subsequent uses of 'eval' map to the safeEvaluator,
 *   which lives as the 'eval' property of the safeGlobal.
 * - route all other property lookups at the safeGlobal.
 * - hide the unsafeGlobal which lives on the scope chain above the 'with'.
 * - ensure the Proxy invariants despite some global properties being frozen.
 */
function createScopeHandler(
  realmRec,
  globalObject,
  endowments = {},
  { sloppyGlobalsMode = false } = {},
) {
  return {
    // The scope handler throws if any trap other than get/set/has are run
    // (e.g. getOwnPropertyDescriptors, apply, getPrototypeOf).
    __proto__: alwaysThrowHandler,

    // This flag allow us to determine if the eval() call is an done by the
    // realm's code or if it is user-land invocation, so we can react differently.
    useUnsafeEvaluator: false,

    get(shadow, prop) {
      if (typeof prop === 'symbol') {
        return undefined;
      }

      // Special treatment for eval. The very first lookup of 'eval' gets the
      // unsafe (real direct) eval, so it will get the lexical scope that uses
      // the 'with' context.
      if (prop === 'eval') {
        // test that it is true rather than merely truthy
        if (this.useUnsafeEvaluator === true) {
          // revoke before use
          this.useUnsafeEvaluator = false;
          return realmRec.intrinsics.eval;
        }
        // fall through
      }

      // Properties of the global.
      if (prop in endowments) {
        // Use reflect to defeat accessors that could be
        // present on the endowments object itself as `this`.
        return reflectGet(endowments, prop, globalObject);
      }

      // Properties of the global.
      return reflectGet(globalObject, prop);
    },

    set(shadow, prop, value) {
      // Properties of the endowments.
      if (prop in endowments) {
        const desc = getOwnPropertyDescriptor$6(endowments, prop);
        if ('value' in desc) {
          // Work around a peculiar behavior in the specs, where
          // value properties are defined on the receiver.
          return reflectSet(endowments, prop, value);
        }
        // Ensure that the 'this' value on setters resolves
        // to the safeGlobal, not to the endowments object.
        return reflectSet(endowments, prop, value, globalObject);
      }

      // Properties of the global.
      return reflectSet(globalObject, prop, value);
    },

    // we need has() to return false for some names to prevent the lookup  from
    // climbing the scope chain and eventually reaching the unsafeGlobal
    // object (globalThis), which is bad.

    // todo: we'd like to just have has() return true for everything, and then
    // use get() to raise a ReferenceError for anything not on the safe global.
    // But we want to be compatible with ReferenceError in the normal case and
    // the lack of ReferenceError in the 'typeof' case. Must either reliably
    // distinguish these two cases (the trap behavior might be different), or
    // we rely on a mandatory source-to-source transform to change 'typeof abc'
    // to XXX. We already need a mandatory parse to prevent the 'import',
    // since it's a special form instead of merely being a global variable/

    // note: if we make has() return true always, then we must implement a
    // set() trap to avoid subverting the protection of strict mode (it would
    // accept assignments to undefined globals, when it ought to throw
    // ReferenceError for such assignments)

    has(shadow, prop) {
      // unsafeGlobal: hide all properties of the current global
      // at the expense of 'typeof' being wrong for those properties. For
      // example, in the browser, evaluating 'document = 3', will add
      // a property to globalObject instead of throwing a ReferenceError.
      if (
        sloppyGlobalsMode ||
        prop === 'eval' ||
        prop in endowments ||
        prop in globalObject ||
        prop in globalThis
      ) {
        return true;
      }

      return false;
    },

    // note: this is likely a bug of safari
    // https://bugs.webkit.org/show_bug.cgi?id=195534

    getPrototypeOf() {
      return null;
    },
  };
}

// Find the first occurence of the given pattern and return
// the location as the approximate line number.

function getLineNumber(src, pattern) {
  const index = stringSearch(src, pattern);
  if (index < 0) {
    return -1;
  }
  return stringSplit(stringSlice(src, 0, index), '\n').length;
}

// https://www.ecma-international.org/ecma-262/9.0/index.html#sec-html-like-comments
// explains that JavaScript parsers may or may not recognize html
// comment tokens "<" immediately followed by "!--" and "--"
// immediately followed by ">" in non-module source text, and treat
// them as a kind of line comment. Since otherwise both of these can
// appear in normal JavaScript source code as a sequence of operators,
// we have the terrifying possibility of the same source code parsing
// one way on one correct JavaScript implementation, and another way
// on another.
//
// This shim takes the conservative strategy of just rejecting source
// text that contains these strings anywhere. Note that this very
// source file is written strangely to avoid mentioning these
// character strings explicitly.

// We do not write the regexp in a straightforward way, so that an
// apparennt html comment does not appear in this file. Thus, we avoid
// rejection by the overly eager rejectDangerousSources.

const htmlCommentPattern = new RegExp(`(?:${'<'}!--|--${'>'})`);

function rejectHtmlComments(src) {
  const linenum = getLineNumber(src, htmlCommentPattern);
  if (linenum < 0) {
    return src;
  }
  throw new SyntaxError(
    `possible html comment syntax rejected around line ${linenum}`,
  );
}

// The proposed dynamic import expression is the only syntax currently
// proposed, that can appear in non-module JavaScript code, that
// enables direct access to the outside world that cannot be
// surpressed or intercepted without parsing and rewriting. Instead,
// this shim conservatively rejects any source text that seems to
// contain such an expression. To do this safely without parsing, we
// must also reject some valid programs, i.e., those containing
// apparent import expressions in literal strings or comments.

// The current conservative rule looks for the identifier "import"
// followed by either an open paren or something that looks like the
// beginning of a comment. We assume that we do not need to worry
// about html comment syntax because that was already rejected by
// rejectHtmlComments.

// this \s *must* match all kinds of syntax-defined whitespace. If e.g.
// U+2028 (LINE SEPARATOR) or U+2029 (PARAGRAPH SEPARATOR) is treated as
// whitespace by the parser, but not matched by /\s/, then this would admit
// an attack like: import\u2028('power.js') . We're trying to distinguish
// something like that from something like importnotreally('power.js') which
// is perfectly safe.

const importPattern = new RegExp('\\bimport\\s*(?:\\(|/[/*])');

function rejectImportExpressions(src) {
  const linenum = getLineNumber(src, importPattern);
  if (linenum < 0) {
    return src;
  }
  throw new SyntaxError(
    `possible import expression rejected around line ${linenum}`,
  );
}

// The shim cannot correctly emulate a direct eval as explained at
// https://github.com/Agoric/realms-shim/issues/12
// Without rejecting apparent direct eval syntax, we would
// accidentally evaluate these with an emulation of indirect eval. To
// prevent future compatibility problems, in shifting from use of the
// shim to genuine platform support for the proposal, we should
// instead statically reject code that seems to contain a direct eval
// expression.
//
// As with the dynamic import expression, to avoid a full parse, we do
// this approximately with a regexp, that will also reject strings
// that appear safely in comments or strings. Unlike dynamic import,
// if we miss some, this only creates future compat problems, not
// security problems. Thus, we are only trying to catch innocent
// occurrences, not malicious one. In particular, `(eval)(...)` is
// direct eval syntax that would not be caught by the following regexp.

const someDirectEvalPattern = new RegExp('\\beval\\s*(?:\\(|/[/*])');

function rejectSomeDirectEvalExpressions(src) {
  const linenum = getLineNumber(src, someDirectEvalPattern);
  if (linenum < 0) {
    return src;
  }
  const index = stringSearch(src, someDirectEvalPattern);
  const span = stringSlice(src, index - 100, index + 100);
  throw new SyntaxError(
    `possible direct eval expression rejected around line ${linenum} in span ${span}`,
  );
}

// Export a rewriter transform.
const mandatoryTransforms = {
  rewrite(rewriterState) {
    rejectHtmlComments(rewriterState.src);
    rejectImportExpressions(rewriterState.src);
    rejectSomeDirectEvalExpressions(rewriterState.src);
    return rewriterState;
  },
};

function applyTransforms(rewriterState, transforms) {
  // Rewrite the source, threading through rewriter state as necessary.
  for (const transform of transforms) {
    if (typeof transform.rewrite === 'function') {
      rewriterState = transform.rewrite(rewriterState);
    }
  }

  return rewriterState;
}

/**
 * buildOptimizer()
 * Given an array of indentifier, the optimizer return a `const` declaration
 * destructring `this`.
 */
function buildOptimizer(constants) {
  // No need to build an oprimizer when there are no constants.
  if (constants.length === 0) return '';
  // Use 'this' to avoid going through the scope proxy, which is unecessary
  // since the optimizer only needs references to the safe global.
  return `const {${arrayJoin(constants, ',')}} = this;`;
}

/**
 * makeEvaluateFactory()
 * The factory create 'evaluate' functions with the correct optimizer
 * inserted.
 */
function makeEvaluateFactory(realmRec, constants = []) {
  const optimizer = buildOptimizer(constants);

  // Create a function in sloppy mode, so that we can use 'with'. It returns
  // a function in strict mode that evaluates the provided code using direct
  // eval, and thus in strict mode in the same scope. We must be very careful
  // to not create new names in this scope

  // 1: we use 'with' (around a Proxy) to catch all free variable names. The
  // `this` value holds the Proxy which safely wraps the safeGlobal
  // 2: 'optimizer' catches constant variable names for speed.
  // 3: The inner strict function is effectively passed two parameters:
  //    a) its arguments[0] is the source to be directly evaluated.
  //    b) its 'this' is the this binding seen by the code being
  //       directly evaluated (the globalObject).
  // 4: The outer sloppy function is passed one parameter, the scope proxy.
  //    as the `this` parameter.

  // Notes:
  // - everything in the 'optimizer' string is looked up in the proxy
  //   (including an 'arguments[0]', which points at the Proxy).
  // - keywords like 'function' which are reserved keywords, and cannot be
  //   used as a variables, so they is not part to the optimizer.
  // - when 'eval' is looked up in the proxy, and it's the first time it is
  //   looked up after useUnsafeEvaluator is turned on, the proxy returns the
  //   eval intrinsic, and flips useUnsafeEvaluator back to false. Any reference
  //   to 'eval' in that string will get the tamed evaluator.

  return realmRec.intrinsics.Function(`
    with (this) {
      ${optimizer}
      return function() {
        'use strict';
        return eval(arguments[0]);
      };
    }
  `);
}

// Portions adapted from V8 - Copyright 2016 the V8 project authors.

/**
 * makeEvalFunction()
 * The low-level operation used by all evaluators:
 * eval(), Function(), Evalutator.prototype.evaluate().
 */
function performEval(
  realmRec,
  src,
  globalObject,
  endowments = {},
  {
    localTransforms = [],
    globalTransforms = [],
    sloppyGlobalsMode = false,
  } = {},
) {
  // Execute the mandatory transforms last to ensure that any rewritten code
  // meets those mandatory requirements.
  let rewriterState = { src, endowments };
  rewriterState = applyTransforms(rewriterState, [
    ...localTransforms,
    ...globalTransforms,
    mandatoryTransforms,
  ]);

  const scopeHandler = createScopeHandler(
    realmRec,
    globalObject,
    rewriterState.endowments,
    { sloppyGlobalsMode },
  );
  const scopeProxyRevocable = proxyRevocable(immutableObject, scopeHandler);
  // Ensure that "this" resolves to the scope proxy.

  const constants = getScopeConstants(globalObject, rewriterState.endowments);
  const evaluateFactory = makeEvaluateFactory(realmRec, constants);
  const evaluate = apply$2(evaluateFactory, scopeProxyRevocable.proxy, []);

  scopeHandler.useUnsafeEvaluator = true;
  let err;
  try {
    // Ensure that "this" resolves to the safe global.
    return apply$2(evaluate, globalObject, [rewriterState.src]);
  } catch (e) {
    // stash the child-code error in hopes of debugging the internal failure
    err = e;
    throw e;
  } finally {
    if (scopeHandler.useUnsafeEvaluator === true) {
      // The proxy switches off useUnsafeEvaluator immediately after
      // the first access, but if that's not the case we abort.
      throwTantrum('handler did not revoke useUnsafeEvaluator', err);
      // If we were not able to abort, at least prevent further
      // variable resolution via the scopeHandler.
      scopeProxyRevocable.revoke();
    }
  }
}

/**
 * makeEvalFunction()
 * A safe version of the native eval function which relies on
 * the safety of performEvaluate for confinement.
 */
const makeEvalFunction = (realmRec, globalObject, options = {}) => {
  // We use the the concise method syntax to create an eval without a
  // [[Construct]] behavior (such that the invocation "new eval()" throws
  // TypeError: eval is not a constructor"), but which still accepts a
  // 'this' binding.
  const newEval = {
    eval(x) {
      if (typeof x !== 'string') {
        // As per the runtime semantic of PerformEval [ECMAScript 18.2.1.1]:
        // If Type(x) is not String, return x.
        return x;
      }
      return performEval(realmRec, x, globalObject, {}, options);
    },
  }.eval;

  defineProperties$3(newEval, {
    toString: {
      value: () => `function eval() { [native code] }`,
      writable: false,
      enumerable: false,
      configurable: true,
    },
  });

  assert$1(
    getConstructorOf$1(newEval) !== Function,
    'eval constructor is Function',
  );
  assert$1(
    getConstructorOf$1(newEval) !== realmRec.intrinsics.Function,
    'eval contructions is %Function%',
  );

  return newEval;
};

/**
 * makeFunctionConstructor()
 * A safe version of the native Function which relies on
 * the safety of performEvaluate for confinement.
 */
function makeFunctionConstructor(realmRec, globaObject, options = {}) {
  // Define an unused parameter to ensure Function.length === 1
  // eslint-disable-next-line no-unused-vars
  const newFunction = function Function(body) {
    // Sanitize all parameters at the entry point.
    // eslint-disable-next-line prefer-rest-params
    const bodyText = `${arrayPop(arguments) || ''}`;
    // eslint-disable-next-line prefer-rest-params
    const parameters = `${arrayJoin(arguments, ',')}`;

    // Are parameters and bodyText valid code, or is someone
    // attempting an injection attack? This will throw a SyntaxError if:
    // - parameters doesn't parse as parameters
    // - bodyText doesn't parse as a function body
    // - either contain a call to super() or references a super property.
    // eslint-disable-next-line no-new
    new realmRec.intrinsics.Function(parameters, bodyText);

    // Safe to be combined. Defeat potential trailing comments.
    // TODO: since we create an anonymous function, the 'this' value
    // isn't bound to the global object as per specs, but set as undefined.
    const src = `(function anonymous(${parameters}\n) {\n${bodyText}\n})`;
    return performEval(realmRec, src, globaObject, {}, options);
  };

  defineProperties$3(newFunction, {
    // Ensure that any function created in any evaluator in a realm is an
    // instance of Function in any evaluator of the same realm.
    prototype: {
      value: realmRec.intrinsics.Function.prototype,
      writable: false,
      enumerable: false,
      configurable: false,
    },

    // Provide a custom output without overwriting
    // Function.prototype.toString which is called by some third-party
    // libraries.
    toString: {
      value: () => 'function Function() { [native code] }',
      writable: false,
      enumerable: false,
      configurable: true,
    },
  });

  // Assert identity of Function.__proto__ accross all compartments
  assert$1(getPrototypeOf$3(Function) === Function.prototype);
  assert$1(getPrototypeOf$3(newFunction) === Function.prototype);

  // Assert that the unsafe Function is not leaking
  assert$1(getConstructorOf$1(newFunction) !== Function);
  assert$1(getConstructorOf$1(newFunction) !== realmRec.intrinsics.Function);

  return newFunction;
}

/**
 * globalPropertyNames
 * Properties of the global object.
 */
const globalPropertyNames = [
  // *** 18.2 Function Properties of the Global Object

  'eval',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',

  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',

  // *** 18.3 Constructor Properties of the Global Object

  'Array',
  'ArrayBuffer',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Function',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Map',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Set',
  // 'SharedArrayBuffer'  // removed on Jan 5, 2018
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'URIError',
  'WeakMap',
  'WeakSet',

  // *** 18.4 Other Properties of the Global Object

  // 'Atomics', // removed on Jan 5, 2018
  'JSON',
  'Math',
  'Reflect',

  // *** Annex B

  'escape',
  'unescape',

  // ESNext

  'globalThis',
  'Compartment',
  'harden',
];

/**
 * createGlobalObject()
 * Create new global object using a process similar to ECMA specifications
 * (portions of SetRealmGlobalObject and SetDefaultGlobalBindings). The new
 * global object is not part of the realm record.
 */
function createGlobalObject(realmRec, { globalTransforms }) {
  const globalObject = {};

  // Immutable properties. Those values are shared between all realms.
  // *** 18.1 Value Properties of the Global Object
  const descs = {
    Infinity: {
      value: Infinity,
      enumerable: false,
    },
    NaN: {
      value: NaN,
      enumerable: false,
    },
    undefined: {
      value: undefined,
      enumerable: false,
    },
  };

  // *** 18.2, 18.3, 18.4 etc.
  for (const name of globalPropertyNames) {
    if (!objectHasOwnProperty(realmRec.intrinsics, name)) {
      // only create the global if the intrinsic exists.
      // eslint-disable-next-line no-continue
      continue;
    }

    let value;
    switch (name) {
      case 'eval':
        // Use an evaluator-specific instance of eval.
        value = makeEvalFunction(realmRec, globalObject, {
          globalTransforms,
        });
        break;

      case 'Function':
        // Use an evaluator-specific instance of Function.
        value = makeFunctionConstructor(realmRec, globalObject, {
          globalTransforms,
        });
        break;

      case 'globalThis':
        // Use an evaluator-specific circular reference.
        value = globalObject;
        break;

      default:
        value = realmRec.intrinsics[name];
    }

    descs[name] = {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    };
  }

  // Define properties all at once.
  defineProperties$3(globalObject, descs);

  assert$1(
    globalObject.eval !== realmRec.intrinsics.eval,
    'eval on global object',
  );
  assert$1(
    globalObject.Function !== realmRec.intrinsics.Function,
    'Function on global object',
  );

  return globalObject;
}

// The global intrinsics are the root named intrinsics (intrinsics that are
// direct properties of the global object).
//
// getGlobalIntrinsics(): Object
//
//  Return a record-like object similar to the [[intrinsics]] slot of the
//  realmRec in the ES specifications except for the following simpifications:
//
//  - we only returns the intrinsics that correspond to the global object
//    properties listed in 18.2, 18.3, or 18.4 of ES specifications.
//
//  - we use the name of the associated global object property instead of the
//    intrinsic name (usually, `<intrinsic name> === '%' + <global property
//    name>+ '%'`).
//
// Assumptions
//
// The intrinsic names correspond to the object names with "%" added as prefix and suffix, i.e. the intrinsic "%Object%" is equal to the global object property "Object".
const { getOwnPropertyDescriptor: getOwnPropertyDescriptor$7 } = Object;

/**
 * globalIntrinsicNames
 * The following subset contains only the intrinsics that correspond to the
 * global object properties listed in 18.2, 18.3, or 18.4 on ES specifications.
 */
const globalIntrinsicNames = [
  // *** 18.1 Value Properties of the Global Object

  // Ignore: those value properties are not intrinsics.

  // *** 18.2 Function Properties of the Global Object

  'eval',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',

  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',

  // *** 18.3 Constructor Properties of the Global Object

  'Array',
  'ArrayBuffer',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Function',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Map',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Set',
  // 'SharedArrayBuffer'  // removed on Jan 5, 2018
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'URIError',
  'WeakMap',
  'WeakSet',

  // *** 18.4 Other Properties of the Global Object

  // 'Atomics', // removed on Jan 5, 2018
  'JSON',
  'Math',
  'Reflect',

  // *** Annex B

  'escape',
  'unescape',

  // ESNext

  'globalThis',
  'Compartment',
  'harden',
];

/**
 * getGlobalIntrinsics()
 * Return a record-like object similar to the [[intrinsics]] slot of the
 * realmRec in the ES specifications except for this simpification:
 * - we only return the intrinsics that are own properties of the global object.
 * - we use the name of the associated global object property
 *   (usually, the intrinsic name is '%' + global property name + '%').
 */
function getGlobalIntrinsics() {
  const result = { __proto__: null };

  for (const name of globalIntrinsicNames) {
    const desc = getOwnPropertyDescriptor$7(globalThis, name);
    if (desc) {
      // Abort if an accessor is found on the unsafe global object
      // instead of a data property. We should never get into this
      // non standard situation.
      if ('get' in desc || 'set' in desc) {
        throw new TypeError(`Unexpected accessor on global property: ${name}`);
      }

      result[name] = desc.value;
    }
  }

  return result;
}

// Note: Instead of using a  safe*/unsafe* naming convention as a label to
// indentify sources of power, we simply use realmRec as the powerful object,
// and we always reference properties directly on it, which has the benefit
// of decreasing the number of moving parts.

let realmRec;

/**
 * getCurrentRealmRec()
 * Creates a realm-like record, minus what we don't need or can't emulate.
 * The realm record (ECMAScript 8.2) holds the intrinsics, the global
 * object, the global environment, etc.
 */
function getCurrentRealmRec() {
  if (realmRec) {
    return realmRec;
  }

  // We don't freeze the intrinsics record itself so it can be customized.
  const intrinsics = getGlobalIntrinsics();

  realmRec = {
    __proto__: null,
    intrinsics,
  };

  // However, we freeze the realm record for safety.
  return objectFreeze(realmRec);
}

/**
 * Compartment()
 * The Compartment constructor is a global. A host that wants to execute
 * code in a context bound to a new global creates a new compartment.
 */
const privateFields = new WeakMap();

class Compartment {
  constructor(endowments, modules, options = {}) {
    // Extract options, and shallow-clone transforms.
    const { transforms = [] } = options;
    const globalTransforms = [...transforms];

    const realmRec = getCurrentRealmRec();
    const globalObject = createGlobalObject(realmRec, {
      globalTransforms,
    });

    assign(globalObject, endowments);

    privateFields.set(this, {
      globalTransforms,
      globalObject,
    });
  }

  get global() {
    return privateFields.get(this).globalObject;
  }

  /**
   * The options are:
   * "x": the source text of a program to execute.
   */
  evaluate(x, options = {}) {
    // Perform this check first to avoid unecessary sanitizing.
    if (typeof x !== 'string') {
      throw new TypeError('first argument of evaluate() must be a string');
    }

    // Extract options, and shallow-clone transforms.
    const {
      endowments = {},
      transforms = [],
      sloppyGlobalsMode = false,
    } = options;
    const localTransforms = [...transforms];

    const { globalTransforms, globalObject } = privateFields.get(this);
    const realmRec = getCurrentRealmRec();
    return performEval(realmRec, x, globalObject, endowments, {
      globalTransforms,
      localTransforms,
      sloppyGlobalsMode,
    });
  }

  // eslint-disable-next-line class-methods-use-this
  toString() {
    return '[object Compartment]';
  }

  static toString() {
    return 'function Compartment() { [shim code] }';
  }
}

// Copyright (C) 2018 Agoric

let previousOptions;

function assert$2(condition, message) {
  if (!condition) {
    throw new TypeError(message);
  }
}

function lockdown(options = {}) {
  const {
    noTameDate = false,
    noTameError = false,
    noTameMath = false,
    noTameRegExp = false,
    registerOnly = false,
    ...extraOptions
  } = options;

  // Assert that only supported options were passed.

  const extraOptionsNames = Object.keys(extraOptions);
  assert$2(
    extraOptionsNames.length === 0,
    `lockdown(): non supported option ${extraOptionsNames.join(', ')}`,
  );

  // Asserts for multiple invocation of lockdown().

  const currentOptions = {
    noTameDate,
    noTameError,
    noTameMath,
    noTameRegExp,
    registerOnly,
  };
  if (previousOptions) {
    // Assert that multiple invocation have the same value
    Object.keys(currentOptions).forEach(name => {
      assert$2(
        currentOptions[name] === previousOptions[name],
        `lockdown(): cannot re-invoke with different option ${name}`,
      );
    });

    // Returning `false` indicates that lockdown() made no changes because it
    // was invokes from SES with the same options.
    return false;
  }
  previousOptions = currentOptions;

  /**
   * 1. TAME powers first.
   */

  tameFunctionConstructors();

  if (!noTameDate) {
    tameGlobalDateObject();
  }

  if (!noTameError) {
    tameGlobalErrorObject();
  }

  if (!noTameMath) {
    tameGlobalMathObject();
  }

  if (!noTameRegExp) {
    tameGlobalRegExpObject();
  }

  /**
   * 2. SHIM to expose the proposed APIs.
   */

  // Build a harden() with an empty fringe.
  const harden = makeHardener();

  // Add the API to the global object.
  Object.defineProperties(globalThis, {
    harden: {
      value: harden,
      configurable: true,
      writable: true,
      enumerable: false,
    },
    Compartment: {
      value: Compartment,
      configurable: true,
      writable: true,
      enumerable: false,
    },
  });

  /**
   * 3. WHITELIST to standardize the environment.
   */

  // Extract the intrinsics from the global.
  const intrinsics = getIntrinsics();

  // Remove non-standard properties.
  whitelistIntrinsics(intrinsics);

  // Repair problems with legacy accessors if necessary.
  repairLegacyAccessors();

  /**
   * 4. HARDEN to share the intrinsics.
   */

  // Circumvent the override mistake.
  const detachedProperties = enablePropertyOverrides(intrinsics);

  // Finally register and optionally freeze all the intrinsics. This
  // must be the operation that modifies the intrinsics.
  harden(intrinsics, registerOnly);
  harden(detachedProperties, registerOnly);

  // Returning `true` indicates that this is a JS to SES transition.
  return true;
}

export { lockdown };
