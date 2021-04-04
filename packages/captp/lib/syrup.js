/* global harden */

// See https://gitlab.com/spritely/syrup/-/blob/master/impls/racket/syrup/syrup.rkt

const makeDecodingGetter = (eventualBytegetter) => {
  const getter = async (self = getter) => {
    const first = await eventualBytegetter();
      var length = "";
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
        length = length.concat(first);
        while (true) {
          const byte = await eventualBytegetter();
        }
        break; // end the case
    }
  }
  return harden(getter);
}
export { makeDecodingGetter }
