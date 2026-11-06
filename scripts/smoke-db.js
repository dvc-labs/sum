#!/usr/bin/env node
/**
 * Database smoke check — read-mostly, safe to run against production while the bot runs.
 *   docker exec <container> node scripts/smoke-db.js
 * Only writes inside a transaction that is always rolled back.
 * Exit code 0 = all good, 1 = at least one failure.
 */
import Database from 'better-sqlite3';
import { existsSync, statSync, accessSync, constants, readdirSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { EXPECTED_TABLES, SCHEMA_VERSION } from '../src/db/migrations.js';

const dataDir = path.resolve(process.env.DATA_DIR?.trim() || './data');
const dbPath = path.join(dataDir, 'sum.db');
const backupDir = path.join(dataDir, 'backups');

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const warn = (msg) => {
  warnings++;
  console.log(`  ! ${msg}`);
};
const fail = (msg) => {
  failures++;
  console.log(`  ✖ ${msg}`);
};
const section = (title) => console.log(`\n${title}`);
const mode = (p) => (statSync(p).mode & 0o777).toString(8).padStart(3, '0');

console.log(`Sum database smoke check — DATA_DIR=${dataDir}`);
console.log(`Running as uid=${process.getuid?.()} gid=${process.getgid?.()}`);

section('1. Data directory');
if (!existsSync(dataDir)) {
  fail(`${dataDir} does not exist — is the persistent volume mounted?`);
  finish();
}
const dirStat = statSync(dataDir);
if (!dirStat.isDirectory()) fail(`${dataDir} is not a directory`);
else ok('exists and is a directory');
try {
  accessSync(dataDir, constants.R_OK | constants.W_OK | constants.X_OK);
  ok('readable and writable by this user');
} catch {
  fail('not writable by this user — fix ownership (see deploy guide: chown 1000:1000)');
}
if (process.getuid && dirStat.uid !== process.getuid()) warn(`owned by uid ${dirStat.uid}, process runs as uid ${process.getuid()}`);
else ok(`owned by the bot user (uid ${dirStat.uid})`);
const dirMode = mode(dataDir);
if (Number.parseInt(dirMode, 8) & 0o007) warn(`mode ${dirMode} — world-accessible; expected 700`);
else ok(`mode ${dirMode}`);
try {
  const fsInfo = statfsSync(dataDir);
  const freeMb = Math.round((fsInfo.bavail * fsInfo.bsize) / 1024 / 1024);
  if (freeMb < 500) warn(`only ${freeMb} MB free on the volume`);
  else ok(`${freeMb.toLocaleString()} MB free on the volume`);
} catch {
  /* statfs unsupported */
}

section('2. Database file');
if (!existsSync(dbPath)) {
  fail(`${dbPath} missing — start the bot once so it can create and migrate the database`);
  finish();
}
const fileMode = mode(dbPath);
if (Number.parseInt(fileMode, 8) & 0o077) warn(`sum.db mode ${fileMode}; expected 600`);
else ok(`sum.db mode ${fileMode}`);
ok(`sum.db size ${(statSync(dbPath).size / 1024).toFixed(1)} KB`);
for (const side of ['-wal', '-shm']) {
  if (existsSync(dbPath + side)) ok(`sum.db${side} present (mode ${mode(dbPath + side)})`);
}

section('3. SQLite settings & integrity');
let db;
try {
  db = new Database(dbPath, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  ok(`opened (SQLite ${db.prepare('SELECT sqlite_version() AS v').get().v})`);
} catch (err) {
  fail(`cannot open database: ${err.message}`);
  finish();
}
const journal = db.pragma('journal_mode', { simple: true });
journal === 'wal' ? ok('journal_mode = wal') : fail(`journal_mode = ${journal}, expected wal`);
const version = db.pragma('user_version', { simple: true });
version === SCHEMA_VERSION
  ? ok(`schema version ${version} (matches this build)`)
  : fail(`schema version ${version}, this build expects ${SCHEMA_VERSION}`);
const integrity = db.pragma('integrity_check', { simple: true });
integrity === 'ok' ? ok('integrity_check = ok') : fail(`integrity_check: ${integrity}`);
db.pragma('foreign_keys = ON');
const fk = db.pragma('foreign_key_check');
fk.length === 0 ? ok('foreign_key_check clean') : fail(`${fk.length} foreign key violations`);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
missing.length === 0 ? ok(`tables present: ${EXPECTED_TABLES.join(', ')}`) : fail(`missing tables: ${missing.join(', ')}`);

section('4. Write test (rolled back)');
try {
  const probe = `smoke-${Date.now()}`;
  const rollback = new Error('rollback');
  try {
    db.transaction(() => {
      const now = Date.now();
      db.prepare('INSERT INTO guilds (guild_id, created_at, updated_at) VALUES (?, ?, ?)').run(probe, now, now);
      db.prepare('INSERT INTO user_stats (guild_id, user_id, counts) VALUES (?, ?, 1)').run(probe, 'u');
      const row = db.prepare('SELECT counts FROM user_stats WHERE guild_id = ?').get(probe);
      if (row?.counts !== 1) throw new Error('read-back mismatch');
      throw rollback;
    })();
  } catch (err) {
    if (err !== rollback) throw err;
  }
  const leftover = db.prepare('SELECT COUNT(*) AS n FROM guilds WHERE guild_id = ?').get(probe).n;
  leftover === 0 ? ok('insert + read-back + rollback succeeded, nothing left behind') : fail('probe row survived rollback!');
} catch (err) {
  fail(`write test failed: ${err.message}`);
}

section('5. Contents');
const g = db.prepare('SELECT COUNT(*) AS total, SUM(left_at IS NULL) AS active, SUM(count_channel_id IS NOT NULL AND left_at IS NULL) AS configured FROM guilds').get();
ok(`servers: ${g.total} total · ${g.active ?? 0} active · ${g.configured ?? 0} with a counting channel`);
ok(`players tracked: ${db.prepare('SELECT COUNT(*) AS n FROM user_stats').get().n}`);
ok(`pending ruined-role removals: ${db.prepare('SELECT COUNT(*) AS n FROM temp_roles').get().n}`);
const lock = db.prepare('SELECT * FROM instance_lock WHERE id = 1').get();
if (!lock) warn('no leader lock — the bot is not running (or shut down cleanly)');
else {
  const age = (Date.now() - lock.heartbeat_at) / 1000;
  age > 15
    ? warn(`leader ${lock.owner.slice(0, 8)} heartbeat is ${age.toFixed(0)} s old — is the bot running?`)
    : ok(`leader ${lock.owner.slice(0, 8)} alive (heartbeat ${age.toFixed(1)} s ago)`);
}
db.close();

section('6. Backups');
if (!existsSync(backupDir)) {
  warn('no backups directory yet (first backup runs at BACKUP_HOUR_UTC)');
} else {
  const files = readdirSync(backupDir).filter((f) => /^sum-.*\.db$/.test(f)).sort();
  if (files.length === 0) warn('no backups yet');
  else {
    const latest = path.join(backupDir, files.at(-1));
    const ageH = (Date.now() - statSync(latest).mtimeMs) / 3_600_000;
    ageH > 26 ? warn(`latest backup is ${ageH.toFixed(1)} h old`) : ok(`latest backup ${files.at(-1)} (${ageH.toFixed(1)} h old)`);
    ok(`${files.length} local snapshot(s) kept`);
    try {
      const b = new Database(latest, { readonly: true, fileMustExist: true });
      const res = b.pragma('integrity_check', { simple: true });
      b.close();
      res === 'ok' ? ok('latest backup passes integrity_check') : fail(`latest backup integrity: ${res}`);
    } catch (err) {
      fail(`latest backup cannot be opened: ${err.message}`);
    }
  }
}

finish();

function finish() {
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s), ${warnings} warning(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
