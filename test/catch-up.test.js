import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import { CountCatchUp } from '../src/game/catch-up.js';
import { compareMessageIds, cursorAt } from '../src/game/cursor.js';
import { resetRun } from '../src/game/engine.js';
import { onMessageCreate } from '../src/game/handler.js';
import { KeyedQueue } from '../src/game/queue.js';
import { Leader } from '../src/services/leader.js';

function fixture(options) {
  const db = openDatabase(':memory:');
  const store = new Store(db);
  store.ensureGuild('g');
  store.updateGuild('g', { count_channel_id: 'c' });
  store.updateGuild('g', { count_cursor: '1000' });
  const history = [], requests = [], notices = [], reactions = [], deletes = [];
  const permissions = new PermissionsBitField(
    PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.ManageMessages,
  );
  let beforeFetch = async () => {};
  const channel = {
    id: 'c',
    permissionsFor: () => permissions,
    send: async (payload) => notices.push(JSON.stringify(payload.components)),
    messages: {
      fetch: async (query) => {
        requests.push(query);
        const page = history
          .filter((message) => query.before === undefined || compareMessageIds(message.id, query.before) < 0)
          .sort((a, b) => compareMessageIds(b.id, a.id))
          .slice(0, query.limit);
        await beforeFetch();
        return new Map(page.map((message) => [message.id, message]));
      },
    },
  };
  const guild = { id: 'g', members: { me: {} }, channels: { cache: new Map([['c', channel]]) } };
  const app = {
    store, queue: new KeyedQueue(), effects: new KeyedQueue(), roleQueue: new KeyedQueue(),
    client: { guilds: { cache: new Map([['g', guild]]) } },
  };
  const catchUp = new CountCatchUp(app, options);
  const message = (id, userId, content, bot = false) => ({
    id: String(id), guildId: guild.id, channelId: channel.id, author: { id: userId, bot },
    content: String(content), guild, channel, createdTimestamp: Date.now() - 5000,
    react: async () => reactions.push(id),
    delete: async () => deletes.push(id),
  });
  return {
    app, db, store, guild, catchUp, history, requests, notices, reactions, deletes, message, permissions,
    g: () => store.getGuild('g'),
    delayFetch: (task) => { beforeFetch = task; },
    recover: async () => {
      await catchUp.run(guild);
      await app.effects.drain();
    },
  };
}

test('catch-up pages backwards and commits surviving attempts oldest first', async () => {
  const h = fixture();
  await onMessageCreate(h.app, h.message(1001, 'a', 1));
  h.history.push(h.message(1001, 'a', 1));
  h.history.push(h.message(1002, 'b', '1.05+0.95'), h.message(1003, 'a', '3️⃣'));
  for (let n = 4; n <= 102; n++) h.history.push(h.message(1000 + n, n % 2 ? 'a' : 'b', n));
  h.history.push(h.message(1103, 'bot', 103, true));
  await h.recover();

  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(({ cache, limit }) => cache === false && limit <= 100));
  assert.equal(h.g().current_count, 102);
  assert.equal(h.g().count_cursor, '1103');
  assert.equal(h.g().saves, 1);
  assert.equal(h.store.getStats('g', 'a').counts, 51);
  assert.equal(h.store.getStats('g', 'b').counts, 51);
  assert.deepEqual(h.reactions, [1001]);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /101\*\* count attempts/);
});

test('live attempts wait behind catch-up and a replay consumes a save only once', async () => {
  const h = fixture();
  await onMessageCreate(h.app, h.message(1001, 'a', 1));
  h.store.updateGuild('g', { strict_mode: 1 });
  const wrong = h.message(1002, 'b', 99);
  const correct = h.message(1003, 'b', 2);
  h.history.push(wrong, correct, h.message(1004, 'a', 'hello'));
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  h.delayFetch(() => {
    started.resolve();
    return release.promise;
  });
  const catchingUp = h.catchUp.run(h.guild);
  await started.promise;
  assert.equal(h.catchUp.run(h.guild), catchingUp);
  const duplicateWrong = onMessageCreate(h.app, wrong);
  const duplicateCorrect = onMessageCreate(h.app, correct);
  const live = onMessageCreate(h.app, h.message(1005, 'a', 3));
  assert.equal(h.g().current_count, 1);
  release.resolve();
  await Promise.all([catchingUp, duplicateWrong, duplicateCorrect, live]);

  assert.equal(h.g().current_count, 3);
  assert.equal(h.g().count_cursor, '1005');
  assert.equal(h.g().saves, 0);
  assert.equal(h.store.getStats('g', 'b').mistakes, 1);
  assert.equal(h.store.getStats('g', 'b').counts, 1);
  assert.deepEqual(h.reactions, [1001, 1005]);
  assert.deepEqual(h.deletes, []);
});

