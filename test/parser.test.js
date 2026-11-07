import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCount } from '../src/game/parser.js';
import { GAME } from '../src/config.js';

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

test('decimal expressions use either separator and exact arithmetic', () => {
  assert.equal(v('1,5+0,5 =2'), 2);
  assert.equal(v('1.05+0.95=2'), 2);
  assert.equal(v('(1,05+0.95)*2'), 4);
  assert.equal(v('0.58x100'), 58);
  assert.equal(v('2,00'), 2);
  assert.equal(v('2.00'), 2);
});

test('number emoji work as digits, as ten and in expressions', () => {
  const keycaps = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  keycaps.forEach((emoji, number) => assert.equal(v(emoji), number, emoji));
  assert.equal(v('1\u20e3'), 1);
  assert.equal(v('1️⃣2️⃣ good job'), 12);
  assert.equal(v('🔟+2️⃣'), 12);
  assert.equal(v('1️⃣.0️⃣5️⃣+0,95'), 2);
  assert.equal(parseCount('#️⃣').attempt, false);
  assert.equal(parseCount('*️⃣').attempt, false);
});

test('greedy prefix with backtracking', () => {
  assert.equal(v('4 xmas'), 4);
  assert.equal(v('4x'), 4);
  assert.equal(v('5 + reasons'), 5);
  assert.equal(v('12 - the best'), 12);
});

test('bad tails and non-integers are wrong attempts', () => {
  for (const s of ['1.5', '1,000', '3/2', '1/0', '9999999999999999999',
    '1.005+0.995', '1+0,000', '2+(0.00,0)', '2.0️⃣0️⃣0️⃣']) {
    const r = parseCount(s);
    assert.equal(r.attempt, true, s);
    assert.equal(r.value, null, s);
  }
});

test('math off reads a single leading number', () => {
  assert.equal(v('2+2', { allowMath: false }), 2);
  assert.equal(v('2,00+2', { allowMath: false }), 2);
  assert.equal(v('🔟+2️⃣', { allowMath: false }), 10);
  assert.equal(v('1.5+0.5', { allowMath: false }), null);
  assert.equal(parseCount('(1+1)', { allowMath: false }).attempt, false);
});

test('length and depth limits never throw', () => {
  assert.doesNotThrow(() => parseCount('('.repeat(500) + '1' + ')'.repeat(500)));
  assert.doesNotThrow(() => parseCount('1+'.repeat(1000) + '1'));
  const prefix = '1'.padEnd(GAME.maxExpressionLength - '+1.00'.length);
  assert.equal(v(prefix + '+1.0️⃣0️⃣'), 2);
  assert.equal(v(prefix + '+1.0️⃣0️⃣0️⃣'), null);
});
