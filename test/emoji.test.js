import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client, GatewayIntentBits } from 'discord.js';
import { Collection } from 'discord.js';
import { EMOJI, btn, detectEmoji, e, isCustom, reactionId, reactWith, resetEmojiState } from '../src/ui/emoji.js';
import { aboutCard, kickoffCard, welcomeDm } from '../src/ui/cards.js';
import { overviewView, settingsView } from '../src/ui/panel.js';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';

beforeEach(() => resetEmojiState());

test('the four custom emoji have the expected IDs', () => {
  assert.equal(EMOJI.sum.id, '1568437256291745853');
  assert.equal(EMOJI.dvc.id, '1568437714716463184');
  assert.equal(EMOJI.checkmark.id, '1568438566550511626');
  assert.equal(EMOJI.crossmark.id, '1568438577644183603');
});

test('text, button and reaction forms', () => {
  assert.equal(e('sum'), '<:sum:1568437256291745853>');
  assert.deepEqual(btn('dvc'), { id: '1568437714716463184', name: 'dvc' });
  assert.equal(reactionId('checkmark'), 'checkmark:1568438566550511626');
  // discord.js turns our reaction id into a valid REST identifier
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  assert.equal(client.emojis.resolveIdentifier(reactionId('crossmark')), 'crossmark%3A1568438577644183603');
});

test('an Unknown Emoji error falls back to unicode, retries once, and sticks', async () => {
  const calls = [];
  const message = {
    react: async (id) => {
      calls.push(id);
      if (id.includes(':')) throw Object.assign(new Error('Unknown Emoji'), { code: 10014 });
    },
  };
  await reactWith(message, 'checkmark');
  assert.deepEqual(calls, ['checkmark:1568438566550511626', '✅']);
  assert.equal(isCustom('checkmark'), false);
  assert.equal(e('checkmark'), '✅');
  assert.equal(btn('checkmark'), '✅');
  await reactWith(message, 'checkmark'); // no more custom attempts
  assert.deepEqual(calls.slice(2), ['✅']);
  assert.equal(isCustom('crossmark'), true); // other emoji untouched
});

test('other reaction errors are not swallowed', async () => {
  const message = { react: async () => Promise.reject(Object.assign(new Error('perm'), { code: 50013 })) };
  await assert.rejects(reactWith(message, 'checkmark'), { code: 50013 });
  assert.equal(isCustom('checkmark'), true);
});

test('startup detection: app emoji ok, missing ones fall back, lookup failure stays optimistic', async () => {
  const mk = (appIds, guildIds = []) => ({
    application: { emojis: { fetch: async () => new Collection(appIds.map((id) => [id, {}])) } },
    emojis: { cache: new Collection(guildIds.map((id) => [id, {}])) },
  });
  let r = await detectEmoji(mk(Object.values(EMOJI).map((d) => d.id)));
  assert.deepEqual(Object.values(r), ['app', 'app', 'app', 'app']);

  r = await detectEmoji(mk([EMOJI.sum.id], [EMOJI.dvc.id]));
  assert.deepEqual(r, { sum: 'app', dvc: 'guild', checkmark: 'missing', crossmark: 'missing' });
  assert.equal(isCustom('dvc'), true); // server emoji still used (works where external emoji are allowed)
  assert.equal(isCustom('checkmark'), false);
  assert.equal(isCustom('crossmark'), false);

  resetEmojiState();
  const broken = { application: { emojis: { fetch: async () => Promise.reject(new Error('network')) } }, emojis: { cache: new Collection() } };
  r = await detectEmoji(broken);
  assert.equal(r.sum, 'unknown');
  assert.equal(isCustom('sum'), true);
});

test('emoji appear in the cards, buttons and toggles', () => {
  const store = new Store(openDatabase(':memory:'));
  store.ensureGuild('g');
  const ctx = { store, guild: store.getGuild('g'), guildName: 'T', userId: 'u', isAdmin: true, issues: [] };
  const json = (c) => JSON.stringify(c.map((x) => x.toJSON?.() ?? x));

  const about = JSON.stringify(aboutCard({ guildCount: 1, invite: 'https://x.y' }).toJSON());
  assert.ok(about.includes('<:sum:1568437256291745853> Sum'));
  assert.ok(about.includes('<:dvc:1568437714716463184> With love from dvc.'));
  assert.equal((about.match(/"id":"1568437714716463184"/g) ?? []).length, 2); // dvc.labs + dvc. buttons
  assert.ok(about.includes('"id":"1568437256291745853"')); // Add Sum button

  assert.ok(JSON.stringify(welcomeDm('S', true).toJSON()).includes('"label":"dvc.labs support"'));
  assert.ok(JSON.stringify(kickoffCard().toJSON()).includes('<:sum:1568437256291745853>'));
  assert.ok(json(overviewView(ctx)).includes('"emoji":{"id":"1568437256291745853","name":"sum"}')); // nav Overview

  const rules = json(settingsView(ctx, 'rules'));
  assert.ok(rules.includes('"emoji":{"id":"1568438566550511626","name":"checkmark"}')); // an "On" toggle
  assert.ok(rules.includes('"emoji":{"id":"1568438577644183603","name":"crossmark"}')); // an "Off" toggle
});

test('with every custom emoji disabled the UI still builds, using unicode', async () => {
  await detectEmoji({
    application: { emojis: { fetch: async () => new Collection() } },
    emojis: { cache: new Collection() },
  });
  const about = JSON.stringify(aboutCard({ guildCount: 1, invite: 'https://x.y' }).toJSON());
  assert.ok(!about.includes('<:'));
  assert.ok(about.includes('"emoji":{"name":"🧡"}') || about.includes('🧡 With love from dvc.'));
  assert.ok(!about.includes('1568437714716463184'));
});
