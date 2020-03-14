import { test } from 'tape';
import { evaluateProgram } from '@agoric/evaluate';

test('basic', t => {
  t.deepEqual(evaluateProgram('1+2'), 3);
  t.deepEqual(evaluateProgram('(a,b) => a+b')(1, 2), 3);
  t.deepEqual(evaluateProgram('(function(a,b) { return a+b; })')(1, 2), 3);
  t.end();
});

test('endowments', t => {
  t.deepEqual(evaluateProgram('1+a', { endowments: { a: 2 }}), 3);
  t.deepEqual(evaluateProgram('(a,b) => a+b+c', { endowments: { c: 3 }})(1, 2), 6);
  t.deepEqual(evaluateProgram('(function(a,b) { return a+b+c; })', { endowments: { c: 3 }})(1, 2), 6);
  t.deepEqual(evaluateProgram('1+a+b', { endowments: { a: 2, b: 3 }}), 6);
  t.end();
});
