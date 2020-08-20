import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';
import { sameStructure } from '@agoric/same-structure';
import { showPurseBalance, setupIssuers } from '../helpers';

const build = async (log, zoe, issuers, payments, installations) => {
  const { moola, simoleans, purses } = await setupIssuers(zoe, issuers);
  const [moolaPurseP, simoleanPurseP] = purses;
  const [_moolaPayment, simoleanPayment] = payments;
  const [moolaIssuer, simoleanIssuer] = issuers;
  const invitationIssuer = await E(zoe).getInvitationIssuer();

  return harden({
    doPublicAuction: async invitationP => {
      const invitation = await E(invitationIssuer).claim(invitationP);
      const instance = await E(zoe).getInstance(invitation);
      const installation = await E(zoe).getInstallation(invitation);
      const terms = await E(zoe).getTerms(instance);
      const issuerKeywordRecord = await E(zoe).getIssuers(instance);
      const { value: invitationValue } = await E(invitationIssuer).getAmountOf(
        invitation,
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
      assert(terms.numBidsAllowed === 3, details`terms not as expected`);
      assert(sameStructure(invitationValue[0].minimumBid, simoleans(3)));
      assert(sameStructure(invitationValue[0].auctionedAssets, moola(1)));

      const proposal = harden({
        want: { Asset: moola(1) },
        give: { Bid: simoleans(7) },
        exit: { onDemand: null },
      });
      const paymentKeywordRecord = { Bid: simoleanPayment };

      const seatP = await E(zoe).offer(
        invitation,
        proposal,
        paymentKeywordRecord,
      );

      log(`Carol: ${await E(seatP).getOfferResult()}`);

      const moolaPayout = await E(seatP).getPayout('Asset');
      const simoleanPayout = await E(seatP).getPayout('Bid');

      await E(moolaPurseP).deposit(moolaPayout);
      await E(simoleanPurseP).deposit(simoleanPayout);

      await showPurseBalance(moolaPurseP, 'carolMoolaPurse', log);
      await showPurseBalance(simoleanPurseP, 'carolSimoleanPurse', log);
    },
  });
};

export function buildRootObject(vatPowers) {
  return harden({
    build: (...args) => build(vatPowers.testLog, ...args),
  });
}
