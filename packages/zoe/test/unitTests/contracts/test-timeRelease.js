// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from 'tape-promise/tape';
// eslint-disable-next-line import/no-extraneous-dependencies
import bundleSource from '@agoric/bundle-source';
import harden from '@agoric/harden';
import { E } from '@agoric/eventual-send';
import produceIssuer from '@agoric/ertp';

import { makeZoe } from '../../../src/zoe';

const timeReleaseRoot = `${__dirname}/../../../src/contracts/timeRelease`;

test.only('zoe - time release', async t => {
  t.plan(1);
  try {
    const zoe = makeZoe({ require });
    // Pack the contract.
    const { source, moduleFormat } = await bundleSource(timeReleaseRoot);
    const installationHandle = await E(zoe).install(source, moduleFormat);

    const { mint, issuer, amountMath } = produceIssuer('aliceBucks');

    // TODO: make real timer obj
    const timer = {};

    // Alice creates a contract instance
    const addAssetsInvite = await E(zoe).makeInstance(
      installationHandle,
      { Token: issuer },
      { timer },
    );

    // Alice adds assets
    const tokens1000 = amountMath.make(1000);
    const bucksPayment = mint.mintPayment(tokens1000);
    const aliceProposal = harden({
      give: { Token: tokens1000 },
      // she will not be able to exit on her own. We could also have a
      // deadline that is after the expected timed release of the funds.
      exit: { waived: null },
    });
    const { outcome: bobInvite } = await E(zoe).offer(
      addAssetsInvite,
      aliceProposal,
      { Token: bucksPayment },
    );

    // Bob tries to get the funds. Right now he can get them
    // immediately because we didn't set up the timer
    const { payout: payoutP } = await E(zoe).offer(bobInvite);

    // Bob's payout promise resolves
    const bobPayout = await payoutP;
    const bobTokenPayout = await bobPayout.Token;

    const tokenPayoutAmount = await issuer.getAmountOf(bobTokenPayout);

    // Bob got 1000 tokens
    t.deepEquals(tokenPayoutAmount, tokens1000);
  } catch (e) {
    t.assert(false, e);
    console.log(e);
  }
});
