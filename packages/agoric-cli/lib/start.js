import path from 'path';
import chalk from 'chalk';
import { createHash } from 'crypto';

import {
  STAKING_DENOM,
  MINT_DENOM,
  finishCosmosConfig,
  finishCosmosGenesis,
} from './chain-config';

const PROVISION_COINS = `100000000${STAKING_DENOM},100000000${MINT_DENOM},100provisionpass,100sendpacketpass`;
const DELEGATE0_COINS = `50000000${STAKING_DENOM}`;
const CHAIN_ID = 'agoric';

const FAKE_CHAIN_DELAY =
  process.env.FAKE_CHAIN_DELAY === undefined
    ? 0
    : Number(process.env.FAKE_CHAIN_DELAY);
const PORT = process.env.PORT || 8000;
const HOST_PORT = process.env.HOST_PORT || PORT;
const CHAIN_PORT = process.env.CHAIN_PORT || 26657;

export default async function startMain(progname, rawArgs, powers, opts) {
  const { anylogger, fs, spawn, os, process } = powers;
  const log = anylogger('agoric:start');

  const pspawnEnv = { ...process.env };
  const pspawn = (
    cmd,
    cargs,
    { stdio = 'inherit', env = pspawnEnv, ...rest } = {},
  ) => {
    log.debug(chalk.blueBright(cmd, ...cargs));
    const cp = spawn(cmd, cargs, { stdio, env, ...rest });
    const pr = new Promise((resolve, _reject) => {
      cp.on('exit', resolve);
      cp.on('error', () => resolve(-1));
    });
    pr.cp = cp;
    return pr;
  };

  let keysSpawn;
  if (opts.sdk) {
    keysSpawn = (args, ...rest) =>
      pspawn('ag-cosmos-helper', [`--home=_agstate/keys`, ...args], ...rest);
  } else {
    keysSpawn = (args, ...rest) =>
      pspawn(
        'docker',
        [
          'run',
          `--volume=${process.cwd()}:/usr/src/dapp`,
          `--rm`,
          `-it`,
          `--entrypoint=ag-cosmos-helper`,
          'agoric/agoric-sdk',
          `--home=/usr/src/dapp/_agstate/keys`,
          ...args,
        ],
        ...rest,
      );
  }

  // Translate {inspectBrk: brkOpt} into [`--inspect-brk=${brkOpt}`]
  const debugOpts = [];
  for (const [prop, value] of Object.entries(opts)) {
    if (prop.startsWith('inspect')) {
      const name = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (value === true) {
        debugOpts.push(`--${name}`);
      } else {
        debugOpts.push(`--${name}=${value}`);
      }
    }
  }

  const capture = (spawner, args, show = false) => {
    const capret = [
      spawner(args, { stdio: ['inherit', 'pipe', 'inherit'] }),
      '',
    ];
    capret[0].cp.stdout.on('data', chunk => {
      if (show) {
        process.stdout.write(chunk);
      }
      capret[1] += chunk.toString('utf-8');
    });
    return capret;
  };

  const showKey = keyName =>
    capture(keysSpawn, [
      'keys',
      'show',
      keyName,
      '-a',
      '--keyring-backend=test',
    ]);

  const exists = async file => {
    try {
      await fs.stat(file);
      return true;
    } catch (e) {
      return false;
    }
  };

  let agSolo;
  let agSetupSolo;
  let agServer;
  if (opts.sdk) {
    agSolo = path.resolve(__dirname, '../../cosmic-swingset/bin/ag-solo');
    agSetupSolo = path.resolve(__dirname, '../../cosmic-swingset/setup-solo');
  } else {
    agSolo = `${process.cwd()}/node_modules/@agoric/cosmic-swingset/bin/ag-solo`;
  }

  async function startFakeChain(profileName, _startArgs, popts) {
    const fakeDelay =
      popts.delay === undefined ? FAKE_CHAIN_DELAY : Number(popts.delay);

    if (!opts.sdk) {
      if (
        !(await exists('node_modules/@agoric/cosmic-swingset')) &&
        !(await exists(
          '_agstate/agoric-servers/node_modules/@agoric/cosmic-swingset',
        ))
      ) {
        log.error(`you must first run '${progname} install'`);
        return 1;
      }
    }

    const fakeGCI = 'sim-chain';
    if (!(await exists(agServer))) {
      log(chalk.yellow(`initializing ${profileName}`));
      await pspawn(
        agSolo,
        ['init', profileName, '--egresses=fake', `--webport=${HOST_PORT}`],
        {
          cwd: '_agstate/agoric-servers',
        },
      );
    }

    if (fakeDelay >= 0) {
      log(chalk.yellow(`setting sim chain with ${fakeDelay} second delay`));
      await pspawn(
        agSolo,
        ['set-fake-chain', '--role=two_chain', `--delay=${fakeDelay}`, fakeGCI],
        {
          cwd: agServer,
        },
      );
    }

    if (!popts.restart) {
      // Don't actually run the chain.
      return 0;
    }

    const ps = pspawn(agSolo, [...debugOpts, 'start', '--role=two_client'], {
      cwd: agServer,
    });
    process.on('SIGINT', () => ps.cp.kill('SIGINT'));
    return ps;
  }

  async function startLocalChain(profileName, startArgs, popts) {
    const IMAGE = `agoric/agoric-sdk`;

    const portNum = startArgs[0] === undefined ? CHAIN_PORT : startArgs[0];
    if (`${portNum}` !== `${Number(portNum)}`) {
      log.error(`Argument to local-chain must be a port number`);
      return 1;
    }
    const localAgServer = `${agServer}-${portNum}`;

    if (popts.pull) {
      const exitStatus = await pspawn('docker', ['pull', IMAGE]);
      if (exitStatus) {
        return exitStatus;
      }
    }

    if (popts.reset) {
      log(chalk.green(`removing ${localAgServer}`));
      // rm is available on all the unix-likes, so use it for speed.
      await pspawn('rm', ['-rf', localAgServer]);
    }

    let chainSpawn;
    if (popts.sdk) {
      chainSpawn = (args, spawnOpts = undefined) =>
        pspawn(
          'ag-chain-cosmos',
          [...args, `--home=${localAgServer}`],
          spawnOpts,
        );
    } else {
      chainSpawn = (args, spawnOpts = undefined, dockerArgs = []) =>
        pspawn(
          'docker',
          [
            'run',
            `--volume=${process.cwd()}:/usr/src/dapp`,
            `--rm`,
            ...dockerArgs,
            `-it`,
            IMAGE,
            ...args,
            `--home=/usr/src/dapp/${localAgServer}`,
          ],
          spawnOpts,
        );
    }

    if (!(await exists(localAgServer))) {
      const exitStatus = await chainSpawn([
        'init',
        'local-chain',
        `--chain-id=${CHAIN_ID}`,
      ]);
      if (exitStatus) {
        return exitStatus;
      }
    }

    // Get or create the essential addresses.
    const addrs = {};
    for (const keyName of ['delegate0', 'provision']) {
      /* eslint-disable no-await-in-loop */
      let capret = showKey(keyName);
      if (await capret[0]) {
        const exitStatus = await keysSpawn([
          'keys',
          'add',
          keyName,
          '--keyring-backend=test',
        ]);
        if (exitStatus) {
          return exitStatus;
        }
        capret = showKey(keyName);
        const status2 = await capret[0];
        if (status2) {
          return status2;
        }
      }
      addrs[keyName] = capret[1].trimRight();
      /* eslint-enable no-await-in-loop */
    }

    const genesisFile = `${localAgServer}/config/genesis.json`;
    if (!(await exists(`${genesisFile}.stamp`))) {
      let exitStatus;
      await chainSpawn([
        'add-genesis-account',
        addrs.provision,
        PROVISION_COINS,
      ]);
      if (exitStatus) {
        return exitStatus;
      }
      await chainSpawn([
        'add-genesis-account',
        addrs.delegate0,
        DELEGATE0_COINS,
      ]);
      if (exitStatus) {
        return exitStatus;
      }
      const keysHome = opts.sdk
        ? `_agstate/keys`
        : `/usr/src/dapp/_agstate/keys`;
      exitStatus = await chainSpawn([
        'gentx',
        `--home-client=${keysHome}`,
        '--keyring-backend=test',
        '--name=delegate0',
        `--amount=${DELEGATE0_COINS}`,
      ]);
      if (exitStatus) {
        return exitStatus;
      }
      exitStatus = await chainSpawn(['collect-gentxs']);
      if (exitStatus) {
        return exitStatus;
      }
      exitStatus = await chainSpawn(['validate-genesis']);
      if (exitStatus) {
        return exitStatus;
      }
      exitStatus = await fs.writeFile(`${genesisFile}.stamp`, Date.now());
      if (exitStatus) {
        return exitStatus;
      }
    }

    // Complete the genesis file and launch the chain.
    log('read ag-chain-cosmos config');
    const configFile = `${localAgServer}/config/config.toml`;
    const [genesisJson, configToml] = await Promise.all([
      fs.readFile(genesisFile, 'utf-8'),
      fs.readFile(configFile, 'utf-8'),
    ]);
    const newGenesisJson = finishCosmosGenesis({
      genesisJson,
    });
    const newConfigToml = finishCosmosConfig({
      configToml,
      portNum,
    });

    const create = (fileName, contents) => {
      log('create', fileName);
      return fs.writeFile(fileName, contents);
    };

    // Calculate the GCI for the updated genesis.json.
    const hashFile = `${genesisFile}.sha256`;
    const gci = createHash('sha256')
      .update(newGenesisJson)
      .digest('hex');

    // Save all the files to disk.
    await Promise.all([
      create(configFile, newConfigToml),
      create(genesisFile, newGenesisJson),
      create(hashFile, gci),
    ]);

    return chainSpawn(
      [...debugOpts, 'start', '--pruning=nothing'],
      {
        env: { ...pspawnEnv, ROLE: 'two_chain' },
      },
      // Accessible via either localhost or host.docker.internal
      [`--publish=${portNum}:${portNum}`, `--name=agoric/n0`],
    );
  }

  async function startLocalSolo(profileName, startArgs, popts) {
    const IMAGE = `agoric/agoric-sdk`;

    const portNum = startArgs[0] === undefined ? PORT : startArgs[0];
    if (`${portNum}` !== `${Number(portNum)}`) {
      log.error(`Argument to local-solo must be a port number`);
      return 1;
    }
    const localAgServer = `${agServer}-${portNum}`;

    if (popts.pull) {
      const exitStatus = await pspawn('docker', ['pull', IMAGE]);
      if (exitStatus) {
        return exitStatus;
      }
    }

    if (popts.reset) {
      log(chalk.green(`removing ${localAgServer}`));
      // rm is available on all the unix-likes, so use it for speed.
      await pspawn('rm', ['-rf', localAgServer]);
    }

    let soloSpawn;
    if (popts.sdk) {
      soloSpawn = (args, spawnOpts = undefined) =>
        pspawn(agSolo, args, spawnOpts);
    } else {
      soloSpawn = (args, spawnOpts = undefined, dockerArgs = []) =>
        pspawn(
          'docker',
          [
            'run',
            `--volume=${process.cwd()}:/usr/src/dapp`,
            `--rm`,
            ...dockerArgs,
            `-it`,
            `--entrypoint=${agSolo}`,
            ...dockerArgs,
            IMAGE,
            `--home=/usr/src/dapp/${localAgServer}`,
            ...args,
          ],
          spawnOpts,
        );
    }

    // Initialise the solo directory and key.
    if (!(await exists(localAgServer))) {
      const initArgs = [`--webport=${portNum}`];
      if (!opts.sdk) {
        initArgs.push(`--webhost=0.0.0.0`);
      }
      const exitStatus = await soloSpawn(['init', localAgServer, ...initArgs]);
      if (exitStatus) {
        return exitStatus;
      }
    }

    const spawnOpts = {};
    if (popts.sdk) {
      spawnOpts.cwd = localAgServer;
    }

    const rpcAddrs = [`localhost:${CHAIN_PORT}`];
    if (!popts.sdk) {
      rpcAddrs.push(`host.docker.internal:${CHAIN_PORT}`);
    }

    let exitStatus;

    // Connect to the chain.
    const gciFile = `_agstate/agoric-servers/local-chain-${CHAIN_PORT}/config/genesis.json.sha256`;
    const gci = (await fs.readFile(gciFile, 'utf-8')).trimRight();
    exitStatus = await soloSpawn(
      ['set-gci-ingress', `--chainID=${CHAIN_ID}`, gci, rpcAddrs.join(',')],
      spawnOpts,
    );
    if (exitStatus) {
      return exitStatus;
    }

    // Provision the ag-solo, if necessary.
    const soloAddr = (
      await fs.readFile(`${localAgServer}/ag-cosmos-helper-address`, 'utf-8')
    ).trimRight();
    for (const rpcAddr of rpcAddrs) {
      // eslint-disable-next-line no-await-in-loop
      const egressNeeded = await keysSpawn([
        'query',
        'swingset',
        'egress',
        soloAddr,
        `--chain-id=${CHAIN_ID}`,
        `--node=tcp://${rpcAddr}`,
      ]);
      if (egressNeeded) {
        // We need to provision our address.
        const capret = capture(
          keysSpawn,
          [
            'tx',
            'swingset',
            'provision-one',
            '--keyring-backend=test',
            '--from=provision',
            '--gas=auto',
            '--gas-adjustment=1.5',
            '--broadcast-mode=block',
            '--yes',
            `--chain-id=${CHAIN_ID}`,
            `--node=tcp://${rpcAddr}`,
            `local-solo-${portNum}`,
            soloAddr,
          ],
          true,
        );
        // eslint-disable-next-line no-await-in-loop
        exitStatus = await capret[0];
        if (!exitStatus && !capret[1].includes('code: 0')) {
          exitStatus = 2;
        }
      }
      if (!exitStatus) {
        break;
      }
    }
    if (exitStatus) {
      return exitStatus;
    }

    // Now actually start the solo.
    return soloSpawn(['start', '--role=two_client'], spawnOpts, [
      `--publish=${portNum}:${portNum}`,
    ]);
  }

  async function startTestnetDocker(profileName, startArgs, popts) {
    const IMAGE = `agoric/cosmic-swingset-setup-solo`;

    if (popts.pull) {
      const exitStatus = await pspawn('docker', ['pull', IMAGE]);
      if (exitStatus) {
        return exitStatus;
      }
    }

    const setupRun = (...bonusArgs) =>
      pspawn('docker', [
        'run',
        `-p127.0.0.1:${HOST_PORT}:${PORT}`,
        `--volume=${process.cwd()}:/usr/src/dapp`,
        `-eAG_SOLO_BASEDIR=/usr/src/dapp/${agServer}`,
        `--rm`,
        `-it`,
        IMAGE,
        `--webport=${PORT}`,
        `--webhost=0.0.0.0`,
        ...bonusArgs,
        ...startArgs,
      ]);

    if (!(await exists(agServer))) {
      const exitStatus = await setupRun('--no-restart');
      if (exitStatus) {
        return exitStatus;
      }
    }

    return setupRun();
  }

  async function startTestnetSdk(profileName, startArgs) {
    const virtEnv = path.resolve(
      `_agstate/agoric-servers/ve3-${os.platform()}-${os.arch()}`,
    );
    if (!(await exists(`${virtEnv}/bin/pip`))) {
      const exitStatus = await pspawn('python3', ['-mvenv', virtEnv], {
        cwd: agSetupSolo,
      });
      if (exitStatus) {
        return exitStatus;
      }
    }

    const pipRun = (...bonusArgs) =>
      pspawn(`${virtEnv}/bin/pip`, bonusArgs, {
        cwd: agSetupSolo,
      });

    if (!(await exists(`${virtEnv}/bin/wheel`))) {
      const exitStatus = await pipRun('install', 'wheel');
      if (exitStatus) {
        return exitStatus;
      }
    }

    if (!(await exists(`${virtEnv}/bin/ag-setup-solo`))) {
      const exitStatus = await pipRun('install', `--editable`, '.');
      if (exitStatus) {
        return exitStatus;
      }
    }

    const setupRun = (...bonusArgs) =>
      pspawn(
        `${virtEnv}/bin/ag-setup-solo`,
        [`--webport=${PORT}`, ...bonusArgs, ...startArgs],
        {
          env: { ...pspawnEnv, AG_SOLO_BASEDIR: agServer },
        },
      );

    if (!(await exists(agServer))) {
      const exitStatus = await setupRun('--no-restart');
      if (exitStatus) {
        return exitStatus;
      }
    }

    return setupRun();
  }

  const profiles = {
    dev: startFakeChain,
    'local-chain': startLocalChain,
    'local-solo': startLocalSolo,
    testnet: opts.sdk ? startTestnetSdk : startTestnetDocker,
  };

  const popts = opts;

  if (popts.verbose > 1) {
    // Enable verbose logs.
    pspawnEnv.DEBUG = 'agoric';
  } else if (!popts.verbose) {
    // Disable more logs.
    pspawnEnv.DEBUG = '';
  }

  const args = rawArgs.slice(1);
  const profileName = args[0] || 'dev';
  const startFn = profiles[profileName];
  if (!startFn) {
    log.error(
      `unrecognized profile name ${profileName}; use one of: ${Object.keys(
        profiles,
      )
        .sort()
        .join(', ')}`,
    );
    return 1;
  }

  agServer = `_agstate/agoric-servers/${profileName}`;

  if (popts.reset) {
    log(chalk.green(`removing ${agServer}`));
    // rm is available on all the unix-likes, so use it for speed.
    await pspawn('rm', ['-rf', agServer]);
  }

  return startFn(profileName, args[0] ? args.slice(1) : args, popts);
}
