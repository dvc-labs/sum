import { PermissionFlagsBits } from 'discord.js';
import { GAME } from '../config.js';
import { ACCENT, v2 } from '../ui/kit.js';
import { logCard, ownerAlertDm } from '../ui/cards.js';
import { logger } from './logger.js';

/**
 * Posts an event to the server's log channel, if one is configured and usable.
 * Never throws — logging must not break the game.
 */
export async function logEvent(client, guildRow, title, lines, accent = ACCENT.brand) {
  if (!guildRow?.log_channel_id) return;
  try {
    const guild = client.guilds.cache.get(guildRow.guild_id);
    const channel = guild?.channels.cache.get(guildRow.log_channel_id);
    if (!channel?.isTextBased()) return;
    const perms = channel.permissionsFor(guild.members.me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) return;
    await channel.send(v2([logCard(title, lines, accent)]));
  } catch (err) {
    logger.debug({ err, guildId: guildRow.guild_id }, 'log channel post failed');
  }
}

/**
 * DMs the server owner about something that stops the game (deleted channel,
 * lost permissions). Rate-limited per server so owners never get spammed.
 * @param {{ force?: boolean }} options force skips the cooldown (e.g. channel deleted)
 */
export async function warnOwner(client, store, guildRow, title, lines, { force = false } = {}) {
  const now = Date.now();
  const cooldown = GAME.ownerWarnCooldownHours * 3_600_000;
  if (!force && guildRow.owner_warned_at && now - guildRow.owner_warned_at < cooldown) return false;

  const guild = client.guilds.cache.get(guildRow.guild_id);
  if (!guild) return false;
  store.updateGuild(guildRow.guild_id, { owner_warned_at: now }, now);
  try {
    const owner = await guild.fetchOwner();
    await owner.send(v2([ownerAlertDm(guild.name, title, lines)]));
    return true;
  } catch (err) {
    logger.info({ guildId: guild.id, err: err.message }, 'could not DM server owner');
    return false;
  }
}
