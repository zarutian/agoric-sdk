/* eslint-disable no-await-in-loop */
import inquirer from 'inquirer';
import djson from 'deterministic-json';
import crypto from 'crypto';
import chalk from 'chalk';
import parseArgs from 'minimist';
import doInit from './init';
import {
  chdir,
  doRun,
  needBacktick,
  needDoRun,
  shellEscape,
  shellMetaRegexp,
  setSilent,
} from './run';
import {
  dirname,
  exists,
  readFile,
  resolve,
  stat,
  streamFromString,
  createFile,
  mkdir,
  readdir,
} from './files';
import {
  SETUP_HOME,
  DEFAULT_BOOT_TOKENS,
  playbook,
  sleep,
  SSH_TYPE,
} from './setup';

const PROVISION_DIR = 'provision';
const PROVISIONER_NODE = 'node0'; // FIXME: Allow configuration.
const COSMOS_DIR = 'ag-chain-cosmos';
const CONTROLLER_DIR = 'ag-pserver';
const SECONDS_BETWEEN_BLOCKS = 5;

// This is needed for hyphenated group names not to trigger Ansible.
process.env.ANSIBLE_TRANSFORM_INVALID_GROUP_CHARS = 'ignore';

const trimReadFile = async file => String(await readFile(file)).trimRight();

const guardFile = async (file, maker) => {
  if (await exists(file)) {
    return 0;
  }
  const parent = dirname(file);
  if (!(await exists(parent))) {
    await mkdir(parent);
  }
  let made = false;
  const ret = await maker(async contents => {
    await createFile(file, contents);
    made = true;
  });
  if (!made) {
    if (!ret) {
      // Create a timestamp by default.
      await createFile(file, String(new Date()));
    } else {
      // They failed.
      throw ret;
    }
  }
  return ret;
};

const waitForStatus = async (user, host, service, doRetry, acceptFn) => {
  const hostArgs = host ? [`-l${host}`] : [];
  const serviceArgs = service ? [`-eservice=${service}`] : [];
  let retryNum = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    await doRetry(retryNum);
    let buf = '';
    // eslint-disable-next-line no-await-in-loop
    const code = await needDoRun(
      playbook('status', `-euser=${user}`, ...hostArgs, ...serviceArgs),
      undefined,
      chunk => {
        process.stdout.write(chunk);
        buf += String(chunk);
      },
    );
    const accepted = acceptFn(buf, code);
    if (accepted !== undefined) {
      return accepted;
    }
    retryNum += 1;
  }
};

const provisionOutput = async () => {
  const jsonFile = `${PROVISION_DIR}/terraform.json`;
  await guardFile(jsonFile, async makeFile => {
    const json = await needBacktick(`terraform output -json`);
    await makeFile(json);
  });
  const json = String(await readFile(jsonFile));
  return JSON.parse(json);
};

