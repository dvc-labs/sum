import { PermissionFlagsBits } from 'discord.js';
import { writeIfLeader } from '../services/leader.js';
import { reportError } from '../services/errors.js';
import { errorDetails, logger } from '../services/logger.js';
import { ACCENT, card, fmt, v2 } from '../ui/kit.js';
import { compareMessageIds, cursorAt } from './cursor.js';
import { recordCountAttempt } from './engine.js';
import { isPlayerMessage } from './handler.js';
import { parseCount } from './parser.js';
import { KeyedQueue } from './queue.js';

const HISTORY_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
const HISTORY_LANES = 4;
const FAILURE_NOTICE_COOLDOWN_MS = 30 * 60_000;

async function readMissedMessages(channel, cursor, maxMessages, signal) {
  const messages = [];
  let before;
  let newest;
  while (!signal.aborted) {
    // Read backwards to verify we have the whole gap before applying any of it.
    const limit = Math.min(100, maxMessages + 1 - messages.length);
    const page = await channel.messages.fetch({ before, limit, cache: false });
    if (signal.aborted) return;
    const ordered = [...page.values()].sort((a, b) => compareMessageIds(b.id, a.id));
    if (before && ordered.length && compareMessageIds(ordered[0].id, before) >= 0) {
      throw new Error('Discord history pagination did not advance');
    }
    newest ??= ordered[0]?.id;
    for (const message of ordered) {
      if (compareMessageIds(message.id, cursor) <= 0) return { messages: messages.reverse(), newest };
      messages.push(message);
      if (messages.length > maxMessages) return { skipped: 'limit', newest };
    }
    if (ordered.length < limit) return { messages: messages.reverse(), newest };
    before = ordered.at(-1).id;
  }
}

