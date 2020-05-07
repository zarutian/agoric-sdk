// @ts-check

import harden from '@agoric/harden';
import { makeZoeHelpers, defaultAcceptanceMsg } from '../contractSupport';

/** @typedef {import('../zoe').ContractFacet} ContractFacet */

/**
 * The Barter Exchange ignores the keywords in offers. It takes advantage of
 * Zoe facet parameters by only paying attention the issuers in proposals.
 *
 * The want and give amounts are both treated as minimums. Each successful
 * trader gets their `want` and may trade with counter-parties who specify any
 * amount up to their specified `give`.
 */
export const makeContract = harden(
  /** @param {ContractFacet} zcf */ zcf => {
    // bookOrders is a Map of Maps. The first key is the brand of each offer's
    // give, and the second key is the brand of their want.
    // for each offer, we store (see extractOfferDetails) the handle, as well as
    // keywords, brands, and amount for both `give` and `want`. The keywords are
    // only used to produce the payout.
    const bookOrders = new Map();
    let brandToAmountMath;

    const { rejectOffer, getKeys, assertKeywords } = makeZoeHelpers(zcf);

    assertKeywords(harden(['Asset', 'Price']));

    function lookupBookOrders(brandIn, brandOut) {
      let ordersMap = bookOrders.get(brandIn);
      if (!ordersMap) {
        ordersMap = new Map();
        bookOrders.set(brandIn, ordersMap);
      }
      let ordersArray = ordersMap.get(brandOut);
      if (!ordersArray) {
        ordersArray = [];
        ordersMap.set(brandOut, ordersArray);
      }
      return ordersArray;
    }

    const getKeywordAndBrand = (offerHandle, amountKeywordRecord) => {
      const keywords = getKeys(amountKeywordRecord);
      if (keywords.length !== 1) {
        rejectOffer(
          offerHandle,
          `A swap requires giving one type of token for another, ${keywords.length} tokens were provided.`,
        );
      }
      return harden({
        keyword: keywords[0],
        brand: Object.values(amountKeywordRecord)[0].brand,
      });
    };

    function extractOfferDetails(offerHandle, proposal) {
      const keywordAndBrandIn = getKeywordAndBrand(offerHandle, proposal.give);
      const { brand: brandIn, keyword: keywordIn } = keywordAndBrandIn;
      const keywordAndBrandOut = getKeywordAndBrand(offerHandle, proposal.want);
      const { brand: brandOut, keyword: keywordOut } = keywordAndBrandOut;
      const {
        proposal: {
          give: { [keywordIn]: amountIn },
          want: { [keywordOut]: amountOut },
        },
      } = zcf.getOffer(offerHandle);
      return {
        offerHandle,
        keywordOut,
        brandOut,
        amountOut,
        keywordIn,
        brandIn,
        amountIn,
      };
    }

    function findMatchingTrade(newDetails, orders) {
      return orders.find(order => {
        const { amountIn, amountOut } = order;
        // see if canTradeWith() would work as well
        const amountMathNewIn = brandToAmountMath.get(newDetails.brandIn);
        const amountMathNewOut = brandToAmountMath.get(newDetails.brandOut);
        return (
          amountMathNewIn.isGTE(newDetails.amountIn, amountOut) &&
          amountMathNewOut.isGTE(amountIn, newDetails.amountOut)
        );
      });
    }

    function removeFromOrders(offerDetails) {
      const orders = lookupBookOrders(
        offerDetails.brandIn,
        offerDetails.brandOut,
      );
      orders.splice(orders.indexOf(offerDetails), 1);
    }

    function crossMatchAmounts(offerDetails, matchingTrade) {
      const amountMathNewIn = brandToAmountMath.get(offerDetails.brandIn);
      const amountMathNewOut = brandToAmountMath.get(offerDetails.brandOut);
      const newOfferAmountsRecord = {
        [offerDetails.keywordOut]: offerDetails.amountOut,
        [offerDetails.keywordIn]: amountMathNewIn.subtract(
          offerDetails.amountIn,
          matchingTrade.amountOut,
        ),
      };
      const newMatchingAmountsRecord = {
        [matchingTrade.keywordOut]: matchingTrade.amountOut,
        [matchingTrade.keywordIn]: amountMathNewOut.subtract(
          matchingTrade.amountIn,
          offerDetails.amountOut,
        ),
      };
      return [newOfferAmountsRecord, newMatchingAmountsRecord];
    }

    function tradeWithMatchingOffer(offerDetails) {
      const orders = lookupBookOrders(
        offerDetails.brandOut,
        offerDetails.brandIn,
      );
      const matchingTrade = findMatchingTrade(offerDetails, orders);
      if (matchingTrade) {
        // reallocate by switching the amount
        const amounts = crossMatchAmounts(offerDetails, matchingTrade);
        const handles = [offerDetails.offerHandle, matchingTrade.offerHandle];
        const keywords = [
          [offerDetails.keywordIn, offerDetails.keywordOut],
          [matchingTrade.keywordIn, matchingTrade.keywordOut],
        ];
        zcf.reallocate(handles, amounts, keywords);
        // swap(offerDetails.offerHandle, matchingTrade.offerHandle);
        removeFromOrders(matchingTrade);
        zcf.complete(handles);

        return true;
      }
      return false;
    }

    function addToBook(offerDetails) {
      const orders = lookupBookOrders(
        offerDetails.brandIn,
        offerDetails.brandOut,
      );
      orders.push(offerDetails);
    }

    function extractBrandToAmountMaths(offerHandle, issuerKeywordRecord) {
      const amountMathMap = new Map();
      Object.getOwnPropertyNames(issuerKeywordRecord).forEach(keyword => {
        const amountMath = zcf.getAmountMaths([keyword])[keyword];
        amountMathMap.set(issuerKeywordRecord[keyword].getBrand(), amountMath);
      });
      return amountMathMap;
    }

    const exchangeOfferHook = offerHandle => {
      const { proposal } = zcf.getOffer(offerHandle);
      const { issuerKeywordRecord } = zcf.getInstanceRecord();
      brandToAmountMath = extractBrandToAmountMaths(
        offerHandle,
        issuerKeywordRecord,
      );
      const offerDetails = extractOfferDetails(offerHandle, proposal);

      if (!tradeWithMatchingOffer(offerDetails)) {
        addToBook(offerDetails);
      }

      return defaultAcceptanceMsg;
    };

    const makeExchangeInvite = () =>
      zcf.makeInvitation(exchangeOfferHook, 'exchange');

    return harden({
      invite: makeExchangeInvite(),
      publicAPI: {
        makeInvite: makeExchangeInvite,
      },
    });
  },
);
