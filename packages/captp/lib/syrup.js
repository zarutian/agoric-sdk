/* global harden */

// See https://gitlab.com/spritely/syrup/-/blob/master/impls/racket/syrup/syrup.rkt

const makeDecodingGetter = (opt) => {
  const { eventualBytegetter,
          makeBytestring,
          makeString,
          makeSymbol,
          makeFloatSingle,
          makeFloatDouble,
          makeDictionary,
          makeList,
          makeRecord,
          makeSet,
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
                case ':': return makeBytestring(payload);
                case '"': return makeString(payload);
                case "'": return makeSymbol(payload);
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
        return makeFloatSingle(payload);
      case 'D': // ieee double precision floating point number big endian
        const payload = await eventualBytegetter(8n);
        return makeFloatDouble(payload);
      case 'i': // integers
        var num = 0n;
        var sign = 0n;
        var signSet = false;
        while (true) {
          const byte = await eventualBytegetter(1n);
          switch (byte) {
            case '-':
              if (signSet) {
                throw new Error("syrup decode error #2");
              }
              signSet = true;
              sign = -1n;
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
                sign = 1n;
              }
              num = (num * 10n) + BigInt(Number.parse(byte, 10));
              break; // end of case
            case 'e':
              return (sign * num);
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
            return makeDictionary(payload);
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
            return makeList(payload);
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
            return makeRecord(tag, payload);
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
            return makeSet(payload);
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
export { makeDecodingGetter }
