import { GAME } from '../config.js';

/** Columns that may be changed through updateGuild(). */
const GUILD_COLUMNS = new Set([
  'count_channel_id',
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
  'brand_role_enabled',
  'brand_role_id',
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
  'brand_role_enabled',
];

export const LEADERBOARD_CATEGORIES = {
  counts: { order: 'counts DESC, best_streak DESC', where: 'counts > 0' },
  accuracy: {
    order: 'CAST(counts AS REAL) / (counts + mistakes) DESC, counts DESC',
    where: `counts >= ${GAME.accuracyMinCounts}`,
  },
  streak: { order: 'best_streak DESC, counts DESC', where: 'best_streak > 0' },
  shame: { order: 'ruins DESC, mistakes DESC', where: 'ruins > 0' },
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
      addTempRole: db.prepare(
        `INSERT INTO temp_roles (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET expires_at = excluded.expires_at`,
      ),
      dueTempRoles: db.prepare('SELECT * FROM temp_roles WHERE expires_at <= ? LIMIT 100'),
      guildTempRoles: db.prepare('SELECT * FROM temp_roles WHERE guild_id = ?'),
      removeTempRole: db.prepare(
        'DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?',
      ),
      deleteGuild: db.prepare('DELETE FROM guilds WHERE guild_id = ?'),
      purgeLeft: db.prepare('DELETE FROM guilds WHERE left_at IS NOT NULL AND left_at <= ?'),
      activeGuildIds: db.prepare('SELECT guild_id FROM guilds WHERE left_at IS NULL'),
    };
  }

  transaction(fn) {
    return this.db.transaction(fn)();
  }

  getGuild(guildId) {
    return hydrateGuild(this.stmt.getGuild.get(guildId));
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
    const cat = LEADERBOARD_CATEGORIES[category];
    const rows = this.db
      .prepare(`SELECT user_id FROM user_stats WHERE guild_id = ? AND ${cat.where} ORDER BY ${cat.order}`)
      .all(guildId);
    const idx = rows.findIndex((r) => r.user_id === userId);
    return idx === -1 ? null : { rank: idx + 1, of: rows.length };
  }

  leaderboard(guildId, category, page, pageSize = GAME.leaderboardPageSize) {
    const cat = LEADERBOARD_CATEGORIES[category] ?? LEADERBOARD_CATEGORIES.counts;
    const total = this.db
      .prepare(`SELECT COUNT(*) AS n FROM user_stats WHERE guild_id = ? AND ${cat.where}`)
      .get(guildId).n;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(0, page), pages - 1);
    const rows = this.db
      .prepare(
        `SELECT * FROM user_stats WHERE guild_id = ? AND ${cat.where} ORDER BY ${cat.order} LIMIT ? OFFSET ?`,
      )
      .all(guildId, pageSize, safePage * pageSize);
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

  addTempRole(guildId, userId, roleId, expiresAt) {
    this.stmt.addTempRole.run(guildId, userId, roleId, expiresAt);
  }

  dueTempRoles(now = Date.now()) {
    return this.stmt.dueTempRoles.all(now);
  }

  tempRolesForGuild(guildId) {
    return this.stmt.guildTempRoles.all(guildId);
  }

  removeTempRole(guildId, userId, roleId) {
    this.stmt.removeTempRole.run(guildId, userId, roleId);
  }

  /** Server left the bot: keep data for the retention window, then purge. */
  markLeft(guildId, now = Date.now()) {
    if (this.getGuild(guildId)) this.updateGuild(guildId, { left_at: now }, now);
  }

  purgeLeftBefore(cutoff) {
    return this.stmt.purgeLeft.run(cutoff).changes;
  }

  /** Admin "wipe": removes every stat for the server and restores default settings. */
  wipeGuild(guildId, now = Date.now()) {
    return this.transaction(() => {
      const old = this.getGuild(guildId);
      this.stmt.deleteGuild.run(guildId);
      this.ensureGuild(guildId, now);
      // The colour role still exists in Discord: keep tracking it so it isn't orphaned or duplicated.
      const keep = old ? { brand_role_enabled: old.brand_role_enabled, brand_role_id: old.brand_role_id } : {};
      return this.updateGuild(guildId, { welcomed: 1, ...keep }, now);
    });
  }

  /** Servers Sum believes it is still in (used to reconcile removals made while offline). */
  activeGuildIds() {
    return this.stmt.activeGuildIds.all().map((r) => r.guild_id);
  }
}
