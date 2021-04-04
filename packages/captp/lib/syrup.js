/* global harden */

// See https://gitlab.com/spritely/syrup/-/blob/master/impls/racket/syrup/syrup.rkt

const makeDecodingGetter = (opt) => {
  const { eventualBytegetter,
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
    const first = await eventualBytegetter(1n);
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
          const byte = await eventualBytegetter(1n);
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
            default:
              const payload = await eventualBytegetter(length);
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
        const payload = await eventualBytegetter(4n);
        return unmarshallFloatSingle(payload);
      case 'D': // ieee double precision floating point number big endian
        const payload = await eventualBytegetter(8n);
        return unmarshallFloatDouble(payload);
      case 'i': // integers
        var num = 0n;
        var sign = "";
        var signSet = false;
        while (true) {
          const byte = await eventualBytegetter(1n);
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
export { makeDecodingGetter };

const makeEncodingPutter = (opt) => {
  const { eventualByteputter,
          marshallers,
        } = opt;
  const innerPutter = (specimen) => {
    for (const marshaller of marshallers) {
      const mugshot = marshaller(specimen, innerPutter);
      if (mugshot !== undefined) {
        return mugshot;
      }
    }
    throw new Error("syrup encode error #0");
  };
  const putter = async (specimen) => {
    return await eventualByteputter(innerPutter(specimen));
  };
  return harden(putter);
}
export { makeEncodingPutter };

const eu8a = new Uint8Array.of(0);

const unmarshallBytestring = (bytes) => Uint8Array.from(bytes);
const marshallBytestring = (specimen, putter) => {
  if (typeof specimen == "object") {
    if (specimen instanceof Uint8Array) {
      const length = specimen.byteLength;
      return eu8a.concat(length.toString(10), ":", specimen);
    }
  }
  return undefined;
};

const utf8_TextDecoder = new TextDecoder("utf-8");
const utf8_TextEncoder = new TextEncoder();
const unmarshallString = (pl) => utf8_TextDecoder.decode(pl);
const marshalString = (specimen, putter) => {
  if (typeof specimen == "string") {
    const bytes = utf8_TextEncoder.encode(specimen);
    return eu8a.concat(bytes.byteLength.toString(10), '"', bytes);
  }
  return undefined;
}

const unmarshallSymbol = (pl) => {
  const symbolStr = utf8_TextDecoder.decode(pl);
  return Symbol.for(symbolStr);
}
const marshallSymbol = (specimen, putter) => {
  if (typeof specimen == "object") {
    if (specimen instanceof Symbol) {
      var symbolStr = Symbol.keyFor(specimen);
      const bytes = utf8_TextEncoder.encode(symbolStr);
      return eu8a.concat(bytes.byteLength.toString(10), "'", bytes);
    }
  }
  return undefined;
}

const unmarshallInteger = (sign, num) => (sign == "-") ? -num : num ;
const marshallInteger = (specimen, putter) => {
  const t = typeof specimen;
  if ((t == "number") || (t == "bigint")) {
    return eu8a.concat("i", specimen.toString(10), "e");
  }
  return undefined;
};
