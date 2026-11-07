/**
 * Per-key serial queue. Messages for the same server are processed strictly
 * one after another, so two people posting "43" at the same moment can never
 * both be accepted. Different servers still run concurrently.
 */
export class KeyedQueue {
  constructor({ maxPerKey = Infinity, maxTotal = Infinity } = {}) {
    this.tails = new Map();
    this.maxPerKey = maxPerKey;
    this.maxTotal = maxTotal;
    this.pending = 0;
  }

  run(key, task, { essential = false } = {}) {
    const entry = this.tails.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    if (!essential && (entry.pending >= this.maxPerKey || this.pending >= this.maxTotal)) return undefined;

    entry.pending++;
    this.pending++;
    const next = entry.tail.then(task);
    const tail = next.catch(() => {});
    entry.tail = tail;
    this.tails.set(key, entry);
    tail.then(() => {
      this.pending--;
      if (--entry.pending === 0) this.tails.delete(key);
    });
    return next;
  }

  /** Resolves when every queued task has settled (used on shutdown). */
  async drain() {
    await Promise.allSettled([...this.tails.values()].map(({ tail }) => tail));
  }
}
