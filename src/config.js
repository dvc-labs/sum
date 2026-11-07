import { readFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback = undefined) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function int(name, fallback) {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

function bool(name, fallback) {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** Static product constants — not secrets, safe to ship in the image. */
export const BRAND = Object.freeze({
  name: 'Sum',
  version: pkg.version,
  color: 0xff4500,
  supportInvite: 'https://discord.gg/dRxSt8Bt9t',
  website: 'https://www.davevancauwenberghe.be',
  repo: 'https://github.com/dvc-labs/sum',
  docs: 'https://github.com/dvc-labs/sum/tree/main/docs',
  fineprint: 'With love from dvc.',
});

/** Bot permissions requested on invite. Keep in sync with docs/admin-guide.md. */
export const INVITE_PERMISSIONS = [
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'AddReactions',
  'ManageMessages',
  'ManageRoles',
];

/** Game tuning constants. */
export const GAME = Object.freeze({
  saveInterval: 200, // earn a save every time the count reaches a multiple of this
  startingSaves: 1, // granted on first install
  maxSaves: 3,
  milestoneReaction: 100, // special reaction every N
  milestoneCard: 1000, // celebration card every N
  maxExpressionLength: 64,
  leaderboardPageSize: 10,
  accuracyMinCounts: 20,
  dataRetentionDays: 30, // after the bot is removed from a server
  backupRetentionDays: 7,
  countReplayHours: 24,
  ownerWarnCooldownHours: 24,
  ruinedRoleDefaultMinutes: 60,
});

let cached;

/** Loads runtime configuration from the environment. Secrets never have defaults. */
export function loadConfig() {
  if (cached) return cached;
  const dataDir = path.resolve(optional('DATA_DIR', './data'));
  cached = Object.freeze({
    token: required('DISCORD_TOKEN'),
    applicationId: required('DISCORD_APPLICATION_ID'),
    dataDir,
    dbPath: path.join(dataDir, 'sum.db'),
    backupDir: path.join(dataDir, 'backups'),
    backupKeep: int('BACKUP_KEEP', 7),
    backupHourUtc: int('BACKUP_HOUR_UTC', 2),
    registerCommands: bool('REGISTER_COMMANDS', true),
    healthPort: int('HEALTH_PORT', 3000),
    logLevel: optional('LOG_LEVEL', 'info'),
    errorWebhookUrl: optional('ERROR_WEBHOOK_URL'),
    r2: optional('R2_BUCKET')
      ? {
          accountId: required('R2_ACCOUNT_ID'),
          accessKeyId: required('R2_ACCESS_KEY_ID'),
          secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
          bucket: required('R2_BUCKET'),
          prefix: optional('R2_PREFIX', 'sum/'),
        }
      : null,
  });
  return cached;
}

export function inviteUrl(applicationId, permissionBits) {
  const params = new URLSearchParams({
    client_id: applicationId,
    permissions: String(permissionBits),
    integration_type: '0',
    scope: 'bot applications.commands',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
