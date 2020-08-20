// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'tape-promise/tape';
// eslint-disable-next-line import/no-extraneous-dependencies
import bundleSource from '@agoric/bundle-source';
import { E } from '@agoric/eventual-send';

import { setup } from '../setupBasicMints';
import { setupNonFungible } from '../setupNonFungibleMints';

const atomicSwapRoot = `${__dirname}/../../../src/contracts/atomicSwap`;

test('zoe - atomicSwap', async t => {
  t.plan(8);
  const { moolaKit, simoleanKit, moola, simoleans, zoe } = setup();

  const makeAlice = async moolaPayment => {
    const moolaPurse = await E(moolaKit.issuer).makeEmptyPurse();
    const simoleanPurse = await E(simoleanKit.issuer).makeEmptyPurse();
    return {
      installCode: async () => {
        // pack the contract
        const bundle = await bundleSource(atomicSwapRoot);
        // install the contract
        const installationP = E(zoe).install(bundle);
        return installationP;
      },
      startInstance: async installation => {
        const issuerKeywordRecord = harden({
          Asset: moolaKit.issuer,
          Price: simoleanKit.issuer,
        });
        const adminP = zoe.startInstance(installation, issuerKeywordRecord);
        return adminP;
      },
      offer: async firstInvitation => {
        const proposal = harden({
          give: { Asset: moola(3) },
          want: { Price: simoleans(7) },
          exit: { onDemand: null },
        });
        const payments = { Asset: moolaPayment };

        const seat = await E(zoe).offer(firstInvitation, proposal, payments);

        E(seat)
          .getPayout('Asset')
          .then(moolaPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              moola(0),
              `Alice didn't get any of what she put in`,
            ),
          );

        E(seat)
          .getPayout('Price')
          .then(simoleanPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              proposal.want.Price,
              `Alice got exactly what she wanted`,
            ),
          );

        // The result of making the first offer is an invitation to swap by
        // providing the other goods.
        const invitationP = E(seat).getOfferResult();
        return invitationP;
      },
    };
  };

  const makeBob = (installation, simoleanPayment) => {
    const moolaPurse = moolaKit.issuer.makeEmptyPurse();
    const simoleanPurse = simoleanKit.issuer.makeEmptyPurse();
    return harden({
      offer: async untrustedInvitation => {
        const invitationIssuer = await E(zoe).getInvitationIssuer();

        // Bob is able to use the trusted invitationIssuer from Zoe to
        // transform an untrusted invitation that Alice also has access to, to
        // an
        const invitation = await invitationIssuer.claim(untrustedInvitation);
        const invitationValue = await E(zoe).getInvitationDetails(invitation);

        t.equals(
          invitationValue.installation,
          installation,
          'installation is atomicSwap',
        );
        t.deepEquals(
          invitationValue.asset,
          moola(3),
          `asset to be traded is 3 moola`,
        );
        t.deepEquals(
          invitationValue.price,
          simoleans(7),
          `price is 7 simoleans, so bob must give that`,
        );

        const proposal = harden({
          give: { Price: simoleans(7) },
          want: { Asset: moola(3) },
          exit: { onDemand: null },
        });
        const payments = { Price: simoleanPayment };

        const seat = await zoe.offer(invitation, proposal, payments);

        t.equals(
          await E(seat).getOfferResult(),
          'The offer has been accepted. Once the contract has been completed, please check your payout',
        );

        E(seat)
          .getPayout('Asset')
          .then(moolaPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              proposal.want.Asset,
              `Bob got what he wanted`,
            ),
          );

        E(seat)
          .getPayout('Price')
          .then(simoleanPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              simoleans(0),
              `Bob didn't get anything back`,
            ),
          );
      },
    });
  };

  const alice = await makeAlice(await E(moolaKit.mint).mintPayment(moola(3)));

  // Alice makes an instance and makes her offer.
  const installation = await alice.installCode();

  const bob = await makeBob(
    installation,
    await E(simoleanKit.mint).mintPayment(simoleans(7)),
  );
  const { creatorInvitation } = await alice.startInstance(installation);
  const invitation = await alice.offer(creatorInvitation);

  // Alice spreads the invitation far and wide with instructions
  // on how to use it and Bob decides he wants to be the
  // counter-party, without needing to trust Alice at all.

  await bob.offer(invitation);
});

