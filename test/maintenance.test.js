import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import { pruneBackups, pruneRemoteBackups, runBackup } from '../src/services/backup.js';
import { sweepTempRoles } from '../src/services/roles.js';
import { KeyedQueue } from '../src/game/queue.js';
import { onGuildCreate, reconcileGuilds } from '../src/events/guilds.js';

test('backups keep exactly the configured number of snapshots', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sum-bk-'));
  const db = openDatabase(path.join(dir, 'sum.db'));
  const backupDir = path.join(dir, 'backups');
  for (let i = 0; i < 4; i++) {
    await runBackup(db, { backupDir, keep: 2, r2: null });
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(readdirSync(backupDir).length, 2);
  await assert.rejects(runBackup(db, { backupDir, keep: undefined, r2: null }), /BACKUP_KEEP must be/);
  assert.equal(readdirSync(backupDir).length, 2); // a bad option never deletes anything
});

function fakeClient(behaviour) {
  const guild = {
    members: {
      fetch: async ({ user: userId, force, cache }) => {
        assert.equal(force, true);
        assert.equal(cache, false);
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
  store.addTempRole('g', 'denied', 'r', 0);
  store.addTempRole('offline', 'x', 'r', 0);
  const behaviour = { left: err(10007), flaky: err(500), denied: err(50013) };
  const app = { client: fakeClient(behaviour), store, roleQueue: new KeyedQueue() };

  await sweepTempRoles(app);
  assert.deepEqual(store.tempRolesForGuild('g').map((e) => e.user_id).sort(), ['denied', 'flaky']);
  assert.equal(store.tempRolesForGuild('offline').length, 1);
  assert.deepEqual(store.dueTempRoles(), []);

  behaviour.denied = null;
  store.retryTempRole(store.getTempRole('g', 'denied', 'r'), 0);
  await sweepTempRoles(app);
  assert.equal(store.getTempRole('g', 'denied', 'r'), undefined);
});

test('local snapshots expire by age even below the count limit', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sum-expiry-'));
  const db = openDatabase(':memory:');
  writeFileSync(path.join(dir, 'sum-2000-01-01T00-00-00-000Z.db'), 'old');
  writeFileSync(path.join(dir, 'unrelated.db'), 'untouched');
  const file = await runBackup(db, { backupDir: dir, keep: 7, r2: null });
  assert.deepEqual(readdirSync(dir).sort(), [path.basename(file), 'unrelated.db'].sort());
});

test('partial snapshot cleanup preserves recent, unrelated and active files', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sum-partial-'));
  const date = new Date(0);
  const suffix = '.460a65b2-fefd-45fa-8cc2-006a63c53181.partial';
  const old = 'sum-2000-01-01T00-00-00-000Z.db' + suffix;
  const recent = 'sum-2000-01-02T00-00-00-000Z.db' + suffix;
  const unrelated = 'other.db' + suffix;
  for (const name of [old, recent, unrelated]) writeFileSync(path.join(dir, name), '');
  for (const name of [old, unrelated]) utimesSync(path.join(dir, name), date, date);

  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const db = { backup: async (file) => {
    writeFileSync(file, '');
    utimesSync(file, date, date);
    started.resolve(file);
    await finish.promise;
  } };
  const backup = runBackup(db, { backupDir: dir, keep: 7, r2: null });
  const active = path.basename(await started.promise);
  try {
    await pruneBackups(dir, 7);
    assert.deepEqual(readdirSync(dir).sort(), [recent, unrelated, active].sort());
  } finally {
    finish.resolve();
  }
  const finished = await backup;
  assert.deepEqual(readdirSync(dir).sort(), [recent, unrelated, path.basename(finished)].sort());
});

test('R2 pruning follows pagination and only deletes expired Sum snapshots in its prefix', async () => {
  const old = 'sum/sum-2026-10-01T00-00-00-000Z.db';
  const recent = 'sum/sum-2026-11-06T00-00-00-000Z.db';
  const calls = [];
  const client = { send: async (command) => {
    calls.push([command.constructor.name, command.input]);
    if (command.constructor.name === 'DeleteObjectsCommand') return {};
    if (command.input.ContinuationToken) return { Contents: [{ Key: recent }] };
    return {
      IsTruncated: true,
      NextContinuationToken: 'page-2',
      Contents: [{ Key: old }, { Key: 'sum/manual.db' }, { Key: 'other/' + old }],
    };
  } };
  await pruneRemoteBackups(client, { bucket: 'backups', prefix: 'sum/' }, Date.parse('2026-11-07T00:00:00Z'));
  assert.deepEqual(calls, [
    ['ListObjectsV2Command', { Bucket: 'backups', Prefix: 'sum/', ContinuationToken: undefined }],
    ['DeleteObjectsCommand', { Bucket: 'backups', Delete: { Objects: [{ Key: old }], Quiet: true } }],
    ['ListObjectsV2Command', { Bucket: 'backups', Prefix: 'sum/', ContinuationToken: 'page-2' }],
  ]);
});

test('startup reconciliation settles membership before waiting for Discord', async () => {
  const store = new Store(openDatabase(':memory:'));
  store.ensureGuild('left');
  const dm = Promise.withResolvers();
  const first = { id: 'first', name: 'First', members: {}, fetchOwner: async () => ({ user: { send: () => dm.promise } }) };
  const guilds = new Map([[first.id, first]]);
  const app = { store, client: { guilds: { cache: guilds } } };
  const reconciliation = reconcileGuilds(app);
  assert.ok(store.getGuild('left').left_at);
  const joined = { id: 'joined', name: 'Joined', members: {}, fetchOwner: async () => ({ user: { send: async () => {} } }) };
  guilds.set(joined.id, joined);
  await onGuildCreate(app, joined);
  dm.resolve();
  await reconciliation;
  assert.equal(store.getGuild(joined.id).left_at, null);
  assert.ok(store.getGuild('left').left_at);
});
