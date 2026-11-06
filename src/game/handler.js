import { PermissionFlagsBits } from 'discord.js';
import { parseCount } from './parser.js';
import { applyOutcome, evaluate } from './engine.js';
import { v2, ACCENT, fmt, user } from '../ui/kit.js';
import {
  milestoneCard,
  recordCard,
  ruinedCard,
  saveEarnedCard,
  savedCard,
  tamperCard,
} from '../ui/cards.js';
import { logEvent, warnOwner } from '../services/notify.js';
import { assignRuinedRole } from '../services/roles.js';
import { isPermissionError, reportError } from '../services/errors.js';

const EMOJI = {
  ok: '✅',
  beyondRecord: '☑️',
  hundred: '💯',
  thousand: '🎉',
  wrong: '❌',
  saved: '🛟',
  benched: '⛔',
};

/** Returns the guild row if this message belongs to an active counting channel. */
function countingGuild(store, message) {
  if (!message.guildId) return null;
  const row = store.getGuild(message.guildId);
  if (!row || row.left_at || row.count_channel_id !== message.channelId) return null;
  return row;
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
      await logEvent(app.client, guildRow, '⚠️ Missing permissions', lines, ACCENT.warning);
      await warnOwner(app.client, app.store, app.store.getGuild(guildRow.guild_id), 'Sum is missing permissions', lines);
    } else if (err?.code !== 10008) {
      // 10008 = Unknown Message (already deleted) — harmless.
      reportError(err, { where: what, guildId: guildRow.guild_id });
    }
    return null;
  }
}

function canManageMessages(message) {
  return message.channel.permissionsFor(message.guild.members.me)?.has(PermissionFlagsBits.ManageMessages);
}

/* ───────────────────────────── New messages ───────────────────────────── */

export function onMessageCreate(app, message) {
  if (message.author?.bot || message.system || message.webhookId) return;
  const row = countingGuild(app.store, message);
  if (!row) return;
  return app.queue.run(row.guild_id, () => processCount(app, message));
}

async function processCount(app, message) {
  const { store, client } = app;
  const guild = store.getGuild(message.guildId); // fresh read inside the queue
  if (!guild || guild.count_channel_id !== message.channelId) return;

  const parsed = parseCount(message.content, { allowMath: Boolean(guild.math_enabled) });
  if (!parsed.attempt) {
    if (guild.strict_mode && canManageMessages(message)) {
      await safely(app, guild, 'delete a non-count message', () => message.delete());
    }
    return;
  }

  const disqualified = Boolean(guild.rule_edit_delete) && store.isDisqualified(guild.guild_id, message.author.id, guild.run_id);
  const outcome = evaluate(guild, { userId: message.author.id, parsed, disqualified });
  const updated = applyOutcome(store, guild, {
    userId: message.author.id,
    messageId: message.id,
    outcome,
  });
  const send = (container, what = 'send a message') =>
    safely(app, updated, what, () => message.channel.send(v2([container])));
  const react = (emoji) => safely(app, updated, 'add reactions', () => message.react(emoji));

  switch (outcome.type) {
    case 'disqualified':
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
        `${user(message.author.id)} ${outcome.reason === 'double' ? 'counted twice in a row' : `typed \`${outcome.text}\` (expected ${fmt(outcome.expected)})`}.`,
        `Saves left: **${outcome.savesLeft}**.`,
      ], ACCENT.warning);
      return;

    case 'ruined':
      await react(EMOJI.wrong);
      await send(ruinedCard(outcome, message.author.id, updated));
      await logEvent(client, updated, '💥 Run ruined', [
        `${user(message.author.id)} ended the run at **${fmt(outcome.ruinedAt)}**.`,
        outcome.reason === 'double'
          ? 'Reason: counted twice in a row.'
          : `Reason: typed \`${outcome.text}\`, expected **${fmt(outcome.expected)}**.`,
        `[Jump to message](${message.url})`,
      ], ACCENT.danger);
      await assignRuinedRole(client, store, updated, message.author.id);
      return;

    default:
  }
}

/* ─────────────────────── Deleted & edited counts ─────────────────────── */

export function onMessageDelete(app, message) {
  const row = countingGuild(app.store, message);
  if (!row || row.last_message_id !== message.id) return;
  return app.queue.run(row.guild_id, () => handleTamper(app, message, 'delete', true));
}

export function onMessageDeleteBulk(app, messages, channel) {
  const row = app.store.getGuild(channel.guildId);
  if (!row || row.left_at || row.count_channel_id !== channel.id) return;
  if (!row.last_message_id || !messages.has(row.last_message_id)) return;
  // A bulk delete is a moderator purge — repost the count, but don't bench anyone.
  const msg = messages.get(row.last_message_id);
  return app.queue.run(row.guild_id, () => handleTamper(app, msg, 'delete', false));
}

export async function onMessageUpdate(app, _old, updatedMessage) {
  const row = countingGuild(app.store, updatedMessage);
  if (!row || row.last_message_id !== updatedMessage.id) return;
  let msg = updatedMessage;
  if (msg.partial) {
    msg = await msg.fetch().catch(() => null);
    if (!msg) return;
  }
  const parsed = parseCount(msg.content, { allowMath: Boolean(row.math_enabled) });
  if (parsed.attempt && parsed.value === row.current_count) return; // cosmetic edit, number unchanged
  return app.queue.run(row.guild_id, () => handleTamper(app, msg, 'edit', true));
}

async function handleTamper(app, message, kind, mayBench) {
  const { store, client } = app;
  const guild = store.getGuild(message.guildId);
  if (!guild || guild.last_message_id !== message.id) return; // already handled / run moved on
  const userId = guild.last_user_id;
  const bench = mayBench && Boolean(guild.rule_edit_delete) && Boolean(userId);

  store.transaction(() => {
    store.updateGuild(guild.guild_id, { last_message_id: null });
    if (bench) store.disqualify(guild.guild_id, userId, guild.run_id, kind);
  });

  const channel = client.channels.cache.get(guild.count_channel_id);
  if (channel?.isTextBased()) {
    await safely(app, guild, 'send a message', () =>
      channel.send(v2([tamperCard(kind, userId, guild.current_count, bench)])),
    );
  }
  await logEvent(client, guild, kind === 'delete' ? '🕵️ Count deleted' : '🕵️ Count edited', [
    `${user(userId)}’s count **${fmt(guild.current_count)}** was ${kind === 'delete' ? 'deleted' : 'edited'}.`,
    bench ? 'They are benched until the next reset.' : mayBench ? null : 'Bulk delete — nobody benched.',
  ], ACCENT.warning);
}
