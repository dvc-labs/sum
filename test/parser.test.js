import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCount } from '../src/game/parser.js';

const v = (s, opts) => parseCount(s, opts).value;

test('plain numbers', () => {
  assert.equal(v('1'), 1);
  assert.equal(v('  42  '), 42);
  assert.equal(v('42 let’s gooo'), 42);
  assert.equal(v('7!'), 7);
});

test('chatter is not an attempt', () => {
  for (const s of ['hello', 'lol 5', '', '<@123> 5', '-1', '(hello', '   ']) {
    assert.equal(parseCount(s).attempt, false, s);
  }
});

test('math expressions', () => {
  assert.equal(v('1+1'), 2);
  assert.equal(v('2x1'), 2);
  assert.equal(v('2X3'), 6);
  assert.equal(v('2×3'), 6);
  assert.equal(v('4/2'), 2);
  assert.equal(v('8÷4'), 2);
  assert.equal(v('3-1'), 2);
  assert.equal(v('1 + 2 * 3'), 7);
  assert.equal(v('(1+2)*3'), 9);
  assert.equal(v('7/2*2'), 7);
  assert.equal(v('1/3*3'), 1);
  assert.equal(v('10--1'), 11);
  assert.equal(parseCount('1+1').expression, true);
  assert.equal(parseCount('2').expression, false);
});

test('greedy prefix with backtracking', () => {
  assert.equal(v('4 xmas'), 4);
  assert.equal(v('4x'), 4);
  assert.equal(v('5 + reasons'), 5);
  assert.equal(v('12 - the best'), 12);
});

test('bad tails and non-integers are wrong attempts', () => {
  for (const s of ['1.5', '1,000', '3/2', '1/0', '9999999999999999999']) {
    const r = parseCount(s);
    assert.equal(r.attempt, true, s);
    assert.equal(r.value, null, s);
  }
});

test('math off only reads leading integer', () => {
  assert.equal(v('2+2', { allowMath: false }), 2);
  assert.equal(parseCount('(1+1)', { allowMath: false }).attempt, false);
});

test('length and depth limits never throw', () => {
  assert.doesNotThrow(() => parseCount('('.repeat(500) + '1' + ')'.repeat(500)));
  assert.doesNotThrow(() => parseCount('1+'.repeat(1000) + '1'));
});