test('zoe - non-fungible atomicSwap', async t => {
  t.plan(8);
  const {
    ccIssuer,
    rpgIssuer,
    ccMint,
    rpgMint,
    cryptoCats,
    rpgItems,
    createRpgItem,
    zoe,
  } = setupNonFungible();

  const makeAlice = async aliceCcPayment => {
    const ccPurse = ccIssuer.makeEmptyPurse();
    const rpgPurse = rpgIssuer.makeEmptyPurse();
    return {
      installCode: async () => {
        // pack the contract
        const bundle = await bundleSource(atomicSwapRoot);
        // install the contract
        const installationP = E(zoe).install(bundle);
        return installationP;
      },
      startInstance: async installation => {
        const issuerKeywordRecord = harden({
          Asset: ccIssuer,
          Price: rpgIssuer,
        });
        const adminP = zoe.startInstance(installation, issuerKeywordRecord);
        return adminP;
      },
      offer: async (firstInvitation, calico37Amount, vorpalAmount) => {
        const proposal = harden({
          give: { Asset: calico37Amount },
          want: { Price: vorpalAmount },
          exit: { onDemand: null },
        });
        const payments = { Asset: aliceCcPayment };

        const seat = await zoe.offer(firstInvitation, proposal, payments);

        seat
          .getPayout('Asset')
          .then(ccPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              cryptoCats(harden([])),
              `Alice didn't get any of what she put in`,
            ),
          );

        seat
          .getPayout('Price')
          .then(rpgPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              proposal.want.Price,
              `Alice got exactly what she wanted`,
            ),
          );

        // The result of making the first offer is an invitation to swap by
        // providing the other goods.
        const invitationP = seat.getOfferResult();
        return invitationP;
      },
    };
  };

  const makeBob = (installation, rpgPayment) => {
    return harden({
      offer: async (untrustedInvitation, calico37Amount, vorpalAmount) => {
        const ccPurse = ccIssuer.makeEmptyPurse();
        const rpgPurse = rpgIssuer.makeEmptyPurse();

        const invitationIssuer = await E(zoe).getInvitationIssuer();

        // Bob is able to use the trusted invitationIssuer from Zoe to
        // transform an untrusted invitation that Alice also has access to, to
        // an
        const invitation = await invitationIssuer.claim(untrustedInvitation);
        const invitationValue = await E(zoe).getInvitationDetails(invitation);

        t.equals(
          invitationValue.installation,
          installation,
          'installation is atomicSwap',
        );
        t.deepEquals(
          invitationValue.asset,
          calico37Amount,
          `asset to be traded is a particular crypto cat`,
        );
        t.deepEquals(
          invitationValue.price,
          vorpalAmount,
          `price is vorpalAmount, so bob must give that`,
        );

        const proposal = harden({
          give: { Price: vorpalAmount },
          want: { Asset: calico37Amount },
          exit: { onDemand: null },
        });
        const payments = { Price: rpgPayment };

        const seat = await zoe.offer(invitation, proposal, payments);

        t.equals(
          await E(seat).getOfferResult(),
          'The offer has been accepted. Once the contract has been completed, please check your payout',
        );

        seat
          .getPayout('Asset')
          .then(ccPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              proposal.want.Asset,
              `Bob got what he wanted`,
            ),
          );

        seat
          .getPayout('Price')
          .then(rpgPurse.deposit)
          .then(amountDeposited =>
            t.deepEquals(
              amountDeposited,
              rpgItems(harden([])),
              `Bob didn't get anything back`,
            ),
          );
      },
    });
  };

  const calico37Amount = cryptoCats(harden(['calico #37']));
  const aliceCcPayment = await E(ccMint).mintPayment(calico37Amount);
  const alice = await makeAlice(aliceCcPayment);

  // Alice makes an instance and makes her offer.
  const installation = await alice.installCode();

  const vorpalSword = createRpgItem('Vorpal Sword', 38);
  const vorpalAmount = rpgItems(vorpalSword);
  const bobRpgPayment = await E(rpgMint).mintPayment(vorpalAmount);
  const bob = await makeBob(installation, bobRpgPayment);
  const { creatorInvitation } = await alice.startInstance(installation);
  const invitation = await alice.offer(
    creatorInvitation,
    calico37Amount,
    vorpalAmount,
  );

  // Alice spreads the invitation far and wide with instructions
  // on how to use it and Bob decides he wants to be the
  // counter-party, without needing to trust Alice at all.

  await bob.offer(invitation, calico37Amount, vorpalAmount);
});

