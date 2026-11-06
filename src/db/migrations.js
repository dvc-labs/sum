/**
 * Ordered schema migrations. Index + 1 = PRAGMA user_version after applying.
 * Never edit a shipped migration — append a new one instead.
 */
export const MIGRATIONS = [
  // v1 — initial schema (Sum v0.1.0)
  `
  CREATE TABLE guilds (
    guild_id              TEXT PRIMARY KEY,
    count_channel_id      TEXT,
    log_channel_id        TEXT,
    admin_role_ids        TEXT    NOT NULL DEFAULT '[]',

    current_count         INTEGER NOT NULL DEFAULT 0,
    last_user_id          TEXT,
    last_message_id       TEXT,
    run_id                INTEGER NOT NULL DEFAULT 1,
    run_started_at        INTEGER,
    record_to_beat        INTEGER NOT NULL DEFAULT 0, -- high score when this run started

    high_score            INTEGER NOT NULL DEFAULT 0,
    high_score_at         INTEGER,
    saves                 INTEGER NOT NULL DEFAULT 0,
    total_counts          INTEGER NOT NULL DEFAULT 0,
    total_ruins           INTEGER NOT NULL DEFAULT 0,
    last_ruin_user_id     TEXT,
    last_ruin_count       INTEGER,
    last_ruin_at          INTEGER,

    rule_wrong_number     INTEGER NOT NULL DEFAULT 1,
    rule_double_count     INTEGER NOT NULL DEFAULT 1,
    rule_edit_delete      INTEGER NOT NULL DEFAULT 1,
    math_enabled          INTEGER NOT NULL DEFAULT 1,
    strict_mode           INTEGER NOT NULL DEFAULT 0,
    saves_enabled         INTEGER NOT NULL DEFAULT 1,
    ruined_role_enabled   INTEGER NOT NULL DEFAULT 0,
    ruined_role_id        TEXT,
    ruined_role_minutes   INTEGER NOT NULL DEFAULT 60,

    welcomed              INTEGER NOT NULL DEFAULT 0,
    owner_warned_at       INTEGER,
    joined_at             INTEGER,
    left_at               INTEGER,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE user_stats (
    guild_id        TEXT    NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id         TEXT    NOT NULL,
    counts          INTEGER NOT NULL DEFAULT 0,
    mistakes        INTEGER NOT NULL DEFAULT 0,
    ruins           INTEGER NOT NULL DEFAULT 0,
    current_streak  INTEGER NOT NULL DEFAULT 0,
    best_streak     INTEGER NOT NULL DEFAULT 0,
    highest_number  INTEGER NOT NULL DEFAULT 0,
    last_count_at   INTEGER,
    PRIMARY KEY (guild_id, user_id)
  ) STRICT;

  CREATE INDEX idx_user_stats_counts ON user_stats (guild_id, counts DESC);
  CREATE INDEX idx_user_stats_ruins  ON user_stats (guild_id, ruins DESC);

  CREATE TABLE disqualified (
    guild_id   TEXT    NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT    NOT NULL,
    run_id     INTEGER NOT NULL,
    reason     TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, run_id)
  ) STRICT;

  CREATE TABLE temp_roles (
    guild_id   TEXT    NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id    TEXT    NOT NULL,
    role_id    TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, role_id)
  ) STRICT;

  CREATE INDEX idx_temp_roles_expiry ON temp_roles (expires_at);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export const EXPECTED_TABLES = ['guilds', 'user_stats', 'disqualified', 'temp_roles'];
