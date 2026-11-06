import { mkdirSync, readdirSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

/**
 * Online, consistent SQLite snapshot (safe while the bot is running, WAL included).
 * Keeps the newest `keep` local copies and optionally uploads to Cloudflare R2.
 */
export async function runBackup(db, { backupDir, keep, r2 }) {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `sum-${stamp}.db`);
  await db.backup(file);
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }

  const snapshots = readdirSync(backupDir)
    .filter((f) => /^sum-.*\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of snapshots.slice(keep)) rmSync(path.join(backupDir, old), { force: true });

  if (r2) await uploadToR2(file, r2);
  logger.info({ file, kept: Math.min(snapshots.length, keep), r2: Boolean(r2) }, 'database backup complete');
  return file;
}

async function uploadToR2(file, r2) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  await client.send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: `${r2.prefix}${path.basename(file)}`,
      Body: readFileSync(file),
      ContentType: 'application/vnd.sqlite3',
    }),
  );
}
