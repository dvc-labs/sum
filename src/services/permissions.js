import { PermissionFlagsBits } from 'discord.js';

/**
 * Sum admin = server owner, Administrator, Manage Server, or one of the
 * server's configured Sum admin roles. Nothing is tied to a hard-coded user.
 */
export function isSumAdmin(interaction, guildRow) {
  if (!interaction.inGuild()) return false;
  if (interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user.id) return true;
  const perms = interaction.memberPermissions;
  if (perms?.has(PermissionFlagsBits.Administrator) || perms?.has(PermissionFlagsBits.ManageGuild)) return true;
  const adminRoles = guildRow?.admin_role_ids ?? [];
  if (adminRoles.length === 0) return false;
  const roles = interaction.member?.roles;
  const memberRoleIds = Array.isArray(roles) ? roles : roles?.cache ? [...roles.cache.keys()] : [];
  return memberRoleIds.some((id) => adminRoles.includes(id));
}

/** Permissions Sum needs in the counting channel for the core game. */
export const COUNT_CHANNEL_REQUIRED = [
  ['ViewChannel', 'View Channel'],
  ['SendMessages', 'Send Messages'],
  ['ReadMessageHistory', 'Read Message History'],
  ['AddReactions', 'Add Reactions'],
];

/**
 * Human-readable list of problems with the current configuration.
 * Used in the admin panel and in owner alerts.
 */
export function configIssues(guild, guildRow) {
  const issues = [];
  if (!guild) return issues;
  const me = guild.members.me;
  if (!me) return issues;

  if (guildRow.count_channel_id) {
    const ch = guild.channels.cache.get(guildRow.count_channel_id);
    if (!ch) {
      issues.push('The counting channel no longer exists. Pick a new one.');
    } else {
      const perms = ch.permissionsFor(me);
      const missing = COUNT_CHANNEL_REQUIRED.filter(([flag]) => !perms?.has(PermissionFlagsBits[flag])).map(
        ([, label]) => label,
      );
      if (missing.length) issues.push(`Sum is missing **${missing.join(', ')}** in <#${ch.id}>.`);
      if (guildRow.strict_mode && !perms?.has(PermissionFlagsBits.ManageMessages)) {
        issues.push(`Strict channel is on, but Sum can’t **Manage Messages** in <#${ch.id}>.`);
      }
    }
  }

  if (guildRow.log_channel_id) {
    const log = guild.channels.cache.get(guildRow.log_channel_id);
    const perms = log?.permissionsFor(me);
    if (!log) issues.push('The log channel no longer exists.');
    else if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      issues.push(`Sum can’t post in the log channel <#${log.id}>.`);
    }
  }

  if (guildRow.ruined_role_enabled && guildRow.ruined_role_id) {
    const role = guild.roles.cache.get(guildRow.ruined_role_id);
    if (!role) issues.push('The ruined role no longer exists.');
    else if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      issues.push('Sum needs **Manage Roles** to hand out the ruined role.');
    } else if (role.position >= me.roles.highest.position) {
      issues.push(`Move Sum’s role **above** <@&${role.id}> so it can hand it out.`);
    } else if (role.managed) {
      issues.push(`<@&${role.id}> is managed by an integration and can’t be assigned.`);
    }
  }
  return issues;
}

/** Why Sum's colour role isn't in the state the setting asks for, for the Settings → Roles tab. Null when all is well. */
export function brandRoleIssue(guild, guildRow) {
  if (!guild) return null;
  if (!guildRow.brand_role_enabled) {
    // Switched off, but the delete didn't go through: say so instead of failing silently.
    return guildRow.brand_role_id
      ? 'Sum couldn\u2019t delete its colour role. Delete **Sum colour** yourself in Server Settings \u2192 Roles.'
      : null;
  }
  if (guildRow.brand_role_id) return null;
  const me = guild.members.me;
  if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'Sum needs **Manage Roles** to add its colour role.';
  }
  return 'Sum\u2019s colour role isn\u2019t in place yet. It will try again on the next restart.';
}
