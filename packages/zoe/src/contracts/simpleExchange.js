// @ts-check

import { makeNotifierKit } from '@agoric/notifier';

import '../../exported';
import {
  swap,
  satisfies,
  assertProposalShape,
  assertIssuerKeywords,
} from '../contractSupport/zoeHelpers';

/**
 * SimpleExchange is an exchange with a simple matching algorithm, which allows
 * an unlimited number of parties to create new orders or accept existing
 * orders. The notifier allows callers to find the current list of orders.
 *
 * The SimpleExchange uses Asset and Price as its keywords. The contract treats
 * the two keywords symmetrically. New offers can be created and existing offers
 * can be accepted in either direction.
 *
 * { give: { 'Asset', simoleans(5) }, want: { 'Price', quatloos(3) } }
 * { give: { 'Price', quatloos(8) }, want: { 'Asset', simoleans(3) } }
 *
 * The Asset is treated as an exact amount to be exchanged, while the
 * Price is a limit that may be improved on. This simple exchange does
 * not partially fill orders.
 *
 * The publicFacet is returned from the contract.
 *
 * @type {ContractStartFn}
 */
const start = zcf => {
  let sellSeats = [];
  let buySeats = [];
  // eslint-disable-next-line no-use-before-define
  const { notifier, updater } = makeNotifierKit(getBookOrders());

  assertIssuerKeywords(zcf, harden(['Asset', 'Price']));

  function dropExit(p) {
    return {
      want: p.want,
      give: p.give,
    };
  }

  function flattenOrders(seats) {
    const activeSeats = seats.filter(s => !s.hasExited());
    return activeSeats.map(seat => dropExit(seat.getProposal()));
  }

  function getBookOrders() {
    return {
      buys: flattenOrders(buySeats),
      sells: flattenOrders(sellSeats),
    };
  }

  // Tell the notifier that there has been a change to the book orders
  function bookOrdersChanged() {
    updater.updateState(getBookOrders());
  }

  // If there's an existing offer that this offer is a match for, make the trade
  // and return the seat for the matched offer. If not, return undefined, so
  // the caller can know to add the new offer to the book.
  function swapIfCanTrade(offers, seat) {
    for (const offer of offers) {
      const satisfiedBy = (xSeat, ySeat) =>
        satisfies(zcf, xSeat, ySeat.getCurrentAllocation());
      if (satisfiedBy(offer, seat) && satisfiedBy(seat, offer)) {
        swap(zcf, seat, offer);
        // return handle to remove
        return offer;
      }
    }
    return undefined;
  }

  // try to swap offerHandle with one of the counterOffers. If it works, remove
  // the matching offer and return the remaining counterOffers. If there's no
  // matching offer, add the offerHandle to the coOffers, and return the
  // unmodified counterOfffers
  function swapIfCanTradeAndUpdateBook(counterOffers, coOffers, seat) {
    const offer = swapIfCanTrade(counterOffers, seat);
    if (offer) {
      // remove the matched offer.
      counterOffers = counterOffers.filter(value => value !== offer);
    } else {
      // Save the order in the book
      coOffers.push(seat);
    }
    bookOrdersChanged();
    return counterOffers;
  }

  const sellAssetForPrice = harden({
    give: { Asset: null },
    want: { Price: null },
  });

  const sell = seat => {
    buySeats = swapIfCanTradeAndUpdateBook(buySeats, sellSeats, seat);
    return 'Trade Successful';
  };

  const sellHandler = assertProposalShape(sell, sellAssetForPrice);

  const buyAssetForPrice = harden({
    give: { Price: null },
    want: { Asset: null },
  });

  const buy = seat => {
    sellSeats = swapIfCanTradeAndUpdateBook(sellSeats, buySeats, seat);
    return 'Trade Successful';
  };

  const buyHandler = assertProposalShape(buy, buyAssetForPrice);

  /** @type {OfferHandler} */
  const exchangeOfferHandler = seat => {
    // Buy Order
    if (seat.getProposal().want.Asset) {
      return buyHandler(seat);
    }
    // Sell Order
    if (seat.getProposal().give.Asset) {
      return sellHandler(seat);
    }
    // Eject because the offer must be invalid
    throw seat.kickOut(
      new Error(`The proposal did not match either a buy or sell order.`),
    );
  };

  const makeExchangeInvitation = () =>
    zcf.makeInvitation(exchangeOfferHandler, 'exchange');

  /** @type {SimpleExchangePublicFacet} */
  const publicFacet = harden({
    makeInvitation: makeExchangeInvitation,
    getNotifier: () => notifier,
  });

  // set the initial state of the notifier
  bookOrdersChanged();
  return harden({ publicFacet });
};

harden(start);
export { start };
