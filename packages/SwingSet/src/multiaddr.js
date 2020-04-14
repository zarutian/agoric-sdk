import harden from '@agoric/harden';

/**
 * @typedef {[string, string][]} Multiaddr
 * @typedef {string} Textaddr An address string formatted as in https://github.com/multiformats/multiaddr
 *
 * Here is the difference between Textaddr and Multiaddr:
 *
 * unspecified port on local ibc interface: /if/ibc0 [['if', 'ibc0']]
 * specific local port: /if/ibc0/ordered/transfer [['if', 'ibc0'], ['ordered', 'transfer']]
 *
 * remote pointer to chain: /dnsaddr/ibc.testnet.agoric.com/ordered/transfer
 *   [['dnsaddr', 'ibc.testnet.agoric.com'], ['ordered', 'transfer']]
 * resolve step to another pointer: /dnsaddr/rpc.testnet.agoric.com/ibc/testnet-1.19.0/gci/4bc8d.../ordered/transfer
 *   [['dnsaddr', 'rpc.testnet.agoric.com'], ['ibc', 'testnet-1.19.0'], ['gci', '4bc8d...'], ['ordered', 'transfer']]
 * resolve to the individual peers: /ip4/172.17.0.4/tcp/26657/tendermint/0.33/ibc/testnet-1.19.0/gci/4bc8d.../ordered/transfer
 *   [['ip4', '172.17.0.4'], ['tcp', '26657'], ['tendermint', '0.33'],
 *    ['ibc', 'testnet-1.19.0'], ['gci', '4bc8d...'], ['ordered', 'transfer']]
 */

/**
 * Transform a text address to a parsed multiaddr
 *
 * @param {Textaddr|Multiaddr} ta
 * @returns {Multiaddr}
 */
export function parse(ma) {
  if (typeof ma !== 'string') {
    return ma;
  }
  let s = ma;
  let m;
  /**
   * @type {[string, string][]}
   */
  const acc = [];
  // eslint-disable-next-line no-cond-assign
  while ((m = s.match(/^\/([^/]+)\/([^/]*)/))) {
    s = s.substr(m[0].length);
    acc.push([m[1], m[2]]);
  }
  if (s !== '') {
    throw TypeError(`Error parsing Multiaddr ${ma} at ${s}`);
  }
  return acc;
}

/**
 * Transform a parsed multiaddr to a string.
 *
 * @param {Multiaddr|Textaddr} ma
 * @returns {Textaddr}
 */
export function unparseMultiaddr(ma) {
  if (typeof ma === 'string') {
    return ma;
  }
  return ma.reduce((prior, arg) => prior + arg.join('/'), '/');
}

/*
export function makeRouter() {
  return harden({
    roet
  });
}
*/
