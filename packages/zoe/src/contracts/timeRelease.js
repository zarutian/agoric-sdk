import harden from '@agoric/harden';

// Eventually will be importable from '@agoric/zoe-contract-support'
import { makeZoeHelpers } from '../contractSupport';

// Alice escrows funds, and then Bob can get them as a payout, but
// only after a certain time.

// zcf is the Zoe Contract Facet, i.e. the contract-facing API of Zoe
export const makeContract = harden(zcf => {
  const { swap, assertKeywords } = makeZoeHelpers(zcf);
  assertKeywords(harden(['Token']));

  const { terms: { timer }} = zcf.getInstanceRecord();

  const makeClaimAssetsInvite = addAssetsOfferHandle => {
    const claimAssetsOfferHook = claimAssetsOfferHandle => {
      // TODO: use the timer to ensure that this reallocation and completion
      // happens only after a certain time.
      return swap(addAssetsOfferHandle, claimAssetsOfferHandle);
    };

    return zcf.makeInvitation(
      claimAssetsOfferHook,
      harden({ inviteDesc: 'claimAssets' }),
    );
  };

  const makeAddAssetsInvite = () =>
    zcf.makeInvitation(
      makeClaimAssetsInvite,
      harden({ inviteDesc: 'addAssets' }),
    );

  return harden({
    invite: makeAddAssetsInvite(),
  });
});
