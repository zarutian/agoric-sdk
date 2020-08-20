/* eslint-disable no-await-in-loop */
import { E, makeCapTP } from '@agoric/captp';
import { makePromiseKit } from '@agoric/promise-kit';
import bundleSource from '@agoric/bundle-source';
import path from 'path';

// note: CapTP has it's own HandledPromise instantiation, and the contract
// must use the same one that CapTP uses. We achieve this by not bundling
// captp, and doing a (non-isolated) dynamic import of the deploy script
// below, so everything uses the same module table. The eventual-send that
// our captp uses will the same as the one the deploy script imports, so
// they'll get identical HandledPromise objects.

// TODO: clean this up: neither captp nor eventual-send will export
// HandledPromise, eventual-send should behave a shims, whoever imports it
// first will cause HandledPromise to be added to globalThis. And actually
// HandledPromise will go away in favor of globalThis.Promise.delegate

const RETRY_DELAY_MS = 1000;

export default async function deployMain(progname, rawArgs, powers, opts) {
  const { anylogger, makeWebSocket } = powers;
  const console = anylogger('agoric:deploy');

  const args = rawArgs.slice(1);
  const provide = opts.provide
    .split(',')
    .map(dep => dep.trim())
    .filter(dep => dep);

  const need = opts.need
    .split(',')
    .map(dep => dep.trim())
    .filter(dep => dep && !provide.includes(dep));

  if (args.length === 0 && !provide.length) {
    console.error('you must specify at least one deploy.js (or --provide=XXX)');
    return 1;
  }

  const sendJSON = (ws, obj) => {
    if (ws.readyState !== ws.OPEN) {
      return;
    }
    const body = JSON.stringify(obj);
    console.debug('sendJSON', body.slice(0, 200));
    ws.send(body);
  };

  const wsurl = `ws://${opts.hostport}/private/captp`;
  const exit = makePromiseKit();
  let connected = false;
  process.stdout.write(`Open CapTP connection to ${wsurl}...`);
  let progressDot = '.';
  const progressTimer = setInterval(
    () => process.stdout.write(progressDot),
    1000,
  );
  const retryWebsocket = () => {
    const ws = makeWebSocket(wsurl, { origin: 'http://127.0.0.1' });
    ws.on('open', async () => {
      connected = true;
      try {
        console.debug('Connected to CapTP!');
        const { dispatch, getBootstrap } = makeCapTP('bundle', obj =>
          sendJSON(ws, obj),
        );
        ws.on('message', data => {
          try {
            const obj = JSON.parse(data);
            console.debug('receiving', data.slice(0, 200));
            if (obj.type === 'CTP_ERROR') {
              throw obj.error;
            }
            dispatch(obj);
          } catch (e) {
            console.error('server error processing message', data, e);
            exit.reject(e);
          }
        });

        // Wait for the chain to become ready.
        let bootP = getBootstrap();
        let lastUpdateCount;
        let stillLoading = [...need].sort();
        progressDot = 'o';
        while (stillLoading.length) {
          // Wait for the notifier to report a new state.
          process.stdout.write(progressDot);
          console.debug('need:', stillLoading.join(', '));
          const update = await E(E.G(bootP).loadingNotifier).getUpdateSince(
            lastUpdateCount,
          );
          lastUpdateCount = update.updateCount;
          const nextLoading = [];
          for (const dep of stillLoading) {
            if (update.value.includes(dep)) {
              // A dependency is still loading.
              nextLoading.push(dep);
            }
          }
          stillLoading = nextLoading;
        }

        clearInterval(progressTimer);
        process.stdout.write('\n');
        console.debug(JSON.stringify(need), 'loaded');
        // Take a new copy, since the chain objects have been added to bootstrap.
        bootP = getBootstrap();

        for (const arg of args) {
          const moduleFile = path.resolve(process.cwd(), arg);
          const pathResolve = (...resArgs) =>
            path.resolve(path.dirname(moduleFile), ...resArgs);
          console.warn('running', moduleFile);

          // use a dynamic import to load the deploy script, it is unconfined
          // eslint-disable-next-line import/no-dynamic-require,global-require
          const mainNS = require(pathResolve(moduleFile));
          const main = mainNS.default;
          if (typeof main !== 'function') {
            console.error(
              `${moduleFile} does not have an export default function main`,
            );
          } else {
            await main(bootP, {
              bundleSource: file => bundleSource(pathResolve(file)),
              pathResolve,
            });
          }
        }

        if (provide.length) {
          console.debug('provide:', provide.join(', '));
          await E(E.G(E.G(bootP).local).http).doneLoading(provide);
        }

        console.debug('Done!');
        ws.close();
        exit.resolve(0);
      } catch (e) {
        exit.reject(e);
      }
    });
    ws.on('close', (_code, _reason) => {
      console.debug('connection closed');
      if (connected) {
        exit.resolve(1);
      }
    });
    ws.on('error', e => {
      if (e.code === 'ECONNREFUSED' && !connected) {
        // Retry in a little bit.
        setTimeout(retryWebsocket, RETRY_DELAY_MS);
        return;
      }
      exit.reject(e);
    });
  };
  // Start the retry process.
  retryWebsocket();
  return exit.promise;
}
