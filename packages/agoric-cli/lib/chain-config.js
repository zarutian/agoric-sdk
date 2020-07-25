import djson from 'deterministic-json';
import TOML from '@iarna/toml';

export const MINT_DENOM = 'uag';
export const STAKING_DENOM = 'uagstake';
export const GOV_DEPOSIT_COINS = [{ amount: '10000000', denom: MINT_DENOM }];
export const BLOCK_CADENCE_S = 2;

export const ORIG_BLOCK_CADENCE_S = 5;
export const ORIG_SIGNED_BLOCKS_WINDOW = 100;

// Rewrite the config.toml.
export function finishCosmosConfig({
  configToml,
  portNum = '26657',
  persistentPeers = '',
}) {
  const rpcPort = Number(portNum);

  // Adjust the config.toml.
  const config = TOML.parse(configToml);
  config.proxy_app = 'kvstore';

  // Enforce our inter-block delays for this node.
  config.consensus.timeout_commit = `${BLOCK_CADENCE_S}s`;

  // Update addresses in the config.
  config.p2p.laddr = `tcp://0.0.0.0:${rpcPort - 1}`;
  config.p2p.persistent_peers = persistentPeers;
  config.rpc.laddr = `tcp://127.0.0.1:${rpcPort}`;

  // Needed for IBC.
  config.tx_index.index_all_keys = true;

  // Stringify the new config.toml.
  return TOML.stringify(config);
}

// Rewrite/import the genesis.json.
export function finishCosmosGenesis({ genesisJson, exportedGenesisJson }) {
  const genesis = JSON.parse(genesisJson);
  const exported = exportedGenesisJson ? JSON.parse(exportedGenesisJson) : {};

  genesis.app_state.staking.params.bond_denom = STAKING_DENOM;

  // We scale this parameter according to our own block cadence, so
  // that we tolerate the same downtime as the old genesis.
  genesis.app_state.slashing.params.signed_blocks_window = `${Math.ceil(
    (ORIG_BLOCK_CADENCE_S * ORIG_SIGNED_BLOCKS_WINDOW) / BLOCK_CADENCE_S,
  )}`;

  // Zero inflation, for now.
  genesis.app_state.mint.minter.inflation = '0.0';
  genesis.app_state.mint.params.inflation_rate_change = '0.0';
  genesis.app_state.mint.params.inflation_min = '0.0';

  // Set the denomination for different modules.
  genesis.app_state.mint.params.mint_denom = MINT_DENOM;
  genesis.app_state.crisis.constant_fee.denom = MINT_DENOM;
  genesis.app_state.gov.deposit_params.min_deposit = GOV_DEPOSIT_COINS;

  // Reduce the cost of a transaction.
  genesis.app_state.auth.params.tx_size_cost_per_byte = '1';

  // We upgrade from export data.
  const { app_state: exportedAppState = {} } = exported;
  for (const state of Object.keys(exportedAppState)) {
    genesis.app_state[state] = exportedAppState[state];
  }

  // Remove IBC and capability state.
  // TODO: This needs much more support to preserve contract state
  // between exports in order to be able to carry forward IBC conns.
  delete genesis.app_state.capability;
  delete genesis.app_state.ibc;

  // Use the same consensus_params.
  if ('consensus_params' in exported) {
    genesis.consensus_params = exported.consensus_params;
  }

  // This is necessary until https://github.com/cosmos/cosmos-sdk/issues/6446 is closed.
  genesis.consensus_params.block.time_iota_ms = '1000';
  return djson.stringify(genesis);
}
