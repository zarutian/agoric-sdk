import assert from 'node:assert';
import {
  queryVstorage,
  agops,
  agoric,
  executeOffer,
} from '@agoric/synthetic-chain';
import { makeMarshal, Remotable } from '@endo/marshal';

export const GOV4ADDR = 'agoric1c9gyu460lu70rtcdp95vummd6032psmpdx7wdy';

const slotToRemotable = (_slotId, iface = 'Remotable') =>
  Remotable(iface, undefined, {
    getBoardId: () => _slotId,
  });

// /** @param {BoardRemote | object} val */
const boardValToSlot = val => {
  if ('getBoardId' in val) {
    return val.getBoardId();
  }
  throw Error(`unknown obj in boardSlottingMarshaller.valToSlot ${val}`);
};

const boardSlottingMarshaller = slotToVal => {
  return makeMarshal(boardValToSlot, slotToVal, {
    serializeBodyFormat: 'smallcaps',
  });
};

export const marshaller = boardSlottingMarshaller(slotToRemotable);

export const queryVstorageFormatted = async (path, index = -1) => {
  const data = await queryVstorage(path);

  const formattedData = JSON.parse(data.value);
  const formattedDataAtIndex = JSON.parse(formattedData.values.at(index));
  return marshaller.fromCapData(formattedDataAtIndex);
};

export const generateVaultDirectorParamChange = async (
  previousOfferId,
  voteDur,
  params,
  paramsPath,
) => {
  const voteDurSec = BigInt(voteDur);
  const toSec = ms => BigInt(Math.round(ms / 1000));

  const id = `propose-${Date.now()}`;
  const deadline = toSec(Date.now()) + voteDurSec;

  const zip = (xs, ys) => xs.map((x, i) => [x, ys[i]]);
  // KLUDGE: partial deconstruction of smallCaps values
  const fromSmallCapsEntries = txt => {
    const { body, slots } = JSON.parse(txt);
    const theEntries = zip(JSON.parse(body.slice(1)), slots).map(
      ([[name, ref], boardID]) => {
        const iface = ref.replace(/^\$\d+\./, '');
        return [name, { iface, boardID }];
      },
    );
    return Object.fromEntries(theEntries);
  };

  const slots = []; // XXX global mutable state
  const smallCaps = {
    Nat: n => `+${n}`,
    // XXX mutates obj
    ref: obj => {
      if (obj.ix) return obj.ix;
      const ix = slots.length;
      slots.push(obj.boardID);
      obj.ix = `$${ix}.Alleged: ${obj.iface}`;
      return obj.ix;
    },
  };

  await null;
  const instance = fromSmallCapsEntries(
    await agoric.follow('-lF', ':published.agoricNames.instance', '-o', 'text'),
  );
  assert(instance.VaultFactory);

  const body = {
    method: 'executeOffer',
    offer: {
      id,
      invitationSpec: {
        invitationMakerName: 'VoteOnParamChange',
        previousOffer: previousOfferId,
        source: 'continuing',
      },
      offerArgs: {
        deadline: smallCaps.Nat(deadline),
        instance: smallCaps.ref(instance.VaultFactory),
        params,
        path: paramsPath,
      },
      proposal: {},
    },
  };

  const capData = { body: `#${JSON.stringify(body)}`, slots };
  return JSON.stringify(capData);
};

export const proposeVaultDirectorParamChange = async (
  address,
  params,
  path,
) => {
  const charterAcceptOfferId = await agops.ec(
    'find-continuing-id',
    '--for',
    `${'charter\\ member\\ invitation'}`,
    '--from',
    address,
  );

  return executeOffer(
    address,
    generateVaultDirectorParamChange(charterAcceptOfferId, 30, params, path),
  );
};

export const voteForNewParams = (accounts, position) => {
  return Promise.all(
    accounts.map(account =>
      agops.ec('vote', '--forPosition', position, '--send-from', account),
    ),
  );
};
