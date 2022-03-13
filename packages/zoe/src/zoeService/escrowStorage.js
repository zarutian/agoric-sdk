// @ts-check

import { AmountMath, AmountKind } from '@agoric/ertp';
import { E } from '@agoric/eventual-send';
import { makeWeakStore } from '@agoric/store';
import { assert, details as X, q } from '@agoric/assert';

import './types.js';
import './internal-types.js';

import { cleanKeywords } from '../cleanProposal.js';
import { arrayToObj, objectMap } from '../objArrayConversion.js';

/**
 * Store the pool purses whose purpose is to escrow assets, with one
 * purse per brand.
 */
export const makeEscrowStorage = (misbehavingPaymentsBrand) => {
  /** @type {WeakStore<Brand, ERef<Purse>>} */
  const brandToPurse = makeWeakStore('brand');

  /** @type {CreatePurse} */
  const createPurse = (issuer, brand) => {
    if (brandToPurse.has(brand)) {
      return undefined;
    }
    return E.when(
      E(issuer).makeEmptyPurse(),
      purse => {
        // Check again after the promise resolves
        if (!brandToPurse.has(brand)) {
          brandToPurse.init(brand, purse);
        }
      },
      err =>
        assert.fail(
          X`A purse could not be created for brand ${brand} because: ${err}`,
        ),
    );
  };

  /**
   * @type {MakeLocalPurse}
   */
  const makeLocalPurse = (issuer, brand) => {
    if (brandToPurse.has(brand)) {
      return /** @type {Purse} */ (brandToPurse.get(brand));
    } else {
      const localPurse = issuer.makeEmptyPurse();
      brandToPurse.init(brand, localPurse);
      return localPurse;
    }
  };

  /** @type {WithdrawPayments} */
  const withdrawPayments = allocation => {
    return harden(
      objectMap(allocation, ([keyword, amount]) => {
        const purse = brandToPurse.get(amount.brand);
        return [keyword, E(purse).withdraw(amount)];
      }),
    );
  };

  /**
   *
   *  Only used internally. Actually deposit a payment or promise for payment.
   *
   * @param {ERef<Payment>} paymentP
   * @param {Amount} amount
   * @returns {Promise<Amount>}
   */
  const doDepositPayment = (paymentP, amount) => {
    const purse = brandToPurse.get(amount.brand);
    return E.when(paymentP, payment => E(purse).deposit(payment, amount));
  };

  // Proposal is cleaned, but payments are not

  /** @type {DepositPayments} */
  const depositPayments = async (proposal, payments, makeTimeout) => {
    const { give, want } = proposal;
    const giveKeywords = Object.keys(give);
    const wantKeywords = Object.keys(want);
    const paymentKeywords = cleanKeywords(payments);

    // Assert that all of the payment keywords are present in the give
    // keywords. Proposal.give keywords that do not have matching payments will
    // be caught in the deposit step.
    paymentKeywords.forEach(keyword => {
      assert(
        giveKeywords.includes(keyword),
        X`The ${q(
          keyword,
        )} keyword in the paymentKeywordRecord was not a keyword in proposal.give, which had keywords: ${q(
          giveKeywords,
        )}`,
      );
    });

    const proposalKeywords = [...giveKeywords, ...wantKeywords];

    // If any of these deposits hang or fail, then depositPayments
    // hangs or fails, the offer does not succeed, and any funds that
    // were deposited into the pool purses are lost. We have a ticket
    // for giving the user a refund of what was already deposited, and
    // offer safety and payout liveness are still meaningful as long
    // as issuers are well-behaved. For more, see
    // https://github.com/Agoric/agoric-sdk/issues/1271

    // 2022-03-13 Zarutian:
    //   Here is what I propose, add an 'MisbehavingPayments'
    //   keyword and stuff the misbehaving payments into the amount
    //   there.
    const timeoutP = makeTimeout();
    const amountsDepositedPs = giveKeywords.map(keyword => {
      assert(
        payments[keyword] !== undefined,
        X`The ${q(
          keyword,
        )} keyword in proposal.give did not have an associated payment in the paymentKeywordRecord, which had keywords: ${q(
          paymentKeywords,
        )}`,
      );
      return doDepositPayment(payments[keyword], give[keyword]);
    });
    
    // a rather complicated await point
    // expect the timeoutPromise to be rejected when the timeout has occured
    const t1 = await Promise.allSettled(amountsDepositedPs.map(
      depositedP => Promise.race([depostedP, timeoutP]),
    ));
    const t2 = t1.reduce(
      (acc, item, idx) => {
        if (item.status === "rejected) {
          return AmountMath.add(acc, {
            [paymentKeywords[idx]]: [payments[paymentKeywords[idx]], depositedP[idx]],
          });
        }
        return acc;
      },
      AmountMath.makeEmpty(misbehavingPaymentsBrand, AmountKind.SET),
    );
    const amountsDeposited = t1.map(
      (item, idx) => {
        if (item.status === "fulfilled") {
          return item.value;
        } else {
          AmountMath.makeEmptyFromAmount(give[paymentKeywords[idx]]);
        }
      },
    );

    const emptyAmountsForWantKeywords = wantKeywords.map(keyword =>
      AmountMath.makeEmptyFromAmount(want[keyword]),
    );

    if (!AmountMath.isEmpty(t2)) {
      proposalKeywords.push('MisbehavingPayments');
      return arrayToObj(
        [...amountsDeposited, ...emptyAmountsForWantKeywords, t2],
        harden(proposalKeywords),
      );
    }

    const initialAllocation = arrayToObj(
      [...amountsDeposited, ...emptyAmountsForWantKeywords],
      harden(proposalKeywords),
    );

    return initialAllocation;
  };

  return {
    createPurse, // createPurse does not return a purse
    makeLocalPurse,
    withdrawPayments,
    depositPayments,
  };
};
