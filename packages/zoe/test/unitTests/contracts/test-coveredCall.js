// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'tape-promise/tape';
import bundleSource from '@agoric/bundle-source';
import { E } from '@agoric/eventual-send';

import { sameStructure } from '@agoric/same-structure';
import { makeLocalAmountMath } from '@agoric/ertp';

import buildManualTimer from '../../../tools/manualTimer';
import { setup } from '../setupBasicMints';
import { setupNonFungible } from '../setupNonFungibleMints';

const coveredCallRoot = `${__dirname}/../../../src/contracts/coveredCall`;
const atomicSwapRoot = `${__dirname}/../../../src/contracts/atomicSwap`;

test('zoe - coveredCall', async t => {
  t.plan(11);
  try {
    const { moolaKit, simoleanKit, moola, simoleans, zoe } = setup();

    const makeAlice = async (timer, moolaPayment) => {
      const moolaPurse = await E(moolaKit.issuer).makeEmptyPurse();
      const simoleanPurse = await E(simoleanKit.issuer).makeEmptyPurse();
      return {
        installCode: async () => {
          // pack the contract
          const bundle = await bundleSource(coveredCallRoot);
          // install the contract
          const installationP = E(zoe).install(bundle);
          return installationP;
        },
        startInstance: async installation => {
          const issuerKeywordRecord = harden({
            UnderlyingAsset: moolaKit.issuer,
            StrikePrice: simoleanKit.issuer,
          });
          const adminP = zoe.startInstance(installation, issuerKeywordRecord);
          return adminP;
        },
        offer: async createCallOptionInvitation => {
          const proposal = harden({
            give: { UnderlyingAsset: moola(3) },
            want: { StrikePrice: simoleans(7) },
            exit: { afterDeadline: { deadline: 1, timer } },
          });
          const payments = { UnderlyingAsset: moolaPayment };

          const seat = await E(zoe).offer(
            createCallOptionInvitation,
            proposal,
            payments,
          );

          E(seat)
            .getPayout('UnderlyingAsset')
            .then(moolaPurse.deposit)
            .then(amountDeposited =>
              t.deepEquals(
                amountDeposited,
                moola(0),
                `Alice didn't get any of what she put in`,
              ),
            );

          E(seat)
            .getPayout('StrikePrice')
            .then(simoleanPurse.deposit)
            .then(amountDeposited =>
              t.deepEquals(
                amountDeposited,
                proposal.want.StrikePrice,
                `Alice got exactly what she wanted`,
              ),
            );

          // The result of making the first offer is the call option
          // digital asset. It is simultaneously actually an invitation to
          // exercise the option.
          const invitationP = E(seat).getOfferResult();
          return invitationP;
        },
      };
    };

    const makeBob = (timer, installation, simoleanPayment) => {
      const moolaPurse = moolaKit.issuer.makeEmptyPurse();
      const simoleanPurse = simoleanKit.issuer.makeEmptyPurse();
      return harden({
        offer: async untrustedInvitation => {
          const invitationIssuer = await E(zoe).getInvitationIssuer();

          // Bob is able to use the trusted invitationIssuer from Zoe to
          // transform an untrusted invitation that Alice also has access to
          const invitation = await E(invitationIssuer).claim(
            untrustedInvitation,
          );

          const invitationValue = await E(zoe).getInvitationDetails(invitation);

          t.equals(
            invitationValue.installation,
            installation,
            'installation is atomicSwap',
          );
          t.equal(invitationValue.description, 'exerciseOption');

          t.deepEquals(
            invitationValue.underlyingAsset,
            moola(3),
            `underlying asset is 3 moola`,
          );
          t.deepEquals(
            invitationValue.strikePrice,
            simoleans(7),
            `strike price is 7 simoleans, so bob must give that`,
          );

          t.equal(invitationValue.expirationDate, 1);
          t.deepEqual(invitationValue.timerAuthority, timer);

          const proposal = harden({
            give: { StrikePrice: simoleans(7) },
            want: { UnderlyingAsset: moola(3) },
            exit: { onDemand: null },
          });
          const payments = { StrikePrice: simoleanPayment };

          const seat = await E(zoe).offer(invitation, proposal, payments);

          t.equals(
            await E(seat).getOfferResult(),
            'The offer has been accepted. Once the contract has been completed, please check your payout',
          );

          E(seat)
            .getPayout('UnderlyingAsset')
            .then(moolaPurse.deposit)
            .then(amountDeposited =>
              t.deepEquals(
                amountDeposited,
                proposal.want.UnderlyingAsset,
                `Bob got what he wanted`,
              ),
            );

          E(seat)
            .getPayout('StrikePrice')
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

    const timer = buildManualTimer(console.log);

    // Setup Alice
    const aliceMoolaPayment = moolaKit.mint.mintPayment(moola(3));
    const alice = await makeAlice(timer, aliceMoolaPayment);

    // Alice makes an instance and makes her offer.
    const installation = await alice.installCode();

    // Setup Bob
    const bobSimoleanPayment = simoleanKit.mint.mintPayment(simoleans(7));
    const bob = makeBob(timer, installation, bobSimoleanPayment);

    const { creatorInvitation } = await alice.startInstance(installation);
    const invitation = await alice.offer(creatorInvitation);

    // Alice spreads the invitation far and wide with instructions
    // on how to use it and Bob decides he wants to be the
    // counter-party, without needing to trust Alice at all.
    await bob.offer(invitation);
  } catch (e) {
    t.isNot(e, e, 'unexpected exception');
  }
});

test(`zoe - coveredCall - alice's deadline expires, cancelling alice and bob`, async t => {
  t.plan(13);
  try {
    const { moolaR, simoleanR, moola, simoleans, zoe } = setup();
    // Pack the contract.
    const bundle = await bundleSource(coveredCallRoot);
    const coveredCallInstallation = await zoe.install(bundle);
    const timer = buildManualTimer(console.log);

    // Setup Alice
    const aliceMoolaPayment = moolaR.mint.mintPayment(moola(3));
    const aliceMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const aliceSimoleanPurse = simoleanR.issuer.makeEmptyPurse();

    // Setup Bob
    const bobSimoleanPayment = simoleanR.mint.mintPayment(simoleans(7));
    const bobMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const bobSimoleanPurse = simoleanR.issuer.makeEmptyPurse();

    // Alice creates a coveredCall instance
    const issuerKeywordRecord = harden({
      UnderlyingAsset: moolaR.issuer,
      StrikePrice: simoleanR.issuer,
    });
    const { creatorInvitation: aliceInvitation } = await zoe.startInstance(
      coveredCallInstallation,
      issuerKeywordRecord,
    );

    // Alice escrows with Zoe
    const aliceProposal = harden({
      give: { UnderlyingAsset: moola(3) },
      want: { StrikePrice: simoleans(7) },
      exit: {
        afterDeadline: {
          deadline: 1,
          timer,
        },
      },
    });
    const alicePayments = { UnderlyingAsset: aliceMoolaPayment };
    // Alice makes an option
    const aliceSeat = await zoe.offer(
      aliceInvitation,
      aliceProposal,
      alicePayments,
    );
    timer.tick();

    const optionP = E(aliceSeat).getOfferResult();

    // Imagine that Alice sends the option to Bob for free (not done here
    // since this test doesn't actually have separate vats/parties)

    // Bob inspects the option (an invitation payment) and checks that it is the
    // contract instance that he expects as well as that Alice has
    // already escrowed.

    const invitationIssuer = zoe.getInvitationIssuer();
    const bobExclOption = await invitationIssuer.claim(optionP);
    const optionValue = await E(zoe).getInvitationDetails(bobExclOption);
    t.equal(optionValue.installation, coveredCallInstallation);
    t.equal(optionValue.description, 'exerciseOption');
    t.ok(moolaR.amountMath.isEqual(optionValue.underlyingAsset, moola(3)));
    t.ok(simoleanR.amountMath.isEqual(optionValue.strikePrice, simoleans(7)));
    t.equal(optionValue.expirationDate, 1);
    t.deepEqual(optionValue.timerAuthority, timer);

    const bobPayments = { StrikePrice: bobSimoleanPayment };

    const bobProposal = harden({
      want: { UnderlyingAsset: optionValue.underlyingAsset },
      give: { StrikePrice: optionValue.strikePrice },
    });

    // Bob escrows
    const bobSeat = await zoe.offer(bobExclOption, bobProposal, bobPayments);

    t.rejects(
      () => E(bobSeat).getOfferResult(),
      /The covered call option is expired./,
      'The call option should be expired',
    );

    const bobMoolaPayout = await E(bobSeat).getPayout('UnderlyingAsset');
    const bobSimoleanPayout = await E(bobSeat).getPayout('StrikePrice');
    const aliceMoolaPayout = await E(aliceSeat).getPayout('UnderlyingAsset');
    const aliceSimoleanPayout = await E(aliceSeat).getPayout('StrikePrice');

    // Alice gets back what she put in
    t.deepEquals(await moolaR.issuer.getAmountOf(aliceMoolaPayout), moola(3));

    // Alice doesn't get what she wanted
    t.deepEquals(
      await simoleanR.issuer.getAmountOf(aliceSimoleanPayout),
      simoleans(0),
    );

    // Alice deposits her winnings to ensure she can
    await aliceMoolaPurse.deposit(aliceMoolaPayout);
    await aliceSimoleanPurse.deposit(aliceSimoleanPayout);

    // Bob deposits his winnings to ensure he can
    await bobMoolaPurse.deposit(bobMoolaPayout);
    await bobSimoleanPurse.deposit(bobSimoleanPayout);

    // Assert that the correct outcome was achieved.
    // Alice had 3 moola and 0 simoleans.
    // Bob had 0 moola and 7 simoleans.
    t.deepEquals(aliceMoolaPurse.getCurrentAmount(), moola(3));
    t.deepEquals(aliceSimoleanPurse.getCurrentAmount(), simoleans(0));
    t.deepEquals(bobMoolaPurse.getCurrentAmount(), moola(0));
    t.deepEquals(bobSimoleanPurse.getCurrentAmount(), simoleans(7));
  } catch (e) {
    t.isNot(e, e, 'unexpected exception');
  }
});

// Alice makes a covered call and escrows. She shares the invitation to
// Bob. Bob tries to sell the invitation to Dave through a swap. Can Bob
// trick Dave? Can Dave describe what it is that he wants in the swap
// offer description?
test('zoe - coveredCall with swap for invitation', async t => {
  t.plan(24);
  try {
    // Setup the environment
    const timer = buildManualTimer(console.log);
    const { moolaR, simoleanR, bucksR, moola, simoleans, bucks, zoe } = setup();
    // Pack the contract.
    const coveredCallBundle = await bundleSource(coveredCallRoot);

    const coveredCallInstallation = await zoe.install(coveredCallBundle);
    const atomicSwapBundle = await bundleSource(atomicSwapRoot);

    const swapInstallationId = await zoe.install(atomicSwapBundle);

    // Setup Alice
    // Alice starts with 3 moola
    const aliceMoolaPayment = moolaR.mint.mintPayment(moola(3));
    const aliceMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const aliceSimoleanPurse = simoleanR.issuer.makeEmptyPurse();

    // Setup Bob
    // Bob starts with nothing
    const bobMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const bobSimoleanPurse = simoleanR.issuer.makeEmptyPurse();
    const bobBucksPurse = bucksR.issuer.makeEmptyPurse();

    // Setup Dave
    // Dave starts with 1 buck
    const daveSimoleanPayment = simoleanR.mint.mintPayment(simoleans(7));
    const daveBucksPayment = bucksR.mint.mintPayment(bucks(1));
    const daveMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const daveSimoleanPurse = simoleanR.issuer.makeEmptyPurse();
    const daveBucksPurse = bucksR.issuer.makeEmptyPurse();

    // Alice creates a coveredCall instance of moola for simoleans
    const issuerKeywordRecord = harden({
      UnderlyingAsset: moolaR.issuer,
      StrikePrice: simoleanR.issuer,
    });
    const { creatorInvitation: aliceInvitation } = await zoe.startInstance(
      coveredCallInstallation,
      issuerKeywordRecord,
    );

    // Alice escrows with Zoe. She specifies her proposal,
    // which includes the amounts she gives and wants as well as the exit
    // conditions. In this case, she choses an exit condition of after
    // the deadline of "100" according to a particular timer. This is
    // meant to be something far in the future, and will not be
    // reached in this test.

    const aliceProposal = harden({
      give: { UnderlyingAsset: moola(3) },
      want: { StrikePrice: simoleans(7) },
      exit: {
        afterDeadline: {
          deadline: 100, // we will not reach this
          timer,
        },
      },
    });
    const alicePayments = { UnderlyingAsset: aliceMoolaPayment };
    // Alice makes an option.
    const aliceSeat = await zoe.offer(
      aliceInvitation,
      aliceProposal,
      alicePayments,
    );

    const optionP = E(aliceSeat).getOfferResult();

    // Imagine that Alice sends the invitation to Bob (not done here since
    // this test doesn't actually have separate vats/parties)

    // Bob inspects the invitation payment and checks its information against the
    // questions that he has about whether it is worth being a counter
    // party in the covered call: Did the covered call use the
    // expected covered call installation (code)? Does it use the issuers
    // that he expects (moola and simoleans)?
    const invitationIssuer = zoe.getInvitationIssuer();
    const invitationAmountMath = await makeLocalAmountMath(invitationIssuer);
    const bobExclOption = await invitationIssuer.claim(optionP);
    const optionAmount = await invitationIssuer.getAmountOf(bobExclOption);
    const optionDesc = optionAmount.value[0];
    t.equal(optionDesc.installation, coveredCallInstallation);
    t.equal(optionDesc.description, 'exerciseOption');
    t.ok(moolaR.amountMath.isEqual(optionDesc.underlyingAsset, moola(3)));
    t.ok(simoleanR.amountMath.isEqual(optionDesc.strikePrice, simoleans(7)));
    t.equal(optionDesc.expirationDate, 100);
    t.deepEqual(optionDesc.timerAuthority, timer);

    // Let's imagine that Bob wants to create a swap to trade this
    // invitation for bucks.
    const swapIssuerKeywordRecord = harden({
      Asset: invitationIssuer,
      Price: bucksR.issuer,
    });
    const { creatorInvitation: bobSwapInvitation } = await zoe.startInstance(
      swapInstallationId,
      swapIssuerKeywordRecord,
    );

    // Bob wants to swap an invitation with the same amount as his
    // current invitation from Alice. He wants 1 buck in return.
    const bobProposalSwap = harden({
      give: { Asset: await invitationIssuer.getAmountOf(bobExclOption) },
      want: { Price: bucks(1) },
    });

    const bobPayments = harden({ Asset: bobExclOption });

    // Bob escrows his option in the swap
    // Bob makes an offer to the swap with his "higher order" invitation
    const bobSwapSeat = await zoe.offer(
      bobSwapInvitation,
      bobProposalSwap,
      bobPayments,
    );

    const daveSwapInvitationP = E(bobSwapSeat).getOfferResult();

    // Bob passes the swap invitation to Dave and tells him the
    // optionAmounts (basically, the description of the option)

    const {
      value: [{ instance: swapInstance, installation: daveSwapInstallId }],
    } = await invitationIssuer.getAmountOf(daveSwapInvitationP);

    const daveSwapIssuers = zoe.getIssuers(swapInstance);

    // Dave is looking to buy the option to trade his 7 simoleans for
    // 3 moola, and is willing to pay 1 buck for the option. He
    // checks that this instance matches what he wants

    // Did this swap use the correct swap installation? Yes
    t.equal(daveSwapInstallId, swapInstallationId);

    // Is this swap for the correct issuers and has no other terms? Yes
    t.ok(
      sameStructure(
        daveSwapIssuers,
        harden({
          Asset: invitationIssuer,
          Price: bucksR.issuer,
        }),
      ),
    );

    // What's actually up to be bought? Is it the kind of invitation that
    // Dave wants? What's the price for that invitation? Is it acceptable
    // to Dave? Bob can tell Dave this out of band, and if he lies,
    // Dave's offer will be rejected and he will get a refund. Dave
    // knows this to be true because he knows the swap.

    // Dave escrows his 1 buck with Zoe and forms his proposal
    const daveSwapProposal = harden({
      want: { Asset: optionAmount },
      give: { Price: bucks(1) },
    });

    const daveSwapPayments = harden({ Price: daveBucksPayment });
    const daveSwapSeat = await zoe.offer(
      daveSwapInvitationP,
      daveSwapProposal,
      daveSwapPayments,
    );

    t.equals(
      await daveSwapSeat.getOfferResult(),
      'The offer has been accepted. Once the contract has been completed, please check your payout',
    );

    const daveOption = await daveSwapSeat.getPayout('Asset');
    const daveBucksPayout = await daveSwapSeat.getPayout('Price');

    // Dave exercises his option by making an offer to the covered
    // call. First, he escrows with Zoe.

    const daveCoveredCallProposal = harden({
      want: { UnderlyingAsset: moola(3) },
      give: { StrikePrice: simoleans(7) },
    });
    const daveCoveredCallPayments = harden({
      StrikePrice: daveSimoleanPayment,
    });
    const daveCoveredCallSeat = await zoe.offer(
      daveOption,
      daveCoveredCallProposal,
      daveCoveredCallPayments,
    );

    t.equals(
      await E(daveCoveredCallSeat).getOfferResult(),
      'The offer has been accepted. Once the contract has been completed, please check your payout',
    );

    // Dave should get 3 moola, Bob should get 1 buck, and Alice
    // get 7 simoleans
    const daveMoolaPayout = await daveCoveredCallSeat.getPayout(
      'UnderlyingAsset',
    );
    const daveSimoleanPayout = await daveCoveredCallSeat.getPayout(
      'StrikePrice',
    );
    const aliceMoolaPayout = await aliceSeat.getPayout('UnderlyingAsset');
    const aliceSimoleanPayout = await aliceSeat.getPayout('StrikePrice');
    const bobInvitationPayout = await bobSwapSeat.getPayout('Asset');
    const bobBucksPayout = await bobSwapSeat.getPayout('Price');

    t.deepEquals(await moolaR.issuer.getAmountOf(daveMoolaPayout), moola(3));
    t.deepEquals(
      await simoleanR.issuer.getAmountOf(daveSimoleanPayout),
      simoleans(0),
    );

    t.deepEquals(await moolaR.issuer.getAmountOf(aliceMoolaPayout), moola(0));
    t.deepEquals(
      await simoleanR.issuer.getAmountOf(aliceSimoleanPayout),
      simoleans(7),
    );

    t.deepEquals(
      await invitationIssuer.getAmountOf(bobInvitationPayout),
      invitationAmountMath.getEmpty(),
    );
    t.deepEquals(await bucksR.issuer.getAmountOf(bobBucksPayout), bucks(1));

    // Alice deposits her payouts
    await aliceMoolaPurse.deposit(aliceMoolaPayout);
    await aliceSimoleanPurse.deposit(aliceSimoleanPayout);

    // Bob deposits his payouts
    await bobBucksPurse.deposit(bobBucksPayout);

    // Dave deposits his payouts
    await daveMoolaPurse.deposit(daveMoolaPayout);
    await daveSimoleanPurse.deposit(daveSimoleanPayout);
    await daveBucksPurse.deposit(daveBucksPayout);

    t.equals(aliceMoolaPurse.getCurrentAmount().value, 0);
    t.equals(aliceSimoleanPurse.getCurrentAmount().value, 7);

    t.equals(bobMoolaPurse.getCurrentAmount().value, 0);
    t.equals(bobSimoleanPurse.getCurrentAmount().value, 0);
    t.equals(bobBucksPurse.getCurrentAmount().value, 1);

    t.equals(daveMoolaPurse.getCurrentAmount().value, 3);
    t.equals(daveSimoleanPurse.getCurrentAmount().value, 0);
    t.equals(daveBucksPurse.getCurrentAmount().value, 0);
  } catch (e) {
    t.isNot(e, e, 'unexpected exception');
  }
});

// Alice makes a covered call and escrows. She shares the invitation to
// Bob. Bob tries to sell the invitation to Dave through another covered
// call. Can Bob trick Dave? Can Dave describe what it is that he
// wants in his offer description in the second covered call?
test('zoe - coveredCall with coveredCall for invitation', async t => {
  t.plan(31);
  try {
    // Setup the environment
    const timer = buildManualTimer(console.log);
    const { moolaR, simoleanR, bucksR, moola, simoleans, bucks, zoe } = setup();

    // Pack the contract.
    const bundle = await bundleSource(coveredCallRoot);

    const coveredCallInstallation = await zoe.install(bundle);

    // Setup Alice
    // Alice starts with 3 moola
    const aliceMoolaPayment = moolaR.mint.mintPayment(moola(3));
    const aliceMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const aliceSimoleanPurse = simoleanR.issuer.makeEmptyPurse();

    // Setup Bob
    // Bob starts with nothing
    const bobMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const bobSimoleanPurse = simoleanR.issuer.makeEmptyPurse();
    const bobBucksPurse = bucksR.issuer.makeEmptyPurse();

    // Setup Dave
    // Dave starts with 1 buck and 7 simoleans
    const daveSimoleanPayment = simoleanR.mint.mintPayment(simoleans(7));
    const daveBucksPayment = bucksR.mint.mintPayment(bucks(1));
    const daveMoolaPurse = moolaR.issuer.makeEmptyPurse();
    const daveSimoleanPurse = simoleanR.issuer.makeEmptyPurse();
    const daveBucksPurse = bucksR.issuer.makeEmptyPurse();

    // Alice creates a coveredCall instance of moola for simoleans
    const issuerKeywordRecord = harden({
      UnderlyingAsset: moolaR.issuer,
      StrikePrice: simoleanR.issuer,
    });
    const {
      creatorInvitation: aliceCoveredCallInvitation,
    } = await zoe.startInstance(coveredCallInstallation, issuerKeywordRecord);

    // Alice escrows with Zoe. She specifies her proposal,
    // which include what she wants and gives as well as the exit
    // condition. In this case, she choses an exit condition of after
    // the deadline of "100" according to a particular timer. This is
    // meant to be something far in the future, and will not be
    // reached in this test.

    const aliceProposal = harden({
      give: { UnderlyingAsset: moola(3) },
      want: { StrikePrice: simoleans(7) },
      exit: {
        afterDeadline: {
          deadline: 100, // we will not reach this
          timer,
        },
      },
    });
    const alicePayments = { UnderlyingAsset: aliceMoolaPayment };
    // Alice makes a call option, which is an invitation to join the
    // covered call contract
    const aliceSeat = await zoe.offer(
      aliceCoveredCallInvitation,
      aliceProposal,
      alicePayments,
    );
    const optionP = await E(aliceSeat).getOfferResult();

    // Imagine that Alice sends the invitation to Bob as well as the
    // instanceHandle (not done here since this test doesn't actually have
    // separate vats/parties)

    // Bob inspects the invitation payment and checks its information against the
    // questions that he has about whether it is worth being a counter
    // party in the covered call: Did the covered call use the
    // expected covered call installation (code)? Does it use the issuers
    // that he expects (moola and simoleans)?
    const invitationIssuer = zoe.getInvitationIssuer();
    const invitationAmountMath = await makeLocalAmountMath(invitationIssuer);
    const bobExclOption = await invitationIssuer.claim(optionP);
    const optionValue = await E(zoe).getInvitationDetails(bobExclOption);
    t.equal(optionValue.installation, coveredCallInstallation);
    t.equal(optionValue.description, 'exerciseOption');
    t.ok(moolaR.amountMath.isEqual(optionValue.underlyingAsset, moola(3)));
    t.ok(simoleanR.amountMath.isEqual(optionValue.strikePrice, simoleans(7)));
    t.equal(optionValue.expirationDate, 100);
    t.deepEqual(optionValue.timerAuthority, timer);

    // Let's imagine that Bob wants to create another coveredCall, but
    // this time to trade this invitation for bucks.
    const issuerKeywordRecord2 = harden({
      UnderlyingAsset: invitationIssuer,
      StrikePrice: bucksR.issuer,
    });
    const {
      creatorInvitation: bobInvitationForSecondCoveredCall,
    } = await zoe.startInstance(coveredCallInstallation, issuerKeywordRecord2);

    // Bob wants to swap an invitation with the same amount as his
    // current invitation from Alice. He wants 1 buck in return.
    const bobProposalSecondCoveredCall = harden({
      give: {
        UnderlyingAsset: await invitationIssuer.getAmountOf(bobExclOption),
      },
      want: { StrikePrice: bucks(1) },
      exit: {
        afterDeadline: {
          deadline: 100, // we will not reach this
          timer,
        },
      },
    });

    const bobPayments = { UnderlyingAsset: bobExclOption };

    // Bob escrows his invitation
    // Bob makes an offer to the swap with his "higher order" option
    const bobSeat = await zoe.offer(
      bobInvitationForSecondCoveredCall,
      bobProposalSecondCoveredCall,
      bobPayments,
    );
    const invitationForDaveP = E(bobSeat).getOfferResult();

    // Bob passes the higher order invitation and
    // optionAmounts to Dave

    // Dave is looking to buy the option to trade his 7 simoleans for
    // 3 moola, and is willing to pay 1 buck for the option. He
    // checks that this invitation matches what he wants
    const daveExclOption = await invitationIssuer.claim(invitationForDaveP);
    const daveOptionValue = await E(zoe).getInvitationDetails(daveExclOption);
    t.equal(daveOptionValue.installation, coveredCallInstallation);
    t.equal(daveOptionValue.description, 'exerciseOption');
    t.ok(bucksR.amountMath.isEqual(daveOptionValue.strikePrice, bucks(1)));
    t.equal(daveOptionValue.expirationDate, 100);
    t.deepEqual(daveOptionValue.timerAuthority, timer);

    // What about the underlying asset (the other option)?
    t.equal(
      daveOptionValue.underlyingAsset.value[0].description,
      'exerciseOption',
    );
    t.equal(daveOptionValue.underlyingAsset.value[0].expirationDate, 100);
    t.ok(
      simoleanR.amountMath.isEqual(
        daveOptionValue.underlyingAsset.value[0].strikePrice,
        simoleans(7),
      ),
    );
    t.deepEqual(daveOptionValue.underlyingAsset.value[0].timerAuthority, timer);

    // Dave's planned proposal
    const daveProposalCoveredCall = harden({
      want: { UnderlyingAsset: daveOptionValue.underlyingAsset },
      give: { StrikePrice: bucks(1) },
    });

    // Dave escrows his 1 buck with Zoe and forms his proposal

    const daveSecondCoveredCallPayments = { StrikePrice: daveBucksPayment };
    const daveSecondCoveredCallSeat = await zoe.offer(
      daveExclOption,
      daveProposalCoveredCall,
      daveSecondCoveredCallPayments,
    );
    t.equals(
      await E(daveSecondCoveredCallSeat).getOfferResult(),
      'The offer has been accepted. Once the contract has been completed, please check your payout',
      `dave second offer accepted`,
    );

    const firstCoveredCallInvitation = await daveSecondCoveredCallSeat.getPayout(
      'UnderlyingAsset',
    );
    const daveBucksPayout = await daveSecondCoveredCallSeat.getPayout(
      'StrikePrice',
    );

    // Dave exercises his option by making an offer to the covered
    // call. First, he escrows with Zoe.

    const daveFirstCoveredCallProposal = harden({
      want: { UnderlyingAsset: moola(3) },
      give: { StrikePrice: simoleans(7) },
    });
    const daveFirstCoveredCallPayments = harden({
      StrikePrice: daveSimoleanPayment,
    });
    const daveFirstCoveredCallSeat = await zoe.offer(
      firstCoveredCallInvitation,
      daveFirstCoveredCallProposal,
      daveFirstCoveredCallPayments,
    );

    t.equals(
      await daveFirstCoveredCallSeat.getOfferResult(),
      'The offer has been accepted. Once the contract has been completed, please check your payout',
      `dave first offer accepted`,
    );

    // Dave should get 3 moola, Bob should get 1 buck, and Alice
    // get 7 simoleans

    const daveMoolaPayout = await daveFirstCoveredCallSeat.getPayout(
      'UnderlyingAsset',
    );
    const daveSimoleanPayout = await daveFirstCoveredCallSeat.getPayout(
      'StrikePrice',
    );

    const aliceMoolaPayout = await aliceSeat.getPayout('UnderlyingAsset');
    const aliceSimoleanPayout = await aliceSeat.getPayout('StrikePrice');

    const bobInvitationPayout = await bobSeat.getPayout('UnderlyingAsset');
    const bobBucksPayout = await bobSeat.getPayout('StrikePrice');

    t.deepEquals(await moolaR.issuer.getAmountOf(daveMoolaPayout), moola(3));
    t.deepEquals(
      await simoleanR.issuer.getAmountOf(daveSimoleanPayout),
      simoleans(0),
    );

    t.deepEquals(await moolaR.issuer.getAmountOf(aliceMoolaPayout), moola(0));
    t.deepEquals(
      await simoleanR.issuer.getAmountOf(aliceSimoleanPayout),
      simoleans(7),
    );

    t.deepEquals(
      await invitationIssuer.getAmountOf(bobInvitationPayout),
      invitationAmountMath.getEmpty(),
    );
    t.deepEquals(await bucksR.issuer.getAmountOf(bobBucksPayout), bucks(1));

    // Alice deposits her payouts
    await aliceMoolaPurse.deposit(aliceMoolaPayout);
    await aliceSimoleanPurse.deposit(aliceSimoleanPayout);

    // Bob deposits his payouts
    await bobBucksPurse.deposit(bobBucksPayout);

    // Dave deposits his payouts
    await daveMoolaPurse.deposit(daveMoolaPayout);
    await daveSimoleanPurse.deposit(daveSimoleanPayout);
    await daveBucksPurse.deposit(daveBucksPayout);

    t.equals(aliceMoolaPurse.getCurrentAmount().value, 0);
    t.equals(aliceSimoleanPurse.getCurrentAmount().value, 7);

    t.equals(bobMoolaPurse.getCurrentAmount().value, 0);
    t.equals(bobSimoleanPurse.getCurrentAmount().value, 0);
    t.equals(bobBucksPurse.getCurrentAmount().value, 1);

    t.equals(daveMoolaPurse.getCurrentAmount().value, 3);
    t.equals(daveSimoleanPurse.getCurrentAmount().value, 0);
    t.equals(daveBucksPurse.getCurrentAmount().value, 0);
  } catch (e) {
    t.isNot(e, e, 'unexpected exception');
  }
});

// Alice uses a covered call to sell a cryptoCat to Bob for the
// 'Glorious shield' she has wanted for a long time.
test('zoe - coveredCall non-fungible', async t => {
  t.plan(13);
  const {
    ccIssuer,
    rpgIssuer,
    ccMint,
    rpgMint,
    cryptoCats,
    rpgItems,
    amountMaths,
    createRpgItem,
    zoe,
  } = setupNonFungible();

  // install the contract.
  const bundle = await bundleSource(coveredCallRoot);
  const coveredCallInstallation = await zoe.install(bundle);
  const timer = buildManualTimer(console.log);

  // Setup Alice
  const growlTiger = harden(['GrowlTiger']);
  const growlTigerAmount = cryptoCats(growlTiger);
  const aliceCcPayment = ccMint.mintPayment(growlTigerAmount);
  const aliceCcPurse = ccIssuer.makeEmptyPurse();
  const aliceRpgPurse = rpgIssuer.makeEmptyPurse();

  // Setup Bob
  const aGloriousShield = createRpgItem(
    'Glorious Shield',
    25,
    'a Glorious Shield, burnished to a blinding brightness',
  );
  const aGloriousShieldAmount = rpgItems(aGloriousShield);
  const bobRpgPayment = rpgMint.mintPayment(aGloriousShieldAmount);
  const bobCcPurse = ccIssuer.makeEmptyPurse();
  const bobRpgPurse = rpgIssuer.makeEmptyPurse();

  // Alice creates a coveredCall instance
  const issuerKeywordRecord = harden({
    UnderlyingAsset: ccIssuer,
    StrikePrice: rpgIssuer,
  });
  // separate issuerKeywordRecord from contract-specific terms
  const { creatorInvitation: aliceInvitation } = await zoe.startInstance(
    coveredCallInstallation,
    issuerKeywordRecord,
  );

  // Alice escrows with Zoe
  const aliceProposal = harden({
    give: { UnderlyingAsset: growlTigerAmount },
    want: { StrikePrice: aGloriousShieldAmount },
    exit: { afterDeadline: { deadline: 1, timer } },
  });
  const alicePayments = { UnderlyingAsset: aliceCcPayment };
  // Alice creates a call option
  const aliceSeat = await zoe.offer(
    aliceInvitation,
    aliceProposal,
    alicePayments,
  );
  const optionP = E(aliceSeat).getOfferResult();

  // Imagine that Alice sends the option to Bob for free (not done here
  // since this test doesn't actually have separate vats/parties)

  // Bob inspects the option (an invitation payment) and checks that it is the
  // contract instance that he expects as well as that Alice has
  // already escrowed.

  const invitationIssuer = zoe.getInvitationIssuer();
  const bobExclOption = await invitationIssuer.claim(optionP);
  const optionValue = await E(zoe).getInvitationDetails(bobExclOption);
  t.equal(optionValue.installation, coveredCallInstallation);
  t.equal(optionValue.description, 'exerciseOption');
  t.ok(
    amountMaths
      .get('cc')
      .isEqual(optionValue.underlyingAsset, growlTigerAmount),
  );
  t.ok(
    amountMaths
      .get('rpg')
      .isEqual(optionValue.strikePrice, aGloriousShieldAmount),
  );
  t.equal(optionValue.expirationDate, 1);
  t.deepEqual(optionValue.timerAuthority, timer);

  const bobPayments = { StrikePrice: bobRpgPayment };

  const bobProposal = harden({
    want: { UnderlyingAsset: optionValue.underlyingAsset },
    give: { StrikePrice: optionValue.strikePrice },
    exit: { onDemand: null },
  });

  // Bob redeems his invitation and escrows with Zoe
  // Bob exercises the option
  const bobSeat = await zoe.offer(bobExclOption, bobProposal, bobPayments);

  t.equals(
    await E(bobSeat).getOfferResult(),
    'The offer has been accepted. Once the contract has been completed, please check your payout',
  );

  const bobCcPayout = await E(bobSeat).getPayout('UnderlyingAsset');
  const bobRpgPayout = await E(bobSeat).getPayout('StrikePrice');
  const aliceCcPayout = await E(aliceSeat).getPayout('UnderlyingAsset');
  const aliceRpgPayout = await E(aliceSeat).getPayout('StrikePrice');

  // Alice gets what Alice wanted
  t.deepEquals(
    await rpgIssuer.getAmountOf(aliceRpgPayout),
    aliceProposal.want.StrikePrice,
  );

  // Alice didn't get any of what Alice put in
  t.deepEquals(
    await ccIssuer.getAmountOf(aliceCcPayout),
    cryptoCats(harden([])),
  );

  // Alice deposits her payout to ensure she can
  await aliceCcPurse.deposit(aliceCcPayout);
  await aliceRpgPurse.deposit(aliceRpgPayout);

  // Bob deposits his original payments to ensure he can
  await bobCcPurse.deposit(bobCcPayout);
  await bobRpgPurse.deposit(bobRpgPayout);

  // Assert that the correct payouts were received.
  // Alice had growlTiger and no RPG tokens.
  // Bob had an empty CryptoCat purse and the Glorious Shield.
  t.deepEquals(aliceCcPurse.getCurrentAmount().value, []);
  t.deepEquals(aliceRpgPurse.getCurrentAmount().value, aGloriousShield);
  t.deepEquals(bobCcPurse.getCurrentAmount().value, ['GrowlTiger']);
  t.deepEquals(bobRpgPurse.getCurrentAmount().value, []);
});
