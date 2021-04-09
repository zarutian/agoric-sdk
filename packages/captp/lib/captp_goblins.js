/* global harden */

import { E, HandledPromise } from '@agoric/eventual-send';
import { isPromise, makePromiseKit } from '@agoric/promise-kit';

export { E };

import { makeMarshallKit, marshallRecord } from "./syrup.js";

const idFunc = (thing) => thing;

const tagSym = new Symbol("tagSym");
const recordableStruct = (tagstr, memberNames, unmarshallTrap = idFunc) => {
  // þrjár leiðir að tilurð: make, makeFromObj, og unmarshall
  const sym = Symbol.for(tagstr);
  const make = (..args) => {
    const struct = {};
    struct[tagSym] = sym;
    memberNames.forEach((mn, i) => struct[mn] = args[i]);
    return harden(struct);
  };
  const makeFromObj = (obj) => make(.. memberNames.map(mn => obj[mn]));
  const marshall = (specimen, writer) => {
    if (typeof specimen == "object") {
      if (specimen[tagSym] == sym) {
        return marshallRecord(sym, memberNames.map(mn => specimen[mn]), writer);
      }
    }
    return undefined;
  };
  const unmarshallRecord = (tag, payload) => {
    if (tag != sym) { throw new Error("tbd: er etta villa?"); }
    return unmarshallTrap(make(payload));
  };
  return harden({ make, makeFromObj, unmarshallRecord, marshall, symbol: sym});
};

/**
 * Create a CapTP connection.
 *
 * @param {string} ourId our name for the current side
 * @param {(obj: Record<string, any>) => void} rawSend send a Uint8Array packet
 * @param {any} bootstrapObj the object to export to the other side
 * @param {Partial<CapTPOptions>} opts options to the connection
 */
export function makeCapTP(ourId, rawSend, bootstrapObj = undefined, opts = {}) {
  const bytewriter = rawSend;
  const {bytereader, dispatch} = (() => {
    var buffer = new Uint8Array(0);
    const pendingReads = [];
    const bytereader = (numOfBytes) => {
      const { promise, resolver } = makePromiseKit();
      const reread = () => {
        if (BigInt(buffer.byteLength) < BigInt(numOfBytes)) { return false; }
        const bytes = buffer.slice(0, numOfBytes);
        buffer = buffer.slice(numOfBytes);
        resolver.resolve(bytes);
        return true;
      };
      if (!reread()) {
        pendingReads.push(reread);
      }
      return promise;
    }
    const dispatch = (chunk) => {
      buffer = buffer.concat(chunk);
      do {
        const reread = pendingReads.shift();
        const framhald = reread();
        if (!framhald) { pendingReads.unshift(reread); }
      } while (framhald);
      return undefined
    };
    return { bytereader, dispatch };
  })();
  const recordMakers        = new Map();
  const recordUnmarshallers = new Map();
  const recordMarshallers   = new Array();
  const recStruct = (tagstr, memberNames, unmarshallTrap) => {
    const { make,
            makeFromObj,
            unmarshallRecord,
            marshall,
            symbol: sym} = recordableStruct(tagstr, memberNames, unmarshallTrap);
    recordMakers.set(sym, harden({ make, makeFromObj });
    recordUnmarshallers.set(sym, unmarshallRecord);
    recordMarshallers.push(marshall);
    return undefined;
  };
  const marshallRecord = (specimen, writer) => {
    for (marshall of recordMarshallers) {
      const mugshot = marshall(specimen, writer);
      if (mugshot != undefined) {
        return mugshot;
      }
    }
    return undefined;
  }
  const marshallers = [];
  
  // Frægu töflurnar fjórar
  const questions = new WeakMap(); // key er promise<obj>/obj, val er okkar answer pos
  const answers   = new Map();     // key er þeirra answer pos, val er promise<obj>
  const exports   = new Map();     // key er okkar pos, val er obj
  const imports   = new WeakMap(); // key er proxobj, val er þeirra pos

  const nextExportId = (() => {
    var counter = 1n;
    return harden(() => {
      const id = counter;
      counter = counter + 1n;
      return id;
    });
  })();

  recStruct("op:bootstrap", ["answer-pos", "resolve-me-desc"],
            // remote is asking for our bootstrap object
            (r) => {
              const promise = Promise.resolve(bootstrapObj);
              answers.set(r["answer-pos"], promise);
              deliverOnly2remote(r["resolve-me-desc"], "resolve", [bootstrapObj], undefined);
              return undefined;
            });
  recStruct("op:deliver-only", ["to-desc", "method", "args", "kw-args"]);
  recStruct("op:deliver", ["to-desc", "method", "args", "kw-args", "answer-pos", "resolve-me-desc"]);
  recStruct("op:abort",   ["reason"]);
  recStruct("op:listen",  ["to-desc", "listener-desc", "wants-partial?"]); // er þörf á þessari aðgerð
  recStruct("op:gc-export", ["export-pos", "wire-delta"]);
  recStruct("op:gc-answer", ["answer-pos"]);

  recStruct("desc:answer", ["pos"], (r) => answers.get(r.pos));
  marshallers.push((specimen, writer) => {
    const ourAnswerPos = questions.get(specimen);
    if (ourAnswerPos != undefined) {
      const { make } = recordMakers.get(Symbol.for("desc:answer"));
      return writer(make(ourAnswerPos));
    }
    return undefined;
  });

  recStruct("desc:export", ["pos"], (r) => exports.get(r.pos));

  recStruct("desc:import-object", ["pos"]);
  recStruct("desc:import-promise", ["pos"]);
  marshallers.push((specimen, writer) => {
    const pos = nextExportId();
    exports.set(pos, specimen);
    const makeSel = isPromise(specimen) ? "desc:import-promise" : "desc:import-object";
    const { make } = recordMakers.get(Symbol.for(makeSel));
    // always returns a mugshot, thence this marshaller must be the penultimate one
    return writer(make(pos));
  });

  


  return harden({ abort, dispatch, getBootstrap, serialize, unserialize });
}
