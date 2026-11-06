import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { Store } from '../src/db/store.js';
import { applyOutcome, evaluate, resetRun } from '../src/game/engine.js';
import { parseCount } from '../src/game/parser.js';
import { GAME } from '../src/config.js';

function setup() {
  const store = new Store(openDatabase(':memory:'));
  store.ensureGuild('g');
  store.updateGuild('g', { count_channel_id: 'c' });
  let msg = 0;
  const play = (userId, content) => {
    const guild = store.getGuild('g');
    const parsed = parseCount(content, { allowMath: Boolean(guild.math_enabled) });
    const disqualified = store.isDisqualified('g', userId, guild.run_id);
    const outcome = evaluate(guild, { userId, parsed, disqualified });
    applyOutcome(store, guild, { userId, messageId: String(++msg), outcome });
    return outcome;
  };
  return { store, play, g: () => store.getGuild('g') };
}

test('new server starts at 0 with one save', () => {
  const { g } = setup();
  assert.equal(g().current_count, 0);
  assert.equal(g().saves, GAME.startingSaves);
});

test('alternating counting works, math included', () => {
  const { play, g, store } = setup();
  assert.equal(play('a', '1').type, 'correct');
  assert.equal(play('b', '1+1').type, 'correct');
  assert.equal(play('a', '6/2').type, 'correct');
  assert.equal(g().current_count, 3);
  assert.equal(store.getStats('g', 'a').counts, 2);
  assert.equal(store.getStats('g', 'a').best_streak, 2);
});

test('wrong number at 0 is just rejected', () => {
  const { play, g } = setup();
  assert.equal(play('a', '5').type, 'rejected');
  assert.equal(g().saves, 1);
  assert.equal(g().total_ruins, 0);
});

test('double counting uses a save, then ruins', () => {
  const { play, g, store } = setup();
  play('a', '1');
  const saved = play('a', '2');
  assert.equal(saved.type, 'saved');
  assert.equal(g().current_count, 1);
  assert.equal(g().saves, 0);
  const ruined = play('a', '2');
  assert.equal(ruined.type, 'ruined');
  assert.equal(ruined.reason, 'double');
  assert.equal(g().current_count, 0);
  assert.equal(g().total_ruins, 1);
  assert.equal(g().last_ruin_user_id, 'a');
  assert.equal(store.getStats('g', 'a').ruins, 1);
  assert.equal(store.getStats('g', 'a').current_streak, 0);
});

test('rules can be toggled off', () => {
  const { play, g, store } = setup();
  store.updateGuild('g', { rule_double_count: 0, rule_wrong_number: 0, saves_enabled: 0 });
  play('a', '1');
  assert.equal(play('a', '2').type, 'correct');
  assert.equal(play('a', '99').type, 'rejected');
  assert.equal(g().current_count, 2);
});

test('high score tracked and announced once per run', () => {
  const { play, g, store } = setup();
  store.updateGuild('g', { saves_enabled: 0 });
  play('a', '1');
  play('b', '2');
  play('a', '9'); // ruin at 2
  assert.equal(g().high_score, 2);
  play('a', '1');
  play('b', '2');
  const beat = play('a', '3');
  assert.equal(beat.announceRecord, true);
  const next = play('b', '4');
  assert.equal(next.highScore, true);
  assert.equal(next.announceRecord, false);
  assert.equal(g().high_score, 4);
});

test('first run never announces a record', () => {
  const { play } = setup();
  assert.equal(play('a', '1').announceRecord, false);
});

test(`saves earned every ${GAME.saveInterval}, capped at ${GAME.maxSaves}`, () => {
  const { play, g, store } = setup();
  store.updateGuild('g', { current_count: GAME.saveInterval - 1 });
  const out = play('a', String(GAME.saveInterval));
  assert.equal(out.saveEarned, true);
  assert.equal(g().saves, 2);
  store.updateGuild('g', { saves: GAME.maxSaves, current_count: GAME.saveInterval * 2 - 1 });
  assert.equal(play('b', String(GAME.saveInterval * 2)).saveEarned, false);
  assert.equal(g().saves, GAME.maxSaves);
});

test('milestones', () => {
  const { play, store } = setup();
  store.updateGuild('g', { current_count: 99 });
  assert.equal(play('a', '100').milestoneReaction, true);
  store.updateGuild('g', { current_count: 999 });
  const k = play('b', '1000');
  assert.equal(k.milestoneCard, true);
});

test('disqualified players are benched until reset', () => {
  const { play, g, store } = setup();
  play('a', '1');
  store.disqualify('g', 'a', g().run_id, 'delete');
  play('b', '2');
  assert.equal(play('a', '3').type, 'disqualified');
  assert.equal(g().current_count, 2);
  resetRun(store, g());
  assert.equal(g().current_count, 0);
  assert.equal(store.isDisqualified('g', 'a', g().run_id), false);
  assert.equal(play('a', '1').type, 'correct');
});

test('leaderboards and ranks', () => {
  const { play, store } = setup();
  play('a', '1');
  play('b', '2');
  play('a', '3');
  const lb = store.leaderboard('g', 'counts', 0);
  assert.equal(lb.rows[0].user_id, 'a');
  assert.deepEqual(store.rankOf('g', 'b', 'counts'), { rank: 2, of: 2 });
  assert.equal(store.leaderboard('g', 'shame', 0).total, 0);
  assert.equal(store.leaderboard('g', 'counts', 99).page, 0);
});

test('wipe restores defaults but stays welcomed', () => {
  const { play, g, store } = setup();
  store.updateGuild('g', { welcomed: 1 });
  play('a', '1');
  store.wipeGuild('g');
  assert.equal(g().current_count, 0);
  assert.equal(g().count_channel_id, null);
  assert.equal(g().welcomed, 1);
  assert.equal(store.getStats('g', 'a').counts, 0);
});

test('retention purge only removes servers that left long ago', () => {
  const { store } = setup();
  store.ensureGuild('old');
  store.markLeft('old', 1000);
  assert.equal(store.purgeLeftBefore(2000), 1);
  assert.ok(store.getGuild('g'));
  assert.equal(store.getGuild('old'), null);
});
