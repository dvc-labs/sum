import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { Leader } from '../src/services/leader.js';

test('newest instance takes over; old one stands by; stale leader is replaced', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'sum-')), 'sum.db');
  const oldDb = openDatabase(file);
  const newDb = openDatabase(file);
  const oldI = new Leader(oldDb, { id: 'old' });
  const newI = new Leader(newDb, { id: 'new' });

  oldI.claim(1000);
  assert.equal(oldI.tick(2000), true);

  newI.claim(3000); // rolling update: new container boots
  assert.equal(oldI.tick(4000), false); // old one stands by
  assert.equal(newI.tick(4000), true);

  // New container crashes: no heartbeats. After the stale window the old one resumes.
  assert.equal(oldI.tick(4000 + 10_000), false);
  assert.equal(oldI.tick(4000 + 16_000), true);

  // Graceful release lets the other take over immediately.
  oldI.stop();
  assert.equal(newI.tick(25_000), true);
});
