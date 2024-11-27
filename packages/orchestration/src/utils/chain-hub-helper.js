/**
 * @import {ChainHub, CosmosChainInfo, Denom, DenomDetail} from '../types.js';
 */

/**
 * Registers chains, connections, assets in the provided chainHub.
 *
 * If either is not provided, registration will be skipped.
 *
 * TODO #10580 remove 'brandKey' in favor of `LegibleCapData`
 *
 * @param {ChainHub} chainHub
 * @param {Record<string, Brand<'nat'>>} brands
 * @param {Record<string, CosmosChainInfo> | undefined} chainInfo
 * @param {Record<Denom, DenomDetail & { brandKey?: string }> | undefined} assetInfo
 */
export const registerChainsAndAssets = (
  chainHub,
  brands,
  chainInfo,
  assetInfo,
) => {
  console.log('chainHub: registering chains', Object.keys(chainInfo || {}));
  if (!chainInfo) {
    return;
  }

  const conns = {};
  for (const [chainName, allInfo] of Object.entries(chainInfo)) {
    const { connections, ...info } = allInfo;
    chainHub.registerChain(chainName, info);
    conns[info.chainId] = connections;
  }
  const registeredPairs = new Set();
  for (const [pChainId, connInfos] of Object.entries(conns)) {
    for (const [cChainId, connInfo] of Object.entries(connInfos)) {
      const pair = [pChainId, cChainId].sort().join('<->');
      if (!registeredPairs.has(pair)) {
        chainHub.registerConnection(pChainId, cChainId, connInfo);
        registeredPairs.add(pair);
      }
    }
  }
  console.log('chainHub: registered connections', [...registeredPairs].sort());

  console.log('chainHub: registering assets', Object.keys(assetInfo || {}));
  if (!assetInfo) {
    return;
  }
  for (const [denom, info] of Object.entries(assetInfo)) {
    const infoWithBrand = info.brandKey
      ? { ...info, brand: brands[info.brandKey] }
      : info;
    chainHub.registerAsset(denom, infoWithBrand);
  }
};
