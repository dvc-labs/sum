import { ChannelType, escapeMarkdown, MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { inviteUrl, INVITE_PERMISSIONS } from '../config.js';
import { BOOLEAN_SETTINGS } from '../db/store.js';
import { resetRun } from '../game/engine.js';
import { aboutCard, kickoffCard } from '../ui/cards.js';
import { ACCENT, card, channel as ch, v2, v2update } from '../ui/kit.js';
import {
  helpView,
  gameAccessView,
  leaderboardView,
  noAccessView,
  overviewView,
  playerView,
  settingsView,
} from '../ui/panel.js';
import { canManageRole, canUseChannel, configIssues, isSumAdmin, ruinedRoleIssue } from '../services/permissions.js';
import { logEvent } from '../services/notify.js';
import { reportError } from '../services/errors.js';
import { sweepTempRoles } from '../services/roles.js';
import { writeIfLeader } from '../services/leader.js';

const SETTING_LABELS = {
  rule_wrong_number: 'Wrong number ends the run',
  rule_double_count: 'No counting twice in a row',
  rule_edit_delete: 'Bench after edits or deletes',
  math_enabled: 'Math mode',
  saves_enabled: 'Saves',
  strict_mode: 'Strict channel',
  ruined_role_enabled: 'Ruined role',
};

function context(app, interaction) {
  const guild = app.store.getGuild(interaction.guildId) ??
    writeIfLeader(app, () => app.store.ensureGuild(interaction.guildId).guild);
  if (!guild) return null;
  const countChannel = interaction.guild?.channels.cache.get(guild.count_channel_id);
  const isAdmin = isSumAdmin(interaction, guild);
  return {
    store: app.store,
    guild,
    guildName: escapeMarkdown(interaction.guild?.name ?? 'this server', { maskedLink: true }),
    userId: interaction.user.id,
    isAdmin,
    countChannel,
    canViewGame: canUseChannel(interaction, countChannel, PermissionFlagsBits.ReadMessageHistory),
    issues: isAdmin ? configIssues(interaction.guild, guild) : [],
  };
}

function overview(ctx) {
  return ctx.guild.count_channel_id && !ctx.canViewGame ? gameAccessView(ctx) : overviewView(ctx);
}

/* ─────────────────────────── Slash commands ─────────────────────────── */

export async function onInteraction(app, interaction) {
  try {
    if (interaction.isChatInputCommand()) return await onCommand(app, interaction);
    if (interaction.isMessageComponent() && interaction.customId.startsWith('sum:')) {
      if (!interaction.inGuild()) return;
      return await onComponent(app, interaction);
    }
  } catch (err) {
    reportError(err, { where: 'Discord interaction', guildId: interaction.guildId });
    const payload = { content: 'Something went sideways. Try again in a moment.', flags: MessageFlags.Ephemeral };
    if (interaction.isRepliable() && interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

async function onCommand(app, interaction) {
  if (interaction.commandName === 'about') {
    const invite = inviteUrl(app.config.applicationId, PermissionsBitField.resolve(INVITE_PERMISSIONS));
    return interaction.reply(v2([aboutCard({ guildCount: app.client.guilds.cache.size, invite })]));
  }
  if (interaction.commandName === 'sum') {
    if (!interaction.inGuild()) return;
    if (!interaction.guild) {
      return interaction.reply({ content: 'Sum is still loading this server. Try again in a moment.', flags: MessageFlags.Ephemeral });
    }
    const ctx = context(app, interaction);
    if (!ctx) return;
    const firstRun = ctx.isAdmin && !ctx.guild.count_channel_id;
    const view = firstRun ? settingsView(ctx, 'channels') : overview(ctx);
    return interaction.reply(v2(view, { ephemeral: true }));
  }
}

/* ─────────────────────────── Panel components ─────────────────────────── */

async function onComponent(app, interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'Sum is still loading this server. Try again in a moment.', flags: MessageFlags.Ephemeral });
  }
  const ctx = context(app, interaction);
  if (!ctx) return;
  const [, area, action, ...args] = interaction.customId.split(':');

  const show = (view) => interaction.update(v2update(view));
  const showGame = (render) => show(ctx.canViewGame ? render() : gameAccessView(ctx));
  switch (area) {
    case 'nav':
      switch (action) {
        case 'leaderboard':
          return showGame(() => leaderboardView(ctx));
        case 'player':
          return showGame(() => playerView(ctx));
        case 'help':
          return show(helpView(ctx));
        case 'settings':
          return show(ctx.isAdmin ? settingsView(ctx, 'channels') : noAccessView(ctx));
        default:
          return show(overview(ctx));
      }

    case 'lb':
      if (action === 'category') return showGame(() => leaderboardView(ctx, interaction.values[0], 0));
      if (action === 'page') return showGame(() => leaderboardView(ctx, args[0], Number.parseInt(args[1], 10) || 0));
      return;

    case 'player': {
      const target = interaction.users?.first();
      return showGame(() => playerView(ctx, target?.id ?? ctx.userId, Boolean(target?.bot)));
    }

    case 'settings':
      return show(ctx.isAdmin ? settingsView(ctx, action) : noAccessView(ctx));

    case 'set':
    case 'toggle':
    case 'danger':
      if (!ctx.isAdmin) return show(noAccessView(ctx));
      if (area === 'danger' && args[0] !== 'yes') {
        return show(settingsView(ctx, 'danger', { confirm: action }));
      }
      return mutate(app, interaction, area, action, args[0]);

    default:
  }
}

function needsManageMessages(interaction, channel, settings) {
  const bot = interaction.guild.members.me;
  const canDelete = !bot || channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageMessages);
  return settings.strict_mode || (settings.rule_edit_delete && canDelete);
}

