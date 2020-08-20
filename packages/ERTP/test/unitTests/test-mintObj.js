// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';

// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from 'tape-promise/tape';
import { makeIssuerKit, MathKind } from '../../src';

test('mint.getIssuer', t => {
  try {
    const { mint, issuer } = makeIssuerKit('fungible');
    t.equals(mint.getIssuer(), issuer);
  } catch (e) {
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('mint.mintPayment default nat MathKind', t => {
  t.plan(2);
  const { mint, issuer, amountMath } = makeIssuerKit('fungible');
  const fungible1000 = amountMath.make(1000);
  const payment1 = mint.mintPayment(fungible1000);
  issuer.getAmountOf(payment1).then(paymentBalance1 => {
    t.ok(amountMath.isEqual(paymentBalance1, fungible1000));
  });

  const payment2 = mint.mintPayment(amountMath.make(1000));
  issuer.getAmountOf(payment2).then(paymentBalance2 => {
    t.ok(amountMath.isEqual(paymentBalance2, fungible1000));
  });
});

test('mint.mintPayment strSet MathKind', t => {
  t.plan(2);
  const { mint, issuer, amountMath } = makeIssuerKit(
    'items',
    MathKind.STRING_SET,
  );
  const items1and2and4 = amountMath.make(harden(['1', '2', '4']));
  const payment1 = mint.mintPayment(items1and2and4);
  issuer.getAmountOf(payment1).then(paymentBalance1 => {
    t.ok(amountMath.isEqual(paymentBalance1, items1and2and4));
  });

  const items5and6 = amountMath.make(harden(['5', '6']));
  const payment2 = mint.mintPayment(items5and6);
  issuer.getAmountOf(payment2).then(paymentBalance2 => {
    t.ok(amountMath.isEqual(paymentBalance2, items5and6));
  });
});

test('mint.mintPayment set MathKind', t => {
  t.plan(3);
  const { mint, issuer, amountMath } = makeIssuerKit('items', MathKind.SET);
  const item1handle = {};
  const item2handle = {};
  const item3handle = {};
  const items1and2 = amountMath.make(harden([item1handle, item2handle]));
  const payment1 = mint.mintPayment(items1and2);
  issuer.getAmountOf(payment1).then(paymentBalance1 => {
    t.ok(amountMath.isEqual(paymentBalance1, items1and2));
  });

  const item3 = amountMath.make(harden([item3handle]));
  const payment2 = mint.mintPayment(item3);
  issuer.getAmountOf(payment2).then(paymentBalance2 => {
    t.ok(amountMath.isEqual(paymentBalance2, item3));
  });

  // TODO: prevent reminting the same non-fungible amounts
  // https://github.com/Agoric/agoric-sdk/issues/552
  const payment3 = mint.mintPayment(item3);
  issuer.getAmountOf(payment3).then(paymentBalance3 => {
    t.ok(amountMath.isEqual(paymentBalance3, item3));
  });
});

test('mint.mintPayment set MathKind with invites', t => {
  t.plan(2);
  const { mint, issuer, amountMath } = makeIssuerKit('items', MathKind.SET);
  const instanceHandle1 = {};
  const invite1Value = { handle: {}, instanceHandle: instanceHandle1 };
  const invite2Value = { handle: {}, instanceHandle: instanceHandle1 };
  const invite3Value = { handle: {}, instanceHandle: {} };
  const invites1and2 = amountMath.make(harden([invite1Value, invite2Value]));
  const payment1 = mint.mintPayment(invites1and2);
  issuer.getAmountOf(payment1).then(paymentBalance1 => {
    t.ok(amountMath.isEqual(paymentBalance1, invites1and2));
  });

  const invite3 = amountMath.make(harden([invite3Value]));
  const payment2 = mint.mintPayment(invite3);
  issuer.getAmountOf(payment2).then(paymentBalance2 => {
    t.ok(amountMath.isEqual(paymentBalance2, invite3));
  });
});

// Tests related to non-fungible tokens
// This test models ballet tickets
test('non-fungible tokens example', t => {
  t.plan(11);
  const {
    mint: balletTicketMint,
    issuer: balletTicketIssuer,
    amountMath,
  } = makeIssuerKit('Agoric Ballet Opera tickets', MathKind.SET);

  const startDateString = new Date(2020, 1, 17, 20, 30).toISOString();

  const ticketDescriptionObjects = Array(5)
    .fill()
    .map((_, i) => ({
      seat: i + 1,
      show: 'The Sofa',
      start: startDateString,
    }));

  const balletTicketPayments = ticketDescriptionObjects.map(
    ticketDescription => {
      return balletTicketMint.mintPayment(
        amountMath.make(harden([ticketDescription])),
      );
    },
  );

  // Alice will buy ticket 1
  const paymentForAlice = balletTicketPayments[0];
  // Bob will buy tickets 3 and 4
  const paymentForBob = balletTicketIssuer.combine([
    balletTicketPayments[2],
    balletTicketPayments[3],
  ]);

  // ALICE SIDE
  // Alice bought ticket 1 and has access to the balletTicketIssuer, because it's public
  balletTicketIssuer.claim(paymentForAlice).then(myTicketPaymentAlice => {
    // the call to claim() hasn't thrown, so Alice knows myTicketPaymentAlice
    // is a genuine 'Agoric Ballet Opera tickets' payment and she has exclusive access
    // to its handle
    balletTicketIssuer
      .getAmountOf(myTicketPaymentAlice)
      .then(paymentAmountAlice => {
        t.equals(paymentAmountAlice.value.length, 1);
        t.equals(paymentAmountAlice.value[0].seat, 1);
        t.equals(paymentAmountAlice.value[0].show, 'The Sofa');
        t.equals(paymentAmountAlice.value[0].start, startDateString);
      });
  });

  // BOB SIDE
  // Bob bought ticket 3 and 4 and has access to the balletTicketIssuer, because it's public
  balletTicketIssuer.claim(paymentForBob).then(bobTicketPayment => {
    balletTicketIssuer.getAmountOf(bobTicketPayment).then(paymentAmountBob => {
      t.equals(paymentAmountBob.value.length, 2);
      t.equals(paymentAmountBob.value[0].seat, 3);
      t.equals(paymentAmountBob.value[1].seat, 4);
      t.equals(paymentAmountBob.value[0].show, 'The Sofa');
      t.equals(paymentAmountBob.value[1].show, 'The Sofa');
      t.equals(paymentAmountBob.value[0].start, startDateString);
      t.equals(paymentAmountBob.value[1].start, startDateString);
    });
  });
});
