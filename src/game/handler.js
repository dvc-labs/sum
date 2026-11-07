import { PermissionFlagsBits } from 'discord.js';
import { GAME } from '../config.js';
import { parseCount } from './parser.js';
import { recordCountAttempt } from './engine.js';
import { v2, ACCENT, fmt, user } from '../ui/kit.js';
import {
  milestoneCard,
  mistakeReason,
  recordCard,
  ruinedCard,
  saveEarnedCard,
  savedCard,
  tamperCard,
} from '../ui/cards.js';
import { logEvent, warnOwner } from '../services/notify.js';
import { assignRuinedRole } from '../services/roles.js';
import { isPermissionError, reportError } from '../services/errors.js';
import { writeIfLeader } from '../services/leader.js';
import { reactWith } from '../ui/emoji.js';

/**
 * Reaction identifiers. `custom` ones are keys of Sum's custom emoji (see ui/emoji.js)
 * and fall back to unicode automatically; the rest are plain unicode.
 */
const EMOJI = {
  ok: { custom: 'checkmark' },
  wrong: { custom: 'crossmark' },
  beyondRecord: '☑️',
  hundred: '💯',
  thousand: '🎉',
  saved: '🛟',
  benched: '⛔',
};

function inCountingChannel(app, guildId, channelId, update) {
  if (!guildId || !app.store.isCountingChannel(guildId, channelId)) return;
  const generation = app.leader?.generation;
  return app.queue.run(guildId, () => {
    const afterCommit = writeIfLeader(app, () => {
      if (app.leader?.generation !== generation) return;
      const guild = app.store.getGuild(guildId);
      if (!guild || guild.left_at || guild.count_channel_id !== channelId) return;
      return update(guild);
    });
    // The state queue waits for the commit. Discord REST work has its own queue.
    return { effects: afterCommit?.() };
  }).then(({ effects }) => effects);
}

function countEffects(app, guild, task, options) {
  return app.effects.run(guild.guild_id, () => {
    if (app.leader && !app.leader.isLeader()) return;
    const current = app.store.getGuild(guild.guild_id);
    if (!current || current.left_at || current.created_at !== guild.created_at ||
        current.count_channel_id !== guild.count_channel_id) return;
    return task(current);
  }, options);
}

/** Wraps a Discord call: permission failures alert the owner (rate-limited) instead of crashing. */
async function safely(app, guildRow, what, fn) {
  try {
    return await fn();
  } catch (err) {
    if (isPermissionError(err)) {
      const lines = [
        `Sum couldn’t **${what}** in <#${guildRow.count_channel_id}>.`,
        'Check the channel permissions: View Channel, Send Messages, Read Message History and Add Reactions (plus Manage Messages for strict mode).',
      ];
      const current = app.store.getGuild(guildRow.guild_id);
      if (current && (!current.owner_warned_at ||
          Date.now() - current.owner_warned_at >= GAME.ownerWarnCooldownHours * 3_600_000)) {
        await warnOwner(app, current, 'Sum is missing permissions', lines);
        await logEvent(app.client, current, '⚠️ Missing permissions', lines, ACCENT.warning);
      }
    } else if (err?.code !== 10008) {
      // 10008 = Unknown Message (already deleted) — harmless.
      reportError(err, { where: what, guildId: guildRow.guild_id });
    }
    return null;
  }
}

function canManageMessages(message) {
  return message.channel?.permissionsFor(message.guild?.members.me)?.has(PermissionFlagsBits.ManageMessages);
}

/* ───────────────────────────── New messages ───────────────────────────── */

export function isPlayerMessage(message) {
  return Boolean(message.author && !message.author.bot && !message.system && !message.webhookId);
}

export function onMessageCreate(app, message) {
  if (!isPlayerMessage(message)) return;
  const { content } = message; // Discord.js can mutate a cached Message on edit
  return inCountingChannel(app, message.guildId, message.channelId, (guild) => {
    const afterCommit = processCount(app, guild, message, content);
    app.store.advanceCountCursor(guild.guild_id, message.id);
    return afterCommit;
  });
}

function processCount(app, guild, message, content) {
  const { store } = app;
  const parsed = parseCount(content, { allowMath: Boolean(guild.math_enabled) });
  if (!parsed.attempt) {
    if (!guild.strict_mode || !canManageMessages(message)) return;
    return () => countEffects(app, guild, (current) => {
      if (current.strict_mode && canManageMessages(message)) {
        return safely(app, current, 'delete a non-count message', () => message.delete());
      }
    }, { essential: true });
  }
  const result = recordCountAttempt(store, guild, {
    userId: message.author.id,
    messageId: message.id,
    parsed,
  });
  if (!result) return;
  const { outcome, updated } = result;
  return () => {
    const essential = outcome.type === 'saved' || outcome.type === 'ruined' ||
      (outcome.type === 'disqualified' && canManageMessages(message));
    const notification = countEffects(
      app, updated, (current) => announceCount(app, message, guild, updated, outcome, current),
      { essential },
    );
    const role = outcome.type === 'ruined' && updated.ruined_role_enabled
      ? app.roleQueue.run(guild.guild_id, () => assignRuinedRole(app, updated, message.author.id))
      : undefined;
    return Promise.all([notification, role]);
  };
}

