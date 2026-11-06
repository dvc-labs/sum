import { PermissionFlagsBits } from 'discord.js';
import { ACCENT } from '../ui/kit.js';
import { logEvent } from './notify.js';
import { logger } from './logger.js';

/** Discord errors after which retrying a role removal can never succeed. */
const GONE = new Set([
  10004, // Unknown Guild
  10007, // Unknown Member
  10011, // Unknown Role
  10013, // Unknown User
  50013, // Missing Permissions (role hierarchy / Manage Roles revoked)
]);

/** Gives the ruined role to a player for the configured duration. */
export async function assignRuinedRole(client, store, guildRow, userId) {
  if (!guildRow.ruined_role_enabled || !guildRow.ruined_role_id) return;
  const guild = client.guilds.cache.get(guildRow.guild_id);
  const role = guild?.roles.cache.get(guildRow.ruined_role_id);
  const me = guild?.members.me;
  if (!guild || !role || !me) return;

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position || role.managed) {
    await logEvent(
      client,
      guildRow,
      '⚠️ Could not hand out the ruined role',
      [`Check that Sum has **Manage Roles** and sits above <@&${role.id}>.`],
      ACCENT.warning,
    );
    return;
  }

  try {
    const member = await guild.members.fetch(userId);
    await member.roles.add(role, 'Sum: ruined the count');
    store.addTempRole(guild.id, userId, role.id, Date.now() + guildRow.ruined_role_minutes * 60_000);
  } catch (err) {
    logger.warn({ guildId: guild.id, err: err.message }, 'ruined role assign failed');
  }
}

/**
 * Removes one tracked ruined role. Returns true when the record can be dropped:
 * the role is gone from the member, or retrying can never work. Transient
 * failures (rate limits, network, outages) return false so the next sweep retries.
 */
export async function removeTrackedRole(client, entry) {
  const guild = client.guilds.cache.get(entry.guild_id);
  if (!guild) return false; // gateway outage or not cached yet — retry; data purge cleans up removed servers
  try {
    const member = await guild.members.fetch(entry.user_id);
    if (member.roles.cache.has(entry.role_id)) await member.roles.remove(entry.role_id, 'Sum: ruined role expired');
    return true;
  } catch (err) {
    if (GONE.has(err?.code)) return true;
    logger.warn({ guildId: entry.guild_id, err: err.message }, 'ruined role removal failed — will retry');
    return false;
  }
}

/** Removes expired ruined roles. Runs every minute; survives restarts via the DB. */
export async function sweepTempRoles(client, store) {
  for (const entry of store.dueTempRoles()) {
    if (await removeTrackedRole(client, entry)) {
      store.removeTempRole(entry.guild_id, entry.user_id, entry.role_id);
    }
  }
}

/** Takes back every active ruined role in a server (used before wiping its data). */
export async function releaseAllRuinedRoles(client, store, guildId) {
  for (const entry of store.tempRolesForGuild(guildId)) {
    await removeTrackedRole(client, entry);
  }
}
