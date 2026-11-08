import { ActivityType, Client, Events, GatewayIntentBits, Options, Partials, Status } from 'discord.js';
import { BRAND, GAME, loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { Store } from './db/store.js';
import { KeyedQueue } from './game/queue.js';
import { CountCatchUp } from './game/catch-up.js';
import { onMessageCreate, onMessageDelete, onMessageDeleteBulk, onMessageUpdate } from './game/handler.js';
import { onChannelDelete, onGuildCreate, onGuildDelete, onRoleDelete, reconcileGuilds } from './events/guilds.js';
import { onInteraction } from './interactions/router.js';
import { registerCommands } from './commands/register.js';
import { startHealthServer } from './services/health.js';
import { sweepTempRoles } from './services/roles.js';
import { initErrorReporting, reportError } from './services/errors.js';
import { Leader } from './services/leader.js';
import { detectEmoji } from './ui/emoji.js';
import { errorDetails, logger } from './services/logger.js';

process.umask(0o077); // data files are readable by the bot user only

const config = loadConfig();
initErrorReporting(config.errorWebhookUrl);

const db = openDatabase(config.dbPath);
const store = new Store(db);
const queue = new KeyedQueue();
const effects = new KeyedQueue({ maxPerKey: 64, maxTotal: 512 });
const roleQueue = new KeyedQueue();
const leader = new Leader(db);

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

const app = { client, store, queue, effects, roleQueue, config, leader };
const catchUp = new CountCatchUp(app);
const timers = [];
const jobs = new Set();
let shuttingDown = false;

const gatewayReady = () => client.isReady() && client.ws.shards.every((shard) => shard.status === Status.Ready);

function refreshLease() {
  if (shuttingDown || !leader.timer || !gatewayReady()) return;
  try {
    leader.tick();
  } catch (err) {
    reportError(err, { where: 'gateway lease refresh' });
  }
}

/** Wraps event handlers: standby instances ignore events, and one bad event never kills the process. */
const guard = (where, fn) => async (...args) => {
  try {
    if (shuttingDown || !leader.isLeader()) return;
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
const joinGuild = (app, guild) => Promise.all([
  onGuildCreate(app, guild),
  catchUp.run(guild, { freshConnection: true }),
]);
client.on(Events.GuildCreate, guard('guildCreate', joinGuild));
client.on(Events.GuildAvailable, guard('guildAvailable', joinGuild));
client.on(Events.GuildDelete, guard('guildDelete', onGuildDelete));
client.on(Events.ChannelDelete, guard('channelDelete', onChannelDelete));
client.on(Events.GuildRoleDelete, guard('roleDelete', onRoleDelete));
client.on(Events.Error, (err) => reportError(err, { where: 'client' }));
client.on(Events.ShardDisconnect, () => logger.warn('gateway disconnected'));
client.on(Events.ShardResume, () => {
  logger.info('gateway resumed');
  refreshLease();
});
client.on(Events.ShardReady, (shardId) => {
  const generation = leader.generation;
  refreshLease();
  if (!shuttingDown && leader.timer && leader.generation === generation && leader.isLeader()) {
    catchUp.runConfigured(shardId);
  }
});

function updatePresence() {
  const n = client.guilds.cache.size;
  client.user.setActivity({
    type: ActivityType.Custom,
    name: 'sum',
    state: `Counting in ${n} server${n === 1 ? '' : 's'} · /sum`,
  });
}

function scheduleJob(where, intervalMs, task) {
  let pending;
  const run = () => {
    if (pending || shuttingDown || !gatewayReady() || !leader.isLeader()) return;
    pending = Promise.resolve().then(task).catch((err) => reportError(err, { where })).finally(() => {
      jobs.delete(pending);
      pending = null;
    });
    jobs.add(pending);
  };
  timers.push(setInterval(run, intervalMs));
  run();
}

function scheduleMaintenance() {
  scheduleJob('role expiry', 60_000, () => sweepTempRoles(app));
  scheduleJob('maintenance', 3_600_000, () => {
    const now = Date.now();
    updatePresence();
    const purged = leader.write(() => {
      store.purgeProcessedCounts(now - GAME.countReplayHours * 3_600_000);
      return store.purgeLeftBefore(now - GAME.dataRetentionDays * 86_400_000);
    });
    if (purged) logger.info({ purged }, 'purged data of servers that removed Sum');
  });
}

client.once(Events.ClientReady, async (c) => {
  logger.info({ user: c.user.tag, guilds: c.guilds.cache.size, version: BRAND.version }, 'Sum is online');
  if (shuttingDown) return;
  leader.start(gatewayReady, () => {
    reconcileGuilds(app).catch((err) => reportError(err, { where: 'guild reconciliation' }));
    catchUp.runConfigured();
  });
  scheduleMaintenance();
  try {
    if (config.registerCommands && leader.isLeader()) await registerCommands(config);
  } catch (err) {
    reportError(err, { where: 'registerCommands' });
  }
  await detectEmoji(client).catch((err) => reportError(err, { where: 'detectEmoji' }));
});

const health = startHealthServer({ port: config.healthPort, gatewayReady, db, leader });

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  timers.forEach(clearInterval);
  const drained = queue.drain().then(() => Promise.allSettled([effects.drain(), roleQueue.drain(), ...jobs]));
  await Promise.race([drained, new Promise((r) => setTimeout(r, 5_000))]);
  leader.stop(); // hand over immediately instead of waiting for the stale window
  await client.destroy().catch(() => {});
  health.close();
  try {
    db.close();
  } catch (err) {
    logger.error({ error: errorDetails(err) }, 'error closing database');
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
  logger.fatal({ error: errorDetails(err) }, 'login failed — check DISCORD_TOKEN and the Message Content intent');
  process.exit(1);
});
