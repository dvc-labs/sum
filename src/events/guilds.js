import { AuditLogEvent, escapeMarkdown, PermissionFlagsBits } from 'discord.js';
import { v2, ACCENT } from '../ui/kit.js';
import { welcomeDm } from '../ui/cards.js';
import { logEvent, warnOwner } from '../services/notify.js';
import { errorDetails, logger } from '../services/logger.js';
import { writeIfLeader } from '../services/leader.js';

/**
 * Who to thank? Discord doesn't tell bots who added them. If Sum can read the
 * audit log we DM the person who installed it, otherwise the server owner.
 */
async function findInstaller(client, guild) {
  if (guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    try {
      const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
      const entry = logs.entries.find((e) => e.target?.id === client.user.id);
      if (entry?.executor && !entry.executor.bot) return { user: entry.executor, isOwner: false };
    } catch {
      /* fall through to owner */
    }
  }
  const owner = await guild.fetchOwner();
  return { user: owner.user, isOwner: true };
}

export async function onGuildCreate(app, guild) {
  if (guild.available === false) return;
  const { store, client } = app;
  const welcome = writeIfLeader(app, () => {
    const { guild: row, created } = store.ensureGuild(guild.id);
    if (row.left_at) store.updateGuild(guild.id, { left_at: null, joined_at: Date.now() });
    if (created || row.left_at) logger.info({ guildId: guild.id, members: guild.memberCount, created }, 'joined guild');
    if (row.welcomed) return false;
    store.updateGuild(guild.id, { welcomed: 1 });
    return true;
  });
  if (!welcome) return;

  try {
    const { user, isOwner } = await findInstaller(client, guild);
    await user.send(v2([welcomeDm(guild.name, isOwner)]));
  } catch (err) {
    logger.info({ guildId: guild.id, error: errorDetails(err) }, 'welcome DM not delivered');
  }
}

export function onGuildDelete(app, guild) {
  // Discord.js emits GuildUnavailable separately from GuildDelete.
  writeIfLeader(app, () => {
    app.store.markLeft(guild.id);
    logger.info({ guildId: guild.id }, 'removed from guild — data kept for retention window');
  });
}

export async function reconcileGuilds(app) {
  const { client, store, leader } = app;
  // Settle membership before the first REST await or retention sweep.
  writeIfLeader(app, () => {
    for (const id of store.activeGuildIds()) {
      if (!client.guilds.cache.has(id)) store.markLeft(id);
    }
    for (const id of client.guilds.cache.keys()) {
      if (store.getGuild(id)?.left_at) store.updateGuild(id, { left_at: null, joined_at: Date.now() });
    }
  });
  for (const guild of client.guilds.cache.values()) {
    if (leader && !leader.isLeader()) return;
    const before = store.getGuild(guild.id);
    if (!before || !before.welcomed) await onGuildCreate(app, guild);
  }
}

export async function onChannelDelete(app, channel) {
  if (!channel.guildId) return;
  const { store, client } = app;
  const updated = writeIfLeader(app, () => {
    const row = store.getGuild(channel.guildId);
    if (!row) return;
    const countDeleted = row.count_channel_id === channel.id;
    const patch = {};
    if (countDeleted) patch.count_channel_id = null;
    if (row.log_channel_id === channel.id) patch.log_channel_id = null;
    const current = store.updateGuild(row.guild_id, patch);
    if (countDeleted) return current;
  });
  if (updated) {
    const lines = [
      `The counting channel **#${escapeMarkdown(channel.name, { maskedLink: true })}** was deleted, so the game is paused.`,
      `The count (**${updated.current_count}**), high score and player stats are safe.`,
      'Run `/sum` → **⚙️ Settings** and pick a new channel (a fresh `#sum` works great) to continue.',
    ];
    await logEvent(client, updated, '⚠️ Counting channel deleted', lines, ACCENT.warning);
    await warnOwner(app, updated, 'Your Sum counting channel was deleted', lines, { force: true });
  }
}

export function onRoleDelete(app, role) {
  writeIfLeader(app, () => {
    const row = app.store.getGuild(role.guild.id);
    if (!row) return;
    const patch = {};
    if (row.ruined_role_id === role.id) {
      patch.ruined_role_id = null;
      patch.ruined_role_enabled = 0;
    }
    if (row.admin_role_ids.includes(role.id)) {
      patch.admin_role_ids = row.admin_role_ids.filter((r) => r !== role.id);
    }
    app.store.updateGuild(row.guild_id, patch);
  });
}
