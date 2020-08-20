// @ts-check

import { assert, details, q } from '@agoric/assert';
import makeStore from '@agoric/store';
// Eventually will be importable from '@agoric/zoe-contract-support'
import {
  assertIssuerKeywords,
  assertProposalShape,
  assertUsesNatMath,
} from '../../../src/contractSupport';

import '../../../exported';

/**
 * This contract implements coin voting. There are two roles: the
 * Secretary, who can determine the question (a string), make voting
 * invitations, and close the election; and the Voters, who can vote YES or
 * NO on the question. The voters can only get the capability to vote
 * by making an offer using a voter invitation and escrowing assets. The
 * brand of assets is determined on contract instantiation through an
 * issuerKeywordRecord. The instantiator gets the only Secretary
 * access through the creatorFacet.
 *
 * @type {ContractStartFn}
 */
const start = zcf => {
  const {
    question,
    brands: { Assets: assetsBrand },
    maths: { Assets: amountMath },
  } = zcf.getTerms();
  let electionOpen = true;
  assertIssuerKeywords(zcf, harden(['Assets']));
  assert.typeof(question, 'string');
  assertUsesNatMath(zcf, assetsBrand);

  const seatToResponse = makeStore('seat');

  // We assume the only valid responses are 'YES' and 'NO'
  const assertResponse = response => {
    assert(
      response === 'NO' || response === 'YES',
      details`the answer ${q(response)} was not 'YES' or 'NO'`,
    );
    // Throw an error if the response is not valid, but do not
    // exit the seat. We should allow the voter to recast their vote.
  };

  const voteHandler = voterSeat => {
    const voter = harden({
      /**
       * Vote on a particular issue
       * @param {string} response - 'YES' || 'NO'
       */
      vote: response => {
        // Throw if the offer is no longer active, i.e. the user has
        // completed their offer and the assets are no longer escrowed.
        assert(!voterSeat.hasExited(), details`the voter seat has exited`);

        assertResponse(response);

        // Record the response
        if (seatToResponse.has(voterSeat)) {
          seatToResponse.set(voterSeat, response);
        } else {
          seatToResponse.init(voterSeat, response);
        }
        return `Successfully voted '${response}'`;
      },
    });
    return voter;
  };

  const expectedVoterProposal = harden({
    give: { Assets: null },
  });

  const creatorFacet = harden({
    closeElection: () => {
      assert(electionOpen, 'the election is already closed');
      // YES | NO to Nat
      const tally = new Map();
      tally.set('YES', amountMath.getEmpty());
      tally.set('NO', amountMath.getEmpty());

      for (const [seat, response] of seatToResponse.entries()) {
        if (!seat.hasExited()) {
          const escrowedAmount = seat.getAmountAllocated('Assets');
          const sumSoFar = tally.get(response);
          tally.set(response, amountMath.add(escrowedAmount, sumSoFar));
          seat.exit();
        }
      }
      electionOpen = false;

      return harden({
        YES: tally.get('YES'),
        NO: tally.get('NO'),
      });
    },
    makeVoterInvitation: () => {
      assert(electionOpen, 'the election is closed');
      return zcf.makeInvitation(
        assertProposalShape(voteHandler, expectedVoterProposal),
        'voter',
      );
    },
  });

  // Return the creatorFacet so that the creator of the
  // contract instance can hand out scarce votes and close the election.

  return harden({ creatorFacet });
};

harden(start);
export { start };
