import { chmod, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { GAME } from '../config.js';
import { logger } from './logger.js';

const RETENTION_MS = GAME.backupRetentionDays * 86_400_000;
const PARTIAL_NAME = /^(.*\.db)\.[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\.partial$/;
const activeBackups = new Set();

function snapshotTime(name) {
  const parts = /^sum-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/.exec(name);
  return parts ? Date.parse(`${parts[1]}:${parts[2]}:${parts[3]}.${parts[4]}Z`) : NaN;
}

function checkKeep(keep) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('BACKUP_KEEP must be a positive integer');
}

/** Enforces age even when the bot missed a scheduled backup. */
export async function pruneBackups(backupDir, keep, now = Date.now()) {
  checkKeep(keep);
  const names = await readdir(backupDir).catch((err) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  const snapshots = names.filter((name) => Number.isFinite(snapshotTime(name))).sort().reverse();
  const expired = snapshots.filter((name, i) => i >= keep || snapshotTime(name) <= now - RETENTION_MS);
  for (const name of expired) await rm(path.join(backupDir, name), { force: true });
  for (const name of names) {
    const partial = PARTIAL_NAME.exec(name);
    if (!partial || !Number.isFinite(snapshotTime(partial[1]))) continue;
    const file = path.resolve(backupDir, name);
    if (activeBackups.has(file)) continue;
    const stats = await lstat(file).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    // The last write is the best measure of age for an unfinished snapshot.
    if (stats?.isFile() && stats.mtimeMs <= now - RETENTION_MS) await rm(file, { force: true });
  }
  return snapshots.length - expired.length;
}

/** Only delete Sum snapshots under the configured prefix. */
export async function pruneRemoteBackups(client, r2, now = Date.now()) {
  const { DeleteObjectsCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: r2.bucket, Prefix: r2.prefix, ContinuationToken: token,
    }));
    const expired = (page.Contents ?? [])
      .filter(({ Key }) => Key?.startsWith(r2.prefix) && snapshotTime(Key.slice(r2.prefix.length)) <= now - RETENTION_MS)
      .map(({ Key }) => ({ Key }));
    if (expired.length) {
      const result = await client.send(new DeleteObjectsCommand({
        Bucket: r2.bucket, Delete: { Objects: expired, Quiet: true },
      }));
      if (result.Errors?.length) throw new Error('R2 snapshot cleanup failed');
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

/** Online SQLite snapshot (WAL included). Publish it only after the copy completes. */
export async function runBackup(db, { backupDir, keep, r2 }) {
  checkKeep(keep);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `sum-${stamp}.db`);
  const pending = path.resolve(`${file}.${randomUUID()}.partial`);
  activeBackups.add(pending);
  try {
    await db.backup(pending);
    await chmod(pending, 0o600);
    await rename(pending, file);
  } finally {
    try {
      await rm(pending, { force: true });
    } finally {
      activeBackups.delete(pending);
    }
  }

  const kept = await pruneBackups(backupDir, keep);
  if (r2) await uploadToR2(file, r2);
  logger.info({ file, kept, r2: Boolean(r2) }, 'database backup complete');
  return file;
}

async function uploadToR2(file, r2) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  try {
    await client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: `${r2.prefix}${path.basename(file)}`,
      Body: await readFile(file),
      ContentType: 'application/vnd.sqlite3',
    }));
    await pruneRemoteBackups(client, r2);
  } finally {
    client.destroy();
  }
}
