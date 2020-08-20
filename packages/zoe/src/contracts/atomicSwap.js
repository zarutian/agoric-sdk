// @ts-check

// Eventually will be importable from '@agoric/zoe-contract-support'
import {
  assertIssuerKeywords,
  swap,
  assertProposalShape,
} from '../contractSupport';

import '../../exported';

/**
 * Trade one item for another.
 *
 * The initial offer is { give: { Asset: A }, want: { Price: B } }.
 * The outcome from the first offer is an invitation for the second party,
 * who should offer { give: { Price: B }, want: { Asset: A } }, with a want
 * amount no greater than the original's give, and a give amount at least as
 * large as the original's want.
 *
 * @type {ContractStartFn}
 */
const start = zcf => {
  assertIssuerKeywords(zcf, harden(['Asset', 'Price']));

  /** @type {OfferHandler} */
  const makeMatchingInvitation = firstSeat => {
    const { want, give } = firstSeat.getProposal();

    /** @type {OfferHandler} */
    const matchingSeatOfferHandler = matchingSeat =>
      swap(zcf, firstSeat, matchingSeat);

    const matchingSeatInvitation = zcf.makeInvitation(
      matchingSeatOfferHandler,
      'matchOffer',
      {
        asset: give.Asset,
        price: want.Price,
      },
    );
    return matchingSeatInvitation;
  };

  const firstProposalExpected = harden({
    give: { Asset: null },
    want: { Price: null },
  });

  const creatorInvitation = zcf.makeInvitation(
    assertProposalShape(makeMatchingInvitation, firstProposalExpected),
    'firstOffer',
  );

  return { creatorInvitation };
};

harden(start);
export { start };
