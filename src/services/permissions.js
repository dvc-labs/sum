import { PermissionFlagsBits } from 'discord.js';

function isGuildOwner(interaction) {
  return interaction.guild?.ownerId === interaction.user.id;
}

export function canUseChannel(interaction, channel, ...permissions) {
  return Boolean(channel && (isGuildOwner(interaction) ||
    channel.permissionsFor(interaction.member)?.has([PermissionFlagsBits.ViewChannel, ...permissions])));
}

export function canManageRole(interaction, role) {
  const member = interaction.member;
  return Boolean(role && (isGuildOwner(interaction) ||
    (member?.permissions?.has(PermissionFlagsBits.ManageRoles) &&
      member.roles.highest.comparePositionTo(role) > 0)));
}

/**
 * Sum admin = server owner, Administrator, Manage Server, or one of the
 * server's configured Sum admin roles. Nothing is tied to a hard-coded user.
 */
export function isSumAdmin(interaction, guildRow) {
  if (!interaction.inGuild()) return false;
  if (isGuildOwner(interaction)) return true;
  const perms = interaction.memberPermissions;
  if (perms?.has(PermissionFlagsBits.Administrator) || perms?.has(PermissionFlagsBits.ManageGuild)) return true;
  const adminRoles = guildRow?.admin_role_ids ?? [];
  if (adminRoles.length === 0) return false;
  const roles = interaction.member?.roles;
  const memberRoleIds = Array.isArray(roles) ? roles : roles?.cache ? [...roles.cache.keys()] : [];
  return memberRoleIds.some((id) => adminRoles.includes(id));
}

/** A temporary game role can restrict access, but must never grant it. */
export function ruinedRoleIssue(guild, row, role = guild?.roles.cache.get(row.ruined_role_id)) {
  if (!role || role.id === guild.id || role.managed) return 'Pick an existing role Sum can assign.';
  if (row.admin_role_ids.includes(role.id)) return 'The ruined role cannot also be a Sum admin role.';
  if (role.permissions.bitfield !== 0n) return 'Pick a ruined role without Discord server permissions.';
  for (const channel of guild.channels.cache.values()) {
    const overwrite = channel.permissionOverwrites?.cache.get(role.id);
    if (overwrite && overwrite.allow.bitfield !== 0n) {
      return 'The ruined role cannot allow extra permissions in a channel or category.';
    }
  }
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'Sum needs **Manage Roles** to hand out the ruined role.';
  }
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return `Move Sum’s role **above** <@&${role.id}> so it can hand it out.`;
  }
  return null;
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
    const issue = ruinedRoleIssue(guild, guildRow);
    if (issue) issues.push(issue);
  }
  return issues;
}