const MODERATION_NOTICE = 'You need **Manage Messages** in the counting channel to configure message deletion.';
const ROLE_NOTICE = 'You need **Manage Roles** and a role above the ruined role to configure it.';

async function mutate(app, interaction, area, action, arg) {
  const generation = app.leader?.generation;
  await interaction.deferUpdate();
  const id = interaction.guildId;
  const result = await app.queue.run(id, () => {
    const committed = writeIfLeader(app, () => {
      if (app.leader?.generation !== generation) return;
      const ctx = context(app, interaction);
      if (!ctx?.isAdmin) return { view: noAccessView(ctx) };

      let result;
      if (area === 'set') {
        result = setOption(app, interaction, ctx, action);
        if (arg === 'setup-channels' || !ctx.guild.count_channel_id) result.tab ??= 'setup-channels';
      } else if (area === 'toggle') {
        result = toggleOption(app, interaction, ctx, action, arg);
      } else {
        result = dangerOption(app, interaction, ctx, action);
      }
      return { ...result, ctx: context(app, interaction) };
    });
    if (!committed) return;
    if (committed.notify) {
      committed.effect = app.effects.run(id, () => {
        if (app.leader && !app.leader.isLeader()) return;
        const current = app.store.getGuild(id);
        if (current && !current.left_at && current.created_at === committed.ctx.guild.created_at) {
          return committed.notify();
        }
      });
    }
    if (committed.cleanup) committed.cleanupTask = sweepTempRoles(app, id);
    return committed;
  });

  if (!result) {
    return interaction.followUp({ content: 'Sum is reconnecting. Try again in a moment.', flags: MessageFlags.Ephemeral });
  }
  const view = result.view ?? (result.ctx.isAdmin
    ? settingsView(result.ctx, result.tab)
    : noAccessView(result.ctx));
  if (result.notice) view.unshift(card({ body: result.notice, accent: ACCENT.warning }));
  await Promise.all([interaction.editReply(v2update(view)), result.effect, result.cleanupTask]);
}

