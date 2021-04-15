/* global harden */

import { E, HandledPromise } from '@agoric/eventual-send';
import { isPromise, makePromiseKit } from '@agoric/promise-kit';

export { E };

import { makeMarshallKit, marshallRecord } from "./syrup.js";
import { WeakBiMap, BiMap } from "./bimap.js";

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
 * @typedef {Object} CapTPOptions the options to makeCapTP
 * @property {(err: any) => void} onReject
 * @property {typeof defaultRemotable} Remotable
 *  property {typeof defaultFar} Far                 \ spurning um þetta tvennt þar se syrup er notað í staðinn
 *  property {typeof defaultMakeMarshal} makeMarshal /
 * @property {number} epoch toBeInvestigated: getur þetta verið BigInt?
 */
/**
 * Create a CapTP connection.
 *
 * @param {string} ourId our name for the current side
 * @param {(obj: Record<string, any>) => void} rawSend send a Uint8Array packet
 * @param {any} bootstrapObj the object to export to the other side
 * @param {Partial<CapTPOptions>} opts options to the connection
 */
export function makeCapTP(ourId, rawSend, bootstrapObj = undefined, opts = {}) {
  var {
        otherImport3Desc = (specimen, writer) => undefined,
        periodicRepeater,
      } = opts;
  const doPeriodicCallbacks = (() => {
    const periodicCallbacks = [];
    if (periodicRepeater === undefined) {
      periodicRepeater = (callback) => {
        periodicCallbacks.push(callback);
      }
    }
    return harden(() => periodicCallbacks.forEach(callback => { try { callback(); } });
  })();

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
      doPeriodicCallbacks();
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
  
  const qopts = {
    finalizer: ( qpos ) => {
      skrifOp("op:gc-answer", qpos);
    },
    periodicRepeater,
  };
  const imopts = {
    finalizer: ( impos ) => {
      skrifOp("op:gc-import", impos, false);
    },
    periodicRepeater,
  };

  // Frægu töflurnar fjórar
  const questions = WeakBiMap([], qopts);  // key er promise<obj>/obj, val er okkar answer pos
  const answers   = BiMap();               // key er þeirra answer pos, val er promise<obj>
  const exports   = BiMap();               // key er okkar pos, val er local obj
  const imports   = WeakBiMap([], imopts); // key er proxobj, val er þeirra pos

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
  // er þörf á þessari aðgerð, já _on eða E.when() eða .then() eða áskrift að loforðs fyllingu
  recStruct("op:listen",  ["to-desc", "listener-desc", "wants-partial?"],
            (r) => {
              E.when(r["to-desc"],
                (result) => {
                  deliverOnly2remote(r["listener-desc"], "resolve", [result], emptyDictionary);
                },
                (err) => {
                  deliverOnly2remote(r["listener-desc"], "reject", [err], emptyDictionary);
                },
              );
            }); 
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
             var obj = imports.getByValue(r.pos);
             if (obj == undefined) {
               // a new thing being exported by the remote end
               obj = makeProxobj(r.pos);
               imports.set(obj, r.pos);
             }
             return obj;
           });
  recStruct("desc:import-promise", ["pos"],
           (r) => {
             var obj = imports.getByValue(r.pos);
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
               // hin rétta leið:
               skrifOp("op:listen", exp, resolver, false);
               imports.set(obj, r.pos);
             }
             return obj;
           });
  marshallers.push((specimen, writer) => {
    var pos = exports.getByValue(specimen);
    if (pos == undefined) {
      pos = nextExportId();
      exports.set(pos, specimen);
    }
    const makeSel = isPromise(specimen) ? "desc:import-promise" : "desc:import-object";
    const { make } = recordMakers.get(Symbol.for(makeSel));
    // always returns a mugshot, thence this marshaller must be the penultimate one
    return writer(make(pos));
  });
  // varnagli;
  marshallers.push((specimen, writer) => throw new Error("execution should never reach this point"));

  const makeProxPromise = (myQuestionPos) => {
    const { make: answerDescMake } = recordMakers.get(Symbol.for("desc:answer"));
    const myQuestionDesc = answerDescMake(myQuestionPos);
    const handler  = {
      applyMethod(_o, verb, innstoumligk) {
        // hvurnig fá kwargs?
        // seinasta stak í args kanske?
        // const [...args, kwargs] = innstoumligk;
        const args = innstoumligk;
        return deliver2remote(myQuestionDesc, verb, args, kwargs);
      }
    };
    const resolver = {}; // mutable object
    const proxProm = new HandledPromise((resolve, reject, resolveWithPresence) => {
      resolver.resolve = resolve;
      resolver.reject  = reject;
      resolver.resolveWithPresence = resolveWithPresence;
    }, handler);
    
    return harden({ promise: proxProm, resolver: harden(resolver) });
  };

  const deliverOnly2remote = (target, verb, args, kwargs = emptyDictionary) => {
    skrifOp("op:deliver-only", target, verb, args, kwargs));
  };
  const deliver2remote = (target, verb, args, kwargs = emptyDictionary) => {
    const spurnPos = nextQuestionId();
    const { promise: spurn, resolver } = makeProxPromise(spurnPos);
    skrifOp("op:deliver", target, verb, args, kwargs, spurnPos, resolver);
    return spurn;
  };

  const { writer: skrif, reader: les } = makeMarshallKit({
    bytewriter,
    bytereader,
    extraPostMarshallers: marshallers,
    marshallRecord,
  });
  const skrifOp = (symstr, ...args) => {
    const { make } = recordMakers.get(Symbol.for(symstr));
    return skrif(make(...args));
  };

  const abort = (reason) => {
    skrifOp("op:abort", reason);
  };

  // spurning um að láta dispatch drífa þetta í stað þessarar loforðalykkju
  const lesLykkja = () => {
    E.when(
      les(),
      opResult => {
        lesLykkja();
      },
      opError => {
      }
    );
  };
  lesLykkja();

  return harden({ abort, dispatch, getBootstrap, serialize, unserialize, yourRemoteImport3Desc });
}
