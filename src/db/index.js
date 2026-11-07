import Database from 'better-sqlite3';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations.js';

/**
 * Opens (and migrates) the SQLite database.
 * Data files are created owner-only (0700 dir / 0600 files).
 */
export function openDatabase(dbPath, { readonly = false } = {}) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const db = new Database(dbPath, { readonly, fileMustExist: readonly });
  db.pragma('busy_timeout = 5000');
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');

  if (!readonly) {
    migrate(db);
    if (dbPath !== ':memory:') {
      try {
        chmodSync(dbPath, 0o600);
      } catch {
        /* non-fatal: e.g. filesystem without chmod support */
      }
    }
  }
  return db;
}

export function migrate(db) {
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true });
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `Database schema v${current} is newer than this build supports (v${SCHEMA_VERSION}). Refusing to start.`,
      );
    }
    for (let v = current; v < SCHEMA_VERSION; v++) {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    }
  }).immediate();
}
