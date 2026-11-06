import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import { runBackup } from '../src/services/backup.js';
import { sweepTempRoles } from '../src/services/roles.js';

test('backups keep exactly the configured number of snapshots', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sum-bk-'));
  const db = openDatabase(path.join(dir, 'sum.db'));
  const backupDir = path.join(dir, 'backups');
  for (let i = 0; i < 4; i++) {
    await runBackup(db, { backupDir, keep: 2, r2: null });
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(readdirSync(backupDir).length, 2);
  await assert.rejects(runBackup(db, { backupDir, keep: undefined, r2: null }), /keep must be/);
  assert.equal(readdirSync(backupDir).length, 2); // a bad option never deletes anything
});

function fakeClient(behaviour) {
  const guild = {
    members: {
      fetch: async (userId) => {
        const b = behaviour[userId];
        if (b instanceof Error) throw b;
        return { roles: { cache: new Map([['r', {}]]), remove: async () => {} } };
      },
    },
  };
  return { guilds: { cache: new Map([['g', guild]]) } };
}

const err = (code) => Object.assign(new Error(`code ${code}`), { code });

test('sweep keeps expiry records on transient failures, drops them when done or impossible', async () => {
  const store = new Store(openDatabase(':memory:'));
  store.ensureGuild('g');
  store.ensureGuild('offline');
  store.addTempRole('g', 'ok', 'r', 0);
  store.addTempRole('g', 'left', 'r', 0);
  store.addTempRole('g', 'flaky', 'r', 0);
  store.addTempRole('offline', 'x', 'r', 0);
  const client = fakeClient({ left: err(10007), flaky: err(500) });

  await sweepTempRoles(client, store);
  const remaining = store.dueTempRoles(Date.now()).map((e) => `${e.guild_id}/${e.user_id}`).sort();
  assert.deepEqual(remaining, ['g/flaky', 'offline/x']);
});
