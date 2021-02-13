import { E } from '@agoric/eventual-send';
import { assert, details as X } from '@agoric/assert';
import { makeIssuerKit } from '../../../src';

export function buildRootObject(vatPowers, vatParameters) {
  const arg0 = vatParameters.argv[0];

  function testSplitPayments(aliceMaker) {
    vatPowers.testLog('start test splitPayments');
    const { mint: moolaMint, issuer, amountMath } = makeIssuerKit('moola');
    const moolaPayment = moolaMint.mintPayment(amountMath.make(1000));

    const aliceP = E(aliceMaker).make(issuer, amountMath, moolaPayment);
    return E(aliceP).testSplitPayments();
  }

  const obj0 = {
    async bootstrap(vats) {
      switch (arg0) {
        case 'splitPayments': {
          const aliceMaker = await E(vats.alice).makeAliceMaker();
          return testSplitPayments(aliceMaker);
        }
        default: {
          assert.fail(X`unrecognized argument value ${arg0}`);
        }
      }
    },
  };
  return harden(obj0);
}
