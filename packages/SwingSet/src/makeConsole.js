export default function makeConsole(parentConsole) {
  const newConsole = {};
  const passThrough = [
    'log',
    'info',
    'warn',
    'error',
    'group',
    'groupEnd',
    'trace',
    'time',
    'timeLog',
    'timeEnd',
  ];
  // TODO: those are the properties that MDN documents. Node.js has a bunch
  // of additional ones that I didn't include, which might be appropriate.

  passThrough.forEach(name => {
    // TODO: do we reveal the presence/absence of these properties to the
    // child realm, thus exposing nondeterminism (and a hint of what platform
    // you might be on) when it is constructed with {consoleMode: allow} ? Or
    // should we expose the same set all the time, but silently ignore calls
    // to the missing ones, to hide that variation? We might even consider
    // adding console.* to the child realm all the time, even without
    // consoleMode:allow, but ignore the calls unless the mode is enabled.
    if (name in parentConsole) {
      newConsole[name] = parentConsole[name];
    }
  });

  return newConsole;
}
