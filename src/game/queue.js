/**
 * Per-key serial queue. Messages for the same server are processed strictly
 * one after another, so two people posting "43" at the same moment can never
 * both be accepted. Different servers still run concurrently.
 */
export class KeyedQueue {
  constructor() {
    this.tails = new Map();
  }

  run(key, task) {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  /** Resolves when every queued task has settled (used on shutdown). */
  async drain() {
    await Promise.allSettled([...this.tails.values()]);
  }
}