async function readWithDeadline(read, timeoutMs, progress) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          // A read that never got a history lane attempted nothing, so it cannot have failed.
          resolve({ skipped: progress.started ? 'timeout' : 'busy' });
        }, timeoutMs);
      }),
    ]);
  } catch (err) {
    return { skipped: 'read failed', error: errorDetails(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Schedules recovery ahead of live game events in each guild's state queue. */
export class CountCatchUp {
  constructor(app, { maxMessages = 500, timeoutMs = 10_000, noticeCooldownMs = FAILURE_NOTICE_COOLDOWN_MS } = {}) {
    this.app = app;
    this.maxMessages = maxMessages;
    this.timeoutMs = timeoutMs;
    this.noticeCooldownMs = noticeCooldownMs;
    this.failureNotices = new Map();
    this.pending = new Map();
    this.historyReads = new KeyedQueue();
    this.nextLane = 0;
  }

  runConfigured(shardId) {
    const { client, store } = this.app;
    for (const id of store.countingGuildIds()) {
      const guild = client.guilds.cache.get(id);
      if (shardId === undefined || guild?.shardId === shardId) {
        this.run(guild, { freshConnection: shardId !== undefined });
      }
    }
  }

  run(guild, { freshConnection = false } = {}) {
    if (!guild || guild.available === false) return;
    const { id } = guild;
    const generation = this.app.leader?.generation;
    const pending = this.pending.get(id);
    // A fresh session can have a new gap even while an older read is in progress.
    if (!freshConnection && pending && pending.generation === generation) return pending.task;
    const task = this.app.queue.run(id, () => this.recover(guild, generation))
      .catch((err) => reportError(err, { where: 'count catch-up', guildId: id }))
      .finally(() => {
        if (this.pending.get(id)?.task === task) this.pending.delete(id);
      });
    this.pending.set(id, { generation, task });
    return task;
  }

  async recover(discordGuild, generation) {
    const app = this.app;
    const { store, leader } = app;
    const { id } = discordGuild;
    if (leader && (leader.generation !== generation || !leader.isLeader())) return;

    const saved = store.getGuild(id);
    if (!saved?.count_channel_id || saved.left_at) return;
    const channel = discordGuild.channels.cache.get(saved.count_channel_id);
    if (!saved.count_cursor) {
      // A migrated database has no trustworthy boundary for older messages.
      writeIfLeader(app, () => store.advanceCountCursor(id, cursorAt(Date.now())));
      return;
    }
    const bot = discordGuild.members.me;
    if (!channel?.messages || !bot || !channel.permissionsFor(bot)?.has(HISTORY_PERMISSIONS)) return;

    const lane = this.nextLane;
    this.nextLane = (lane + 1) % HISTORY_LANES;
    const progress = { started: false };
    const history = await readWithDeadline((signal) => this.historyReads.run(lane, () => {
      if (leader && (leader.generation !== generation || !leader.isLeader())) return {};
      progress.started = true;
      return readMissedMessages(channel, saved.count_cursor, this.maxMessages, signal);
    }), this.timeoutMs, progress);
    if (history.skipped === 'busy') {
      // Other servers held every lane for the whole window. Nothing was read, so don't claim a failure.
      logger.warn({ guildId: id }, 'count catch-up skipped — history reads were busy');
      return;
    }
    const applied = writeIfLeader(app, () => {
      if (leader?.generation !== generation || !channel.permissionsFor(bot)?.has(HISTORY_PERMISSIONS)) return;
      let guild = store.getGuild(id);
      if (!guild || guild.left_at || guild.created_at !== saved.created_at ||
          guild.count_channel_id !== saved.count_channel_id || guild.count_cursor !== saved.count_cursor) return;

      let attempts = 0;
      for (const message of history.messages ?? []) {
        if (!isPlayerMessage(message)) continue;
        const parsed = parseCount(message.content, { allowMath: Boolean(guild.math_enabled) });
        const result = recordCountAttempt(store, guild, {
          parsed, userId: message.author.id, messageId: message.id, now: message.createdTimestamp ?? undefined,
        });
        if (!result) continue;
        guild = result.updated;
        attempts++;
      }
      if (history.newest) store.advanceCountCursor(id, history.newest);
      return { attempts };
    });
    if (!applied) return;

    if (history.skipped) {
      logger.warn({ guildId: id, reason: history.skipped, error: history.error }, 'count catch-up skipped');
    } else if (applied.attempts) {
      logger.info({ guildId: id, attempts: applied.attempts }, 'count history recovered');
    } else {
      return;
    }
    this.announce(channel, saved, history.skipped, applied.attempts, generation);
  }

  announce(channel, saved, skipped, attempts, generation) {
    const { effects, store, leader } = this.app;
    const id = saved.guild_id;
    if (skipped && skipped !== 'limit') {
      // A failing API can end sessions repeatedly. One warning per window is enough.
      // An oversized gap moves the cursor, so each of those is new information.
      const now = Date.now();
      if (now - (this.failureNotices.get(id) ?? 0) < this.noticeCooldownMs) return;
      this.failureNotices.set(id, now);
    }
    effects.run(id, async () => {
      if (leader && (leader.generation !== generation || !leader.isLeader())) return;
      const guild = store.getGuild(id);
      if (!guild || guild.left_at || guild.created_at !== saved.created_at || guild.count_channel_id !== channel.id) return;

      let detail = `Sum caught up on **${fmt(attempts)}** count attempt${attempts === 1 ? '' : 's'}.`;
      if (skipped === 'limit') detail = `Sum skipped the backlog because it exceeded **${fmt(this.maxMessages)}** channel messages.`;
      else if (skipped) detail = 'Sum couldn’t read the full backlog. Counting can continue from the saved state.';
      await channel.send(v2([card({
        title: skipped ? '⚠️ Counting catch-up skipped' : '🔄 Counting caught up',
        body: `${detail}\nNext number is **${fmt(guild.current_count + 1)}**.`,
        accent: skipped ? ACCENT.warning : ACCENT.brand,
      })]));
    }, { essential: true })?.catch((err) => reportError(err, { where: 'count catch-up notice', guildId: id }));
  }
}
