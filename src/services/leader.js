import { randomUUID } from 'node:crypto';
import { errorDetails, logger } from './logger.js';

/**
 * Makes sure only ONE running container plays the game at a time.
 *
 * Coolify rolling updates start the new container before stopping the old one,
 * so for a short while two copies of Sum are connected to Discord. Both would
 * react to every count. The replacement claims the lock when its gateway is
 * ready. All game writes check the lock within the SQLite write transaction.
 * If the leader dies (crash, failed deploy), its heartbeat goes stale and the
 * remaining instance takes over automatically.
 */
export class Leader {
  constructor(db, { heartbeatMs = 3_000, staleMs = 15_000, id = randomUUID() } = {}) {
    this.db = db;
    this.id = id;
    this.heartbeatMs = heartbeatMs;
    this.staleMs = staleMs;
    this.leader = false;
    this.timer = null;
    this.gatewayReady = () => true;
    this.onAcquire = null;
    this.get = db.prepare('SELECT * FROM instance_lock WHERE id = 1');
    this.claimStmt = db.prepare(
      `INSERT INTO instance_lock (id, owner, started_at, heartbeat_at) VALUES (1, @owner, @now, @now)
       ON CONFLICT(id) DO UPDATE SET owner = @owner, started_at = @now, heartbeat_at = @now`,
    );
    this.claimStale = db.prepare(
      `INSERT INTO instance_lock (id, owner, started_at, heartbeat_at) VALUES (1, @owner, @now, @now)
       ON CONFLICT(id) DO UPDATE SET owner = @owner, started_at = @now, heartbeat_at = @now
       WHERE instance_lock.heartbeat_at < @cutoff`,
    );
    this.beat = db.prepare('UPDATE instance_lock SET heartbeat_at = ? WHERE id = 1 AND owner = ?');
    this.release = db.prepare('DELETE FROM instance_lock WHERE id = 1 AND owner = ?');
  }

  /** The new container takes over once its Discord gateway is ready. */
  claim(now = Date.now()) {
    if (!this.gatewayReady()) return false;
    this.claimStmt.run({ owner: this.id, now });
    this.setLeader(true);
    return true;
  }

  tick(now = Date.now()) {
    // Keep ownership during a short resume so replayed gateway events can be
    // processed. Without a heartbeat a ready standby can still take over.
    if (!this.gatewayReady()) return false;
    const owned = this.beat.run(now, this.id).changes === 1;
    const acquired = owned || this.claimStale.run({ owner: this.id, now, cutoff: now - this.staleMs }).changes === 1;
    this.setLeader(acquired);
    return this.leader;
  }

  setLeader(value) {
    if (value !== this.leader) {
      logger.info({ instance: this.id }, value ? 'this instance is now the leader' : 'another instance took over — standing by');
      this.leader = value;
      if (value) this.onAcquire?.();
    }
  }

  isLeader() {
    return this.leader && this.get.get()?.owner === this.id;
  }

  write(task) {
    if (!this.leader) return undefined;
    return this.db.transaction(() => (this.isLeader() ? task() : undefined)).immediate();
  }

  start(gatewayReady, onAcquire) {
    this.gatewayReady = gatewayReady;
    this.onAcquire = onAcquire;
    this.claim();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        logger.warn({ error: errorDetails(err) }, 'leader heartbeat failed');
      }
    }, this.heartbeatMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    try {
      this.release.run(this.id);
    } catch {
      /* db may already be closed */
    }
    this.leader = false;
  }
}

/** Runs a synchronous database mutation while this process owns the writer lease. */
export function writeIfLeader(app, task) {
  return app.leader ? app.leader.write(task) : app.store.transaction(task);
}
