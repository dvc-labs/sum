import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import {
  helpView,
  leaderboardView,
  noAccessView,
  overviewView,
  playerView,
  settingsView,
} from '../src/ui/panel.js';
import * as cards from '../src/ui/cards.js';
import { MessageFlags } from 'discord.js';

/** Discord Components v2 limits. */
const MAX_COMPONENTS = 40;
const MAX_TEXT = 4000;

function walk(json, visit) {
  for (const c of json) {
    visit(c);
    if (c.components) walk(c.components, visit);
    if (c.accessory) visit(c.accessory);
  }
}

function validate(name, components) {
  const json = components.map((c) => c.toJSON());
  let count = 0;
  let textLen = 0;
  const ids = new Set();
  walk(json, (c) => {
    count++;
    if (c.content) textLen += c.content.length;
    if (c.custom_id) {
      assert.ok(c.custom_id.length <= 100, `${name}: custom_id too long`);
      assert.ok(!ids.has(c.custom_id), `${name}: duplicate custom_id ${c.custom_id}`);
      ids.add(c.custom_id);
    }
  });
  assert.ok(count <= MAX_COMPONENTS, `${name}: ${count} components > ${MAX_COMPONENTS}`);
  assert.ok(textLen <= MAX_TEXT, `${name}: ${textLen} chars > ${MAX_TEXT}`);
  for (const top of json) {
    assert.ok([1, 10, 14, 17].includes(top.type), `${name}: unexpected top-level type ${top.type}`);
  }
  return { count, textLen };
}

function ctxWith(mutate) {
  const store = new Store(openDatabase(':memory:'));
  store.ensureGuild('g');
  mutate?.(store);
  for (let i = 0; i < 25; i++) {
    store.recordCount('g', `u${i}`, i + 1);
    if (i % 3 === 0) store.recordMistake('g', `u${i}`, true);
  }
  return {
    store,
    guild: store.getGuild('g'),
    guildName: 'Test Server',
    userId: 'u1',
    isAdmin: true,
    canViewGame: Boolean(store.getGuild('g').count_channel_id),
    canCheckDeletes: true,
    issues: ['Sum is missing **Add Reactions** in <#1>.'],
  };
}

test('every panel view fits Components v2 limits', () => {
  const unconfigured = ctxWith();
  const configured = ctxWith((s) =>
    s.updateGuild('g', {
      count_channel_id: '1',
      log_channel_id: '2',
      admin_role_ids: ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19'],
      ruined_role_enabled: 1,
      ruined_role_id: '5',
      last_ruin_user_id: 'u3',
      last_ruin_count: 1234,
      last_ruin_at: Date.now(),
    }),
  );
  for (const ctx of [unconfigured, configured]) {
    validate('overview', overviewView(ctx));
    for (const cat of ['counts', 'accuracy', 'streak', 'shame', 'bogus']) {
      validate(`leaderboard:${cat}`, leaderboardView(ctx, cat, 0));
      validate(`leaderboard:${cat}:p2`, leaderboardView(ctx, cat, 1));
    }
    validate('player:self', playerView(ctx));
    validate('player:other', playerView(ctx, 'u5'));
    validate('player:bot', playerView(ctx, 'bot', true));
    validate('help', helpView(ctx));
    for (const tab of ['channels', 'rules', 'role', 'danger']) validate(`settings:${tab}`, settingsView(ctx, tab));
    validate('danger:reset', settingsView(ctx, 'danger', { confirm: 'reset' }));
    validate('danger:wipe', settingsView(ctx, 'danger', { confirm: 'wipe' }));
    validate('noAccess', noAccessView(ctx));
    validate('overview:nonadmin', overviewView({ ...ctx, isAdmin: false }));
  }
});

test('announcement cards and DMs are valid', () => {
  const ctx = ctxWith();
  const outcome = { reason: 'wrong', expected: 43, got: 41, text: '41', ruinedAt: 42, savesLeft: 1 };
  const all = {
    kickoff: cards.kickoffCard(),
    ruined: cards.ruinedCard(outcome, 'u1', ctx.guild),
    ruinedDouble: cards.ruinedCard({ ...outcome, reason: 'double' }, 'u1', ctx.guild),
    ruinedInvalid: cards.ruinedCard({ ...outcome, got: null, text: '3/2' }, 'u1', ctx.guild),
    saved: cards.savedCard(outcome, 'u1'),
    record: cards.recordCard(500),
    milestone: cards.milestoneCard(1000, ctx.guild),
    saveEarned: cards.saveEarnedCard(ctx.guild),
    tamperDelete: cards.tamperCard('delete', 'u1', 41, true),
    tamperEdit: cards.tamperCard('edit', 'u1', 41, false),
    log: cards.logCard('Title', ['a', null, 'b']),
    welcome: cards.welcomeDm('Test Server', true),
    owner: cards.ownerAlertDm('Test Server', 'Heads up', ['line']),
    about: cards.aboutCard({ guildCount: 3, invite: 'https://discord.com/oauth2/authorize?client_id=1' }),
  };
  for (const [name, c] of Object.entries(all)) validate(name, [c]);
  assert.equal(all.about.toJSON().accent_color, 0xff4500);
  assert.ok(JSON.stringify(all.welcome.toJSON()).includes('With love from dvc.'));
  assert.ok(JSON.stringify(all.welcome.toJSON()).includes('https://discord.gg/dRxSt8Bt9t'));
  assert.ok(MessageFlags.IsComponentsV2 === 1 << 15);
});
