import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyedQueue } from '../src/game/queue.js';

test('tasks for one key run strictly in order, errors do not block the queue', async () => {
  const q = new KeyedQueue();
  const log = [];
  const slow = (n, ms) => () => new Promise((r) => setTimeout(() => (log.push(n), r()), ms));
  const p1 = q.run('g', slow(1, 30));
  const p2 = q.run('g', () => {
    throw new Error('boom');
  });
  const p3 = q.run('g', slow(3, 1));
  await assert.rejects(p2);
  await Promise.all([p1, p3]);
  assert.deepEqual(log, [1, 3]);
});

test('different keys run concurrently', async () => {
  const q = new KeyedQueue();
  const log = [];
  const a = q.run('a', () => new Promise((r) => setTimeout(() => (log.push('a'), r()), 30)));
  const b = q.run('b', () => (log.push('b'), undefined));
  await Promise.all([a, b]);
  assert.deepEqual(log, ['b', 'a']);
});
