import { setTimeout as sleep } from 'node:timers/promises';
import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { errorDetails, logger } from './logger.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const MAX_PENDING = 32;
const MAX_SNAPSHOTS = 64;

export function canReadDeleteAudit(guild) {
  return Boolean(guild?.available !== false &&
    guild?.members?.me?.permissions?.has(PermissionFlagsBits.ViewAuditLog));
}

/**
 * Discord records moderator deletes by author and channel, without the
 * message ID. Existing entries can grow in place. Ambiguous checks abstain.
 */
export class DeleteAudit {
  constructor({ settleMs = 3_000 } = {}) {
    this.settleMs = settleMs;
    this.pending = new Set();
    this.snapshots = new Map();
  }

  async likelySelfDelete(guild, { authorId, channelId, messageCreatedAt }) {
    if (!canReadDeleteAudit(guild) || this.pending.has(guild.id) || this.pending.size >= MAX_PENDING) return false;
    this.pending.add(guild.id);
    const previous = this.snapshots.get(guild.id);
    try {
      // Give the moderation log time to catch up with the message event.
      await sleep(this.settleMs);
      if (!canReadDeleteAudit(guild)) return false;

      const entries = [];
      let before;
      let complete = false;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: PAGE_SIZE, before });
        entries.push(...page.entries.values());
        if (page.entries.size < PAGE_SIZE) {
          complete = true;
          break;
        }
        before = page.entries.lastKey();
      }
      if (!complete || !canReadDeleteAudit(guild)) return false;
      this.snapshots.delete(guild.id);
      this.snapshots.set(guild.id, {
        checkedAt: Date.now(),
        counts: new Map(entries.map((entry) => [entry.id, entry.extra?.count])),
      });
      if (this.snapshots.size > MAX_SNAPSHOTS) this.snapshots.delete(this.snapshots.keys().next().value);

      return entries.every((entry) => {
        if (entry.targetId !== authorId) return true;
        const targetChannel = entry.extra?.channel?.id;
        if (targetChannel && targetChannel !== channelId) return true;
        if (!targetChannel || !(entry.createdTimestamp < messageCreatedAt)) return false;

        const count = entry.extra.count;
        // A single deletion predating this message cannot be this one.
        // For aggregates, require an unchanged count from before the message.
        return count === 1 || (Number.isInteger(count) && count > 1 &&
          previous?.checkedAt < messageCreatedAt && previous.counts.get(entry.id) === count);
      });
    } catch (err) {
      logger.debug({ guildId: guild.id, error: errorDetails(err) }, 'could not check count deletion audit log');
      return false;
    } finally {
      this.pending.delete(guild.id);
    }
  }
}
