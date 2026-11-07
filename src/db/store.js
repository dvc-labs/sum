import { GAME } from '../config.js';
import { cursorAt } from '../game/cursor.js';

/** Columns that may be changed through updateGuild(). */
const GUILD_COLUMNS = new Set([
  'count_channel_id',
  'count_cursor',
  'log_channel_id',
  'admin_role_ids',
  'current_count',
  'last_user_id',
  'last_message_id',
  'run_id',
  'run_started_at',
  'record_to_beat',
  'high_score',
  'high_score_at',
  'saves',
  'total_counts',
  'total_ruins',
  'last_ruin_user_id',
  'last_ruin_count',
  'last_ruin_at',
  'rule_wrong_number',
  'rule_double_count',
  'rule_edit_delete',
  'math_enabled',
  'strict_mode',
  'saves_enabled',
  'ruined_role_enabled',
  'ruined_role_id',
  'ruined_role_minutes',
  'welcomed',
  'owner_warned_at',
  'joined_at',
  'left_at',
]);

export const BOOLEAN_SETTINGS = [
  'rule_wrong_number',
  'rule_double_count',
  'rule_edit_delete',
  'math_enabled',
  'strict_mode',
  'saves_enabled',
  'ruined_role_enabled',
];

const LEADERBOARD_CATEGORIES = {
  counts: { scores: ['counts', 'best_streak'], where: 'counts > 0' },
  accuracy: {
    scores: ['CAST(counts AS REAL) / (counts + mistakes)', 'counts'],
    where: `counts >= ${GAME.accuracyMinCounts}`,
  },
  streak: { scores: ['best_streak', 'counts'], where: 'best_streak > 0' },
  shame: { scores: ['ruins', 'mistakes'], where: 'ruins > 0' },
};

function hydrateGuild(row) {
  if (!row) return null;
  return { ...row, admin_role_ids: JSON.parse(row.admin_role_ids || '[]') };
}

