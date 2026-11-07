import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { openDatabase, migrate } from '../src/db/index.js';
import { MIGRATIONS } from '../src/db/migrations.js';
import { Store } from '../src/db/store.js';
import { BRAND } from '../src/config.js';
import { reconcileBrandRoles, syncBrandRole } from '../src/services/brand.js';
import { onRoleDelete } from '../src/events/guilds.js';
import Database from 'better-sqlite3';

function world({ manageRoles = true, createError = null, existingRoles = [] } = {}) {
  const store = new Store(openDatabase(':memory:'));
  store.ensureGuild('g');
  const calls = { created: [], added: [], deleted: [] };
  const roles = new Collection(existingRoles.map((r) => [r.id, r]));
  const worn = new Set();
  const me = {
    permissions: { has: (f) => (f === PermissionFlagsBits.ManageRoles ? manageRoles : true) },
    roles: {
      cache: { has: (id) => worn.has(id) },
      highest: { position: 10 },
      add: async (role) => (calls.added.push(role.id), worn.add(role.id)),
    },
  };
  const guild = {
    id: 'g',
    members: { me },
    roles: {
      cache: roles,
      create: async (opts) => {
        if (createError) throw createError;
        calls.created.push(opts);
        const role = {
          id: `r${calls.created.length}`,
          name: opts.name,
          managed: false,
          position: 1,
          colors: { primaryColor: opts.colors.primaryColor },
          permissions: { bitfield: 0n },
          delete: async (reason) => (calls.deleted.push([`r${calls.created.length}`, reason]), roles.delete(`r${calls.created.length}`)),
        };
        roles.set(role.id, role);
        return role;
      },
    },
  };
  const client = { guilds: { cache: new Collection([['g', guild]]) }, channels: { cache: new Collection() } };
  return { store, client, guild, calls, roles, worn };
}

test('creates a permission-less brand-coloured role and wears it', async () => {
  const w = world();
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'created');
  const [opts] = w.calls.created;
  assert.equal(opts.name, 'Sum colour');
  assert.equal(opts.colors.primaryColor, 0xff4500);
  assert.deepEqual(opts.permissions, []);
  assert.equal(opts.hoist, false);
  assert.equal(opts.mentionable, false);
  assert.deepEqual(w.calls.added, ['r1']);
  assert.equal(w.store.getGuild('g').brand_role_id, 'r1');
});

test('is idempotent and never recolours or recreates', async () => {
  const w = world();
  await syncBrandRole(w.client, w.store, 'g');
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'ok');
  w.roles.get('r1').colors.primaryColor = 0x00ff00; // an admin picked their own colour
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'ok');
  assert.equal(w.calls.created.length, 1);
  assert.equal(w.roles.get('r1').colors.primaryColor, 0x00ff00);
});

test('re-assigns the role if Sum lost it', async () => {
  const w = world();
  await syncBrandRole(w.client, w.store, 'g');
  w.worn.clear();
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'assigned');
  assert.equal(w.calls.created.length, 1);
});

test('without Manage Roles it quietly does nothing', async () => {
  const w = world({ manageRoles: false });
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'skipped');
  assert.equal(w.calls.created.length, 0);
  assert.equal(w.store.getGuild('g').brand_role_id, null);
});

test('a Discord error is reported as failed, never thrown', async () => {
  const w = world({ createError: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'failed');
  assert.equal(w.store.getGuild('g').brand_role_id, null);
});

test('turning it off deletes the role and forgets it', async () => {
  const w = world();
  await syncBrandRole(w.client, w.store, 'g');
  w.store.updateGuild('g', { brand_role_enabled: 0 });
  assert.equal(await syncBrandRole(w.client, w.store, 'g', { by: 'dave' }), 'removed');
  assert.equal(w.calls.deleted.length, 1);
  assert.match(w.calls.deleted[0][1], /turned off by dave/);
  assert.equal(w.store.getGuild('g').brand_role_id, null);
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'ok'); // nothing left to do
});

test('a re-invited Sum adopts the role it left behind instead of making a duplicate', async () => {
  const orphan = {
    id: 'old', name: 'Sum colour', managed: false, position: 1,
    colors: { primaryColor: BRAND.color }, permissions: { bitfield: 0n },
  };
  const w = world({ existingRoles: [orphan] });
  assert.equal(await syncBrandRole(w.client, w.store, 'g'), 'assigned');
  assert.equal(w.calls.created.length, 0);
  assert.equal(w.store.getGuild('g').brand_role_id, 'old');
  // a lookalike with permissions or another colour is not adopted
  const w2 = world({ existingRoles: [{ ...orphan, permissions: { bitfield: 8n } }] });
  assert.equal(await syncBrandRole(w2.client, w2.store, 'g'), 'created');
});

test('an admin deleting the role is respected: it is switched off, not recreated', async () => {
  const w = world();
  await syncBrandRole(w.client, w.store, 'g');
  w.roles.delete('r1');
  onRoleDelete({ store: w.store }, { id: 'r1', guild: { id: 'g' } });
  const row = w.store.getGuild('g');
  assert.equal(row.brand_role_enabled, 0);
  assert.equal(row.brand_role_id, null);
  await reconcileBrandRoles(w.client, w.store);
  assert.equal(w.calls.created.length, 1); // still just the original
});

test('startup reconcile adds the role to servers that lack it, once', async () => {
  const w = world();
  await reconcileBrandRoles(w.client, w.store);
  await reconcileBrandRoles(w.client, w.store);
  assert.equal(w.calls.created.length, 1);
  w.store.markLeft('g');
  const w2 = world();
  w2.store.markLeft('g');
  await reconcileBrandRoles(w2.client, w2.store);
  assert.equal(w2.calls.created.length, 0); // servers Sum has left are ignored
});

test('wiping server data keeps tracking the colour role', () => {
  const w = world();
  w.store.updateGuild('g', { brand_role_id: 'r9', brand_role_enabled: 0 });
  const after = w.store.wipeGuild('g');
  assert.equal(after.brand_role_id, 'r9');
  assert.equal(after.brand_role_enabled, 0);
});

test('migration v2 is additive: existing servers keep their data and default to enabled', () => {
  const db = new Database(':memory:');
  db.exec(MIGRATIONS[0]);
  db.pragma('user_version = 1');
  db.prepare('INSERT INTO guilds (guild_id, high_score, created_at, updated_at) VALUES (?, ?, 1, 1)').run('old', 321);
  migrate(db);
  const row = db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get('old');
  assert.equal(row.high_score, 321);
  assert.equal(row.brand_role_enabled, 1);
  assert.equal(row.brand_role_id, null);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
});