async function announceCount(app, message, guild, updated, outcome, current) {
  const { client } = app;
  const send = (container, what = 'send a message') =>
    safely(app, updated, what, () => message.channel.send(v2([container])));
  const react = (emoji) =>
    safely(app, updated, 'add reactions', () => (emoji.custom ? reactWith(message, emoji.custom) : message.react(emoji)));

  switch (outcome.type) {
    case 'disqualified':
      if (!current.rule_edit_delete || current.run_id !== guild.run_id) return;
      if (canManageMessages(message)) await safely(app, guild, 'delete a message', () => message.delete());
      else await react(EMOJI.benched);
      return;

    case 'correct': {
      const emoji = outcome.milestoneCard
        ? EMOJI.thousand
        : outcome.milestoneReaction
          ? EMOJI.hundred
          : outcome.beyondRecord
            ? EMOJI.beyondRecord
            : EMOJI.ok;
      await react(emoji);
      if (outcome.announceRecord) {
        await send(recordCard(outcome.number));
        await logEvent(client, updated, '🏆 New high score run', [
          `Passed the previous record of **${fmt(guild.high_score)}**.`,
        ], ACCENT.celebrate);
      }
      if (outcome.saveEarned) {
        await send(saveEarnedCard(updated));
        await logEvent(client, updated, '🛟 Save earned', [`At **${fmt(outcome.number)}** · now ${updated.saves} saves.`]);
      }
      if (outcome.milestoneCard) {
        await send(milestoneCard(outcome.number, updated));
        await logEvent(client, updated, '🎉 Milestone', [`The server reached **${fmt(outcome.number)}**.`], ACCENT.celebrate);
      }
      return;
    }

    case 'rejected':
      await react(EMOJI.wrong);
      return;

    case 'saved':
      await react(EMOJI.saved);
      await send(savedCard(outcome, message.author.id));
      await logEvent(client, updated, '🛟 Save used', [
        `${user(message.author.id)} ${mistakeReason(outcome)}.`,
        `Saves left: **${outcome.savesLeft}**.`,
      ], ACCENT.warning);
      return;

    case 'ruined':
      await react(EMOJI.wrong);
      await send(ruinedCard(outcome, message.author.id, updated));
      await logEvent(client, updated, '💥 Run ruined', [
        `${user(message.author.id)} ended the run at **${fmt(outcome.ruinedAt)}**.`,
        `Reason: ${mistakeReason(outcome)}.`,
        `[Jump to message](${message.url})`,
      ], ACCENT.danger);
      return;

    default:
  }
}

/* ─────────────────────── Deleted & edited counts ─────────────────────── */

export function onMessageDelete(app, message) {
  return inCountingChannel(app, message.guildId, message.channelId, (guild) => {
    if (guild.last_message_id === message.id) return handleTamper(app, guild, 'delete');
  });
}

export function onMessageDeleteBulk(app, messages, channel) {
  return inCountingChannel(app, channel.guildId, channel.id, (guild) => {
    if (guild.last_message_id && messages.has(guild.last_message_id)) {
      // Bulk deletion requires moderator permissions.
      return handleTamper(app, guild, 'delete', { allowBench: false });
    }
  });
}

export function onMessageUpdate(app, oldMessage, message) {
  const { content, guildId, channelId, id } = message;
  const oldContent = oldMessage?.content;
  if (typeof content !== 'string' || oldContent === content) return;
  // An uncached message can gain content during a metadata-only update.
  if (typeof oldContent !== 'string' && !message.editedTimestamp) return;
  return inCountingChannel(app, guildId, channelId, (guild) => {
    if (guild.last_message_id === id) return handleTamper(app, guild, 'edit');
  });
}

function handleTamper(app, guild, kind, { allowBench = true } = {}) {
  const { store, client } = app;
  const userId = guild.last_user_id;
  const bench = allowBench && Boolean(guild.rule_edit_delete && userId);
  store.updateGuild(guild.guild_id, { last_message_id: null });
  if (bench) store.disqualify(guild.guild_id, userId, guild.run_id, kind);

  return () => countEffects(app, guild, async () => {
    const channel = client.channels.cache.get(guild.count_channel_id);
    if (channel?.isTextBased()) {
      await safely(app, guild, 'send a message', () =>
        channel.send(v2([tamperCard(kind, userId, guild.current_count, bench)])),
      );
    }
    await logEvent(client, guild, kind === 'delete' ? '🕵️ Count deleted' : '🕵️ Count edited', [
      `${user(userId)}’s count **${fmt(guild.current_count)}** was ${kind === 'delete' ? 'deleted' : 'edited'}.`,
      bench ? 'They are benched until the next reset.' : null,
    ], ACCENT.warning);
  }, { essential: true });
}
