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

const emptyDictionary = new Map();

/**
 * Create a CapTP connection.
 *
 * @param {string} ourId our name for the current side
 * @param {(obj: Record<string, any>) => void} rawSend send a Uint8Array packet
 * @param {any} bootstrapObj the object to export to the other side
 * @param {Partial<CapTPOptions>} opts options to the connection
 */
export function makeCapTP(ourId, rawSend, bootstrapObj = undefined, opts = {}) {
  const {
          otherImport3Desc = (specimen, writer) => undefined,
        } = opts;

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
  const exports   = new Map();     // key er okkar pos, val er local obj
  const imports   = new WeakMap(); // key er proxobj, val er þeirra pos

  const nextExportId = (() => {
    var counter = 1n;
    return harden(() => {
      const id = counter;
      counter = counter + 1n;
      return id;
    });
  })();
  const nextQuestionId = (() => {
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
              deliverOnly2remote(r["resolve-me-desc"], "resolve", [bootstrapObj], emptyDictionary);
              return undefined;
            });
  recStruct("op:deliver-only", ["to-desc", "method", "args", "kw-args"],
           // got a sendOnly delivery!
           (r) => {
             const target = E.sendOnly(r["to-desc"]);
             if (r.method == false) {
               target(...(r.args), r["kw-args"]);
             } else {
               target[r.method].apply(target, [...(r.args), r["kw-args"]]);
             }
             return undefined;
           });
  recStruct("op:deliver", ["to-desc", "method", "args", "kw-args", "answer-pos", "resolve-me-desc"],
           // got a send delivery!
           (r) => {
             const target = E(r["to-desc"]);
             var resultP;
             if (r.method == false) {
               resultP = target(...(r.args), r["kw-args"]);
             } else if ((r.method == true) || (r.method = Symbol.for("get")) {
               // tbd: ég veit það ekki hvort þetta sé sú rétta leið til að styðja eventual get eður ei
               resultP = E.get(r["to-desc"])[r.args];
             } else {
               resultP = target[r.method].apply(target, [...(r.args), r["kw-args"]]);
             }
             answers.set(r["answer-pos"], resultP);
             E.when(resultP, (result) => {
               deliverOnly2remote(r["resolve-me-desc"], "resolve", [result], emptyDictionary);
             }, (err) => {
               deliverOnly2remote(r["resolve-me-desc"], "reject", [err], emptyDictionary);
             });
             return undefined;
           });
  recStruct("op:abort",   ["reason"],
           // same reaction needed as for CTP_DISCONNECT in captp.js
           );
  recStruct("op:listen",  ["to-desc", "listener-desc", "wants-partial?"]); // er þörf á þessari aðgerð, já _on eða E.when() eða .then() eða áskrift að loforðs fyllingu
  recStruct("op:gc-export", ["export-pos", "wire-delta"],
           // todo: write a wire delta check but for now, just drop the export
           (r) => {
             exports.delete(r["export-pos"]);
             return undefined;
           });
  recStruct("op:gc-answer", ["answer-pos"], (r) => answers.delete(r["answer-pos"]));

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
  marshallers.push((specimen, writer) => {
    if (typeof specimen == "object") {
      const pos = imports.get(specimen);
      if (pos != undefined) {
        const { make } = recordMakers.get(Symbol.for("desc:export"));
        return writer(make(pos));
      }
    }
    return undefined;
  });

  marshallers.push((specimen, writer) => {
    // for 3vat handoff, ófullgert
    // otherImport3Desc
    return undefined;
  });

  recStruct("desc:import-object", ["pos"],
           (r) => {
             var obj = undefined;
             // not very efficient but a fast kludge to write
             (new Array(imports.entries()).forEach(
               ([o, p]) => {
                 if (r.pos == p) {
                   obj = o;
                 }
             });
             if (obj == undefined) {
               // a new thing being exported by the remote end
               obj = makeProxobj(r.pos);
               imports.set(obj, r.pos);
             }
             return obj;
           });
  recStruct("desc:import-promise", ["pos"],
           (r) => {
             var obj = undefined;
             // not very efficient but a fast kludge to write
             (new Array(imports.entries()).forEach(
               ([o, p]) => {
                 if (r.pos == p) {
                   obj = o;
                 }
             });
             if (obj == undefined) {
               // a new thing being exported by the remote end
               // todo: hvurnig er áskrift að loforðsfyllingu ætluð?
               //  + temp fix: .then sent á loforðið
               //    hugsanlega rétt leið: senda __whenMoreResolved(resolver.resolve) og
               //                                __whenBroken(resolver.reject) á loforðið
               { promise: obj, resolver } = makeProxPromise(r.pos);
               const { make: makeExpRec } = recordMakers.get(Symbol.for("desc:export"));
               const exp = makeExpRec(r.pos);
               // deliverOnly2remote(exp, "then", [resolver.resolve, resolver.reject], emptyDictionary);
               // deliverOnly2remote(exp, "__whenMoreResolved", [resolver.resolve], emptyDictionary);
               // deliverOnly2remote(exp, "__whenBroken", [resolver.reject], emptyDictionary);
               // hin rétta leið
               const { make } = recordMakers.get(Symbol.for("op:listen"));
               bytewriter(rwriter(make(exp, resolver, false)));
               imports.set(obj, r.pos);
             }
             return obj;
           });
  marshallers.push((specimen, writer) => {
    const pos = nextExportId();
    exports.set(pos, specimen);
    const makeSel = isPromise(specimen) ? "desc:import-promise" : "desc:import-object";
    const { make } = recordMakers.get(Symbol.for(makeSel));
    // always returns a mugshot, thence this marshaller must be the penultimate one
    return writer(make(pos));
  });

  const deliverOnly2remote = (target, verb, args, kwargs = emptyDictionary) => {
    const { make } = recordMakers.get(Symbol.for("op:deliver-only"));
    bytewriter(rwriter(make(target, verb, args, kwargs)));
  };
  const deliver2remote = (target, verb, args, kwargs = emptyDictionary) => {
    const spurnPos = nextQuestionId();
    const { promise: spurn, resolver } = makeProxPromise(spurnPos);
    const { make } = recordMakers.get(Symbol.for("op:deliver"));
    bytewriter(rwriter(make(target, verb, args, kwargs, spurnPos, resolver);
    return spurn;
  };

  const abort = (reason) => {
    const { make } = recordMakers.get(Symbol.for("op:abort"));
    bytewriter(rwriter(make(reason)));
  };

  return harden({ abort, dispatch, getBootstrap, serialize, unserialize, yourRemoteImport3Desc });
}
