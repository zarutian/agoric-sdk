/* global harden */

import { E } from "@agoric/eventual-send";
import { TupleOf,
         AnyOf,
         StrOf,
         ArrayOf,
         AnyGuard, 
         StrGuard,
         NumberGuard,
         NatGuard,
         RegisteredSymbolGuard } from "@zarutian/ocaps/js/guards";

const Datum = AnyOf(NumberGuard, StrGuard);
const VerbGuard = AnyOf(StrGuard, RegisteredSymbolGuard);

// DeliverMsgTuple = Tuple[Str["send"], qid, rdr, target, verb, args]
const DeliverMsgTuple = TupleOf(StrOf("send"), NatGuard, DescOf("rdr"), DescOf("target"), VerbGuard, ArrayOf(DescOf("arg")));
// DeliverOnlyMsgTuple = Tuple[Str["sendOnly"], target, verb, args]
const DeliverOnlyMsgTuple = TupleOf(StrOf("sendOnly"), DescOf("target"), VerbGuard, ArrayOf(DescOf("arg")));
// GcAnswerMsgTuple = Tuple[Str["gcAnswer"], questionId]
const GcAnswerMsgTuple = TupleOf(StrOf("gcAnswer"), NatGuard);
// GcExportMsgTuple = Tuple[Str["gcExport"],exportId]
const GcExportMsgTuple = TupleOf(StrOf("gcExport"), NatGuard);
// AbortMsgTuple = Tuple[Str["abort"], Data]
const AbortMsgTuple = TupleOf(StrOf("abort"), DataGuard);
// msg :AnyOf[DeliverMsgTuple,
//            DeliverOnlyMsgTuple,
//            GcAnswerMsgTuple,
//            GcExportMsgTuple,
//            AbortMsgTuple]
const msgTuple = AnyOf(DeliverMsgTuple, DeliverOnlyMsgTuple, GcAnswerMsgTuple, GcExportMsgTuple, AbortMsgTuple);

