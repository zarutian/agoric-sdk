// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'tape-promise/tape';
import bundleSource from '@agoric/bundle-source';
import { E } from '@agoric/eventual-send';

// noinspection ES6PreferShortImport
import { makeZoe } from '../../../src/zoeService/zoe';
import { setup } from '../setupBasicMints';
import { setupMixed } from '../setupMixedMints';
import fakeVatAdmin from './fakeVatAdmin';

const publicAuctionRoot = `${__dirname}/../../../src/contracts/publicAuction`;

test('zoe - secondPriceAuction w/ 3 bids', async t => {
  t.plan(15);
  try {
    const { moolaKit, simoleanKit, moola, simoleans, zoe } = setup();

    const makeAlice = async moolaPayment => {
      const moolaPurse = await E(moolaKit.issuer).makeEmptyPurse();
      const simoleanPurse = await E(simoleanKit.issuer).makeEmptyPurse();
      return {
        installCode: async () => {
          // pack the contract
          const bundle = await bundleSource(publicAuctionRoot);
          // install the contract
          const installationP = E(zoe).install(bundle);
          return installationP;
        },
        startInstance: async installation => {
          const issuerKeywordRecord = harden({
            Asset: moolaKit.issuer,
            Ask: simoleanKit.issuer,
          });
          const terms = harden({ numBidsAllowed: 3 });
          const adminP = zoe.startInstance(
            installation,
            issuerKeywordRecord,
            terms,
          );
          return adminP;
        },
        offer: async sellInvitation => {
          const proposal = harden({
            give: { Asset: moola(1) },
            want: { Ask: simoleans(3) },
          });

          const payments = { Asset: moolaPayment };

          const seat = await E(zoe).offer(sellInvitation, proposal, payments);

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
            .getPayout('Ask')
            .then(simoleanPurse.deposit)
            .then(amountDeposited =>
              t.deepEquals(
                amountDeposited,
                simoleans(7),
                `Alice got the second price bid, Carol's bid, even though Bob won`,
              ),
            );

          const makeBidInvitationObj = await E(seat).getOfferResult();
          return makeBidInvitationObj;
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
            'installation is publicAuction',
          );
          t.deepEquals(
            invitationValue.auctionedAssets,
            moola(1),
            `asset to be auctioned is 1 moola`,
          );
          t.deepEquals(
            invitationValue.minimumBid,
            simoleans(3),
            `minimum bid is 3 simoleans`,
          );

          t.deepEquals(
            invitationValue.numBidsAllowed,
            3,
            `auction will be closed after 3 bids`,
          );

          const proposal = harden({
            give: { Bid: simoleans(11) },
            want: { Asset: moola(1) },
          });
          const payments = { Bid: simoleanPayment };

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
                `Bob wins the auction`,
              ),
            );

          E(seat)
            .getPayout('Bid')
            .then(simoleanPurse.deposit)
            .then(amountDeposited =>
              t.deepEquals(
                amountDeposited,
                simoleans(4),
                `Bob gets the difference between the second-price bid (Carol's 7 simoleans) and his bid back`,
              ),
            );
        },
      });
    };

    const makeLosingBidder = (bidAmount, simoleanPayment) => {
      const moolaPurse = moolaKit.issuer.makeEmptyPurse();
      const simoleanPurse = simoleanKit.issuer.makeEmptyPurse();
      return harden({
        offer: async untrustedInvitation => {
          const invitationIssuer = await E(zoe).getInvitationIssuer();
          const invitation = await invitationIssuer.claim(untrustedInvitation);

          const proposal = harden({
            give: { Bid: bidAmount },
            want: { Asset: moola(1) },
          });
          const payments = { Bid: simoleanPayment };

          const seat = await zoe.offer(invitation, proposal, payments);

          t.equals(
            await E(seat).getOfferResult(),
            'The offer has been accepted. Once the contract has been completed, please check your payout',
          );

          E(seat)
            .getPayout('Asset')
            .then(moolaPurse.deposit)
            .then(amountDeposited =>
              t.deepEquals(amountDeposited, moola(0), `didn't win the auction`),
            );

          E(seat)
            .getPayout('Bid')
            .then(simoleanPurse.deposit)
            .then(amountDeposited =>
              t.deepEquals(amountDeposited, bidAmount, `full refund`),
            );
        },
      });
    };

    // Setup Alice
    const alice = await makeAlice(moolaKit.mint.mintPayment(moola(1)));
    const installation = await alice.installCode();

    // Setup Bob, Carol, Dave
    const bob = makeBob(
      installation,
      await simoleanKit.mint.mintPayment(simoleans(11)),
    );
    const carol = makeLosingBidder(
      simoleans(7),
      await simoleanKit.mint.mintPayment(simoleans(7)),
    );
    const dave = makeLosingBidder(
      simoleans(5),
      await simoleanKit.mint.mintPayment(simoleans(5)),
    );

    const { creatorInvitation } = await alice.startInstance(installation);

    const makeInvitationsObj = await alice.offer(creatorInvitation);

    const bidInvitation1 = E(makeInvitationsObj).makeBidInvitation();
    const bidInvitation2 = E(makeInvitationsObj).makeBidInvitation();
    const bidInvitation3 = E(makeInvitationsObj).makeBidInvitation();

    bob.offer(bidInvitation1);
    carol.offer(bidInvitation2);
    dave.offer(bidInvitation3);
  } catch (e) {
    t.assert(false, e);
    console.log(e);
  }
});

