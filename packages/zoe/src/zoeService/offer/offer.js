// @ts-check
import { passStyleOf } from '@endo/marshal';

import { cleanProposal } from '../../cleanProposal.js';
import { burnInvitation } from './burnInvitation.js';

import '@agoric/ertp/exported.js';
import '@agoric/store/exported.js';
import '../../../exported.js';
import '../internal-types.js';

const { details: X, quote: q } = assert;

/**
 * @param {Issuer} invitationIssuer
 * @param {GetInstanceAdmin} getInstanceAdmin
 * @param {DepositPayments} depositPayments
 * @param {GetAssetKindByBrand} getAssetKindByBrand
 * @returns {Offer}
 */
export const makeOfferMethod = (
  invitationIssuer,
  getInstanceAdmin,
  depositPayments,
  getAssetKindByBrand,
  makeTimeout,
) => {
  /** @type {Offer} */
  const offer = async (
    invitation,
    uncleanProposal = harden({}),
    paymentKeywordRecord = harden({}),
    offerArgs = undefined,
  ) => {
    const { instanceHandle, invitationHandle } = await burnInvitation(
      invitationIssuer,
      invitation,
    );
    // AWAIT ///

    const instanceAdmin = getInstanceAdmin(instanceHandle);
    instanceAdmin.assertAcceptingOffers();

    const proposal = cleanProposal(uncleanProposal, getAssetKindByBrand);

    if (offerArgs !== undefined) {
      const passStyle = passStyleOf(offerArgs);
      assert(
        passStyle === 'copyRecord',
        X`offerArgs must be a pass-by-copy record, but instead was a ${q(
          passStyle,
        )}: ${offerArgs}`,
      );
    }

    const timeoutPromise = makeTimeout();
    const onDepositFailure = (backpayments) => {
      // tbd: what the hell comes here?
      // idea:
      if (offerArgs !== undefined) {
        if (offerArgs.onDepositFailure !== undefined) {
          (E.sendOnly(offerArgs.onDepositFailure))(harden(backpayments));
        }
      }
      throw new Error("Deposition failed.");
    }
    const initialAllocation = await depositPayments(
      proposal,
      paymentKeywordRecord,
      timeoutPromise,
      onDepositFailure,
    );
    // AWAIT ///

    // This triggers the offerHandler in ZCF
    const userSeat = await instanceAdmin.makeUserSeat(
      invitationHandle,
      initialAllocation,
      proposal,
      offerArgs,
    );
    // AWAIT ///
    return userSeat;
  };
  return offer;
};
