import { ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { inviteUrl, INVITE_PERMISSIONS } from '../config.js';
import { BOOLEAN_SETTINGS } from '../db/store.js';
import { resetRun } from '../game/engine.js';
import { aboutCard, kickoffCard } from '../ui/cards.js';
import { ACCENT, card, channel as ch, v2, v2update } from '../ui/kit.js';
import {
  helpView,
  leaderboardView,
  noAccessView,
  overviewView,
  playerView,
  settingsView,
} from '../ui/panel.js';
import { configIssues, isSumAdmin } from '../services/permissions.js';
import { logEvent } from '../services/notify.js';
import { reportError } from '../services/errors.js';

const SETTING_LABELS = {
  rule_wrong_number: 'Wrong number ends the run',
  rule_double_count: 'No counting twice in a row',
  rule_edit_delete: 'Bench count deleters & editors',
  math_enabled: 'Math mode',
  saves_enabled: 'Saves',
  strict_mode: 'Strict channel',
  ruined_role_enabled: 'Ruined role',
};

function context(app, interaction) {
  const { guild } = app.store.ensureGuild(interaction.guildId);
  return {
    store: app.store,
    guild,
    guildName: interaction.guild?.name ?? 'this server',
    userId: interaction.user.id,
    isAdmin: isSumAdmin(interaction, guild),
    issues: configIssues(interaction.guild, guild),
  };
}

function refresh(ctx, interaction) {
  ctx.guild = ctx.store.getGuild(ctx.guild.guild_id);
  ctx.issues = configIssues(interaction.guild, ctx.guild);
  return ctx;
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
    reportError(err, { where: `interaction ${interaction.customId ?? interaction.commandName}` });
    const payload = { content: 'Something went sideways. Try again in a moment.', flags: MessageFlags.Ephemeral };
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
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
    const ctx = context(app, interaction);
    const firstRun = ctx.isAdmin && !ctx.guild.count_channel_id;
    const view = firstRun ? settingsView(ctx, 'channels') : overviewView(ctx);
    return interaction.reply(v2(view, { ephemeral: true }));
  }
}

/* ─────────────────────────── Panel components ─────────────────────────── */

async function onComponent(app, interaction) {
  const ctx = context(app, interaction);
  const [, area, action, ...args] = interaction.customId.split(':');

  const show = (view) => interaction.update(v2update(view));
  const requireAdmin = () => {
    if (ctx.isAdmin) return true;
    show(noAccessView(ctx)).catch(() => {});
    return false;
  };

  switch (area) {
    case 'nav':
      switch (action) {
        case 'leaderboard':
          return show(leaderboardView(ctx));
        case 'player':
          return show(playerView(ctx));
        case 'help':
          return show(helpView(ctx));
        case 'settings':
          if (!requireAdmin()) return;
          return show(settingsView(ctx, 'channels'));
        default:
          return show(overviewView(ctx));
      }

    case 'lb':
      if (action === 'category') return show(leaderboardView(ctx, interaction.values[0], 0));
      if (action === 'page') return show(leaderboardView(ctx, args[0], Number.parseInt(args[1], 10) || 0));
      return;

    case 'player': {
      const target = interaction.users?.first();
      return show(playerView(ctx, target?.id ?? ctx.userId, Boolean(target?.bot)));
    }

    case 'settings':
      if (!requireAdmin()) return;
      return show(settingsView(ctx, action));

    case 'set':
      if (!requireAdmin()) return;
      return onSet(app, interaction, ctx, action, show);

    case 'toggle':
      if (!requireAdmin()) return;
      return onToggle(app, interaction, ctx, action, args[0], show);

    case 'danger':
      if (!requireAdmin()) return;
      return onDanger(app, interaction, ctx, action, args[0], show);

    default:
  }
}

