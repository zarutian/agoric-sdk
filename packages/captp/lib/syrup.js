/* global harden */

// See https://gitlab.com/spritely/syrup/-/blob/master/impls/racket/syrup/syrup.rkt

const makeDecodingGetter = (opt) => {
  const { eventualBytegetter,
          makeBytestring,
          makeString,
          makeSymbol,
          makeFloatSingle,
          makeFloatDouble, } = opt;
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
        return makeFloarDouble(payload);
    }
  }
  return harden(getter);
}
export { makeDecodingGetter }
