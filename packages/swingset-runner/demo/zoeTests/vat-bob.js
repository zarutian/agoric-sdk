import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';
import { sameStructure } from '@agoric/same-structure';
import { makeLocalAmountMath } from '@agoric/ertp';
import { showPurseBalance, setupIssuers } from './helpers';

import { makePrintLog } from './printLog';

const build = async (log, zoe, issuers, payments, installations, timer) => {
  const {
    moola,
    simoleans,
    bucks,
    purses,
    moolaAmountMath,
    simoleanAmountMath,
  } = await setupIssuers(zoe, issuers);
  const [moolaPurseP, simoleanPurseP, bucksPurseP] = purses;
  const [moolaPayment, simoleanPayment] = payments;
  const [moolaIssuer, simoleanIssuer, bucksIssuer] = issuers;
  const invitationIssuer = await E(zoe).getInvitationIssuer();

  return harden({
    doAutomaticRefund: async invitation => {
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const exclInvitation = await E(invitationIssuer).claim(invitation);

      const issuerKeywordRecord = await E(zoe).getIssuers(instance);

      // Bob ensures it's the contract he expects
      assert(
        installations.automaticRefund === installation,
        details`should be the expected automaticRefund`,
      );

      assert(
        issuerKeywordRecord.Contribution1 === moolaIssuer,
        details`The first issuer should be the moola issuer`,
      );
      assert(
        issuerKeywordRecord.Contribution2 === simoleanIssuer,
        details`The second issuer should be the simolean issuer`,
      );

      // 1. Bob escrows his offer
      const bobProposal = harden({
        want: { Contribution1: moola(15) },
        give: { Contribution2: simoleans(17) },
        exit: { onDemand: null },
      });

      const bobPayments = { Contribution2: simoleanPayment };

      // 2. Bob makes an offer
      const bobSeatP = await E(zoe).offer(
        exclInvitation,
        bobProposal,
        bobPayments,
      );
      log(await E(bobSeatP).getOfferResult());

      const moolaPayout = await E(bobSeatP).getPayout('Contribution1');
      const simoleanPayout = await E(bobSeatP).getPayout('Contribution2');

      // 5: Bob deposits his winnings
      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
    },

    doCoveredCall: async invitation => {
      // Bob claims all with the Zoe invitationIssuer
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const exclInvitation = await E(invitationIssuer).claim(invitation);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);

      const bobIntendedProposal = harden({
        want: { UnderlyingAsset: moola(3) },
        give: { StrikePrice: simoleans(7) },
      });

      // Bob checks that the invitation is for the right covered call
      const { value: optionValue } = await E(invitationIssuer).getAmountOf(
        exclInvitation,
      );
      assert(
        installation === installations.coveredCall,
        details`wrong installation`,
      );
      assert(
        optionValue[0].description === 'exerciseOption',
        details`wrong invitation`,
      );
      assert(moolaAmountMath.isEqual(optionValue[0].underlyingAsset, moola(3)));
      assert(
        simoleanAmountMath.isEqual(optionValue[0].strikePrice, simoleans(7)),
      );
      assert(
        optionValue[0].expirationDate === 1,
        details`wrong expirationDate`,
      );
      assert(optionValue[0].timerAuthority === timer, 'wrong timer');
      const { UnderlyingAsset, StrikePrice } = issuerKeywordRecord;

      assert(
        UnderlyingAsset === moolaIssuer,
        details`The underlying asset issuer should be the moola issuer`,
      );
      assert(
        StrikePrice === simoleanIssuer,
        details`The strike price issuer should be the simolean issuer`,
      );

      const bobPayments = { StrikePrice: simoleanPayment };
      // Bob escrows
      const seatP = await E(zoe).offer(
        exclInvitation,
        bobIntendedProposal,
        bobPayments,
      );

      log(await E(seatP).getOfferResult());

      const moolaPayout = await E(seatP).getPayout('UnderlyingAsset');
      const simoleanPayout = await E(seatP).getPayout('StrikePrice');

      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
    },

    doSwapForOption: async (invitation, daveP) => {
      // Bob claims all with the Zoe invitationIssuer
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const exclInvitation = await E(invitationIssuer).claim(invitation);

      const { UnderlyingAsset, StrikePrice } = await E(zoe).getIssuers(
        instance,
      );

      // Bob checks that the invitation is for the right covered call
      const optionAmounts = await E(invitationIssuer).getAmountOf(
        exclInvitation,
      );
      const optionValue = optionAmounts.value;

      assert(
        installation === installations.coveredCall,
        details`wrong installation`,
      );
      assert(
        optionValue[0].description === 'exerciseOption',
        details`wrong invitation`,
      );
      assert(
        moolaAmountMath.isEqual(optionValue[0].underlyingAsset, moola(3)),
        details`wrong underlying asset`,
      );
      assert(
        simoleanAmountMath.isEqual(optionValue[0].strikePrice, simoleans(7)),
        details`wrong strike price`,
      );
      assert(
        optionValue[0].expirationDate === 100,
        details`wrong expiration date`,
      );
      assert(optionValue[0].timerAuthority === timer, details`wrong timer`);
      assert(
        UnderlyingAsset === moolaIssuer,
        details`The underlyingAsset issuer should be the moola issuer`,
      );
      assert(
        StrikePrice === simoleanIssuer,
        details`The strikePrice issuer should be the simolean issuer`,
      );

      // Let's imagine that Bob wants to create a swap to trade this
      // invitation for bucks. He wants to invitation Dave as the
      // counter-party.
      const offerIssuerKeywordRecord = harden({
        Asset: invitationIssuer,
        Price: bucksIssuer,
      });
      const { creatorInvitation: bobSwapInvitation } = await E(
        zoe,
      ).startInstance(installations.atomicSwap, offerIssuerKeywordRecord);

      // Bob wants to swap an invitation with the same amount as his
      // current invitation from Alice. He wants 1 buck in return.
      const bobProposalSwap = harden({
        give: { Asset: optionAmounts },
        want: { Price: bucks(1) },
      });

      const bobSwapPayments = harden({ Asset: exclInvitation });

      // Bob escrows his option in the swap
      const bobSeatP = await E(zoe).offer(
        bobSwapInvitation,
        bobProposalSwap,
        bobSwapPayments,
      );
      const daveSwapInvitationP = E(bobSeatP).getOfferResult();
      // Bob makes an offer to the swap with his "higher order"
      log('swap invitation made');
      await E(daveP).doSwapForOption(daveSwapInvitationP, optionAmounts);

      const bucksPayout = await E(bobSeatP).getPayout('Price');

      // Bob deposits his winnings
      await E(bucksPurseP).deposit(bucksPayout);

      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
      await showPurseBalance(bucksPurseP, 'bobBucksPurse;', log);
    },
    doPublicAuction: async invitation => {
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const terms = await E(zoe).getTerms(instance);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);
      const exclInvitation = await E(invitationIssuer).claim(invitation);
      const { value: invitationValue } = await E(invitationIssuer).getAmountOf(
        exclInvitation,
      );

      assert(
        installation === installations.publicAuction,
        details`wrong installation`,
      );
      assert(
        sameStructure(
          harden({ Asset: moolaIssuer, Ask: simoleanIssuer }),
          issuerKeywordRecord,
        ),
        details`issuerKeywordRecord was not as expected`,
      );
      assert(terms.numBidsAllowed === 3, details`terms not as expected`);
      assert(sameStructure(invitationValue[0].minimumBid, simoleans(3)));
      assert(sameStructure(invitationValue[0].auctionedAssets, moola(1)));

      const proposal = harden({
        want: { Asset: moola(1) },
        give: { Bid: simoleans(11) },
      });
      const paymentKeywordRecord = { Bid: simoleanPayment };

      const seatP = await E(zoe).offer(
        exclInvitation,
        proposal,
        paymentKeywordRecord,
      );

      log(`Bob: ${await E(seatP).getOfferResult()}`);

      const moolaPayout = await E(seatP).getPayout('Asset');
      const simoleanPayout = await E(seatP).getPayout('Bid');

      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
    },
    doAtomicSwap: async invitation => {
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);
      const exclInvitation = await E(invitationIssuer).claim(invitation);
      const { value: invitationValue } = await E(invitationIssuer).getAmountOf(
        exclInvitation,
      );

      assert(
        installation === installations.atomicSwap,
        details`wrong installation`,
      );
      assert(
        sameStructure(
          harden({ Asset: moolaIssuer, Price: simoleanIssuer }),
          issuerKeywordRecord,
        ),
        details`issuers were not as expected`,
      );

      assert(
        sameStructure(invitationValue[0].asset, moola(3)),
        details`Alice made a different offer than expected`,
      );
      assert(
        sameStructure(invitationValue[0].price, simoleans(7)),
        details`Alice made a different offer than expected`,
      );

      const proposal = harden({
        want: { Asset: moola(3) },
        give: { Price: simoleans(7) },
      });
      const paymentKeywordRecord = { Price: simoleanPayment };

      const seatP = await E(zoe).offer(
        exclInvitation,
        proposal,
        paymentKeywordRecord,
      );

      log(await E(seatP).getOfferResult());

      const moolaPayout = await E(seatP).getPayout('Asset');
      const simoleanPayout = await E(seatP).getPayout('Price');

      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
    },

    doSimpleExchange: async invitation => {
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const exclInvitation = await E(invitationIssuer).claim(invitation);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);

      assert(
        installation === installations.simpleExchange,
        details`wrong installation`,
      );
      assert(
        issuerKeywordRecord.Asset === moolaIssuer,
        details`The first issuer should be the moola issuer`,
      );
      assert(
        issuerKeywordRecord.Price === simoleanIssuer,
        details`The second issuer should be the simolean issuer`,
      );

      const bobBuyOrderProposal = harden({
        want: { Asset: moola(3) },
        give: { Price: simoleans(7) },
        exit: { onDemand: null },
      });
      const paymentKeywordRecord = { Price: simoleanPayment };

      const seatP = await E(zoe).offer(
        exclInvitation,
        bobBuyOrderProposal,
        paymentKeywordRecord,
      );

      log(await E(seatP).getOfferResult());

      const moolaPayout = await E(seatP).getPayout('Asset');
      const simoleanPayout = await E(seatP).getPayout('Price');

      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
    },
    doSimpleExchangeUpdates: async (invitationP, m, s) => {
      const invitation = await E(invitationIssuer).claim(invitationP);
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);

      assert(
        installation === installations.simpleExchange,
        details`wrong installation`,
      );
      assert(
        issuerKeywordRecord.Asset === moolaIssuer,
        details`The first issuer should be the moola issuer`,
      );
      assert(
        issuerKeywordRecord.Price === simoleanIssuer,
        details`The second issuer should be the simolean issuer`,
      );
      const bobBuyOrderProposal = harden({
        want: { Asset: moola(m) },
        give: { Price: simoleans(s) },
        exit: { onDemand: null },
      });
      if (m === 3 && s === 7) {
        await E(simoleanPurseP).deposit(simoleanPayment);
      }
      const simoleanPayment2 = await E(simoleanPurseP).withdraw(simoleans(s));
      const paymentKeywordRecord = { Price: simoleanPayment2 };
      const seatP = await E(zoe).offer(
        invitation,
        bobBuyOrderProposal,
        paymentKeywordRecord,
      );

      log(await E(seatP).getOfferResult());

      E(seatP)
        .getPayout('Asset')
        .then(moolaPayout => {
          E(moolaPurseP).deposit(moolaPayout);
        });
      E(seatP)
        .getPayout('Price')
        .then(simoleanPayout => {
          E(simoleanPurseP).deposit(simoleanPayout);
        });
      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
    },

    doAutoswap: async instance => {
      const publicFacet = await E(zoe).getPublicFacet(instance);
      const buyBInvitation = await E(publicFacet).makeSwapInvitation();
      const installation = await E(zoe).getInstallation(buyBInvitation);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);
      assert(
        installation === installations.autoswap,
        details`wrong installation`,
      );
      const liquidityIssuer = await E(publicFacet).getLiquidityIssuer();
      assert(
        sameStructure(
          harden({
            TokenA: moolaIssuer,
            TokenB: simoleanIssuer,
            Liquidity: liquidityIssuer,
          }),
          issuerKeywordRecord,
        ),
        details`issuers were not as expected`,
      );

      // bob checks the price of 3 moola. The price is 1 simolean
      const simoleanAmounts = await E(publicFacet).getCurrentPrice(
        moola(3),
        simoleans(0).brand,
      );
      log(`simoleanAmounts `, simoleanAmounts);

      const moolaForSimProposal = harden({
        give: { In: moola(3) },
        want: { Out: simoleans(1) },
      });

      const moolaForSimPayments = harden({ In: moolaPayment });
      const buySeatP = await E(zoe).offer(
        buyBInvitation,
        moolaForSimProposal,
        moolaForSimPayments,
      );

      log(await E(buySeatP).getOfferResult());

      const moolaPayout1 = await E(buySeatP).getPayout('In');
      const simoleanPayout1 = await E(buySeatP).getPayout('Out');

      await E(moolaPurseP).deposit(await moolaPayout1);
      await E(simoleanPurseP).deposit(await simoleanPayout1);

      // Bob looks up the price of 3 simoleans. It's 5 moola
      const moolaAmounts = await E(publicFacet).getCurrentPrice(
        simoleans(3),
        moola(0).brand,
      );
      log(`moolaAmounts `, moolaAmounts);

      // Bob makes another offer and swaps
      const bobSimsForMoolaProposal = harden({
        want: { Out: moola(5) },
        give: { In: simoleans(3) },
      });
      await E(simoleanPurseP).deposit(simoleanPayment);
      const bobSimoleanPayment = await E(simoleanPurseP).withdraw(simoleans(3));
      const simsForMoolaPayments = harden({ In: bobSimoleanPayment });
      const invitation2 = E(publicFacet).makeSwapInvitation();

      const swapSeat2 = await E(zoe).offer(
        invitation2,
        bobSimsForMoolaProposal,
        simsForMoolaPayments,
      );

      log(await E(swapSeat2).getOfferResult());

      const moolaPayout2 = await E(swapSeat2).getPayout('Out');
      const simoleanPayout2 = await E(swapSeat2).getPayout('In');

      await E(moolaPurseP).deposit(moolaPayout2);
      await E(simoleanPurseP).deposit(simoleanPayout2);

      await showPurseBalance(moolaPurseP, 'bobMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'bobSimoleanPurse', log);
    },

    doBuyTickets: async (instance, invitation) => {
      const publicFacet = await E(zoe).getPublicFacet(instance);
      const terms = await E(zoe).getTerms(instance);
      const ticketIssuer = await E(publicFacet).getItemsIssuer();
      const ticketAmountMath = await makeLocalAmountMath(ticketIssuer);

      const availableTickets = await E(publicFacet).getAvailableItems();
      log('availableTickets: ', availableTickets);
      // find the value corresponding to ticket #1
      const ticket1Value = availableTickets.value.find(
        ticket => ticket.number === 1,
      );
      // make the corresponding amount
      const ticket1Amount = ticketAmountMath.make(harden([ticket1Value]));
      const proposal = harden({
        give: { Money: terms.pricePerItem },
        want: { Items: ticket1Amount },
      });

      const paymentKeywordRecord = harden({ Money: moolaPayment });

      const seat = await E(zoe).offer(
        invitation,
        proposal,
        paymentKeywordRecord,
      );
      const boughtTicketAmount = await E(ticketIssuer).getAmountOf(
        E(seat).getPayout('Items'),
      );
      log('boughtTicketAmount: ', boughtTicketAmount);
    },
  });
};

export function buildRootObject(_vatPowers) {
  return harden({
    build: (...args) => build(makePrintLog(), ...args),
  });
}
