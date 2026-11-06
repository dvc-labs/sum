import { ActivityType, Client, Events, GatewayIntentBits, Options, Partials } from 'discord.js';
import { BRAND, GAME, loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { Store } from './db/store.js';
import { KeyedQueue } from './game/queue.js';
import { onMessageCreate, onMessageDelete, onMessageDeleteBulk, onMessageUpdate } from './game/handler.js';
import { onChannelDelete, onGuildCreate, onGuildDelete, onRoleDelete } from './events/guilds.js';
import { onInteraction } from './interactions/router.js';
import { registerCommands } from './commands/register.js';
import { runBackup } from './services/backup.js';
import { startHealthServer } from './services/health.js';
import { sweepTempRoles } from './services/roles.js';
import { initErrorReporting, reportError } from './services/errors.js';
import { Leader } from './services/leader.js';
import { logger } from './services/logger.js';

process.umask(0o077); // data files are readable by the bot user only

const config = loadConfig();
initErrorReporting(config.errorWebhookUrl);

const db = openDatabase(config.dbPath);
const store = new Store(db);
const queue = new KeyedQueue();
const leader = new Leader(db);
leader.start(); // newest container wins; an older one still running goes on standby

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — required to read counts
  ],
  partials: [Partials.Message, Partials.Channel],
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 25, // we only ever need the latest few counts
    GuildMemberManager: { maxSize: 200, keepOverLimit: (m) => m.id === m.client.user.id },
    PresenceManager: 0,
    ReactionManager: 0,
  }),
  allowedMentions: { parse: [] },
});

const app = { client, store, queue, config, leader };
const timers = [];

/** Wraps event handlers: standby instances ignore events, and one bad event never kills the process. */
const guard = (where, fn) => async (...args) => {
  if (!leader.isLeader()) return;
  try {
    await fn(app, ...args);
  } catch (err) {
    reportError(err, { where });
  }
};

client.on(Events.MessageCreate, guard('messageCreate', onMessageCreate));
client.on(Events.MessageDelete, guard('messageDelete', onMessageDelete));
client.on(Events.MessageBulkDelete, guard('messageDeleteBulk', onMessageDeleteBulk));
client.on(Events.MessageUpdate, guard('messageUpdate', onMessageUpdate));
client.on(Events.InteractionCreate, guard('interaction', onInteraction));
client.on(Events.GuildCreate, guard('guildCreate', onGuildCreate));
client.on(Events.GuildDelete, guard('guildDelete', onGuildDelete));
client.on(Events.ChannelDelete, guard('channelDelete', onChannelDelete));
client.on(Events.GuildRoleDelete, guard('roleDelete', onRoleDelete));
client.on(Events.Error, (err) => reportError(err, { where: 'client' }));
client.on(Events.ShardDisconnect, () => logger.warn('gateway disconnected'));
client.on(Events.ShardResume, () => logger.info('gateway resumed'));

function updatePresence() {
  const n = client.guilds.cache.size;
  client.user.setActivity({
    type: ActivityType.Custom,
    name: 'sum',
    state: `Counting in ${n} server${n === 1 ? '' : 's'} · /sum`,
  });
}

/** Reconcile servers joined/left while the bot was offline. */
async function reconcileGuilds() {
  const present = new Set(client.guilds.cache.keys());
  for (const guild of client.guilds.cache.values()) {
    const before = store.getGuild(guild.id);
    if (!before || !before.welcomed) await onGuildCreate(app, guild);
    else if (before.left_at) store.updateGuild(guild.id, { left_at: null });
  }
  for (const id of store.activeGuildIds()) {
    if (!present.has(id)) store.markLeft(id);
  }
}

function scheduleMaintenance() {
  // Expired ruined roles — every minute.
  timers.push(
    setInterval(() => {
      if (leader.isLeader()) sweepTempRoles(client, store).catch((e) => reportError(e, { where: 'sweep' }));
    }, 60_000),
  );

  // Hourly: presence, data retention purge, daily backup window.
  let lastBackupDay = null;
  const hourly = async () => {
    if (!leader.isLeader()) return;
    try {
      updatePresence();
      const cutoff = Date.now() - GAME.dataRetentionDays * 86_400_000;
      const purged = store.purgeLeftBefore(cutoff);
      if (purged) logger.info({ purged }, 'purged data of servers that removed Sum');

      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (now.getUTCHours() === config.backupHourUtc && lastBackupDay !== day) {
        lastBackupDay = day;
        await runBackup(db, config);
      }
    } catch (err) {
      reportError(err, { where: 'maintenance' });
    }
  };
  timers.push(setInterval(hourly, 3_600_000));
  hourly();
}

client.once(Events.ClientReady, async (c) => {
  logger.info({ user: c.user.tag, guilds: c.guilds.cache.size, version: BRAND.version }, 'Sum is online');
  try {
    if (config.registerCommands) await registerCommands(config);
  } catch (err) {
    reportError(err, { where: 'registerCommands' });
  }
  if (leader.isLeader()) await reconcileGuilds().catch((err) => reportError(err, { where: 'reconcile' }));
  scheduleMaintenance();
});

const health = startHealthServer({ port: config.healthPort, client, db, leader });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  timers.forEach(clearInterval);
  await Promise.race([queue.drain(), new Promise((r) => setTimeout(r, 5_000))]);
  leader.stop(); // hand over immediately instead of waiting for the stale window
  await client.destroy().catch(() => {});
  health.close();
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (err) {
    logger.error({ err }, 'error closing database');
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => reportError(err, { where: 'unhandledRejection' }));
process.on('uncaughtException', (err) => {
  reportError(err, { where: 'uncaughtException' });
  shutdown('uncaughtException');
});

client.login(config.token).catch((err) => {
  logger.fatal({ err: err.message }, 'login failed — check DISCORD_TOKEN and the Message Content intent');
  process.exit(1);
});