async function onSet(app, interaction, ctx, action, show) {
  const { store, client } = app;
  const id = ctx.guild.guild_id;
  const by = `by <@${interaction.user.id}>`;

  switch (action) {
    case 'count': {
      const channelId = interaction.values[0];
      const target = interaction.guild.channels.cache.get(channelId);
      if (!target || target.type !== ChannelType.GuildText) return show(settingsView(ctx, 'channels'));
      const changed = channelId !== ctx.guild.count_channel_id;
      store.updateGuild(id, { count_channel_id: channelId });
      refresh(ctx, interaction);
      await show(settingsView(ctx, 'channels'));
      if (changed) {
        const perms = target.permissionsFor(interaction.guild.members.me);
        if (perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages)) {
          await target.send(v2([kickoffCard()])).catch(() => {});
        }
        await logEvent(client, ctx.guild, '⚙️ Counting channel set', [`${ch(channelId)} ${by}.`]);
      }
      return;
    }
    case 'log': {
      const channelId = interaction.values[0] ?? null;
      const previous = ctx.guild;
      if (!channelId) await logEvent(client, previous, '⚙️ Log channel removed', [`Logging turned off ${by}.`]);
      store.updateGuild(id, { log_channel_id: channelId });
      refresh(ctx, interaction);
      await show(settingsView(ctx, 'channels'));
      if (channelId) {
        await logEvent(client, ctx.guild, '📝 Sum will log here', [
          `Set ${by}. You’ll see ruined runs, saves, records, deleted counts, setting changes and permission problems.`,
        ]);
      }
      return;
    }
    case 'admins': {
      const roleIds = interaction.values.filter((r) => r !== interaction.guildId); // never @everyone
      store.updateGuild(id, { admin_role_ids: roleIds });
      refresh(ctx, interaction);
      await show(settingsView(ctx, 'channels'));
      await logEvent(client, ctx.guild, '⚙️ Sum admin roles updated', [
        roleIds.length ? roleIds.map((r) => `<@&${r}>`).join(' ') : 'No extra roles.',
        `Changed ${by}.`,
      ]);
      return;
    }
    case 'ruinedrole': {
      const roleId = interaction.values[0];
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role || role.id === interaction.guildId || role.managed) {
        return show(settingsView(refresh(ctx, interaction), 'role'));
      }
      store.updateGuild(id, { ruined_role_id: roleId });
      refresh(ctx, interaction);
      await show(settingsView(ctx, 'role'));
      await logEvent(client, ctx.guild, '⚙️ Ruined role set', [`<@&${roleId}> ${by}.`]);
      return;
    }
    case 'ruinedminutes': {
      const minutes = Number.parseInt(interaction.values[0], 10);
      if (Number.isFinite(minutes) && minutes > 0 && minutes <= 1440) {
        store.updateGuild(id, { ruined_role_minutes: minutes });
      }
      refresh(ctx, interaction);
      return show(settingsView(ctx, 'role'));
    }
    default:
      return show(settingsView(ctx, 'channels'));
  }
}

async function onToggle(app, interaction, ctx, key, tab, show) {
  if (!BOOLEAN_SETTINGS.includes(key)) return show(settingsView(ctx, tab));
  const next = ctx.guild[key] ? 0 : 1;
  if (key === 'ruined_role_enabled' && next && !ctx.guild.ruined_role_id) return show(settingsView(ctx, 'role'));
  app.store.updateGuild(ctx.guild.guild_id, { [key]: next });
  refresh(ctx, interaction);
  await show(settingsView(ctx, tab));
  await logEvent(app.client, ctx.guild, '⚙️ Rule changed', [
    `**${SETTING_LABELS[key]}** turned **${next ? 'on' : 'off'}** by <@${interaction.user.id}>.`,
  ]);
}

async function onDanger(app, interaction, ctx, action, confirm, show) {
  const by = `<@${interaction.user.id}>`;
  if (confirm !== 'yes') return show(settingsView(ctx, 'danger', { confirm: action }));

  if (action === 'reset') {
    const before = ctx.guild.current_count;
    await app.queue.run(ctx.guild.guild_id, () => resetRun(app.store, app.store.getGuild(ctx.guild.guild_id)));
    refresh(ctx, interaction);
    await show(settingsView(ctx, 'danger'));
    const countChannel = interaction.guild.channels.cache.get(ctx.guild.count_channel_id);
    if (countChannel?.isTextBased()) {
      await countChannel
        .send(v2([card({ title: '🔄 Fresh start', body: 'An admin reset the count. Start again with **1**!' })]))
        .catch(() => {});
    }
    await logEvent(app.client, ctx.guild, '🔄 Count reset', [`From **${before}** to 0 by ${by}.`], ACCENT.warning);
    return;
  }

  if (action === 'wipe') {
    const old = ctx.guild;
    await logEvent(app.client, old, '🗑️ Server data wiped', [`All Sum data and settings were wiped by ${by}.`], ACCENT.danger);
    await app.queue.run(old.guild_id, () => app.store.wipeGuild(old.guild_id));
    refresh(ctx, interaction);
    return show(settingsView(ctx, 'channels'));
  }
}