test('zoe - secondPriceAuction w/ 3 bids - alice exits onDemand', async t => {
  t.plan(9);
  try {
    const { moolaR, simoleanR, moola, simoleans } = setup();
    const zoe = makeZoe(fakeVatAdmin);

    // Setup Alice
    const aliceMoolaPayment = moolaR.mint.mintPayment(moola(1));
    const aliceMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const aliceSimoleanPurse = simoleanR.issuer.makeEmptyPurse();

    // Setup Bob
    const bobSimoleanPayment = simoleanR.mint.mintPayment(simoleans(11));
    const bobMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const bobSimoleanPurse = simoleanR.issuer.makeEmptyPurse();

    // Alice creates a secondPriceAuction instance

    // Pack the contract.
    const bundle = await bundleSource(publicAuctionRoot);

    const installation = await zoe.install(bundle);
    const numBidsAllowed = 3;
    const issuerKeywordRecord = harden({
      Asset: moolaR.issuer,
      Ask: simoleanR.issuer,
    });
    const terms = harden({ numBidsAllowed });
    const { creatorInvitation: aliceInvitation } = await zoe.startInstance(
      installation,
      issuerKeywordRecord,
      terms,
    );

    // Alice escrows with zoe
    const aliceProposal = harden({
      give: { Asset: moola(1) },
      want: { Ask: simoleans(3) },
    });
    const alicePayments = harden({ Asset: aliceMoolaPayment });
    // Alice initializes the auction
    const aliceSeat = await zoe.offer(
      aliceInvitation,
      aliceProposal,
      alicePayments,
    );
    const makeInvitationObj = await E(aliceSeat).getOfferResult();

    const bobInvitation = await E(makeInvitationObj).makeBidInvitation();

    // Alice completes her offer, making the auction stop accepting
    // offers
    aliceSeat.tryExit();

    // Alice gives Bob the invitation

    const bobProposal = harden({
      want: { Asset: moola(1) },
      give: { Bid: simoleans(11) },
    });
    const bobPayments = harden({ Bid: bobSimoleanPayment });

    // Bob escrows with zoe
    // Bob bids
    const bobSeat = await zoe.offer(bobInvitation, bobProposal, bobPayments);

    t.rejects(
      () => E(bobSeat).getOfferResult(),
      /The item up for auction is not available or the auction has completed/,
      'The bid should have failed.',
    );

    const aliceMoolaPayout = await aliceSeat.getPayout('Asset');
    const aliceSimoleanPayout = await aliceSeat.getPayout('Ask');
    const bobMoolaPayout = await bobSeat.getPayout('Asset');
    const bobSimoleanPayout = await bobSeat.getPayout('Bid');

    // Alice (the creator of the auction) gets back what she put in
    t.deepEquals(
      await moolaR.issuer.getAmountOf(aliceMoolaPayout),
      aliceProposal.give.Asset,
    );

    // Alice didn't get any of what she wanted
    t.deepEquals(
      await simoleanR.issuer.getAmountOf(aliceSimoleanPayout),
      simoleans(0),
    );

    // Alice deposits her payout to ensure she can
    await aliceMoolaPurse.deposit(aliceMoolaPayout);
    await aliceSimoleanPurse.deposit(aliceSimoleanPayout);

    // Bob gets a refund
    t.deepEquals(await moolaR.issuer.getAmountOf(bobMoolaPayout), moola(0));
    t.deepEquals(
      await simoleanR.issuer.getAmountOf(bobSimoleanPayout),
      bobProposal.give.Bid,
    );

    // Bob deposits his payout to ensure he can
    await bobMoolaPurse.deposit(bobMoolaPayout);
    await bobSimoleanPurse.deposit(bobSimoleanPayout);

    // Assert that the correct refunds were received.
    // Alice had 1 moola and 0 simoleans.
    // Bob had 0 moola and 11 simoleans.
    // Carol had 0 moola and 7 simoleans.
    // Dave had 0 moola and 5 simoleans.
    t.equals(aliceMoolaPurse.getCurrentAmount().value, 1);
    t.equals(aliceSimoleanPurse.getCurrentAmount().value, 0);
    t.equals(bobMoolaPurse.getCurrentAmount().value, 0);
    t.equals(bobSimoleanPurse.getCurrentAmount().value, 11);
  } catch (e) {
    t.assert(false, e);
    console.log(e);
  }
});

