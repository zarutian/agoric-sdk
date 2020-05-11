import { openSwingStore } from '@agoric/swing-store-simple';
import tmp from 'tmp';
import chalk from 'chalk';
import { Command } from 'commander';

const INITIAL_TOKEN = '1000uag';

async function provisionMain(progname, rawArgs, powers, opts) {
  const { anylogger, process, helper, fs } = powers;
  const log = anylogger('agoric:provision');

  // console.log('rawargs', rawArgs);
  const [sender, ...nickaddrs] = rawArgs.slice(1);
  const nicknames = [];
  const addresses = [];
  for (const nickaddr of nickaddrs) {
    const match = nickaddr.match(/^([^:]+):(.*)$/s);
    if (match) {
      nicknames.push(match[1]);
      addresses.push(match[2]);
    } else {
      log.warn('unrecognized nick:address format:', nickaddr);
    }
  }

  if (opts.init) {
    log.info('Recovering egresses from', opts.init);
    const { storage } = openSwingStore(`${opts.init}/config/egresses`);
    const nextChar = String.fromCharCode('/'.charCodeAt(0) + 1);
    for (const key of storage.getKeys('egress/', `egress${nextChar}`)) {
      const nickname = key.substr('egress/'.length);
      const addressesJSON = storage.get(key);
      try {
        JSON.parse(addressesJSON).forEach(address => {
          nicknames.push(nickname);
          addresses.push(address);
        });
      } catch (e) {
        // ignore
      }
    }
    log.info(nicknames.length, 'egresses recovered');
  }

  const helperStdout = async args => {
    let stdout = '';
    const pr = helper(args, { stdio: ['inherit', 'pipe', 'inherit'] });
    pr.cp.stdout.on('data', chunk => {
      stdout += chunk.toString('utf-8');
    });
    const code = await pr;
    if (code !== 0) {
      process.stdout.write(stdout);
    }
    return { code, stdout };
  };

  const { stdout: senderAddress, code: senderCode } = await helperStdout([
    'keys',
    'show',
    sender,
    '-a',
  ]);

  if (senderCode !== 0) {
    process.exit(senderCode);
  }
  const fromAddress = senderAddress.trim();

  const txes = [];
  for (let i = 0; i < addresses.length; i += 1) {
    const address = addresses[i];
    const nickname = nicknames[i];

    // eslint-disable-next-line no-await-in-loop
    const { code, stdout } = await helperStdout([
      'tx',
      'send',
      fromAddress,
      address,
      INITIAL_TOKEN,
      '--generate-only',
      '--gas=auto',
      '--gas-adjustment=1.05',
      '-ojson',
    ]);

    if (code !== 0) {
      process.exit(code);
    }
    txes.push(JSON.parse(stdout));

    // eslint-disable-next-line no-await-in-loop
    const { code: code2, stdout: stdout2 } = await helperStdout([
      'tx',
      'swingset',
      'provision-one',
      `--from=${fromAddress}`,
      '--generate-only',
      '--gas=auto',
      '--gas-adjustment=1.05',
      '-ojson',
      nickname,
      address,
    ]);
    if (code2 !== 0) {
      process.exit(code2);
    }
    txes.push(JSON.parse(stdout2));
  }

  if (txes.length > 0) {
    const tx0 = txes[0];
    const msgs = tx0.value.msg;
    let gas = Number(tx0.value.fee.gas);
    // Add up all the gases and concatenate messages.
    for (const tx of txes.slice(1)) {
      gas += Number(tx.value.fee.gas);
      for (const msg of tx.value.msg) {
        msgs.push(msg);
      }
    }
    tx0.value.fee.gas = String(gas);

    // Create a temporary file that is automatically deleted.
    const tf = tmp.fileSync();
    try {
      await fs.writeFile(tf.name, JSON.stringify(tx0));
      const { code: codeSign, stdout: signedJSON } = await helperStdout([
        'tx',
        'sign',
        tf.name,
        '--from',
        fromAddress,
        '--yes',
        '--append=false',
      ]);
      if (codeSign !== 0) {
        return codeSign;
      }
      // Overwrite the JSON with the signedJSON.
      await fs.writeFile(tf.name, signedJSON);
      const code = await helper([
        'tx',
        'broadcast',
        tf.name,
        '--broadcast-mode=block',
        '--yes',
      ]);
      if (code !== 0) {
        return code;
      }
    } finally {
      tf.removeCallback();
    }
  }
  return 0;
}

export default async function cosmosMain(progname, rawArgs, powers, opts) {
  const IMAGE = `agoric/agoric-sdk`;
  const { anylogger, spawn, process } = powers;
  const log = anylogger('agoric:cosmos');

  const popts = opts;

  const pspawnEnv = { ...process.env };
  if (popts.verbose > 1) {
    // Enable verbose logs.
    pspawnEnv.DEBUG = 'agoric';
  } else if (!popts.verbose) {
    // Disable more logs.
    pspawnEnv.DEBUG = '';
  }

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

  function helper(args, hopts = undefined) {
    if (opts.sdk) {
      return pspawn('ag-cosmos-helper', args, hopts);
    }

    // Don't allocate a TTY if we're not talking to one.
    const ttyFlag = process.stdin.isTTY && process.stdout.isTTY ? '-it' : '-i';

    return pspawn(
      'docker',
      [
        'run',
        `--volume=ag-cosmos-helper-state:/root/.ag-cosmos-helper`,
        '--rm',
        ttyFlag,
        '--entrypoint=ag-cosmos-helper',
        IMAGE,
        ...args,
      ],
      hopts,
    );
  }

  if (popts.pull) {
    const status = await pspawn('docker', ['pull', IMAGE]);
    if (status) {
      return status;
    }
  }

  const provIdx = rawArgs.indexOf('provision');
  if (provIdx >= 0) {
    const program = new Command('agoric cosmos');
    program
      .command('provision <sender> [nick:address...]')
      .description('ensure an account exists and enable its traffic')
      .option(
        '-i, --init [config-dir]',
        'initialise from chain config directory',
        `${process.env.HOME || ''}/.ag-chain-cosmos`,
      )
      .action(async (sender, nickaddrs, cmd) => {
        const propts = { ...opts, ...cmd.opts() };
        return provisionMain(
          'provision',
          ['provision', sender, ...nickaddrs],
          {
            ...powers,
            helper: (args, hopts = undefined) => {
              // console.log('helper opts', rawArgs, rawArgs.slice(1, provIdx), args);
              return helper([...rawArgs.slice(1, provIdx), ...args], hopts);
            },
          },
          propts,
        );
      });
    return program.parseAsync(rawArgs.slice(provIdx), { from: 'user' });
  }
  return helper(rawArgs.slice(1));
}
