import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';
import { sameStructure } from '@agoric/same-structure';
import { showPurseBalance, setupIssuers } from '../helpers';

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
  const [_moolaPayment, simoleanPayment, bucksPayment] = payments;
  const [moolaIssuer, simoleanIssuer, bucksIssuer] = issuers;
  const invitationIssuer = await E(zoe).getInvitationIssuer();

  return harden({
    doPublicAuction: async invitation => {
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
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
        details`issuerKeywordRecord were not as expected`,
      );
      const terms = await E(zoe).getTerms(instance);
      assert(terms.numBidsAllowed === 3, details`terms not as expected`);
      assert(sameStructure(invitationValue[0].minimumBid, simoleans(3)));
      assert(sameStructure(invitationValue[0].auctionedAssets, moola(1)));

      const proposal = harden({
        want: { Asset: moola(1) },
        give: { Bid: simoleans(5) },
        exit: { onDemand: null },
      });
      const paymentKeywordRecord = { Bid: simoleanPayment };

      const seatP = await E(zoe).offer(
        exclInvitation,
        proposal,
        paymentKeywordRecord,
      );

      log(`Dave: ${await E(seatP).getOfferResult()}`);

      const moolaPayout = await E(seatP).getPayout('Asset');
      const simoleanPayout = await E(seatP).getPayout('Bid');

      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'daveMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'daveSimoleanPurse', log);
    },

    doSwapForOption: async (invitation, optionAmounts) => {
      // Dave is looking to buy the option to trade his 7 simoleans for
      // 3 moola, and is willing to pay 1 buck for the option.
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);
      const exclInvitation = await E(invitationIssuer).claim(invitation);
      const { value: invitationValue } = await E(invitationIssuer).getAmountOf(
        exclInvitation,
      );
      const { source } = await E(installation).getBundle();
      // pick some arbitrary code points as a signature.
      assert(
        source.includes('asset: give.Asset,'),
        details`source bundle didn't match at "asset: give.Asset,"`,
      );
      assert(
        source.includes('firstProposalExpected'),
        details`source bundle didn't match at "firstProposalExpected"`,
      );
      assert(
        source.includes('makeMatchingInvitation'),
        details`source bundle didn't match at "makeMatchingInvitation"`,
      );
      assert(
        installation === installations.atomicSwap,
        details`wrong installation`,
      );
      assert(
        sameStructure(
          harden({ Asset: invitationIssuer, Price: bucksIssuer }),
          issuerKeywordRecord,
        ),
        details`issuerKeywordRecord were not as expected`,
      );

      // Dave expects that Bob has already made an offer in the swap
      // with the following rules:
      assert(
        sameStructure(invitationValue[0].asset, optionAmounts),
        details`asset is the option`,
      );
      assert(
        sameStructure(invitationValue[0].price, bucks(1)),
        details`price is 1 buck`,
      );
      const optionValue = optionAmounts.value;
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

      // Dave escrows his 1 buck with Zoe and forms his proposal
      const daveSwapProposal = harden({
        want: { Asset: optionAmounts },
        give: { Price: bucks(1) },
      });
      const daveSwapPayments = harden({ Price: bucksPayment });
      const seatP = await E(zoe).offer(
        exclInvitation,
        daveSwapProposal,
        daveSwapPayments,
      );

      log(await E(seatP).getOfferResult());

      const daveOption = await E(seatP).getPayout('Asset');
      const daveBucksPayout = await E(seatP).getPayout('Price');

      // Dave exercises his option by making an offer to the covered
      // call. First, he escrows with Zoe.

      const daveCoveredCallProposal = harden({
        want: { UnderlyingAsset: moola(3) },
        give: { StrikePrice: simoleans(7) },
      });
      const daveCoveredCallPayments = harden({ StrikePrice: simoleanPayment });
      const optionSeatP = await E(zoe).offer(
        daveOption,
        daveCoveredCallProposal,
        daveCoveredCallPayments,
      );

      log(await E(optionSeatP).getOfferResult());

      const moolaPayout = await E(optionSeatP).getPayout('UnderlyingAsset');
      const simoleanPayout = await E(optionSeatP).getPayout('StrikePrice');

      await E(bucksPurseP).deposit(daveBucksPayout);
      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'daveMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'daveSimoleanPurse', log);
      await showPurseBalance(bucksPurseP, 'daveBucksPurse', log);
    },
  });
};

export function buildRootObject(vatPowers) {
  return harden({
    build: (...args) => build(vatPowers.testLog, ...args),
  });
}
