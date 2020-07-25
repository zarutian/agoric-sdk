import '@agoric/install-ses';
import { test } from 'tape';
import { an, assert, details, q } from '../src/assert';
import { throwsAndLogs } from './throwsAndLogs';

test('an', t => {
  try {
    t.equal(an('object'), 'an object');
    t.equal(an('function'), 'a function');
    // does not treat an initial 'y' as a vowel
    t.equal(an('yaml file'), 'a yaml file');
    // recognize upper case vowels
    t.equal(an('Object'), 'an Object');
    // coerce non-objects to strings.
    // non-letters are treated as non-vowels
    t.equal(an({}), 'a [object Object]');
  } catch (e) {
    console.log('unexpected exception', e);
    t.assert(false, e);
  } finally {
    t.end();
  }
});

// Self-test of the example from the throwsAndLogs comment.
test('throwsAndLogs', t => {
  const err = {};
  try {
    throwsAndLogs(
      t,
      () => {
        console.error('what ', err);
        throw new Error('foo');
      },
      /foo/,
      [['error', 'what ', err]],
    );
  } catch (e) {
    console.log('unexpected exception', e);
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('assert', t => {
  try {
    assert(2 + 3 === 5);

    throwsAndLogs(t, () => assert(false), /Check failed/, [
      ['error', 'LOGGED ERROR:', 'Check failed'],
    ]);
    throwsAndLogs(t, () => assert(false, 'foo'), /foo/, [
      ['error', 'LOGGED ERROR:', 'foo'],
    ]);

    throwsAndLogs(t, () => assert.fail(), /Assert failed/, [
      ['error', 'LOGGED ERROR:', 'Assert failed'],
    ]);
    throwsAndLogs(t, () => assert.fail('foo'), /foo/, [
      ['error', 'LOGGED ERROR:', 'foo'],
    ]);
  } catch (e) {
    console.log('unexpected exception', e);
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('assert equals', t => {
  try {
    assert.equal(2 + 3, 5);
    throwsAndLogs(t, () => assert.equal(5, 6, 'foo'), /foo/, [
      ['error', 'LOGGED ERROR:', 'foo'],
    ]);
    throwsAndLogs(
      t,
      () => assert.equal(5, 6, details`${5} !== ${6}`),
      /\(a number\) !== \(a number\)/,
      [['error', 'LOGGED ERROR:', 5, '!==', 6]],
    );
    throwsAndLogs(
      t,
      () => assert.equal(5, 6, details`${5} !== ${q(6)}`),
      /\(a number\) !== 6/,
      [['error', 'LOGGED ERROR:', 5, '!==', 6]],
    );

    assert.equal(NaN, NaN);
    throwsAndLogs(
      t,
      () => assert.equal(-0, 0),
      /Expected \(a number\) is same as \(a number\)/,
      [['error', 'LOGGED ERROR:', 'Expected', -0, 'is same as', 0]],
    );
  } catch (e) {
    console.log('unexpected exception', e);
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('assert typeof', t => {
  try {
    assert.typeof(2, 'number');
    throwsAndLogs(
      t,
      () => assert.typeof(2, 'string'),
      /\(a number\) must be a string/,
      [['error', 'LOGGED ERROR:', 2, 'must be a string']],
    );
    throwsAndLogs(t, () => assert.typeof(2, 'string', 'foo'), /foo/, [
      ['error', 'LOGGED ERROR:', 'foo'],
    ]);
  } catch (e) {
    console.log('unexpected exception', e);
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('assert q', t => {
  try {
    throwsAndLogs(
      t,
      () => assert.fail(details`<${'bar'},${q('baz')}>`),
      /<\(a string\),"baz">/,
      [['error', 'LOGGED ERROR:', '<', 'bar', ',', 'baz', '>']],
    );

    const list = ['a', 'b', 'c'];
    throwsAndLogs(
      t,
      () => assert.fail(details`${q(list)}`),
      /\["a","b","c"\]/,
      [['error', 'LOGGED ERROR:', ['a', 'b', 'c']]],
    );
    const repeat = { x: list, y: list };
    throwsAndLogs(
      t,
      () => assert.fail(details`${q(repeat)}`),
      /{"x":\["a","b","c"\],"y":"<\*\*seen\*\*>"}/,
      [['error', 'LOGGED ERROR:', { x: ['a', 'b', 'c'], y: ['a', 'b', 'c'] }]],
    );

    // Make it into a cycle
    list[1] = list;
    throwsAndLogs(
      t,
      () => assert.fail(details`${q(list)}`),
      /\["a","<\*\*seen\*\*>","c"\]/,
      [['error', 'LOGGED ERROR:', ['a', list, 'c']]],
    );
    throwsAndLogs(
      t,
      () => assert.fail(details`${q(repeat)}`),
      /{"x":\["a","<\*\*seen\*\*>","c"\],"y":"<\*\*seen\*\*>"}/,
      [['error', 'LOGGED ERROR:', { x: list, y: ['a', list, 'c'] }]],
    );
  } catch (e) {
    console.log('unexpected exception', e);
    t.assert(false, e);
  } finally {
    t.end();
  }
});
