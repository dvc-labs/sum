import { PermissionFlagsBits } from 'discord.js';
import { ACCENT } from '../ui/kit.js';
import { logEvent } from './notify.js';
import { logger } from './logger.js';

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

/** Removes expired ruined roles. Runs every minute; survives restarts via the DB. */
export async function sweepTempRoles(client, store) {
  for (const entry of store.dueTempRoles()) {
    const guild = client.guilds.cache.get(entry.guild_id);
    try {
      if (guild) {
        const member = await guild.members.fetch(entry.user_id).catch(() => null);
        if (member?.roles.cache.has(entry.role_id)) {
          await member.roles.remove(entry.role_id, 'Sum: ruined role expired');
        }
      }
    } catch (err) {
      logger.warn({ guildId: entry.guild_id, err: err.message }, 'ruined role removal failed');
    } finally {
      // Always drop the entry: a missing guild/member/role can't be fixed by retrying.
      store.removeTempRole(entry.guild_id, entry.user_id, entry.role_id);
    }
  }
}
