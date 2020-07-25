import fs from 'fs';
import path from 'path';
import parseArgs from 'minimist';
import process from 'process';
import { spawnSync } from 'child_process';
import { assert } from '@agoric/assert';

import anylogger from 'anylogger';

// Start a network service
import bundle from './bundle';
import initBasedir from './init-basedir';
import resetState from './reset-state';
import setGCIIngress from './set-gci-ingress';
import setFakeChain from './set-fake-chain';
import start from './start';

const log = anylogger('ag-solo');

// As we add more egress types, put the default types in a comma-separated
// string below.
const DEFAULT_EGRESSES = 'cosmos';
process.on('SIGINT', () => process.exit(99));

const AG_SOLO_BASEDIR =
  process.env.AG_SOLO_BASEDIR && path.resolve(process.env.AG_SOLO_BASEDIR);

function insistIsBasedir() {
  if (AG_SOLO_BASEDIR) {
    process.chdir(AG_SOLO_BASEDIR);
  }
  const basedir = fs.realpathSync('.');
  try {
    fs.statSync(path.join(basedir, 'solo-README.md'));
  } catch (e) {
    // eslint-disable-next-line no-throw-literal
    throw `${basedir} doesn't appear to be an ag-solo base directory`;
  }
  return basedir;
}

export default async function solo(progname, rawArgv) {
  log.debug('solo', rawArgv);
  const { _: argv, ...opts } = parseArgs(rawArgv, {
    stopEarly: true,
    boolean: ['help', 'version'],
  });

  if (opts.help) {
    process.stdout.write(`\
Usage: ${rawArgv[0]} COMMAND [OPTIONS...]

init
set-gci-ingress
start
`);
  }

  switch (argv[0]) {
    case 'init': {
      const { _: subArgs, ...subOpts } = parseArgs(argv.slice(1), {
        default: {
          webport: '8000',
          // If we're in Vagrant, default to listen on the VM's routable address.
          webhost: fs.existsSync('/vagrant') ? '0.0.0.0' : '127.0.0.1',
          egresses: DEFAULT_EGRESSES,
        },
      });
      const webport = Number(subOpts.webport);
      const { webhost, egresses } = subOpts;
      const basedir = subArgs[0] || AG_SOLO_BASEDIR;
      const subdir = subArgs[1];
      assert(basedir !== undefined, 'you must provide a BASEDIR');
      initBasedir(basedir, webport, webhost, subdir, egresses.split(','));
      await resetState(basedir);

      // TODO: We may want to give some instructions.  This is probably not the
      // right place to determine our context.
      // log.error(
      //   `Run '(cd ${basedir} && ${progname} start)' to start the vat machine`,
      // );
      break;
    }
    case 'set-gci-ingress': {
      const basedir = insistIsBasedir();
      const { _: subArgs, ...subOpts } = parseArgs(argv.slice(1), {});
      const GCI = subArgs[0];
      const chainID = subOpts.chainID || 'agoric';
      const rpcAddresses = subArgs.slice(1);
      setGCIIngress(basedir, GCI, rpcAddresses, chainID);
      break;
    }
    case 'set-fake-chain': {
      const basedir = insistIsBasedir();
      const { _: subArgs, role, delay } = parseArgs(argv.slice(1), {});
      const GCI = subArgs[0];
      setFakeChain(basedir, GCI, role, delay);
      break;
    }
    case 'start': {
      const basedir = insistIsBasedir();
      await start(basedir, argv.slice(1));
      break;
    }
    case 'reset-state': {
      const basedir = insistIsBasedir();
      await resetState(basedir);
      break;
    }
    case 'bundle': {
      await bundle(insistIsBasedir, argv.slice(1));
      break;
    }
    case 'upload-contract': {
      await bundle(insistIsBasedir, [`--evaluate`, ...argv]);
      break;
    }
    case 'register-http': {
      await bundle(insistIsBasedir, [`--evaluate`, ...argv]);
      break;
    }
    case 'calc-gci':
    case 'calc-rpcport': {
      const cp = spawnSync(`${__dirname}/../../${argv[0]}.js`, argv.slice(1), {
        stdio: 'inherit',
      });
      process.exit(cp.status);
      break;
    }
    default: {
      log.error(`unrecognized command ${argv[0]}`);
      log.error(`try one of: init, set-gci-ingress, start`);
    }
  }
}