test('failed attempts advance the cursor and a manual reset leaves earlier history behind', async () => {
  const h = fixture();
  const first = h.message(1001, 'a', 1);
  const mistake = h.message(1002, 'b', 999);
  await onMessageCreate(h.app, first);
  await onMessageCreate(h.app, mistake);
  assert.equal(h.g().count_cursor, '1002');
  const now = Date.now();
  const resetCursor = cursorAt(now);
  resetRun(h.store, h.g(), now);
  assert.equal(h.g().last_message_id, null);
  assert.equal(h.g().count_cursor, resetCursor);
  h.history.push(first, mistake, h.message(String(BigInt(resetCursor) - 1n), 'a', 1), h.message(cursorAt(now + 1), 'b', 1));
  await h.recover();
  assert.equal(h.g().current_count, 1);
  assert.equal(h.store.getStats('g', 'b').mistakes, 1);
});

test('a new lease discards an old recovery and events that were queued under it', async () => {
  const h = fixture();
  const firstOwner = new Leader(h.db, { id: 'first' });
  const replacement = new Leader(h.db, { id: 'replacement' });
  h.app.leader = firstOwner;
  const recoveries = [];
  firstOwner.onAcquire = () => { recoveries.push(h.catchUp.run(h.guild)); };
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  h.delayFetch(() => {
    started.resolve();
    return release.promise;
  });
  h.history.push(h.message(1001, 'a', 1));
  firstOwner.claim();
  const [staleRecovery] = recoveries;
  await started.promise;
  const third = h.message(1003, 'a', 3);
  const staleEvent = onMessageCreate(h.app, third);
  replacement.claim();
  replacement.stop();
  h.history.push(h.message(1002, 'b', 2), third);
  firstOwner.tick(); // local leader flag was still true when it regained the lock
  assert.equal(recoveries.length, 2);
  const recovery = recoveries[1];
  assert.notEqual(recovery, staleRecovery);
  const live = onMessageCreate(h.app, h.message(1004, 'b', 4));
  release.resolve();
  await Promise.all([staleRecovery, staleEvent, recovery, live]);
  assert.equal(h.g().current_count, 4);
  assert.equal(h.g().saves, 1);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /3\*\* count attempts/);
});

test('a fresh shard session checks for a new gap even during a pending recovery', async () => {
  const h = fixture();
  h.guild.shardId = 0;
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  h.delayFetch(() => {
    started.resolve();
    return release.promise;
  });
  h.history.push(h.message(1001, 'a', 1));
  const first = h.catchUp.run(h.guild);
  await started.promise;
  h.history.push(h.message(1002, 'b', 2));
  h.catchUp.runConfigured(0);
  const live = onMessageCreate(h.app, h.message(1003, 'a', 3));
  release.resolve();
  await Promise.all([first, live]);
  assert.equal(h.requests.length, 2);
  assert.equal(h.g().current_count, 3);
  assert.equal(h.g().saves, 1);
});

test('an oversized backlog is skipped as a whole', async () => {
  const h = fixture({ maxMessages: 2 });
  h.history.push(h.message(1001, 'a', 1), h.message(1002, 'b', 2), h.message(1003, 'a', 3));
  await h.recover();
  assert.equal(h.g().current_count, 0);
  assert.equal(h.g().total_counts, 0);
  assert.equal(h.g().count_cursor, '1003');
  assert.match(h.notices[0], /exceeded \*\*2\*\* channel messages/);
});

