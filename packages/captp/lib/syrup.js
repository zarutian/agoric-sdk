/* global harden */

// See https://gitlab.com/spritely/syrup/-/blob/master/impls/racket/syrup/syrup.rkt

const makeDecodingReader = (opt) => {
  const { bytereader,
          unmarshallBytestring,
          unmarshallString,
          unmarshallSymbol,
          unmarshallFloatSingle,
          unmarshallFloatDouble,
          unmarshallInteger,
          unmarshallDictionary,
          unmarshallList,
          unmarshallRecord,
          unmarshallSet,
        } = opt;
  const dictionaryEndSentiel = harden({});
  const listEndSentiel = harden({});
  const recordEndSentiel = harden({});
  const setEndSentiel = harden({});
  const getter = async (self = getter) => {
    const first = await bytereader(1n);
      var length = 0n;
    switch (first) {
      case '1': // fallthrough
      case '2': // fallthrough
      case '3': // fallthrough
      case '4': // fallthrough
      case '5': // fallthrough
      case '6': // fallthrough
      case '7': // fallthrough
      case '8': // fallthrough
      case '9':
        length = (length * 10n) + BigInt(Number.parse(first, 10));
        while (true) {
          const byte = await bytereader(1n);
          switch (byte) {
            case '0': // fallthrough -start-
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8': // fallthrough -end-
            case '9':
              length = (length * 10n) + BigInt(Number.parse(first, 10));
              break; // end of case
            // catern's suggestion -upphaf-
            case "+":
              return unmarshallInteger("", length);
            case "-":
              return unmarshallInteger("-", length);
            // -lok-
            default:
              const payload = await bytereader(length);
              switch (byte) {
                case ':': return unmarshallBytestring(payload);
                case '"': return unmarshallString(payload);
                case "'": return unmarshallSymbol(payload);
                default:
                  throw new Error("syrup decoding error #1");
              }
              break; // end of default case
          }
        }
        break; // end the case
      case 't': return true;
      case 'f': return false;
      case 'F': // ieee single precision floating point number big endian
        const payload = await bytereader(4n);
        return unmarshallFloatSingle(payload);
      case 'D': // ieee double precision floating point number big endian
        const payload = await bytereader(8n);
        return unmarshallFloatDouble(payload);
      case 'i': // integers
        var num = 0n;
        var sign = "";
        var signSet = false;
        while (true) {
          const byte = await bytereader(1n);
          switch (byte) {
            case '-':
              if (signSet) {
                throw new Error("syrup decode error #2");
              }
              signSet = true;
              sign = "-";
              break; // end of case
            case '0': // fallthrough -start-
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8': // fallthrough -end-
            case '9':
              if (!signSet) {
                signSet = true;
              }
              num = (num * 10n) + BigInt(Number.parse(byte, 10));
              break; // end of case
            case 'e':
              return unmarshallInteger(sign, num);
            default:
              throw new Error("syrup decode error #3");
          }
        }
        break; // end of case
      case '{': // dictionaries|maps|assoc_arrays et ceterata;
        const payload = new Array();
        while (true) {
          const key = await self(getter);
          if (key === dictionaryEndSentiel) {
            return unmarshallDictionary(payload);
          }
          const val = await self(getter);
          payload.push([key, value]);
        }
        break; // end of case
      case '}': return dictionaryEndSentiel;
      case '[': // lists|arrays|sequences osfv
        const payload = new Array();
        while (true) {
          const val = await self(getter);
          if (val === listEndSentiel) {
            return unmarshallList(payload);
          }
          payload.push(val);
        }
        break; // end of case
      case ']': return listEndSentiel;
      case '<': // records
        const tag = await self(getter);
        const payload = new Array();
        while (true) {
          const val = await self(getter);
          if (val === recordEndSentiel) {
            return unmarshallRecord(tag, payload);
          }
          payload.push(val);
        }
        break; // end of case
      case '>': return recordEndSentiel;
      case '#': // sets
        const payload = new Array();
        while (true) {
          const val = await self(getter);
          if (val === setEndSentiel) {
            return unmarshallSet(payload);
          }
          payload.push(val);
        }
        break; // end of case
      case '$': return setEndSentiel;
      default:
        throw new Error("syrup decode error #0");
    }
  }
  return harden(getter);
}
export { makeDecodingReader };

