// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
import { test } from 'tape-promise/tape';

import { makeStateMachine } from '../../../src/contractSupport';

test('stateMachine', t => {
  t.plan(4);
  try {
    const startState = 'empty';
    const allowedTransitions = [
      ['empty', ['open']],
      ['open', ['rellocating', 'cancelled']],
      ['reallocating', ['dispersing']],
      ['dispersing', ['closed']],
      ['cancelled', []],
      ['closed', []],
    ];
    const stateMachine = makeStateMachine(startState, allowedTransitions);
    t.equal(stateMachine.getStatus(), 'empty');
    t.ok(stateMachine.canTransitionTo('open'));
    t.notOk(stateMachine.canTransitionTo('closed'));
    stateMachine.transitionTo('open');
    t.equal(stateMachine.getStatus(), 'open');
  } catch (e) {
    t.assert(false, e);
  }
});
