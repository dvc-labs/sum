import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { v2, ACCENT } from '../ui/kit.js';
import { welcomeDm } from '../ui/cards.js';
import { logEvent, warnOwner } from '../services/notify.js';
import { logger } from '../services/logger.js';
import { syncBrandRole } from '../services/brand.js';

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
  const { store, client } = app;
  const { guild: row, created } = store.ensureGuild(guild.id);
  if (row.left_at) store.updateGuild(guild.id, { left_at: null, joined_at: Date.now() });
  logger.info({ guildId: guild.id, members: guild.memberCount, created }, 'joined guild');

  // Give Sum its brand colour (best effort; silently skipped without Manage Roles).
  await app.queue.run(guild.id, () => syncBrandRole(client, store, guild.id));

  if (row.welcomed) return; // only the very first install gets a thank-you
  store.updateGuild(guild.id, { welcomed: 1 });
  try {
    const { user, isOwner } = await findInstaller(client, guild);
    await user.send(v2([welcomeDm(guild.name, isOwner)]));
  } catch (err) {
    logger.info({ guildId: guild.id, err: err.message }, 'welcome DM not delivered (DMs closed?)');
  }
}

export function onGuildDelete(app, guild) {
  if (guild.available === false) return; // outage, not a removal
  app.store.markLeft(guild.id);
  logger.info({ guildId: guild.id }, 'removed from guild — data kept for retention window');
}

export async function onChannelDelete(app, channel) {
  if (!channel.guildId) return;
  const { store, client } = app;
  const row = store.getGuild(channel.guildId);
  if (!row) return;

  if (row.count_channel_id === channel.id) {
    const updated = store.updateGuild(row.guild_id, { count_channel_id: null });
    const lines = [
      `The counting channel **#${channel.name}** was deleted, so the game is paused.`,
      `The count (**${row.current_count}**), high score and player stats are safe.`,
      'Run `/sum` → **⚙️ Settings** and pick a new channel (a fresh `#sum` works great) to continue.',
    ];
    await logEvent(client, updated, '⚠️ Counting channel deleted', lines, ACCENT.warning);
    await warnOwner(client, store, updated, 'Your Sum counting channel was deleted', lines, { force: true });
  }
  if (row.log_channel_id === channel.id) {
    store.updateGuild(row.guild_id, { log_channel_id: null });
  }
}

export function onRoleDelete(app, role) {
  const row = app.store.getGuild(role.guild.id);
  if (!row) return;
  const patch = {};
  if (row.ruined_role_id === role.id) {
    patch.ruined_role_id = null;
    patch.ruined_role_enabled = 0;
  }
  if (row.brand_role_id === role.id) {
    // Deleted by an admin (or by Sum itself when switching it off): don't bring it back.
    patch.brand_role_id = null;
    patch.brand_role_enabled = 0;
  }
  if (row.admin_role_ids.includes(role.id)) {
    patch.admin_role_ids = row.admin_role_ids.filter((r) => r !== role.id);
  }
  if (Object.keys(patch).length) app.store.updateGuild(row.guild_id, patch);
}
