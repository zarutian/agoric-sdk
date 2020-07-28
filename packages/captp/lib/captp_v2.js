/* global harden */
 const makeCapTP = (ourId, send, connector, bootstrapObj=undefined) => {
    let connected = true; // :Bool
    const answers = new Map();
    const questions = new Map();
    const exports = new Map();
    const descsByValue = new WeakMap();

    const makeQuestion = (ifaceDescr=null) => {
      const qid = nextQuestionId();
      const rdr = {};
      const qdesc = ["yourAnswer", qid];
      const q = makeRemote(qdesc, ifaceDescr,
        (res, rej, resWpre) => {
          rdr.resolve = res;
          rdr.reject  = rej;
          rdr.resolveWithPresence = resWpre;
        });
      descsByValue.set(q, qdesc);
      return [qid, rdr, q];
    }

    const makeRemote = (tdesc, interfaceDescription, executor=()=>{}) => {
      const handler = {
        eventualGet: (_o, prop) => {
          const [qid, rdr, q] = makeQuestion(null);
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
          const [qid, rdr, q] = makeQuestion(null);
          send(["apply", Datum.coerce(qid), desc(rdr), tdesc, args.map(desc)]);
          return q;
        },
        eventualApplyOnly: (_o, args) => {
          send(["applyOnly", tdesc, args.map(desc)]);
        },
        eventualSend: (_o, verb, args) => {
          const [qid, rdr, q] = makeQuestion(null);
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
          return true;
      }
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
              const exportId = nextExportId();
              exports.set(exportId, value);
              descsByValue.set(value, ["myExport", exportId]);
              res = ["myNewExport", exportId, desc(null)];
              break;
            }
          case "function":
            // we are not .there() yet.
            /*
            
            */
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
            const exportId = nextExportId();
            exports.set(exportId, value);
            descsByValue.set(value, ["myExport", exportId]);
            const foid = ["myNewExport", exportId, desc(null)];
            return ["record", foid].concat(Object.entries(value).map(([k, v]) => [desc[k], desc[v]]));
        }
        // end of non-belong
        descsByValue.set(value, res);
        return res;
      } else {
        // passByProxy
        const exportId = nextExportId();
        exports.set(exportId, value);
        descsByValue.set(value, ["myExport", exportId]);
        if (isPromise(value)) {
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
          return ["myNewExport", exportId, desc(null)];
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
          const imported = makeRemote(importDesc, interfaceDescription);
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
        //
        case "array": return rest.map(dedesc);
        case "record": {
          const [oid, ...entries] = rest;
          const record = harden(Object.fromEntries(entries.map(([k, v]) => [dedesc(k), dedesc(v)])));
          descsByValue.set(record, oid);
          // todo: make record also a remote
          return record;
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
      if (Near.coerce(target) == target) {
        void E(target)[verb].apply(target, args);
        return;
      }
      const t = desc(target);
      const v = Datum.coerce(verb);
      const a = args.map(desc);
      send(harden(["sendOnly", t, v, a]));
    }
    const dispatch = (msg) => {
      // DeliverOnlyMsgTuple = Tuple[Str["sendOnly"],
      //                             target, verb, args]
      // GcAnswerMsgTuple = Tuple[Str["gcAnswer"],questionId]
      // GcExportMsgTuple = Tuple[Str["gcExport"],exportId]
      // AbortMsgTuple = Tuple[Str["abort"],Any]
      // msg :AnyOf[DeliverMsgTuple,
      //            DeliverOnlyMsgTuple,
      //            GcAnswerMsgTuple,
      //            GcExportMsgTuple,
      //            AbortMsgTuple]
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
          const [target, args] = rest;
        }; break;
        case "get": {
          const [qid, rdr, target, prop] = rest;
        }; break;
        case "setOnly": {
          const [target, prop, value] = rest;
           
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
          const [reason] = rest;
        }
      }
    }
    return harden({ abort, dispatch, getBootstrap, Near });
  }
