const DISCORD_EPOCH = 1_420_070_400_000;

/** A starting cursor for a channel that has just been configured. */
export function cursorAt(now) {
  return String(BigInt(Math.max(0, now - DISCORD_EPOCH)) << 22n);
}

/** Compare decimal Snowflakes without converting them to JS numbers. */
export function compareMessageIds(left, right) {
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}
