import { errorDetails, logger } from '../services/logger.js';

/**
 * Sum's custom emoji. These are application emojis (Developer Portal → Emojis),
 * which any server can see without "Use External Emojis". IDs are public, so
 * they live in code. Every emoji has a unicode fallback that is used when the
 * custom one is missing, so a deleted emoji never breaks the game.
 */
export const EMOJI = Object.freeze({
  sum: Object.freeze({ name: 'sum', id: '1568437256291745853', fallback: '🔢' }),
  dvc: Object.freeze({ name: 'dvc', id: '1568437714716463184', fallback: '🧡' }),
  checkmark: Object.freeze({ name: 'checkmark', id: '1568438566550511626', fallback: '✅' }),
  crossmark: Object.freeze({ name: 'crossmark', id: '1568438577644183603', fallback: '❌' }),
});

/** Keys of emoji that must NOT be used as custom (missing/deleted). Optimistic by default. */
const disabled = new Set();

function def(key) {
  const d = EMOJI[key];
  if (!d) throw new Error(`Unknown emoji key: ${key}`);
  return d;
}

export const isCustom = (key) => !disabled.has(key);

/** For message text and Components v2 text displays. */
export function e(key) {
  const d = def(key);
  return isCustom(key) ? `<:${d.name}:${d.id}>` : d.fallback;
}

/** For button / select-menu option emoji (`setEmoji`). Unicode strings pass through unchanged. */
export function btn(key) {
  const d = def(key);
  return isCustom(key) ? { id: d.id, name: d.name } : d.fallback;
}

/** For `message.react()`. */
export function reactionId(key) {
  const d = def(key);
  return isCustom(key) ? `${d.name}:${d.id}` : d.fallback;
}

/**
 * Reacts with a custom emoji. If Discord says the emoji doesn't exist (10014),
 * switch that emoji to its unicode fallback for the rest of the process and retry once.
 */
export async function reactWith(message, key) {
  try {
    return await message.react(reactionId(key));
  } catch (err) {
    if (err?.code === 10014 && isCustom(key)) {
      disable(key, 'Discord reported Unknown Emoji on reaction');
      return message.react(def(key).fallback);
    }
    throw err;
  }
}

export function disable(key, why) {
  if (disabled.has(key)) return;
  disabled.add(key);
  logger.warn({ emoji: key, id: def(key).id, why }, 'custom emoji disabled — using unicode fallback');
}

/** Test helper: back to the optimistic default. */
export function resetEmojiState() {
  disabled.clear();
}

/**
 * Startup check: is each emoji an application emoji of this bot?
 *  - application emoji  → fine everywhere, no permission needed
 *  - only a server emoji → works, but external servers need "Use External Emojis"; warn
 *  - nowhere             → fall back to unicode
 * If the lookup itself fails (network), stay optimistic.
 * @returns {Record<string, 'app' | 'guild' | 'missing' | 'unknown'>}
 */
export async function detectEmoji(client) {
  const result = {};
  let app;
  try {
    app = await client.application.emojis.fetch();
  } catch (err) {
    logger.warn({ error: errorDetails(err) }, 'could not list application emojis — assuming custom emoji are available');
    for (const key of Object.keys(EMOJI)) result[key] = 'unknown';
    return result;
  }
  for (const [key, d] of Object.entries(EMOJI)) {
    if (app.has(d.id)) result[key] = 'app';
    else if (client.emojis.cache.has(d.id)) {
      result[key] = 'guild';
      logger.warn(
        { emoji: key },
        'emoji is a server emoji, not an application emoji — other servers need "Use External Emojis"; re-upload it under Developer Portal → Emojis',
      );
    } else {
      result[key] = 'missing';
      disable(key, 'not found among application emojis');
    }
  }
  logger.info({ emoji: result }, 'custom emoji check complete');
  return result;
}
