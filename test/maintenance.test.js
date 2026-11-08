import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import { sweepTempRoles } from '../src/services/roles.js';
import { KeyedQueue } from '../src/game/queue.js';
import { onGuildCreate, reconcileGuilds } from '../src/events/guilds.js';

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
