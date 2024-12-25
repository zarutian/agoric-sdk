/**
 * @file work-around: importing @agoric/synthetic-chain hangs XXX
 */
// @ts-check
/* eslint-env node */
import { $ } from 'execa';

const waitForBootstrap = async () => {
  const endpoint = 'localhost';
  while (true) {
    const { stdout: json } = await $({
      reject: false,
    })`curl -s --fail -m 15 ${`${endpoint}:26657/status`}`;

    if (json.length === 0) {
      continue;
    }

    const data = JSON.parse(json);

    if (data.jsonrpc !== '2.0') {
      continue;
    }

    const lastHeight = data.result.sync_info.latest_block_height;

    if (lastHeight !== '1') {
      return lastHeight;
    }

    await new Promise(r => setTimeout(r, 2000));
  }
};

export const waitForBlock = async (n = 1) => {
  console.log(`waitForBlock waiting for ${n} new block(s)...`);
  const h0 = await waitForBootstrap();
  let lastHeight = h0;
  for (let i = 0; i < n; i += 1) {
    while (true) {
      await new Promise(r => setTimeout(r, 1000));
      const currentHeight = await waitForBootstrap();
      if (currentHeight !== lastHeight) {
        console.log(`waitForBlock saw new height ${currentHeight}`);
        lastHeight = currentHeight;
        break;
      }
    }
  }
};

const { freeze } = Object;

const agdBinary = 'agd';

/**
 * @param {{execFileSync: typeof import('child_process').execFileSync }} io
 */
export const makeAgd = ({ execFileSync }) => {
  /**
   * @param {{
   *   home?: string;
   *   keyringBackend?: string;
   *   rpcAddrs?: string[];
   * }} opts
   */
  const make = ({ home, keyringBackend, rpcAddrs } = {}) => {
    const keyringArgs = [
      ...(home ? ['--home', home] : []),
      ...(keyringBackend ? [`--keyring-backend`, keyringBackend] : []),
    ];
    if (rpcAddrs) {
      assert.equal(
        rpcAddrs.length,
        1,
        'XXX rpcAddrs must contain only one entry',
      );
    }
    const nodeArgs = [...(rpcAddrs ? [`--node`, rpcAddrs[0]] : [])];

    const exec = (args, opts) => execFileSync(agdBinary, args, opts).toString();

    const outJson = ['--output', 'json'];

    const ro = freeze({
      status: async () => JSON.parse(exec([...nodeArgs, 'status'])),
      query: async qArgs => {
        const out = exec(['query', ...qArgs, ...nodeArgs, ...outJson], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        try {
          return JSON.parse(out);
        } catch (e) {
          console.error(e);
          console.info('output:', out);
        }
      },
    });
    const nameHub = freeze({
      /**
       * NOTE: synchronous I/O
       * @param {...any} path
       */
      lookup: (...path) => {
        if (!Array.isArray(path)) {
          // TODO: use COND || Fail``
          throw TypeError();
        }
        if (path.length !== 1) {
          throw Error(`path length limited to 1: ${path.length}`);
        }
        const [name] = path;
        const txt = exec(['keys', 'show', `--address`, name, ...keyringArgs]);
        return txt.trim();
      },
    });
    const rw = freeze({
      /**
       * @param {string[]} txArgs
       * @param {{ chainId: string, from: string, yes?: boolean }} opts
       */
      tx: async (txArgs, { chainId, from, yes }) => {
        const yesArg = yes ? ['--yes'] : [];
        const args = [
          ...nodeArgs,
          ...[`--chain-id`, chainId],
          ...keyringArgs,
          ...[`--from`, from],
          'tx',
          ...['--broadcast-mode', 'block'],
          ...['--gas', 'auto'],
          ...['--gas-adjustment', '1.3'],
          ...txArgs,
          ...yesArg,
          ...outJson,
        ];
        const out = exec(args);
        try {
          return JSON.parse(out);
        } catch (e) {
          console.error(e);
          console.info('output:', out);
        }
      },
      ...ro,
      ...nameHub,
      readOnly: () => ro,
      nameHub: () => nameHub,
      keys: {
        add: (name, mnemonic) => {
          return execFileSync(
            agdBinary,
            [...keyringArgs, 'keys', 'add', name, '--recover'],
            { input: mnemonic },
          ).toString();
        },
      },
      withOpts: opts => make({ home, keyringBackend, rpcAddrs, ...opts }),
    });
    return rw;
  };
  return make();
};
