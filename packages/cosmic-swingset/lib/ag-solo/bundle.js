/* eslint-disable no-await-in-loop */
import parseArgs from 'minimist';
import WebSocket from 'ws';
import { E, HandledPromise } from '@agoric/eventual-send';
import bundleSource from '@agoric/bundle-source';
import { importBundle } from '@agoric/import-bundle';
import { makeTransform } from '@agoric/transform-eventual-send';
import * as babelParser from '@agoric/babel-parser';
import babelGenerate from '@babel/generator';
import { makeCapTP } from '@agoric/captp/lib/captp';
import fs from 'fs';
import path from 'path';

const transformTildot = makeTransform(babelParser, babelGenerate);

const makePromise = () => {
  const pr = {};
  pr.p = new Promise((resolve, reject) => {
    pr.res = resolve;
    pr.rej = reject;
  });
  return pr;
};

const sendJSON = (ws, obj) => {
  if (ws.readyState !== ws.OPEN) {
    return;
  }
  // console.debug('sending', obj);
  ws.send(JSON.stringify(obj));
};

export default async function bundle(insistIsBasedir, args) {
  const {
    _: a,
    evaluate: evflag,
    input,
    once,
    output,
    'ag-solo': agSolo,
  } = parseArgs(args, {
    boolean: ['once', 'evaluate', 'input'],
    alias: { o: 'output', e: 'evaluate', i: 'input' },
    stopEarly: true,
  });

  // Default to evaluate.
  const evaluate = evflag || !output;

  const bundles = [];
  if (input) {
    const fileNames = a;
    for (const fileName of fileNames) {
      const contents = fs.promises.readFile(fileName, 'utf-8');
      bundles.push(JSON.parse(contents));
    }
  } else {
    const [mainModule, ...namePaths] = a;
    if (!mainModule) {
      console.error('You must specify a main module to bundle');
      return 1;
    }

    const bundled = {};
    let moduleFile = mainModule;
    if (moduleFile[0] !== '.' && moduleFile[0] !== '/') {
      moduleFile = `${__dirname}/${mainModule}.js`;
    }
    await Promise.all(
      [`main=${moduleFile}`, ...namePaths].map(async namePath => {
        const match = namePath.match(/^([^=]+)=(.+)$/);
        if (!match) {
          throw Error(`${namePath} isn't NAME=PATH`);
        }
        const name = match[1];
        const filepath = match[2];
        bundled[name] = await bundleSource(filepath);
        bundled[name].path = filepath;
      }),
    );
    bundles.push(bundled);

    if (output) {
      await fs.promises.writeFile(output, JSON.stringify(bundled), 'utf-8');
    }
  }

  if (!evaluate) {
    return 0;
  }

  let wsurl = agSolo;
  if (!agSolo) {
    const basedir = insistIsBasedir();
    const cjson = await fs.promises.readFile(
      path.join(basedir, 'connections.json'),
    );
    for (const conn of JSON.parse(cjson)) {
      if (conn.type === 'http') {
        wsurl = `ws://${conn.host}:${conn.port}/private/captp`;
      }
    }
  }

  const ws = new WebSocket(wsurl, { origin: 'http://127.0.0.1' });
  const exit = makePromise();
  ws.on('open', async () => {
    try {
      const { dispatch, getBootstrap } = makeCapTP('bundle', obj =>
        sendJSON(ws, obj),
      );
      ws.on('message', data => {
        try {
          const obj = JSON.parse(data);
          // console.debug('receiving', obj);
          if (obj.type === 'CTP_ERROR') {
            throw obj.error;
          }
          dispatch(obj);
        } catch (e) {
          console.error('server error processing message', data, e);
          exit.rej(e);
        }
      });

      // Wait for the chain to become ready.
      let boot = getBootstrap();
      console.error('Chain loaded:', await E.G(boot).LOADING);
      // Take a new copy, since the chain objects have been added to bootstrap.
      boot = getBootstrap();
      if (once) {
        if (await E(E.G(boot).READY).isReady()) {
          console.error('Singleton bundle already installed');
          ws.close();
          exit.res(1);
          return;
        }
      }

      for (const bundled of bundles) {
        const mainNS = await importBundle(bundle, {
          endowments: { require, HandledPromise },
          transforms: [transformTildot],
        });
        const main = mainNS.default;
        if (typeof main !== 'function') {
          console.error(`Bundle main does not have an export default function`);
          // eslint-disable-next-line no-continue
          continue;
        }

        const pathResolve = (...resArgs) =>
          path.resolve(path.dirname(bundled.main.path), ...resArgs);
        await main(boot, { bundleSource, pathResolve });
      }
      console.error('Done!');
      if (once) {
        await E(E.G(boot).READY).resolve('initialized');
      }
      ws.close();
      exit.res(0);
    } catch (e) {
      exit.rej(e);
    }
  });
  ws.on('close', (_code, _reason) => {
    // console.debug('connection closed');
    exit.res(1);
  });
  return exit.p;
}