const main = async (progname, rawArgs) => {
  const { _: args, ...opts } = parseArgs(rawArgs, {
    boolean: ['version', 'help'],
    stopEarly: true,
  });

  const reMain = async reArgs => {
    const displayArgs = [progname, ...args];
    console.error('$', ...displayArgs.map(shellEscape));
    return main(progname, reArgs);
  };

  const needReMain = async reArgs => {
    const code = await reMain(reArgs);
    if (code !== 0) {
      throw Error(`Unexpected exit: ${code}`);
    }
  };

  const initHint = () => {
    const adir = process.cwd();
    console.error(`\

NOTE: to manage the ${adir} setup directory, do
  export AG_SETUP_COSMOS_HOME=${adir}
or
  cd ${adir}
and run ${progname} subcommands`);
  };
  const help = () =>
    console.log(`\
Usage: ${progname} [command] [...args]

Notable commands:

bootstrap        automatic setup (idempotent)
destroy          unprovision a setup, so that it can be bootstrapped again
help             display this message
init             initialize a chain setup directory
provision        create network nodes to match this setup
run              run a shell command on a set of nodes
play             run an Ansible playbook on the nodes
rolling-restart  restart each node one at a time
show-config      display the client connection parameters
`);
  const inited = async (cmd = `${progname} init`, ...files) => {
    files = [...files, 'ansible.cfg', 'vars.tf'];
    try {
      const ps = files.map(path => stat(path));
      await Promise.all(ps);
    } catch (e) {
      throw Error(
        `${process.cwd()} does not appear to be a directory created by \`${cmd}'`,
      );
    }
  };

  const cmd = args[0];
  if (SETUP_HOME) {
    // Switch to the chain home.
    switch (cmd) {
      case 'bootstrap':
      case 'init':
      case 'destroy':
      case 'show-config':
      case 'ssh':
        break;
      default:
        if (process.cwd() !== SETUP_HOME) {
          await chdir(SETUP_HOME);
        }
        break;
    }
  }

  if (opts.help) {
    help();
    return 0;
  }

  switch (cmd) {
    case 'help': {
      help();
      break;
    }
    case 'bootstrap': {
      const { _: subArgs, 'boot-tokens': bootTokens, ...subOpts } = parseArgs(
        args.slice(1),
        {
          default: {
            'boot-tokens': DEFAULT_BOOT_TOKENS,
          },
          stopEarly: true,
        },
      );

      const dir = SETUP_HOME;
      if (await exists(`${dir}/network.txt`)) {
        // Change to directory.
        await chdir(dir);
      } else {
        // NOTE: init automatically changes directory.
        await needReMain([
          'init',
          dir,
          ...(process.env.AG_SETUP_COSMOS_NAME
            ? [process.env.AG_SETUP_COSMOS_NAME]
            : []),
        ]);
      }

      await guardFile(`${PROVISION_DIR}/hosts`, async makeFile => {
        await needReMain(['provision', '-auto-approve']);
        const hosts = await needBacktick(`${shellEscape(progname)} show-hosts`);
        await makeFile(hosts);
      });

      await guardFile(`${PROVISION_DIR}/ssh_known_hosts.stamp`, async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const code = await reMain(['play', 'update_known_hosts']);
          if (code === 0) {
            break;
          } else if (code !== 2) {
            return code;
          }
          await sleep(10, 'for hosts to boot SSH');
        }
        return 0;
      });

      // Prepare all the machines.
      await guardFile(`${PROVISION_DIR}/prepare.stamp`, () =>
        needReMain(['play', 'prepare-machine']),
      );

      switch (subArgs[0]) {
        case undefined: {
          await createFile('boot-tokens.txt', bootTokens);
          const bootOpts = [];
          for (const propagate of ['bump', 'import-from']) {
            const val = subOpts[propagate];
            if (val !== undefined) {
              bootOpts.push(`--${propagate}=${val}`);
            }
          }
          await needReMain(['bootstrap-cosmos', ...bootOpts]);
          break;
        }
        default: {
          throw Error(`Unrecognized bootstrap argument ${subArgs[0]}`);
        }
      }
      break;
    }

    case 'bump-chain-version': {
      await inited();
      const { _: subArgs, ...subOpts } = parseArgs(args.slice(1), {
        string: ['tag'],
      });

      const versionFile = `chain-version.txt`;

      let major = 0;
      let minor = 0;
      let revision = 0;
      let tag = '';
      if (await exists(versionFile)) {
        const vstr = await trimReadFile(versionFile);
        const match = vstr.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
        if (match) {
          [major, minor, revision, tag] = match.slice(1);
        } else {
          tag = vstr;
        }
      }

      let versionKind = subArgs[0];
      if (subOpts.tag !== undefined) {
        tag = subOpts.tag;
      } else if (subArgs[0] === undefined || String(subArgs[0]) === 'true') {
        // Default bump.
        versionKind = 'patch';
      }

      switch (versionKind) {
        case 'major':
          major = Number(major) + 1;
          minor = '0';
          revision = '0';
          break;

        case 'minor':
          minor = Number(minor) + 1;
          revision = '0';
          break;

        case 'revision':
        case 'patch':
          revision = Number(revision) + 1;
          break;

        case 'none':
        case undefined:
          break;

        default:
          if (!versionKind.match(/^[1-9]/)) {
            throw Error(
              `${versionKind} is not one of "major", "minor", "revision", or 1.2.3`,
            );
          }
      }

      let vstr = `${major}.${minor}.${revision}${tag}`;
      if (versionKind.match(/^[1-9]/)) {
        vstr = versionKind;
      }
      console.log(vstr);
      await createFile(versionFile, vstr);
      break;
    }

    case 'bootstrap-cosmos': {
      await inited();
      // eslint-disable-next-line no-unused-vars
      const { _: subArgs, ...subOpts } = parseArgs(args.slice(1), {
        string: ['bump', 'import-from'],
        stopEarly: true,
      });

      // See where we're importing the chain state from.
      const importFlags = [];
      const importFrom = subOpts['import-from'];
      if (importFrom) {
        console.error(
          chalk.redBright('FIXME: --import-from is not yet supported!'),
        );
        return 1;
        // Add the exported prefix if not absolute.
        /*
        const absImportFrom = resolve(`${SETUP_HOME}/exported`, importFrom);
        importFlags.push(`--import-from=${absImportFrom}`);
        */
      }

      if (subOpts.bump) {
        const bumpOpts = subOpts.bump ? [subOpts.bump] : [];
        await needReMain(['bump-chain-version', ...bumpOpts]);
      }

      // Make sure the version file exists.
      await guardFile(`chain-version.txt`, makeFile => makeFile('0.0.0'));

      // Assign the chain name.
      const networkName = await trimReadFile('network.txt');
      const chainVersion = await trimReadFile('chain-version.txt');
      const chainName = `${networkName}-${chainVersion}`;
      const pserverPassword = (await exists('pserver-password.txt'))
        ? await trimReadFile('pserver-password.txt')
        : '';
      const currentChainName = await trimReadFile(
        `${COSMOS_DIR}/chain-name.txt`,
      ).catch(_ => undefined);

      if (subOpts.bump || currentChainName !== chainName) {
        // We don't have matching parameters, so restart the chain.
        // Stop all the services.
        await reMain(['play', 'stop', '-eservice=ag-pserver']);
        await reMain([
          'play',
          'stop',
          '-eservice=ag-controller',
          '-euser=ag-pserver',
        ]);
        await reMain(['play', 'stop', '-eservice=ag-chain-cosmos']);

        // Blow away controller/cosmos state.
        await needDoRun(['rm', '-rf', CONTROLLER_DIR, COSMOS_DIR]);
      }
      await guardFile(`${COSMOS_DIR}/chain-name.txt`, async makeFile => {
        await makeFile(chainName);
      });

      // Initialize the controller.
      await guardFile(`${CONTROLLER_DIR}/prepare.stamp`, () =>
        needReMain(['play', 'prepare-controller']),
      );

      // Bootstrap the chain nodes.
      await guardFile(`${COSMOS_DIR}/prepare.stamp`, () =>
        needReMain(['play', 'prepare-cosmos']),
      );
      await guardFile(`${COSMOS_DIR}/genesis.stamp`, () =>
        needReMain(['play', 'cosmos-genesis']),
      );

      await guardFile(`${COSMOS_DIR}/set-defaults.stamp`, async () => {
        await needReMain(['play', 'cosmos-clone-config']);

        const agoricCli = resolve(
          __dirname,
          `../agoric-cli/bin/agoric`,
        ).replace('/cosmic-swingset/', '/');
        // FIXME: The above .replace hacks around legacy /usr/src/agoric-sdk/packages/cosmic-swingset/setup location.
        // TODO: Should change the Dockerfiles to use /usr/src/agoric-sdk/packages/deployment instead.

        // Apply the Agoric set-defaults to all the .dst dirs.
        const files = await readdir(`${COSMOS_DIR}/data`);
        const dsts = files.filter(fname => fname.endsWith('.dst'));
        const peers = await needBacktick(`${shellEscape(progname)} show-peers`);
        await Promise.all(
          dsts.map(async (dst, i) => {
            // Update the config.toml and genesis.json.
            await needDoRun([
              agoricCli,
              `set-defaults`,
              `ag-chain-cosmos`,
              `--persistent-peers=${peers}`,
              ...importFlags,
              `${COSMOS_DIR}/data/${dst}`,
            ]);
            if (i === 0) {
              // Make a canonical copy of the genesis.json.
              const data = await readFile(
                `${COSMOS_DIR}/data/${dst}/genesis.json`,
              );
              await createFile(`${COSMOS_DIR}/data/genesis.json`, data);
            }
          }),
        );
      });

      const peersFile = `${COSMOS_DIR}/data/peers.txt`;
      await guardFile(peersFile, async makeFile => {
        const peers = await needBacktick(`${shellEscape(progname)} show-peers`);
        await makeFile(peers);
      });

      await guardFile(`${COSMOS_DIR}/install.stamp`, () =>
        needReMain(['play', 'install-cosmos']),
      );

      await guardFile(`${COSMOS_DIR}/service.stamp`, () =>
        needReMain([
          'play',
          'install',
          `-eexecline=${shellEscape(
            '/usr/src/cosmic-swingset/bin/ag-chain-cosmos start --pruning=nothing',
          )}`,
        ]),
      );
      await guardFile(`${COSMOS_DIR}/start.stamp`, () =>
        needReMain(['play', 'start']),
      );

      await needReMain(['wait-for-any']);

      // Add the bootstrap validators.
      await guardFile(`${COSMOS_DIR}/validators.stamp`, () =>
        needReMain(['play', 'cosmos-validators']),
      );

      console.error(
        chalk.black.bgGreenBright.bold(
          'Your Agoric Cosmos chain is now running!',
        ),
      );
      const cfg = await needBacktick(`${shellEscape(progname)} show-config`);
      process.stdout.write(`${chalk.yellow(cfg)}\n`);

      await guardFile(
        `${CONTROLLER_DIR}/data/cosmos-chain.json`,
        async makeFile => {
          await makeFile(cfg);
        },
      );

      await guardFile(`${CONTROLLER_DIR}/gci.txt`, async makeFile => {
        const gci = await needBacktick(`${shellEscape(progname)} show-gci`);
        await makeFile(gci);
      });
      await guardFile(`${CONTROLLER_DIR}/rpcaddrs.txt`, async makeFile => {
        const rpcAddrs = await needBacktick(
          `${shellEscape(progname)} show-rpcaddrs`,
        );
        await makeFile(rpcAddrs.replace(/,/g, ' '));
      });
      await guardFile(`${CONTROLLER_DIR}/install.stamp`, () =>
        needReMain(['play', 'install-controller']),
      );

      // Install any pubkeys from a former instantiation.
      await guardFile(`${CONTROLLER_DIR}/pubkeys.stamp`, () =>
        needReMain([
          'ssh',
          'ag-pserver',
          'sudo',
          '-u',
          'ag-pserver',
          '/usr/src/app/ve3/bin/ag-pserver',
          'add-pubkeys',
          '-c',
          'http://localhost:8000/private/repl',
        ]),
      );

      let pserverFlags = '';
      const installFlags = [];
      const pub = `${networkName}.crt`;
      const key = `${networkName}.key`;
      if ((await exists(pub)) && (await exists(key))) {
        pserverFlags = ` ${shellEscape(
          `--listen=ssl:443:privateKey=.ag-pserver/${key}:certKey=.ag-pserver/${pub}`,
        )}`;
        installFlags.push(
          `-eserviceLines=AmbientCapabilities=CAP_NET_BIND_SERVICE`,
        );
      }

      const mountpoint =
        pserverPassword === ''
          ? ''
          : ` -m ${shellEscape(`/provision-${pserverPassword}`)}`;
      const execline = `/usr/src/app/ve3/bin/ag-pserver start${pserverFlags}${mountpoint} -c http://localhost:8000/private/repl`;
      await guardFile(`${CONTROLLER_DIR}/service.stamp`, () =>
        needReMain([
          'play',
          'install',
          '-eservice=ag-pserver',
          `-eexecline=${shellEscape(execline)}`,
          ...installFlags,
        ]),
      );

      await guardFile(`${CONTROLLER_DIR}/start.stamp`, () =>
        needReMain(['play', 'start', '-eservice=ag-pserver']),
      );

      const rpcAddrs = await needBacktick(
        `${shellEscape(progname)} show-rpcaddrs`,
      );
      const match = rpcAddrs.match(/^([^,]+):\d+(,|$)/);
      const pserverHost = pserverFlags
        ? `https://${match[1]}`
        : `http://${match[1]}:8001`;
      const pserverUrl = `${pserverHost}${pserverPassword &&
        `/provision-${pserverPassword}`}`;
      initHint();

      console.error(
        `Use the following to provision:
${chalk.yellow.bold(
  `ag-setup-solo --netconfig='${pserverHost}/network-config'`,
)}
and get your codes from:
${chalk.yellow.bold(`curl ${pserverUrl}/request-code?nickname=MY-NICK`)}
`,
      );
      if (await exists('/vagrant')) {
        console.log(`to publish a chain-connected server to your host, do something like:
"${chalk.yellow.bold(`ve3/bin/ag-setup-solo --webhost=0.0.0.0`)}"`);
      }
      break;
    }

    case 'show-chain-name': {
      await inited();
      const chainName = await trimReadFile(`${COSMOS_DIR}/chain-name.txt`);
      process.stdout.write(chainName);
      break;
    }

    case 'ssh': {
      const [host, ...sshArgs] = args.slice(1);
      if (!host) {
        throw Error(`Need: [host]`);
      }

      setSilent(true);
      await chdir(SETUP_HOME);
      await inited();
      const json = await needBacktick(
        `ansible-inventory --host=${shellEscape(host)}`,
      );
      const obj = JSON.parse(json);
      const node = obj.ansible_host || host;
      const user = obj.ansible_ssh_user || 'root';
      const pkey = obj.ansible_ssh_private_key_file;

      const sshCmd = ['ssh', `-oUserKnownHostsFile=provision/ssh_known_hosts`];
      if (pkey) {
        sshCmd.push(`-i${pkey}`);
      }
      sshCmd.push(`${user}@${node}`);
      sshCmd.push(...sshArgs);
      await needDoRun(sshCmd);
      break;
    }

    case 'show-config': {
      setSilent(true);
      await chdir(SETUP_HOME);
      await inited();
      const [chainName, gci, peers, rpcAddrs] = await Promise.all(
        [
          'show-chain-name',
          'show-gci',
          'show-peers',
          'show-rpcaddrs',
        ].map(subcmd =>
          needBacktick([progname, subcmd].map(shellEscape).join(' ')),
        ),
      );
      const obj = {
        chainName,
        gci,
        peers: peers.split(','),
        rpcAddrs: rpcAddrs.split(','),
      };
      process.stdout.write(`${JSON.stringify(obj, undefined, 2)}\n`);
      break;
    }

    case 'rolling-restart': {
      let [...hosts] = args.slice(1);
      await inited();

      if (hosts.length === 0) {
        hosts = ['all'];
      }

      // Expand the hosts into nodes.
      const nodeMap = {};
      for (const host of hosts) {
        const hostLines = await needBacktick(
          `ansible --list-hosts ${shellEscape(host)}`,
        );
        for (const line of hostLines.split('\n')) {
          const match = line.match(/^\s*(node\d+)/);
          if (match) {
            nodeMap[match[1]] = true;
          }
        }
      }

      const nodes = Object.keys(nodeMap).sort();
      if (nodes.length === 0) {
        throw Error(`Need at least one node`);
      }

      for (const node of nodes) {
        const nodePlaybook = (book, ...pbargs) =>
          playbook(book, '-l', node, ...pbargs);
        await needDoRun(nodePlaybook('restart'));
        await needDoRun([progname, 'wait-for-any', node]);
      }
      break;
    }

    case 'wait-for-any': {
      let [host] = args.slice(1);
      await inited();

      if (!host) {
        host = 'ag-chain-cosmos';
      }

      // Detect when blocks are being produced.
      const height = await waitForStatus(
        'ag-chain-cosmos', // user
        host, // host
        'ag-chain-cosmos', // service
        _retries =>
          sleep(
            SECONDS_BETWEEN_BLOCKS + 1,
            `to check if ${chalk.underline(host)} has committed a block`,
          ),
        buf => {
          const match = buf.match(
            /Committed state.*module=state.*height=([1-9]\d*)/,
          );
          if (match) {
            return match[1];
          }
          return undefined;
        },
      );

      const atLeast = host.match(/^node\d+/) ? '' : `At least one of `;
      console.error(
        chalk.greenBright(
          `${atLeast}${chalk.underline(
            host,
          )} is up-and-running (committed block height=${height})`,
        ),
      );
      break;
    }

    case 'new-account': {
      const [user, passwd] = args.slice(1);
      const stdin = passwd
        ? streamFromString(`${passwd}\n${passwd}\n`)
        : 'inherit';
      await needDoRun(['ag-cosmos-helper', 'keys', 'add', user], stdin);
      break;
    }

    case 'show-rpcaddrs': {
      await inited();
      const prov = await provisionOutput();

      let rpcaddrs = '';
      let sep = '';
      for (const CLUSTER of Object.keys(prov.public_ips.value)) {
        const ips = prov.public_ips.value[CLUSTER];
        const PORT = 26657;
        for (const IP of ips) {
          rpcaddrs += `${sep}${IP}:${PORT}`;
          sep = ',';
        }
      }

      process.stdout.write(rpcaddrs);
      break;
    }

    case 'show-peers': {
      await inited();
      const prov = await provisionOutput();
      const publicIps = [];
      const publicPorts = [];
      for (const CLUSTER of Object.keys(prov.public_ips.value)) {
        const ips = prov.public_ips.value[CLUSTER];
        const offset = Number(prov.offsets.value[CLUSTER]);
        for (let i = 0; i < ips.length; i += 1) {
          publicIps[offset + i] = ips[i];
        }
      }

      const DEFAULT_PORT = 26656;

      let peers = '';
      let sep = '';
      let idPath;
      let i = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Read the node-id file for this node.
        idPath = `${COSMOS_DIR}/data/node${i}/node-id`;
        if (!(await exists(idPath))) {
          break;
        }

        const raw = await trimReadFile(idPath);
        const ID = String(raw);

        if (!ID) {
          throw Error(`${idPath} does not contain a node ID`);
        }
        if (!ID.match(/^[a-f0-9]+/)) {
          throw Error(`${idPath} contains an invalid ID ${ID}`);
        }
        const IP = publicIps[i];
        if (!IP) {
          throw Error(`${idPath} does not correspond to a Terraform public IP`);
        }
        const PORT = publicPorts[i] || DEFAULT_PORT;
        peers += `${sep}${ID}@${IP}:${PORT}`;
        sep = ',';
        i += 1;
      }
      if (i === 0) {
        throw Error(`No ${idPath} file found`);
      }
      process.stdout.write(peers);
      break;
    }

    case 'show-gci': {
      const genesis = await readFile(`${COSMOS_DIR}/data/genesis.json`);
      const s = djson.stringify(JSON.parse(String(genesis)));
      const gci = crypto
        .createHash('sha256')
        .update(s)
        .digest('hex');
      process.stdout.write(gci);
      break;
    }

    case 'destroy': {
      let [dir] = args.slice(1);
      if (!dir) {
        dir = SETUP_HOME;
      }
      if (!dir) {
        throw Error(`Need: [dir]`);
      }

      // Unprovision terraform.
      await chdir(dir);

      if (await exists(`.terraform`)) {
        // Terraform will prompt.
        await needDoRun(['terraform', 'destroy']);
      } else {
        const { CONFIRM } = await inquirer.prompt([
          {
            type: 'input',
            name: 'CONFIRM',
            default: 'no',
            message: `Type "yes" if you are sure you want to reset ${dir} state:`,
          },
        ]);
        if (CONFIRM !== 'yes') {
          throw Error(`Aborting due to user request`);
        }
      }

      // We no longer are provisioned or have Cosmos.
      await needDoRun(['rm', '-rf', PROVISION_DIR, CONTROLLER_DIR, COSMOS_DIR]);
      break;
    }

    case 'init': {
      await doInit(progname, args);
      initHint();
      break;
    }

    case 'provision': {
      await inited();
      if (!(await exists('.terraform'))) {
        await needDoRun(['terraform', 'init']);
      }
      await needDoRun(['terraform', 'apply', ...args.slice(1)]);
      await needDoRun(['rm', '-rf', PROVISION_DIR]);
      break;
    }

    case 'show-hosts': {
      const SSH_PRIVATE_KEY_FILE = resolve(`id_${SSH_TYPE}`);
      await inited(`${progname} init`, SSH_PRIVATE_KEY_FILE);
      const prov = await provisionOutput();
      const out = process.stdout;
      const prefixLines = (str, prefix) => {
        const allLines = str.split('\n');
        if (allLines[allLines.length - 1] === '') {
          allLines.pop();
        }
        return allLines.reduce(
          (prior, line) => `${prior + prefix + line}\n`,
          '',
        );
      };
      const indent = (str, nspaces) => prefixLines(str, ' '.repeat(nspaces));

      const byGroup = {};
      const makeGroup = name => {
        const beginBlock = `\
${name}:
  hosts:
`;
        byGroup[name] = beginBlock;
        return hostBlock => (byGroup[name] += indent(hostBlock, 4));
      };

      const addAll = makeGroup('all');
      const addChainCosmos = makeGroup('ag-chain-cosmos', 4);
      for (const provider of Object.keys(prov.public_ips.value).sort()) {
        const addProvider = makeGroup(provider, 4);
        const ips = prov.public_ips.value[provider];
        const offset = Number(prov.offsets.value[provider]);
        for (let instance = 0; instance < ips.length; instance += 1) {
          const ip = ips[instance];
          const node = `node${offset + instance}`;
          const units =
            node === PROVISIONER_NODE
              ? `\
  units:
  - ag-pserver.service
  - ag-chain-cosmos.service
`
              : '';
          const host = `\
${node}:
  ansible_host: ${ip}
  ansible_ssh_user: root
  ansible_ssh_private_key_file: '${SSH_PRIVATE_KEY_FILE}'
  ansible_python_interpreter: /usr/bin/python
${units}`;
          addProvider(host);

          addAll(host);

          // TODO: Don't make these hardcoded assumptions.
          // For now, we add all the nodes to ag-chain-cosmos, and the first node to ag-pserver.
          addChainCosmos(host);
          if (node === PROVISIONER_NODE) {
            makeGroup('ag-pserver', 4)(host);
          }
        }
      }
      out.write(byGroup.all);
      out.write('  children:\n');
      for (const group of Object.keys(byGroup).sort()) {
        if (group !== 'all') {
          out.write(indent(byGroup[group], 4));
        }
      }
      break;
    }

    case 'play': {
      const [pb, ...pbargs] = args.slice(1);
      if (!pb) {
        throw Error(`Need: [playbook name]`);
      }
      if (!pb.match(/^\w[-\w]*$/)) {
        throw Error(`[playbook] ${JSON.stringify(pb)} must be a word`);
      }
      await inited();
      return doRun(playbook(pb, ...pbargs));
    }

    case 'run': {
      const [host, ...subcmd] = args.slice(1);
      if (!host || subcmd.length === 0) {
        throw Error(`Need: [host] [cmd...]`);
      }
      await inited();
      let runArg;
      if (subcmd.length === 1) {
        if (subcmd[0].match(shellMetaRegexp)) {
          // Already contains metacharacters.
          runArg = `sh -c ${shellEscape(subcmd[0])}`;
        } else {
          [runArg] = subcmd;
        }
      } else {
        // Need to escape each argument individually.
        const escapedArgs = cmd.map(shellEscape);
        runArg = `sh -c ${shellEscape(escapedArgs.join(' '))}`;
      }
      const run = ['ansible', '-f10', host, '-a', runArg];
      await needDoRun(run);
      break;
    }

    default:
      throw Error(`Unknown command ${cmd}; try \`${progname} help'`);
  }
  return 0;
};

export default main;