const makeEncodingWriter = (opt) => {
  const { bytewriter,
          marshallers,
        } = opt;
  const innerwriter = (specimen) => {
    for (const marshaller of marshallers) {
      const mugshot = marshaller(specimen, innerwriter);
      if (mugshot !== undefined) {
        return mugshot;
      }
    }
    throw new Error("syrup encode error #0");
  };
  const writer = async (specimen) => {
    return await bytewriter(innerwriter(specimen));
  };
  return harden(writer);
}
export { makeEncodingWriter };

const eu8a = new Uint8Array.of(0);

const unmarshallBytestring = (bytes) => Uint8Array.from(bytes);
const marshallBytestring = (specimen, writer) => {
  if (typeof specimen == "object") {
    if (specimen instanceof Uint8Array) {
      const length = specimen.byteLength;
      return eu8a.concat(length.toString(10), ":", specimen);
    }
  }
  return undefined;
};
export { unmarshallBytestring, marshallBytestring };

const utf8_TextDecoder = new TextDecoder("utf-8");
const utf8_TextEncoder = new TextEncoder();
const unmarshallString = (pl) => utf8_TextDecoder.decode(pl);
const marshalString = (specimen, writer) => {
  if (typeof specimen == "string") {
    const bytes = utf8_TextEncoder.encode(specimen);
    return eu8a.concat(bytes.byteLength.toString(10), '"', bytes);
  }
  return undefined;
}
export { unmarshallString, marshallString };

const sym2str = new Map();
const str2sym = new Map();
(() => {
  [
    ["Symbol.asyncIterator",      Symbol.asyncIterator],
    ["Symbol.hasInstance",        Symbol.hasInstance],
    ["Symbol.isConcatSpreadable", Symbol.isConcatSpreadable],
    ["Symbol.iterator",           Symbol.iterator],
    ["Symbol.match",              Symbol.match],
    ["Symbol.matchAll",           Symbol.matchAll],
    ["Symbol.replace",            Symbol.replace],
    ["Symbol.search",             Symbol.search],
    ["Symbol.split",              Symbol.split],
    ["Symbol.species",            Symbol.species],
    ["Symbol.toPrimitive",        Symbol.toPrimitive],
    ["Symbol.toStringTag",        Symbol.toStringTag],
    ["Symbol.unscopables",        Symbol.unscopables],
  ].forEach([key, val] => {
    str2sym.set(key, val);
    sym2str.set(val, key);
  });
})();
const unmarshallSymbol = (pl) => {
  const symbolStr = utf8_TextDecoder.decode(pl);
  if (str2sym.has(symbolStr)) {
    return str2sym.get(symbolStr);
  }
  return Symbol.for(symbolStr);
}
const marshallSymbol = (specimen, writer) => {
  if (typeof specimen == "object") {
    if (specimen instanceof Symbol) {
      var symbolStr;
      if (sym2str.has(specimen)) {
        symbolStr = sym2str.get(specimen);
      } else {
        symbolStr = Symbol.keyFor(specimen);
      }
      const bytes = utf8_TextEncoder.encode(symbolStr);
      return eu8a.concat(bytes.byteLength.toString(10), "'", bytes);
    }
  }
  return undefined;
}
export { unmarshallSymbol, marshallSymbol };