// Three bidders with (fungible) moola bid for a CryptoCat
test('zoe - secondPriceAuction non-fungible asset', async t => {
  t.plan(33);
  const {
    ccIssuer,
    moolaIssuer,
    ccMint,
    moolaMint,
    cryptoCats,
    moola,
    zoe,
  } = setupMixed();
  const invitationIssuer = zoe.getInvitationIssuer();

  // Setup Alice
  const aliceCcPayment = ccMint.mintPayment(cryptoCats(harden(['Felix'])));
  const aliceCcPurse = ccIssuer.makeEmptyPurse();
  const aliceMoolaPurse = moolaIssuer.makeEmptyPurse();

  // Setup Bob
  const bobMoolaPayment = moolaMint.mintPayment(moola(11));
  const bobCcPurse = ccIssuer.makeEmptyPurse();
  const bobMoolaPurse = moolaIssuer.makeEmptyPurse();

  // Setup Carol
  const carolMoolaPayment = moolaMint.mintPayment(moola(7));
  const carolCcPurse = ccIssuer.makeEmptyPurse();
  const carolMoolaPurse = moolaIssuer.makeEmptyPurse();

  // Setup Dave
  const daveMoolaPayment = moolaMint.mintPayment(moola(5));
  const daveCcPurse = ccIssuer.makeEmptyPurse();
  const daveMoolaPurse = moolaIssuer.makeEmptyPurse();

  // Alice creates a secondPriceAuction instance

  // Pack the contract.
  const bundle = await bundleSource(publicAuctionRoot);

  const installation = await zoe.install(bundle);
  const numBidsAllowed = 3;
  const issuerKeywordRecord = harden({
    Asset: ccIssuer,
    Ask: moolaIssuer,
  });
  const terms = harden({ numBidsAllowed });
  const { creatorInvitation: aliceInvitation } = await zoe.startInstance(
    installation,
    issuerKeywordRecord,
    terms,
  );

  // Alice escrows with zoe
  const aliceProposal = harden({
    give: { Asset: cryptoCats(harden(['Felix'])) },
    want: { Ask: moola(3) },
  });
  const alicePayments = { Asset: aliceCcPayment };
  // Alice initializes the auction
  const aliceSeat = await zoe.offer(
    aliceInvitation,
    aliceProposal,
    alicePayments,
  );
  const makeBidInvitationObj = await E(aliceSeat).getOfferResult();
  const bobInvitation = E(makeBidInvitationObj).makeBidInvitation();
  const carolInvitation = E(makeBidInvitationObj).makeBidInvitation();
  const daveInvitation = E(makeBidInvitationObj).makeBidInvitation();

  // Alice spreads the invitations far and wide and Bob decides he
  // wants to participate in the auction.
  const bobExclusiveInvitation = await invitationIssuer.claim(bobInvitation);
  const bobInvitationValue = await E(zoe).getInvitationDetails(
    bobExclusiveInvitation,
  );

  const bobTerms = zoe.getTerms(bobInvitationValue.instance);
  const bobIssuers = zoe.getIssuers(bobInvitationValue.instance);

  t.equals(bobInvitationValue.installation, installation, 'bobInstallationId');
  t.deepEquals(bobIssuers, { Asset: ccIssuer, Ask: moolaIssuer }, 'bobIssuers');
  t.equals(bobTerms.numBidsAllowed, 3, 'bobTerms');
  t.deepEquals(bobInvitationValue.minimumBid, moola(3), 'minimumBid');
  t.deepEquals(
    bobInvitationValue.auctionedAssets,
    cryptoCats(harden(['Felix'])),
    'assets',
  );

  const bobProposal = harden({
    give: { Bid: moola(11) },
    want: { Asset: cryptoCats(harden(['Felix'])) },
  });
  const bobPayments = { Bid: bobMoolaPayment };

  // Bob escrows with zoe
  // Bob bids
  const bobSeat = await zoe.offer(
    bobExclusiveInvitation,
    bobProposal,
    bobPayments,
  );

  t.equals(
    await E(bobSeat).getOfferResult(),
    'The offer has been accepted. Once the contract has been completed, please check your payout',
    'bobOutcome',
  );

  // Carol decides to bid for the one cc

  const carolExclusiveInvitation = await invitationIssuer.claim(
    carolInvitation,
  );
  const carolInvitationValue = await E(zoe).getInvitationDetails(
    carolExclusiveInvitation,
  );

  const carolTerms = zoe.getTerms(carolInvitationValue.instance);
  const carolIssuers = zoe.getIssuers(carolInvitationValue.instance);

  t.equals(
    carolInvitationValue.installation,
    installation,
    'carolInstallationId',
  );
  t.deepEquals(
    carolIssuers,
    { Asset: ccIssuer, Ask: moolaIssuer },
    'carolIssuers',
  );
  t.equals(carolTerms.numBidsAllowed, 3, 'carolTerms');
  t.deepEquals(carolInvitationValue.minimumBid, moola(3), 'carolMinimumBid');
  t.deepEquals(
    carolInvitationValue.auctionedAssets,
    cryptoCats(harden(['Felix'])),
    'carolAuctionedAssets',
  );

  const carolProposal = harden({
    give: { Bid: moola(7) },
    want: { Asset: cryptoCats(harden(['Felix'])) },
  });
  const carolPayments = { Bid: carolMoolaPayment };

  // Carol escrows with zoe
  // Carol bids
  const carolSeat = await zoe.offer(
    carolExclusiveInvitation,
    carolProposal,
    carolPayments,
  );

  t.equals(
    await E(carolSeat).getOfferResult(),
    'The offer has been accepted. Once the contract has been completed, please check your payout',
    'carolOutcome',
  );

  // Dave decides to bid for the one moola
  const daveExclusiveInvitation = await invitationIssuer.claim(daveInvitation);
  const daveInvitationValue = await E(zoe).getInvitationDetails(
    daveExclusiveInvitation,
  );

  const daveTerms = zoe.getTerms(daveInvitationValue.instance);
  const daveIssuers = zoe.getIssuers(daveInvitationValue.instance);

  t.equals(daveInvitationValue.installation, installation, 'daveInstallation');
  t.deepEquals(
    daveIssuers,
    { Asset: ccIssuer, Ask: moolaIssuer },
    'daveIssuers',
  );
  t.equals(daveTerms.numBidsAllowed, 3, 'bobTerms');
  t.deepEquals(daveInvitationValue.minimumBid, moola(3), 'daveMinimumBid');
  t.deepEquals(
    daveInvitationValue.auctionedAssets,
    cryptoCats(harden(['Felix'])),
    'daveAssets',
  );

  const daveProposal = harden({
    give: { Bid: moola(5) },
    want: { Asset: cryptoCats(harden(['Felix'])) },
  });
  const davePayments = { Bid: daveMoolaPayment };

  // Dave escrows with zoe
  // Dave bids
  const daveSeat = await zoe.offer(
    daveExclusiveInvitation,
    daveProposal,
    davePayments,
  );

  t.equals(
    await E(daveSeat).getOfferResult(),
    'The offer has been accepted. Once the contract has been completed, please check your payout',
    'daveOutcome',
  );

  const aliceCcPayout = await aliceSeat.getPayout('Asset');
  const aliceMoolaPayout = await aliceSeat.getPayout('Ask');

  const bobCcPayout = await bobSeat.getPayout('Asset');
  const bobMoolaPayout = await bobSeat.getPayout('Bid');

  const carolCcPayout = await carolSeat.getPayout('Asset');
  const carolMoolaPayout = await carolSeat.getPayout('Bid');

  const daveCcPayout = await daveSeat.getPayout('Asset');
  const daveMoolaPayout = await daveSeat.getPayout('Bid');

  // Alice (the creator of the auction) gets back the second highest bid
  t.deepEquals(
    await moolaIssuer.getAmountOf(aliceMoolaPayout),
    carolProposal.give.Bid,
    `alice gets carol's bid`,
  );

  // Alice didn't get any of what she put in
  t.deepEquals(
    await ccIssuer.getAmountOf(aliceCcPayout),
    cryptoCats(harden([])),
    `alice gets nothing of what she put in`,
  );

  // Alice deposits her payout to ensure she can
  await aliceCcPurse.deposit(aliceCcPayout);
  await aliceMoolaPurse.deposit(aliceMoolaPayout);

  // Bob (the winner of the auction) gets the one moola and the
  // difference between his bid and the price back
  t.deepEquals(
    await ccIssuer.getAmountOf(bobCcPayout),
    cryptoCats(harden(['Felix'])),
    `bob is the winner`,
  );
  t.deepEquals(
    await moolaIssuer.getAmountOf(bobMoolaPayout),
    moola(4),
    `bob gets difference back`,
  );

  // Bob deposits his payout to ensure he can
  await bobCcPurse.deposit(bobCcPayout);
  await bobMoolaPurse.deposit(bobMoolaPayout);

  // Carol gets a full refund
  t.deepEquals(
    await ccIssuer.getAmountOf(carolCcPayout),
    cryptoCats(harden([])),
    `carol doesn't win`,
  );
  t.deepEquals(
    await moolaIssuer.getAmountOf(carolMoolaPayout),
    carolProposal.give.Bid,
    `carol gets a refund`,
  );

  // Carol deposits her payout to ensure she can
  await carolCcPurse.deposit(carolCcPayout);
  await carolMoolaPurse.deposit(carolMoolaPayout);

  // Dave gets a full refund
  t.deepEquals(
    await moolaIssuer.getAmountOf(daveMoolaPayout),
    daveProposal.give.Bid,
    `dave gets a refund`,
  );

  // Dave deposits his payout to ensure he can
  await daveCcPurse.deposit(daveCcPayout);
  await daveMoolaPurse.deposit(daveMoolaPayout);

  // Assert that the correct payout were received.
  // Alice had 1 CryptoCat and an empty CryptoCat purse.
  // Bob had an empty CryptoCat purse and 11 moola.
  // Carol had an empty CryptoCat purse and 7 moola.
  // Dave had an empty CryptoCat purse and 5 moola.

  // Now, they should have:
  // Alice: an empty CryptoCat purse and 7 moola
  // Bob: the CryptoCat and 4 moola
  // Carol: an empty CryptoCat purse and 7 moola
  // Dave: an empty CryptoCat purse and 5 moola
  t.deepEquals(aliceCcPurse.getCurrentAmount().value, []);
  t.equals(aliceMoolaPurse.getCurrentAmount().value, 7);
  t.deepEquals(bobCcPurse.getCurrentAmount().value, ['Felix']);
  t.equals(bobMoolaPurse.getCurrentAmount().value, 4);
  t.deepEquals(carolCcPurse.getCurrentAmount().value, []);
  t.equals(carolMoolaPurse.getCurrentAmount().value, 7);
  t.deepEquals(daveCcPurse.getCurrentAmount().value, []);
  t.equals(daveMoolaPurse.getCurrentAmount().value, 5);
});