// Checking handling of duplicate issuers. I'd have preferred a raffle contract
test('zoe - atomicSwap like-for-like', async t => {
  t.plan(13);
  const { moolaIssuer, moolaMint, moola, zoe } = setup();
  const invitationIssuer = zoe.getInvitationIssuer();

  // pack the contract
  const bundle = await bundleSource(atomicSwapRoot);
  // install the contract
  const installation = await zoe.install(bundle);

  // Setup Alice
  const aliceMoolaPayment = moolaMint.mintPayment(moola(3));
  const aliceMoolaPurse = moolaIssuer.makeEmptyPurse();

  // Setup Bob
  const bobMoolaPayment = moolaMint.mintPayment(moola(7));
  const bobMoolaPurse = moolaIssuer.makeEmptyPurse();

  // 1: Alice creates an atomicSwap instance
  const issuerKeywordRecord = harden({
    Asset: moolaIssuer,
    Price: moolaIssuer,
  });
  const { creatorInvitation: aliceInvitation } = await zoe.startInstance(
    installation,
    issuerKeywordRecord,
  );

  // 2: Alice escrows with zoe
  const aliceProposal = harden({
    give: { Asset: moola(3) },
    want: { Price: moola(7) },
    exit: { onDemand: null },
  });
  const alicePayments = { Asset: aliceMoolaPayment };

  // 3: Alice makes the first offer in the swap.
  const aliceSeat = await zoe.offer(
    aliceInvitation,
    aliceProposal,
    alicePayments,
  );

  // 4: Alice spreads the invitation far and wide with instructions
  // on how to use it and Bob decides he wants to be the
  // counter-party.

  const bobInvitationP = E(aliceSeat).getOfferResult();
  const bobExclusiveInvitation = await invitationIssuer.claim(bobInvitationP);
  const bobInvitationValue = await E(zoe).getInvitationDetails(
    bobExclusiveInvitation,
  );

  const bobIssuers = zoe.getIssuers(bobInvitationValue.instance);

  t.equals(bobInvitationValue.installation, installation, 'bobInstallationId');
  t.deepEquals(bobIssuers, { Asset: moolaIssuer, Price: moolaIssuer });
  t.deepEquals(bobInvitationValue.asset, moola(3));
  t.deepEquals(bobInvitationValue.price, moola(7));

  const bobProposal = harden({
    give: { Price: moola(7) },
    want: { Asset: moola(3) },
    exit: { onDemand: null },
  });
  const bobPayments = { Price: bobMoolaPayment };

  // 5: Bob makes an offer
  const bobSeat = await zoe.offer(
    bobExclusiveInvitation,
    bobProposal,
    bobPayments,
  );

  t.equals(
    await E(bobSeat).getOfferResult(),
    'The offer has been accepted. Once the contract has been completed, please check your payout',
  );

  const bobAssetPayout = await bobSeat.getPayout('Asset');
  const bobPricePayout = await bobSeat.getPayout('Price');

  const aliceAssetPayout = await aliceSeat.getPayout('Asset');
  const alicePricePayout = await aliceSeat.getPayout('Price');

  // Alice gets what Alice wanted
  t.deepEquals(
    await moolaIssuer.getAmountOf(alicePricePayout),
    aliceProposal.want.Price,
  );

  // Alice didn't get any of what Alice put in
  t.deepEquals(await moolaIssuer.getAmountOf(aliceAssetPayout), moola(0));

  // Alice deposits her payout to ensure she can
  const aliceAssetAmount = await aliceMoolaPurse.deposit(aliceAssetPayout);
  t.equals(aliceAssetAmount.value, 0);
  const alicePriceAmount = await aliceMoolaPurse.deposit(alicePricePayout);
  t.equals(alicePriceAmount.value, 7);

  // Bob deposits his original payments to ensure he can
  const bobAssetAmount = await bobMoolaPurse.deposit(bobAssetPayout);
  t.equals(bobAssetAmount.value, 3);
  const bobPriceAmount = await bobMoolaPurse.deposit(bobPricePayout);
  t.equals(bobPriceAmount.value, 0);

  // Assert that the correct payouts were received.
  // Alice had 3 moola from Asset and 0 from Price.
  // Bob had 0 moola from Asset and 7 from Price.
  t.equals(aliceMoolaPurse.getCurrentAmount().value, 7);
  t.equals(bobMoolaPurse.getCurrentAmount().value, 3);
});
