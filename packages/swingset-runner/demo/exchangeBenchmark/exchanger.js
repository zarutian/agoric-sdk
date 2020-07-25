/* global harden */

import { E } from '@agoric/eventual-send';
import { showPurseBalance, setupPurses } from './helpers';
import { makePrintLog } from './printLog';

const log = makePrintLog();

async function build(name, zoe, issuers, payments, installations) {
  const { moola, simoleans, purses } = await setupPurses(
    zoe,
    issuers,
    payments,
  );
  const [moolaPurseP, simoleanPurseP] = purses;
  const [moolaIssuer, simoleanIssuer] = issuers;
  const issuerKeywordRecord = harden({
    Price: simoleanIssuer,
    Asset: moolaIssuer,
  });
  const inviteIssuer = await E(zoe).getInviteIssuer();
  const { simpleExchange } = installations;

  async function preReport() {
    await showPurseBalance(moolaPurseP, `${name} moola before`, log);
    await showPurseBalance(simoleanPurseP, `${name} simoleans before`, log);
  }

  async function postReport() {
    await showPurseBalance(moolaPurseP, `${name} moola after`, log);
    await showPurseBalance(simoleanPurseP, `${name} simoleans after`, log);
  }

  async function receivePayout(payoutP) {
    const payout = await payoutP;
    const moolaPayout = await payout.Asset;
    const simoleanPayout = await payout.Price;

    await E(moolaPurseP).deposit(moolaPayout);
    await E(simoleanPurseP).deposit(simoleanPayout);
  }

  async function initiateSimpleExchange(otherP) {
    await preReport();

    const {
      invite: addOrderInvite,
      instanceRecord: { publicAPI },
    } = await E(zoe).makeInstance(simpleExchange, issuerKeywordRecord);

    const mySellOrderProposal = harden({
      give: { Asset: moola(1) },
      want: { Price: simoleans(1) },
      exit: { onDemand: null },
    });
    const paymentKeywordRecord = {
      Asset: await E(moolaPurseP).withdraw(moola(1)),
    };
    const { payout: payoutP } = await E(zoe).offer(
      addOrderInvite,
      mySellOrderProposal,
      paymentKeywordRecord,
    );

    const inviteP = E(publicAPI).makeInvite();
    await E(otherP).respondToSimpleExchange(inviteP);

    await receivePayout(payoutP);
    await postReport();
  }

  async function respondToSimpleExchange(inviteP) {
    await preReport();

    const invite = await inviteP;
    const exclInvite = await E(inviteIssuer).claim(invite);

    const myBuyOrderProposal = harden({
      want: { Asset: moola(1) },
      give: { Price: simoleans(1) },
      exit: { onDemand: null },
    });
    const paymentKeywordRecord = {
      Price: await E(simoleanPurseP).withdraw(simoleans(1)),
    };

    const { payout: payoutP } = await E(zoe).offer(
      exclInvite,
      myBuyOrderProposal,
      paymentKeywordRecord,
    );

    await receivePayout(payoutP);
    await postReport();
  }

  return harden({
    initiateSimpleExchange,
    respondToSimpleExchange,
  });
}

export function buildRootObjectCommon(name, _vatPowers) {
  return harden({
    build: (...args) => build(name, ...args),
  });
}