function setOption(app, interaction, ctx, action) {
  const { store, client } = app;
  const { guild, countChannel } = ctx;
  const id = guild.guild_id;
  const by = `by <@${interaction.user.id}>`;
  const { values } = interaction;

  switch (action) {
    case 'count': {
      const target = interaction.guild.channels.cache.get(values[0]);
      if (target?.type !== ChannelType.GuildText || !canUseChannel(interaction, target) ||
          (countChannel && !ctx.canViewGame)) {
        return { notice: 'Choose a text channel you can view. Moving the game also requires access and **Read Message History** in the current channel.' };
      }
      if (target.id === guild.count_channel_id) return {};
      if (needsManageMessages(interaction, target, guild) &&
          !canUseChannel(interaction, target, PermissionFlagsBits.ManageMessages)) {
        return { notice: MODERATION_NOTICE };
      }
      const updated = store.updateGuild(id, { count_channel_id: target.id });
      return { notify: async () => {
        const perms = target.permissionsFor(interaction.guild.members.me);
        if (perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          await target.send(v2([kickoffCard(updated)])).catch(() => {});
        }
        await logEvent(client, updated, '⚙️ Counting channel set', [`${ch(target.id)} ${by}.`]);
      } };
    }
    case 'log': {
      const channelId = values[0] ?? null;
      const target = interaction.guild.channels.cache.get(channelId);
      if (channelId && (target?.type !== ChannelType.GuildText ||
          !canUseChannel(interaction, target, PermissionFlagsBits.SendMessages) ||
          (countChannel && !ctx.canViewGame))) {
        return { notice: 'Choose a log channel you can view and post in. You also need access and **Read Message History** in the counting channel.' };
      }
      if (channelId === guild.log_channel_id) return {};
      const updated = store.updateGuild(id, { log_channel_id: channelId });
      return { notify: () => channelId
        ? logEvent(client, updated, '📝 Sum will log here', [`Set ${by}. This channel will receive game events and settings changes.`])
        : logEvent(client, guild, '⚙️ Log channel removed', [`Logging turned off ${by}.`]) };
    }
    case 'admins': {
      const roleIds = [...new Set(values)].filter((roleId) => roleId !== id && interaction.guild.roles.cache.has(roleId));
      if (roleIds.length > 10 || roleIds.includes(guild.ruined_role_id)) {
        return { notice: 'Choose up to ten admin roles. The ruined role cannot also be a Sum admin role.' };
      }
      const updated = store.updateGuild(id, { admin_role_ids: roleIds });
      return { notify: () => logEvent(client, updated, '⚙️ Sum admin roles updated', [
        roleIds.length ? roleIds.map((r) => `<@&${r}>`).join(' ') : 'No extra roles.',
        `Changed ${by}.`,
      ]) };
    }
    case 'ruinedrole': {
      const role = interaction.guild.roles.cache.get(values[0]);
      if (!canManageRole(interaction, role)) return { tab: 'role', notice: ROLE_NOTICE };
      const issue = ruinedRoleIssue(interaction.guild, guild, role);
      if (issue) return { tab: 'role', notice: issue };
      const updated = store.updateGuild(id, { ruined_role_id: role.id });
      return { tab: 'role', notify: () => logEvent(client, updated, '⚙️ Ruined role set', [`<@&${role.id}> ${by}.`]) };
    }
    case 'ruinedminutes': {
      const role = interaction.guild.roles.cache.get(guild.ruined_role_id);
      if (!canManageRole(interaction, role)) return { tab: 'role', notice: ROLE_NOTICE };
      const minutes = Number(values[0]);
      if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) return { tab: 'role' };
      const updated = store.updateGuild(id, { ruined_role_minutes: minutes });
      return { tab: 'role', notify: () => logEvent(client, updated, '⚙️ Ruined role duration changed', [
        `Set to **${minutes} minutes** ${by}.`,
      ]) };
    }
    default:
      return {};
  }
}

function toggleOption(app, interaction, ctx, key, tab) {
  if (!BOOLEAN_SETTINGS.includes(key)) return { tab };
  const { guild, countChannel } = ctx;
  const next = guild[key] ? 0 : 1;
  if (next && key === 'ruined_role_enabled') {
    const role = interaction.guild.roles.cache.get(guild.ruined_role_id);
    if (!canManageRole(interaction, role)) return { tab: 'role', notice: ROLE_NOTICE };
    const issue = ruinedRoleIssue(interaction.guild, guild, role);
    if (issue) return { tab: 'role', notice: issue };
  }
  if (next && countChannel && (key === 'strict_mode' || key === 'rule_edit_delete') &&
      needsManageMessages(interaction, countChannel, { ...guild, [key]: next }) &&
      !canUseChannel(interaction, countChannel, PermissionFlagsBits.ManageMessages)) {
    return { tab, notice: MODERATION_NOTICE };
  }

  const updated = app.store.updateGuild(guild.guild_id, { [key]: next });
  return { tab, notify: () => logEvent(app.client, updated, '⚙️ Rule changed', [
    `**${SETTING_LABELS[key]}** turned **${next ? 'on' : 'off'}** by <@${interaction.user.id}>.`,
  ]) };
}

function dangerOption(app, interaction, ctx, action) {
  const { guild, countChannel } = ctx;
  if (guild.count_channel_id && !ctx.canViewGame) return { tab: 'danger' };
  const by = `<@${interaction.user.id}>`;
  if (action === 'reset') {
    const updated = resetRun(app.store, guild);
    return { tab: 'danger', notify: async () => {
      if (countChannel) {
        await countChannel
          .send(v2([card({ title: '🔄 Fresh start', body: 'An admin reset the count. Start again with **1**!' })]))
          .catch(() => {});
      }
      await logEvent(app.client, updated, '🔄 Count reset', [`From **${guild.current_count}** to 0 by ${by}.`], ACCENT.warning);
    } };
  }
  if (action === 'wipe') {
    app.store.wipeGuild(guild.guild_id);
    return { tab: 'channels', cleanup: true, notify: () => logEvent(
      app.client, guild, '🗑️ Server data wiped', [`Sum game data and settings were wiped by ${by}.`], ACCENT.danger,
    ) };
  }
  return { tab: 'danger' };
}