const unmarshallInteger = (sign, num) => {
  const numb = (num < Number.MAX_SAFE_INTEGER) ? (Number(num)).valueOf() : num ;
  return (sign == "-") ? -numb : numb ;
};
const marshallInteger = (specimen, writer) => {
  const t = typeof specimen;
  if ((t == "number") || (t == "bigint")) {
    if ((t == "number") && (!Number.isInteger(specimen)) {
      return undefined;
    }
    return eu8a.concat("i", specimen.toString(10), "e");
  }
  return undefined;
};
export { unmarshallInteger, marshallInteger };

const byteStrComp = (alfa, beta) => {
  // þarfaverk: klára þennan samabera
  var a = alfa[0];
  var b = beta[0];
  var r = 0;
  a = (a === undefined) ? 0 : a;
  b = (b === undefined) ? 0 : b;
  if (a == b) {
    return byteStrComp(a.slice(1), b.slice(1));
  }
  r = (a < b) ? -1 : +1 ;
  return r;
};

const unmarshallDictionary = (payload) => new Map(payload);
const marshallDictionary = (specimen, writer) => {
  if (typeof specimen == "object") {
    if (specimen instanceof Map) {
      const entries = new Array(specimen.entries());
      const encodedEntries = entries.map([key, val] => [writer(key), writer(val)]).sort(
        ([akey, aval], [bkey, bval]) => byteStrComp(akey, bkey),
      ).reduce(
        (acc, [key, val]) => acc.concat(key, val),
        eu8a );
      return eu8a.concat("{", encodedEntries, "}");
    }
  }
  return undefined;
};
export { unmarshallDictionary, marshallDictionary };

const unmarshallList = (pl) => pl; // pl is allready an array
const marshallList = (specimen, writer) => {
  if (Array.isArray(specimen)) {
    const encodedEntries = specimen.reduce((acc, item) => acc.concat(writer(item)), eu8a);
    return eu8a.concat("[", encodedEntries, "]");
  }
  return undefined;
};
export { unmarshallList, marshallList };

const unmarshallSet = (pl) => new Set(pl);
const marshallSet = (specimen, writer) => {
  if (typeof specimen == "object") {
    if (specimen instanceof Set) {
      const items = new Array(specimen.values());
      const encodedItems = items.map(writer).sort(byteStrComp).reduce((acc, item) => acc.concat(item), eu8a);
      return eu8a.concat("#", encodedItems, "$"); 
    }
  }
  return undefined;
}
export { unmarshallSet, marshallSet };

const unmarshallFloatSingle = (payloadBytes) => {
  const scratch = new ArrayBuffer(16);
  const scratchBytes = new Uint8Array(scratch);
  const scratchData = new DataView(scratch);
  scratchBytes.set(payloadBytes);
  return scratchData.getFloat32(0, false); // big end
};
const unmarshallFloatDouble = (payloadBytes) => {
  const scratch = new ArrayBuffer(16);
  const scratchBytes = new Uint8Array(scratch);
  const scratchData = new DataView(scratch);
  scratchBytes.set(payloadBytes);
  return scratchData.getFloat64(0, false); // big end
};
const marshallFloat = (specimen, writer) => {
  if (typeof specimen == "number") {
    if (!Number.isInteger(specimen)) {
      const scratch = new ArrayBuffer(16);
      const scratchBytes = new Uint8Array(scratch);
      const scratchData = new DataView(scratch);
      scratchData.setFloat64(0, specimen, false); // big end
      const encodedItem = scratchBytes.slice(0, 8);
      return eu8a.concat("D", encodedItem); 
    }
  }
  return undefined;
};

const sjálfgefa = (obj, prop, defaultValue) => {
  if (obj[prop] == undefined) {
    obj[prop] = defaultValue;
  }
};
const krefjast = (obj, prop, villumelding) => {
  if (obj[prop] == undefined) {
    throw new Error(villumelding);
  }
}

const makeMarshallKit = (opts) => {
  const opt = new Object(opts);
  sjálfgefa(opt, "unmarshallBytestring", unmarshallBytestring);
  sjálfgefa(opt, "unmarshallString",     unmarshallString);
  sjálfgefa(opt, "unmarshallSymbol",     unmarshallSymbol);
  sjálfgefa(opt, "unmarshallFloatSingle", unmarshallFloatSingle);
  sjálfgefa(opt, "unmarshallFloatDouble", unmarshallFloatDouble);
  sjálfgefa(opt, "unmarshallInteger",    unmarshallInteger);
  sjálfgefa(opt  "unmarshallDictionary", unmarshallDictionary);
  sjálfgefa(opt  "unmarshallList",       unmarshallList);
  sjálfgefa(opt, "unmarshallSet",        unmarshallSet);
  krefjast(opt, "marshallRecord", "marshallRecord not given");
  krefjast(opt, "unmarshallRecord", "unmarshallRecord not given");
  sjálfgefa(opt, "extraPreMarshallers", []);
  sjálfgefa(opt, "extraPostMarshallers", []);
  const { marshallRecord,
          extraPreMarshallers,
          extraPostMarshallers} = opt;
  const marshallers = [...extraPreMarshallers,
                       marshallBytestring,
                       marshallString,
                       marshallSymbol,
                       marshallFloat,  /* Single,
                       marshallFloatDouble, */
                       marshallInteger,
                       marshallDictionary,
                       marshallList,
                       marshallSet,
                       marshallRecord];
  sjálfgefa(opt, "marshallers", marshallers);
  krefjast(opt, "bytereader", "bytereader not given");
  krefjast(opt, "bytewriter", "bytewriter not given");

  const reader = makeDecodingReader(opt);
  const writer = makeEncodingWriter(opt);
  return harden({ reader, writer });
}
export {makeMarshallKit}