export class Store {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
    this.stmt = {
      getGuild: db.prepare('SELECT * FROM guilds WHERE guild_id = ?'),
      countingChannel: db.prepare('SELECT 1 FROM guilds WHERE guild_id = ? AND count_channel_id = ? AND left_at IS NULL'),
      countingGuildIds: db.prepare('SELECT guild_id FROM guilds WHERE count_channel_id IS NOT NULL AND left_at IS NULL').pluck(),
      advanceCountCursor: db.prepare(
        `UPDATE guilds SET count_cursor = @messageId WHERE guild_id = @guildId AND (
           count_cursor IS NULL OR length(count_cursor) < length(@messageId)
           OR (length(count_cursor) = length(@messageId) AND count_cursor < @messageId)
         )`,
      ),
      insertGuild: db.prepare(
        `INSERT INTO guilds (guild_id, saves, run_started_at, ruined_role_minutes, joined_at, created_at, updated_at)
         VALUES (@guild_id, @saves, @now, @minutes, @now, @now, @now)
         ON CONFLICT(guild_id) DO NOTHING`,
      ),
      getStats: db.prepare('SELECT * FROM user_stats WHERE guild_id = ? AND user_id = ?'),
      countUp: db.prepare(
        `INSERT INTO user_stats (guild_id, user_id, counts, current_streak, best_streak, highest_number, last_count_at)
         VALUES (@guild_id, @user_id, 1, 1, 1, @number, @now)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           counts = counts + 1,
           current_streak = current_streak + 1,
           best_streak = MAX(best_streak, current_streak + 1),
           highest_number = MAX(highest_number, @number),
           last_count_at = @now`,
      ),
      mistake: db.prepare(
        `INSERT INTO user_stats (guild_id, user_id, mistakes, ruins)
         VALUES (@guild_id, @user_id, 1, @ruined)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           mistakes = mistakes + 1,
           ruins = ruins + @ruined,
           current_streak = 0`,
      ),
      disqualify: db.prepare(
        `INSERT INTO disqualified (guild_id, user_id, run_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      ),
      isDisqualified: db.prepare(
        'SELECT 1 FROM disqualified WHERE guild_id = ? AND user_id = ? AND run_id = ?',
      ),
      clearDisqualified: db.prepare('DELETE FROM disqualified WHERE guild_id = ? AND run_id < ?'),
      claimCount: db.prepare(
        'INSERT INTO processed_counts (guild_id, message_id, processed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      ),
      purgeProcessedCounts: db.prepare('DELETE FROM processed_counts WHERE processed_at < ?'),
      addTempRole: db.prepare(
        `INSERT INTO temp_roles (guild_id, user_id, role_id, expires_at, retry_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET
           expires_at = excluded.expires_at, retry_at = excluded.retry_at`,
      ),
      getTempRole: db.prepare('SELECT * FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?'),
      dueTempRoles: db.prepare(
        `SELECT temp_roles.* FROM temp_roles JOIN guilds USING (guild_id)
         WHERE left_at IS NULL AND expires_at <= ? AND retry_at <= ? ORDER BY expires_at LIMIT 100`,
      ),
      guildTempRoles: db.prepare('SELECT * FROM temp_roles WHERE guild_id = ?'),
      retryTempRole: db.prepare(
        'UPDATE temp_roles SET retry_at = ? WHERE guild_id = ? AND user_id = ? AND role_id = ? AND retry_at = ?',
      ),
      removeTempRole: db.prepare(
        'DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ? AND retry_at = ?',
      ),
      deleteGuild: db.prepare('DELETE FROM guilds WHERE guild_id = ?'),
      markLeft: db.prepare(
        'UPDATE guilds SET left_at = ?, updated_at = ?, count_cursor = NULL WHERE guild_id = ? AND left_at IS NULL',
      ),
      purgeLeft: db.prepare('DELETE FROM guilds WHERE left_at IS NOT NULL AND left_at <= ?'),
      activeGuildIds: db.prepare('SELECT guild_id FROM guilds WHERE left_at IS NULL'),
    };
    this.boards = new Map(Object.entries(LEADERBOARD_CATEGORIES).map(([category, { scores, where }]) => {
      const [score, tie] = scores;
      const eligible = `guild_id = @guildId AND ${where}`;
      const total = `SELECT COUNT(*) FROM user_stats WHERE ${eligible}`;
      return [category, {
        count: db.prepare(total).pluck(),
        page: db.prepare(
          `SELECT * FROM user_stats WHERE ${eligible}
           ORDER BY ${score} DESC, ${tie} DESC, user_id DESC LIMIT @limit OFFSET @offset`,
        ),
        rank: db.prepare(
          `SELECT 1 + (
             SELECT COUNT(*) FROM user_stats WHERE ${eligible}
               AND (${score}, ${tie}, user_id) > (target.score, target.tie, @userId)
           ) AS rank, (${total}) AS "of"
           FROM (
             SELECT ${score} AS score, ${tie} AS tie FROM user_stats WHERE ${eligible} AND user_id = @userId
           ) AS target`,
        ),
      }];
    }));
  }

  transaction(fn) {
    return this.db.transaction(fn)();
  }

  getGuild(guildId) {
    return hydrateGuild(this.stmt.getGuild.get(guildId));
  }

  isCountingChannel(guildId, channelId) {
    return Boolean(this.stmt.countingChannel.get(guildId, channelId));
  }

  countingGuildIds() {
    return this.stmt.countingGuildIds.all();
  }

  advanceCountCursor(guildId, messageId) {
    this.stmt.advanceCountCursor.run({ guildId, messageId });
  }

  /** Creates the guild row on first sight. Returns { guild, created }. */
  ensureGuild(guildId, now = Date.now()) {
    const info = this.stmt.insertGuild.run({
      guild_id: guildId,
      saves: GAME.startingSaves,
      minutes: GAME.ruinedRoleDefaultMinutes,
      now,
    });
    return { guild: this.getGuild(guildId), created: info.changes === 1 };
  }

  updateGuild(guildId, patch, now = Date.now()) {
    if (Object.hasOwn(patch, 'count_channel_id') &&
        this.stmt.getGuild.get(guildId)?.count_channel_id !== patch.count_channel_id) {
      patch = { ...patch, count_cursor: patch.count_channel_id ? cursorAt(now) : null };
    }
    const entries = Object.entries(patch).filter(([k]) => GUILD_COLUMNS.has(k));
    if (entries.length === 0) return this.getGuild(guildId);
    const values = {};
    const sets = entries.map(([k, v]) => {
      values[k] = k === 'admin_role_ids' ? JSON.stringify(v ?? []) : typeof v === 'boolean' ? Number(v) : v;
      return `${k} = @${k}`;
    });
    this.db
      .prepare(`UPDATE guilds SET ${sets.join(', ')}, updated_at = @__now WHERE guild_id = @__id`)
      .run({ ...values, __now: now, __id: guildId });
    return this.getGuild(guildId);
  }

  getStats(guildId, userId) {
    return (
      this.stmt.getStats.get(guildId, userId) ?? {
        guild_id: guildId,
        user_id: userId,
        counts: 0,
        mistakes: 0,
        ruins: 0,
        current_streak: 0,
        best_streak: 0,
        highest_number: 0,
        last_count_at: null,
      }
    );
  }

  recordCount(guildId, userId, number, now = Date.now()) {
    this.stmt.countUp.run({ guild_id: guildId, user_id: userId, number, now });
  }

  recordMistake(guildId, userId, ruined) {
    this.stmt.mistake.run({ guild_id: guildId, user_id: userId, ruined: ruined ? 1 : 0 });
  }

  rankOf(guildId, userId, category = 'counts') {
    const board = this.boards.get(category) ?? this.boards.get('counts');
    return board.rank.get({ guildId, userId }) ?? null;
  }

  leaderboard(guildId, category, page, pageSize = GAME.leaderboardPageSize) {
    const board = this.boards.get(category) ?? this.boards.get('counts');
    const total = board.count.get({ guildId });
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(0, page), pages - 1);
    const rows = board.page.all({ guildId, limit: pageSize, offset: safePage * pageSize });
    return { rows, total, page: safePage, pages };
  }

  disqualify(guildId, userId, runId, reason, now = Date.now()) {
    this.stmt.disqualify.run(guildId, userId, runId, reason, now);
  }

  isDisqualified(guildId, userId, runId) {
    return Boolean(this.stmt.isDisqualified.get(guildId, userId, runId));
  }

  clearOldDisqualifications(guildId, currentRunId) {
    this.stmt.clearDisqualified.run(guildId, currentRunId);
  }

  claimCount(guildId, messageId, now = Date.now()) {
    return this.stmt.claimCount.run(guildId, messageId, now).changes === 1;
  }

  purgeProcessedCounts(cutoff) {
    this.stmt.purgeProcessedCounts.run(cutoff);
  }

  getTempRole(guildId, userId, roleId) {
    return this.stmt.getTempRole.get(guildId, userId, roleId);
  }

  addTempRole(guildId, userId, roleId, expiresAt, retryAt = 0) {
    this.stmt.addTempRole.run(guildId, userId, roleId, expiresAt, retryAt);
  }

  dueTempRoles(now = Date.now()) {
    return this.stmt.dueTempRoles.all(now, now);
  }

  tempRolesForGuild(guildId) {
    return this.stmt.guildTempRoles.all(guildId);
  }

  retryTempRole(entry, retryAt) {
    this.stmt.retryTempRole.run(retryAt, entry.guild_id, entry.user_id, entry.role_id, entry.retry_at);
  }

  removeTempRole(entry) {
    this.stmt.removeTempRole.run(entry.guild_id, entry.user_id, entry.role_id, entry.retry_at);
  }

  /** Server left the bot: keep data for the retention window, then purge. */
  markLeft(guildId, now = Date.now()) {
    this.stmt.markLeft.run(now, now, guildId);
  }

  purgeLeftBefore(cutoff) {
    return this.stmt.purgeLeft.run(cutoff).changes;
  }

  /** Admin "wipe": removes every stat for the server and restores default settings. */
  wipeGuild(guildId, now = Date.now()) {
    return this.transaction(() => {
      const before = this.getGuild(guildId);
      const cleanup = this.tempRolesForGuild(guildId);
      this.stmt.deleteGuild.run(guildId);
      const generation = Math.max(now, (before?.created_at ?? 0) + 1);
      this.ensureGuild(guildId, generation);
      for (const entry of cleanup) {
        this.addTempRole(guildId, entry.user_id, entry.role_id, now, entry.retry_at);
      }
      return this.updateGuild(guildId, { welcomed: 1, left_at: before?.left_at ?? null }, generation);
    });
  }

  /** Servers Sum believes it is still in (used to reconcile removals made while offline). */
  activeGuildIds() {
    return this.stmt.activeGuildIds.all().map((r) => r.guild_id);
  }
}
