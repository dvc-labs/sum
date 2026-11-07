import { GAME } from '../config.js';
import { cursorAt } from './cursor.js';

/**
 * Pure game rules. Given the guild state and an attempt, decide what happens.
 * No Discord or database side effects here — easy to test.
 *
 * Outcome types:
 *  - ignore        not a count attempt (chatter)
 *  - disqualified  user is benched for this run (deleted/edited a count)
 *  - correct       valid next number
 *  - rejected      wrong, but nothing to lose (count at 0, or the wrong-number rule is off)
 *  - saved         a mistake that consumed a save; the run continues
 *  - ruined        a mistake that resets the count to 0
 */
export function evaluate(guild, { userId, parsed, disqualified = false }) {
  if (!parsed?.attempt) return { type: 'ignore' };
  if (disqualified) return { type: 'disqualified' };

  const expected = guild.current_count + 1;
  const isDouble = Boolean(guild.rule_double_count) && guild.last_user_id === userId;
  const isWrong = parsed.value !== expected;

  if (!isDouble && !isWrong) {
    const number = expected;
    const savesEnabled = Boolean(guild.saves_enabled);
    const saveEarned = savesEnabled && number % GAME.saveInterval === 0 && guild.saves < GAME.maxSaves;
    const beatsRecord = number > guild.high_score;
    const target = guild.record_to_beat; // the record that stood when this run began
    return {
      type: 'correct',
      number,
      expression: parsed.expression,
      saveEarned,
      highScore: beatsRecord,
      beyondRecord: target > 0 && number > target,
      announceRecord: target > 0 && number === target + 1,
      milestoneReaction: number % GAME.milestoneReaction === 0,
      milestoneCard: number % GAME.milestoneCard === 0,
    };
  }

  const reason = isDouble ? 'double' : 'wrong';
  const base = { reason, expected, got: parsed.value };
  if (parsed.fractionalResult) base.fractionalResult = true;

  // Wrong number while the wrong-number rule is off → just reject it.
  if (reason === 'wrong' && !guild.rule_wrong_number) return { type: 'rejected', ...base };
  // Nothing to ruin yet.
  if (guild.current_count === 0) return { type: 'rejected', ...base };

  if (guild.saves_enabled && guild.saves > 0) {
    return { type: 'saved', ...base, savesLeft: guild.saves - 1 };
  }
  return { type: 'ruined', ...base, ruinedAt: guild.current_count };
}

/**
 * Persists an outcome atomically. Returns the updated guild row.
 * @param {import('../db/store.js').Store} store
 */
export function applyOutcome(store, guild, { userId, messageId, outcome, now = Date.now() }) {
  const id = guild.guild_id;
  return store.transaction(() => {
    switch (outcome.type) {
      case 'correct': {
        store.recordCount(id, userId, outcome.number, now);
        const patch = {
          current_count: outcome.number,
          last_user_id: userId,
          last_message_id: messageId,
          total_counts: guild.total_counts + 1,
        };
        if (outcome.saveEarned) patch.saves = guild.saves + 1;
        if (outcome.highScore) {
          patch.high_score = outcome.number;
          patch.high_score_at = now;
        }
        return store.updateGuild(id, patch, now);
      }
      case 'rejected':
        store.recordMistake(id, userId, false);
        return guild;
      case 'saved':
        store.recordMistake(id, userId, false);
        return store.updateGuild(id, { saves: guild.saves - 1 }, now);
      case 'ruined': {
        store.recordMistake(id, userId, true);
        const updated = store.updateGuild(
          id,
          {
            ...freshRunPatch(guild, now),
            total_ruins: guild.total_ruins + 1,
            last_ruin_user_id: userId,
            last_ruin_count: guild.current_count,
            last_ruin_at: now,
          },
          now,
        );
        store.clearOldDisqualifications(id, updated.run_id);
        return updated;
      }
      default:
        return guild;
    }
  });
}

/** Used by both live and recovered messages inside the writer transaction. */
export function recordCountAttempt(store, guild, { userId, messageId, parsed, now }) {
  if (!parsed.attempt || !store.claimCount(guild.guild_id, messageId)) return null;
  const disqualified = Boolean(guild.rule_edit_delete) && store.isDisqualified(guild.guild_id, userId, guild.run_id);
  const outcome = evaluate(guild, { userId, parsed, disqualified });
  const updated = applyOutcome(store, guild, { userId, messageId, outcome, now });
  return { outcome, updated };
}

/** Admin "reset count": starts a new run without blaming anyone. */
export function resetRun(store, guild, now = Date.now()) {
  return store.transaction(() => {
    if (guild.count_channel_id) store.advanceCountCursor(guild.guild_id, cursorAt(now));
    const updated = store.updateGuild(guild.guild_id, freshRunPatch(guild, now), now);
    store.clearOldDisqualifications(guild.guild_id, updated.run_id);
    return updated;
  });
}

function freshRunPatch(guild, now) {
  return {
    current_count: 0,
    last_user_id: null,
    last_message_id: null,
    run_id: guild.run_id + 1,
    run_started_at: now,
    record_to_beat: guild.high_score,
  };
}