test('a history timeout releases live play without applying the late response', async () => {
  const h = fixture({ timeoutMs: 10 });
  const release = Promise.withResolvers();
  h.delayFetch(() => release.promise);
  h.history.push(h.message(1001, 'a', 1));
  const recovery = h.catchUp.run(h.guild);
  const live = onMessageCreate(h.app, h.message(1002, 'b', 1));
  await Promise.all([recovery, live]);
  release.resolve();
  await new Promise(setImmediate);
  assert.equal(h.g().current_count, 1);
  assert.equal(h.g().count_cursor, '1002');
  assert.equal(h.store.getStats('g', 'a').counts, 0);
  assert.match(h.notices[0], /couldn’t read the full backlog/);
});

test('a first boot anchors legacy channels and a channel change or removal discards its old cursor', async () => {
  const h = fixture();
  h.store.updateGuild('g', { count_cursor: null });
  await h.recover();
  assert.equal(h.requests.length, 0);
  assert.match(h.g().count_cursor, /^\d{16,}$/);
  const movedAt = Date.now() + 100;
  h.store.updateGuild('g', { count_channel_id: 'other' }, movedAt);
  assert.equal(h.g().count_cursor, cursorAt(movedAt));
  h.store.markLeft('g');
  assert.equal(h.g().count_cursor, null);
});

test('startup limits concurrent history reads across guilds', async () => {
  const h = fixture();
  const release = Promise.withResolvers();
  const started = Promise.withResolvers();
  let active = 0;
  let peak = 0;
  h.delayFetch(async () => {
    peak = Math.max(peak, ++active);
    if (active === 4) started.resolve();
    await release.promise;
    active--;
  });
  const channel = h.guild.channels.cache.get('c');
  for (let i = 0; i < 5; i++) {
    const id = `g${i}`;
    h.store.ensureGuild(id);
    h.store.updateGuild(id, { count_channel_id: 'c' });
    h.store.updateGuild(id, { count_cursor: '1000' });
    h.app.client.guilds.cache.set(id, { ...h.guild, id, channels: { cache: new Map([['c', channel]]) } });
  }
  h.catchUp.runConfigured();
  await started.promise;
  await new Promise(setImmediate);
  release.resolve();
  await h.app.queue.drain();
  assert.equal(peak, 4);
  assert.equal(h.requests.length, 6);
});

test('a server that never gets a history lane skips quietly instead of reporting a failed read', async () => {
  const h = fixture({ timeoutMs: 30 });
  const release = Promise.withResolvers();
  h.delayFetch(() => release.promise);
  const channel = h.guild.channels.cache.get('c');
  for (let i = 0; i < 5; i++) { // six servers compete for four history lanes
    const id = `g${i}`;
    h.store.ensureGuild(id);
    h.store.updateGuild(id, { count_channel_id: 'c' });
    h.store.updateGuild(id, { count_cursor: '1000' });
    h.app.client.guilds.cache.set(id, { ...h.guild, id, channels: { cache: new Map([['c', channel]]) } });
  }
  h.catchUp.runConfigured();
  await h.app.queue.drain();
  await h.app.effects.drain();
  release.resolve();
  await new Promise(setImmediate);
  // Four reads started and timed out. The other two never read anything.
  assert.equal(h.notices.length, 4);
  for (const id of ['g', 'g0', 'g1', 'g2', 'g3', 'g4']) assert.equal(h.store.getGuild(id).count_cursor, '1000');
});

test('repeated failed reads post one notice, while every oversized gap still gets its own', async () => {
  const h = fixture({ maxMessages: 2 });
  h.delayFetch(async () => { throw new Error('Discord is unavailable'); });
  for (let i = 0; i < 3; i++) {
    await h.catchUp.run(h.guild, { freshConnection: true });
    await h.app.effects.drain();
  }
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /couldn’t read the full backlog/);

  h.delayFetch(async () => {});
  h.history.push(h.message(1001, 'a', 1), h.message(1002, 'b', 2), h.message(1003, 'a', 3));
  await h.recover();
  h.history.push(h.message(1004, 'a', 4), h.message(1005, 'b', 5), h.message(1006, 'a', 6));
  await h.recover();
  assert.equal(h.notices.length, 3);
  assert.match(h.notices[1], /exceeded/);
  assert.match(h.notices[2], /exceeded/);
});
