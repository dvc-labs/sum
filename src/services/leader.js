import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

/**
 * Makes sure only ONE running container plays the game at a time.
 *
 * Coolify rolling updates start the new container before stopping the old one,
 * so for a short while two copies of Sum are connected to Discord. Both would
 * react to every count. The newest container claims leadership on boot; the
 * old one sees it lost the lock and ignores all events until it is stopped.
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
    this.get = db.prepare('SELECT * FROM instance_lock WHERE id = 1');
    this.claimStmt = db.prepare(
      `INSERT INTO instance_lock (id, owner, started_at, heartbeat_at) VALUES (1, @owner, @now, @now)
       ON CONFLICT(id) DO UPDATE SET owner = @owner, started_at = @now, heartbeat_at = @now`,
    );
    this.beat = db.prepare('UPDATE instance_lock SET heartbeat_at = ? WHERE id = 1 AND owner = ?');
    this.release = db.prepare('DELETE FROM instance_lock WHERE id = 1 AND owner = ?');
  }

  /** Newest instance wins: called once on boot. */
  claim(now = Date.now()) {
    this.claimStmt.run({ owner: this.id, now });
    this.setLeader(true);
  }

  tick(now = Date.now()) {
    const row = this.get.get();
    if (row?.owner === this.id) {
      this.beat.run(now, this.id);
      this.setLeader(true);
    } else if (!row || now - row.heartbeat_at > this.staleMs) {
      this.claimStmt.run({ owner: this.id, now });
      this.setLeader(true);
    } else {
      this.setLeader(false);
    }
    return this.leader;
  }

  setLeader(value) {
    if (value !== this.leader) {
      logger.info({ instance: this.id }, value ? 'this instance is now the leader' : 'another instance took over — standing by');
    }
    this.leader = value;
  }

  isLeader() {
    return this.leader;
  }

  start() {
    this.claim();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        logger.warn({ err: err.message }, 'leader heartbeat failed');
      }
    }, this.heartbeatMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    try {
      this.release.run(this.id);
    } catch {
      /* db may already be closed */
    }
    this.leader = false;
  }
}
