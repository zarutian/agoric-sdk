// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from 'tape-promise/tape';
// eslint-disable-next-line import/no-extraneous-dependencies
import bundleSource from '@agoric/bundle-source';

import harden from '@agoric/harden';

import { makeZoe } from '../../..';
// TODO: Remove setupBasicMints and rename setupBasicMints2
import { setup } from '../setupBasicMints';

const grifterRoot = `${__dirname}/grifter`;

test('zoe - grifter tries to steal; prevented by offer safety', async t => {
  t.plan(1);
  // Setup zoe and mints
  const { moola, moolaR, moolaMint, bucksR, bucks } = setup();
  const zoe = makeZoe({ require });
  // Pack the contract.
  const { source, moduleFormat } = await bundleSource(grifterRoot);
  const installationHandle = zoe.install(source, moduleFormat);

  const issuerKeywordRecord = harden({
    Asset: bucksR.issuer,
    Price: moolaR.issuer,
  });

  const { invite: malloryInvite } = await zoe.makeInstance(
    installationHandle,
    issuerKeywordRecord,
  );

  // Mallory doesn't need any money
  const malloryProposal = harden({
    want: { Price: moola(37) },
  });
  const { outcome: vicInviteP } = await zoe.offer(
    malloryInvite,
    malloryProposal,
    harden({}),
  );

  const vicMoolaPayment = moolaMint.mintPayment(moola(37));
  const vicProposal = harden({
    give: { Price: moola(37) },
    want: { Asset: bucks(24) },
    exit: { onDemand: null },
  });
  const vicPayments = { Price: vicMoolaPayment };
  const { outcome: vicOutcomeP } = await zoe.offer(
    vicInviteP,
    vicProposal,
    vicPayments,
  );

  t.rejects(
    vicOutcomeP,
    /The proposed reallocation was not offer safe/,
    `vicOffer is rejected`,
  );
});
