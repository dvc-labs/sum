import { GAME } from '../config.js';

/**
 * Safe count parser. Never uses eval.
 *
 * A message is a count attempt when it starts with a digit or "(".
 * The longest valid expression at the start of the message is evaluated,
 * so "42 let's go" → 42 and "2x3 easy" → 6.
 *
 * Supported: integers, + - * x × / ÷ : and parentheses. Arithmetic is exact
 * (BigInt fractions), so 7/2*2 → 7 and 1/3*3 → 1. A non-integer result is a
 * wrong count, not chatter.
 */

const MUL = new Set(['*', 'x', 'X', '×', '·']);
const DIV = new Set(['/', '÷', ':']);
const MAX_DIGITS = 15;
const MAX_DEPTH = 8;

class Frac {
  constructor(n, d = 1n) {
    if (d === 0n) throw new RangeError('division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n < 0n ? -n : n, d);
    this.n = n / g;
    this.d = d / g;
  }
  add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { return new Frac(this.n * o.d, this.d * o.n); }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

class Parser {
  constructor(src, allowMath) {
    this.src = src;
    this.pos = 0;
    this.allowMath = allowMath;
    this.ops = 0;
    this.depth = 0;
  }
  skipWs() {
    while (this.pos < this.src.length && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++;
  }
  peek() {
    return this.src[this.pos];
  }
  number() {
    const start = this.pos;
    while (this.pos < this.src.length && this.src[this.pos] >= '0' && this.src[this.pos] <= '9') this.pos++;
    const digits = this.src.slice(start, this.pos);
    if (!digits) return null;
    if (digits.length > MAX_DIGITS) throw new RangeError('number too large');
    return new Frac(BigInt(digits));
  }
  factor() {
    this.skipWs();
    const c = this.peek();
    if (c === '-' && this.allowMath) {
      const save = this.pos;
      this.pos++;
      const inner = this.factor();
      if (!inner) {
        this.pos = save;
        return null;
      }
      this.ops++;
      return new Frac(-inner.n, inner.d);
    }
    if (c === '(' && this.allowMath) {
      if (++this.depth > MAX_DEPTH) throw new RangeError('too deep');
      const save = this.pos;
      this.pos++;
      const inner = this.expr();
      this.skipWs();
      if (!inner || this.peek() !== ')') {
        this.pos = save;
        this.depth--;
        return null;
      }
      this.pos++;
      this.depth--;
      return inner;
    }
    return this.number();
  }
  term() {
    let left = this.factor();
    if (!left) return null;
    for (;;) {
      const save = this.pos;
      this.skipWs();
      const c = this.peek();
      if (!this.allowMath || !(MUL.has(c) || DIV.has(c))) {
        this.pos = save;
        return left;
      }
      this.pos++;
      const right = this.factor();
      if (!right) {
        this.pos = save;
        return left;
      }
      this.ops++;
      left = MUL.has(c) ? left.mul(right) : left.div(right);
    }
  }
  expr() {
    let left = this.term();
    if (!left) return null;
    for (;;) {
      const save = this.pos;
      this.skipWs();
      const c = this.peek();
      if (!this.allowMath || (c !== '+' && c !== '-')) {
        this.pos = save;
        return left;
      }
      this.pos++;
      const right = this.term();
      if (!right) {
        this.pos = save;
        return left;
      }
      this.ops++;
      left = c === '+' ? left.add(right) : left.sub(right);
    }
  }
}

/**
 * @param {string} content raw message content
 * @param {{ allowMath?: boolean }} options
 * @returns {{ attempt: false } | { attempt: true, value: number | null, expression: boolean, text: string }}
 */
export function parseCount(content, { allowMath = true } = {}) {
  const text = (content ?? '').trim();
  const first = text[0];
  const startsLikeCount = (first >= '0' && first <= '9') || (allowMath && first === '(');
  if (!startsLikeCount) return { attempt: false };

  const src = text.slice(0, GAME.maxExpressionLength);
  const parser = new Parser(src, allowMath);
  let result;
  try {
    result = parser.expr();
  } catch {
    return { attempt: true, value: null, expression: true, text: src };
  }
  if (!result) {
    // e.g. "(hello" — starts with "(" but isn't an expression: treat as chatter.
    return { attempt: first !== '(' ? true : false, value: null, expression: false, text: src };
  }

  // "1.5", "1,000" or "12345678901234567890" style tails are not clean counts.
  const next = src[parser.pos];
  if (next !== undefined && /[0-9.,]/.test(next)) {
    return { attempt: true, value: null, expression: parser.ops > 0, text: src };
  }

  const expression = parser.ops > 0;
  const consumed = src.slice(0, parser.pos).trim();
  if (result.d !== 1n) return { attempt: true, value: null, expression, text: consumed };
  const value = Number(result.n);
  if (!Number.isSafeInteger(value)) return { attempt: true, value: null, expression, text: consumed };
  return { attempt: true, value, expression, text: consumed };
}
