import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { Leader } from '../src/services/leader.js';
import { Store } from '../src/db/store.js';

test('newest instance takes over; old one stands by; stale leader is replaced', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'sum-')), 'sum.db');
  const oldDb = openDatabase(file);
  const newDb = openDatabase(file);
  const oldI = new Leader(oldDb, { id: 'old' });
  const newI = new Leader(newDb, { id: 'new' });

  oldI.claim(1000);
  assert.equal(oldI.tick(2000), true);

  newI.claim(3000); // rolling update: new container boots
  assert.equal(oldI.isLeader(), false); // no heartbeat needed to see the takeover
  assert.equal(oldI.write(() => assert.fail('standby must not write')), undefined);
  assert.equal(oldI.tick(4000), false); // old one stands by
  assert.equal(newI.tick(4000), true);

  // New container crashes: no heartbeats. After the stale window the old one resumes.
  assert.equal(oldI.tick(4000 + 10_000), false);
  assert.equal(oldI.tick(4000 + 16_000), true);

  // Graceful release lets the other take over immediately.
  oldI.stop();
  assert.equal(newI.tick(25_000), true);
});

test('a cold replacement leaves the original leader running until Discord is ready', () => {
  const db = openDatabase(':memory:');
  const current = new Leader(db, { id: 'current' });
  const replacement = new Leader(db, { id: 'replacement' });
  const store = new Store(db);
  let gatewayReady = false;
  let takeovers = 0;
  current.claim();
  replacement.start(() => gatewayReady, () => { takeovers++; });
  try {
    assert.equal(replacement.claim(), false);
    assert.equal(current.write(() => store.ensureGuild('g')).created, true);

    gatewayReady = true;
    replacement.claim();
    assert.equal(takeovers, 1);
    assert.equal(current.isLeader(), false);
    assert.equal(replacement.write(() => store.claimCount('g', 'm')), true);
    assert.equal(replacement.write(() => store.claimCount('g', 'm')), false);

    gatewayReady = false;
    const disconnectedAt = Date.now();
    assert.equal(replacement.tick(disconnectedAt), false);
    assert.equal(current.tick(disconnectedAt + 5_000), false);
    assert.equal(replacement.isLeader(), true); // a short resume retains ownership
    assert.equal(current.tick(disconnectedAt + 16_000), true);
    assert.equal(replacement.isLeader(), false);
  } finally {
    replacement.stop();
    current.stop();
    db.close();
  }
});