const makeCapTP = (ourId, send, connector={fromOther:()=>false}, bootstrapObj=undefined) => {
    let connected = true; // :Bool
    const answers = new Map();
    const questions = new Map();
    const exports = new Map();
    const imports = new Map();
    const descsByValue = new WeakMap();
    const rejectors = new WeakList();

    const nextExportId = (() => {
      var exportIdCounter = 0;
      return () => {
        const exportId = exportIdCounter;
        exportIdCounter = exportIdCounter + 1;
        return exportId;
      };
    })();
    const nextQuestionId = (() => {
      var questionIdCounter = 0;
      return () => {
        const qid = questionIdCounter;
        questionIdCounter = questionIdCounter + 1;
        return qid;
      }
    })();

    const makeQuestion = (ifaceDescr=null) => {
      const qid = nextQuestionId();
      const rdr = {};
      const qdesc = ["yourAnswer", qid];
      const q = makeRemote(qdesc, ifaceDescr,
        (res, rej, resWpre) => {
          rdr.resolve = res;
          rdr.reject  = rej;
          rdr.resolveWithPresence = resWpre;
          rejectors.push(rej);
        });
      descsByValue.set(q, qdesc);
      return [qid, rdr, q];
    }

    const makeRemote = (tdesc, interfaceDescription=()=>{}, executor=()=>{}) => {
      const handler = {
        eventualGet: (_o, prop) => {
          const [qid, rdr, q] = makeQuestion(interfaceDescription("get", prop));
          send(["get", Datum.coerce(qid), desc(rdr), tdesc, Datum.coerce(prop)]);
          return q;
        },
        eventualGetOnly: (_o, prop) => {
          void handler.eventualGet(_o, prop);
        }
        eventualSet: (_o, prop, value) => {
          void handler.eventualSetOnly(_o, prop, value);
          return value;
        }
        eventualSetOnly: (_o, prop, value) => {
          send(["setOnly", tdesc, Datum.coerce(prob), desc(value)]);
        },
        eventualApply: (_o, args) => {
          const [qid, rdr, q] = makeQuestion(interfaceDescription("apply"));
          send(["apply", Datum.coerce(qid), desc(rdr), tdesc, args.map(desc)]);
          return q;
        },
        eventualApplyOnly: (_o, args) => {
          send(["applyOnly", tdesc, args.map(desc)]);
        },
        eventualSend: (_o, verb, args) => {
          const [qid, rdr, q] = makeQuestion(interfaceDescription("send", verb));
          send(["send", Datum.coerce(qid), desc(rdr), tdesc, Datum.coerce(verb), args.map(desc)]);
          return q;
        },
        eventualSendOnly: (_o, verb, args) => {
          send(["sendOnly", tdesc, Datum.coerce(verb), args.map(desc)]);
        }
      }
      const prom = Promise.delegate(executor, handler);
      return prom;
    }

    const isPromise = (specimen) => (specimen.then !== undefined);
    const isPassByCopy = (specimen) => {
      switch (typeof specimen) {
        case "number":
        case "string":
        case "boolean":
        case "bigint":
        case "undefined":
          return true;
        case "symbol":
          return (Symbol.keyFor(specimen) !== undefined);
        case "function":
          // todo: deal with nomadic functions&closures
          return false;
        case "object":
          if (specimen === null) { return true; }
          if (Array.isArray(specimen)) { return true; }
          // is the specimen a record?
          // btw, this preculdes that records could contain remoteable functions -Zarutian
          return Object.entries(specimen).reduce((a, [k, v]) => ( isPassByCopy(v) ? a : false ), true);
      }
    }
    const doExport = (value, ifaceDescr=null, newDesctag="myNewExport") => {
      const exportId = nextExportId();
      exports.set(exportId, value);
      descsByValue.set(value, ["myExport", exportId]);
      return [newDesctag, exportId, desc(ifaceDescr)];
    }
    const desc = (value) => {
      let res = descsByValue.get(value);
      if (res !== undefined) { return res; }
      if (isPassByCopy(value)) {
        // all this probably dont belong here:
        const type = (typeof value);
        switch (type) {
          case "undefined":
            res = ["undefined"]; break;
          case "number":
            if (value == Number.Nan) {
              res = ["nan"]; break;
            } else if (value == Number.NEGATIVE_INFINITY) {
              res = ["neginfinity"]; break;
            } else if (value == Number.POSITIVE_INFINITY) {
              res = ["posinfinity"]; break;
            }
          case "boolean":
          case "string":
            res = [type, value]; break;
          case "bigint":
            res = [type, value.toString(10)]; break;
          case "symbol":
            if ((const sym = Symbol.keyFor(value)) != undefined) {
              res = ["symbol", sym]; break;
            } else {
              res = doExport(value);
              break;
            }
          case "function":
            // we are not .there() yet.
            /*
            
            */
            res = doExport(value);
            break;
          case "object":
            if (value === null) {
              res = ["null"]; break;
            }
            if (Array.isArray(value)) {
              res = ["array"].concat(value.map(desc));
              break;
            }
            // I guess it is a record then
            // preserve object identity? yes
            const foid = doExport(value);
            return ["record", foid].concat(Object.entries(value).map(([k, v]) => [desc[k], desc[v]]));
        }
        // end of non-belong
        descsByValue.set(value, res);
        return res;
      } else {
        // passByProxy
        if (connector.fromOther(value)) {
          const [hostVatId, nonce, vine] = connector.getIntroP(ourId, value);
          return ["newPromise3VatIntro", DataGuard.coerce(hostVatId), Datum.coerce(nonce), desc(vine)];
        }
        if (isPromise(value)) {
          const exportId = nextExportId();
          exports.set(exportId, value);
          descsByValue.set(value, ["myExport", exportId]);
          const observerQid = nextQuestionId();
          const observer = Object.create(null);
          descsByValue.set(observer, ["yourAnswer", observerQid]);
          void value.then((res) => {
            void remoteSendOnly(observer, "resolve", [res]);
          }, (rej) => {
            void remoteSendOnly(observer, "reject", [rej]);
          });
          return ["myNewPromise", exportId, observerQid];
        } else {
          return doExport(value);
        }
      }
    }
    const dedesc = (desc) => {
      const [kind, ...rest] = desc;
      switch (kind) {
        case "yourExport": {
          let [exportId] = rest;
          exportId = Datum.coerce(exportId);
          return exports.get(exportId);
        }
        case "yourAnswer": {
          let [qid] = rest;
          qid = Datum.coerce(qid);
          return answers.get(qid);
        }
        case "myExport": {
          let [importId] = rest;
          importId = Datum.coerce(importId);
          return imports.get(importId);
        }; break;
        case "myNewExport": {
          const [importId, interfaceDescription] = rest;
          const importDesc = ["yourExport", importId];
          const imported = makeRemote(importDesc, interfaceDescription, (res, rej, resWpre) => { rejectors.push(rej); });
          descsByValue.set(imported, importDesc);
          imports.set(importId, imported);
          return imported;
        }; break;
        case "myNewPromise": {
          const [importId, resolverQuestionId] = rest;
          const importDesc = ["yourExport", importId];
          const rdr = {};
          const imported = makeRemote(importDesc, null,
            (res, rej, resWpre) => {
              rdr.resolve = res;
              rdr.reject  = rej;
              rdr.resolveWithPresence = resWpre;
              rejectors.push(rej);
            });
          const rdrDesc = ["myAnswer", resolverQuestionId];
          descsByValue.set(rdr, rdrDesc);
          answers.set(resolverQuestionId, rdr);
          descsByValue.set(imported, importDesc);
          imports.set(importId, imported);
          return imported;
        }
        case "myAnswer": {
          let [qid] = rest;
          qid = Datum.coerce(qid);
          return questions.get(qid);
        }
        // not quite sure if this is needed yet -Zarutian
        case "newPromise3VatIntro":
          let [hostVatId, nonce, vine] = rest;
          hostVatId = DataGuard.coerce(hostVatId);
          nonce = Datum.coerce(nonce);
          vine  = dedesc(vine);
          return connector.introP(ourId, hostVatId, nonce, vine);
        //
        case "array": return rest.map(dedesc);
        case "record": {
          const [oid, ...entries] = rest;
          const record = harden(Object.fromEntries(entries.map(([k, v]) => [dedesc(k), dedesc(v)])));
          return makeRemote(desc(dedesc(oid)), null, (resolve, reject, resoveWithPresence) => {
            rejectors.push(rej);
            resolveWithPresence(record);
          }); 
        }
        case "undefined": return undefined;
        case "null": return null;
        case "nan": return Number.NaN;
        case "posinfinity": return Number.POSITIVE_INFINITY;
        case "neginfinity": return Number.NEGATIVE_INFINITY;
        case "number":
        case "string":
        case "boolean":
          return rest[0];
        case "bigint":
          return BigInt(rest[0]);
      }
    };
    const remoteSendOnly = (target, verb, args) => {
      var isNear = true;
      Near.coerce(target, (_e) => { isNear = false; });
      if (isNear) {
        void E(target)[verb].apply(target, args);
        return;
      }
      const t = desc(target);
      const v = Datum.coerce(verb);
      const a = args.map(desc);
      send(harden(["sendOnly", t, v, a]));
    }
    const dispatch = (msg) => {
      if (!connected) { return false; }
      const [kind, ...rest] = msg;
      switch (kind) {
        case "send": {
          let [qid, rdr, target, verb, args] = rest;
          qid = Datum.coerce(qid);
          rdr = dedesc(rdr);
          target = dedesc(target);
          verb = Datum.coerce(verb);
          args = args.map(dedesc);
          const resultP = E(target)[verb].apply(target, args);
          answers.set(qid, resultP);
          void resultP.then((res) => {
            // below is equiv of: void E(rdr).resolve(res);
            void remoteSendOnly(rdr, "resolve", [res]);
          }, (rej) => {
            // below is equiv of: void E(rdr).reject(rej);
            void remoteSendOnly(rdr, "reject", [rej]);
          });
          return true;
        }; break;
        case "sendOnly": {
          let [target, verb, args] = rest;
          target = dedesc(target);
          verb   = Datum.coerce(verb);
          args   = args.map(dedesc);
          void E(target)[verb].apply(target, args);
          return true;
        }; break;
        case "apply": {
          let [qid, rdr, target, args] = rest;
          qid = Datum.coerce(qid);
          rdr = dedesc(rdr);
          target = dedesc(target);
          args = args.map(dedesc);
          const resultP = E(target).apply(target, args);
          // tbdetermed: E(t)(...args);
          answers.set(qid, resultP);
          void resultP.then((res) => {
            void remoteSendOnly(rdr, "resolve", [res]);
          }, (rej) => {
            void remoteSendOnly(rdr, "reject", [rej]);
          });
          return true;
        }; break;
        case "applyOnly": {
          let [target, args] = rest;
          target = dedesc(target);
          args   = args.map(dedesc);
          void E(target).apply(target, args);
        }; break;
        case "get": {
          let [qid, rdr, target, prop] = rest;
          qid = Datum.coerce(qid);
          rdr = dedesc(rdr);
          target = dedesc(target);
          prop = Datum.coerce(prop);
          const resultP = E(target)[prop];
          answers.set(qid, resultP);
          resultP.then((res) => {
            void remoteSendOnly(rdr, "resolve", [res]);
          }, (rej) => {
            void remoteSendOnly(rdr, "reject", [rej]);
          });
        }; break;
        case "setOnly": {
          let [target, prop, value] = rest;
          target = dedesc(target);
          prop   = Datum.coerce(prop);
          value  = dedesc(value);
          target[prop] = value;
        }; break;
        case "gcAnswer": {
          let [qid, refCount] = rest;
          qid = Datum.coerce(qid);
          // log("captp: gc answer ".concat(qid, " ", refCount));
          answers.delete(qid);
          return true;
        }; break;
        case "gcExport": {
          let [exportId, refCount] = rest;
          exportId = Datum.coerce(exportId);
          // log("captp: gc export ".concat(exportId, " ", refCount));
          exports.delete(exportId);
          return true;
        }; break;
        case "abort": {
          let [reason] = rest;
          reason = dedesc(reason);
          connected = false;
          // todo: go through all questions and imports and reject them with reason.
          rejectors.forEach((rej) => rej(reason));
        }
      }
    }
    // what is fundemental to boots? soles of course
    const sole = {};
    sole["bootstrap"] = (() => {
      if ((typeof bootstrapObj) == "function") {
        return bootstrapObj();
      } else {
        return bootstrapObj();
      }
    })();
    sole.vatId = ourId;
    doExport(sole); // will be at exportId 0n
    const getBootstrap = () => {
      const soleDesc = ["yourExport", 0n];
      const sole = makeRemote(soleDesc);
      descsByValue.set(sole, soleDesc);
      return E(sole).G("bootstrap");
    }
    const Near = harden({
      coerce: (specimen, ejector=(e)=>{ throw e; }) => {
        const desc = descsByValue.get(specimen);
        if (desc === undefined) {
          return specimen;
        } else {
          const [kind, ...rest] = desc;
          if ((kind === "myExport") ||
              (kind === "myAnswer")) {
            return specimen;
          } else {
            ejector(new Error("specimen not Near this vat (".concat(ourid, ")")));
          }
        }
      }
    });
    const Far = harden({
      coerce: (specimen, ejector) => {
        const desc = descsByValue.get(specimen);
        if (desc !== undefined) {
          if ((kind == "yourExport") ||
              (kind == "yourAnswer")) {
            return specimen;
          }
        }
        ejector(new Error("specimen is not a proxy for a remote object"));
      }
    }
    return harden({ abort, dispatch, getBootstrap, Near, Far});
}
export default makeCapTP;

// more experimental stuff:
const makeCapTPmanager = (ourId, portMaker, receptionist) => {
  return harden({ portReceptionist });
}
