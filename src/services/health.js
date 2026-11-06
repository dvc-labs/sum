import http from 'node:http';
import { logger } from './logger.js';

/**
 * Tiny health endpoint for Coolify / Docker HEALTHCHECK.
 * GET /healthz → 200 "ok" when the gateway is ready and the DB answers, else 503.
 * Binds to 0.0.0.0 inside the container; do NOT publish this port publicly.
 */
export function startHealthServer({ port, client, db, leader }) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || (req.url !== '/healthz' && req.url !== '/readyz')) {
      res.writeHead(404).end();
      return;
    }
    let dbOk = false;
    try {
      dbOk = db.prepare('SELECT 1 AS ok').get().ok === 1;
    } catch {
      dbOk = false;
    }
    const gatewayOk = client.isReady();
    const ok = dbOk && gatewayOk;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain' });
    // A standby instance is still healthy: it is ready to take over if the leader dies.
    const role = leader?.isLeader() ? 'leader' : 'standby';
    res.end(ok ? `ok ${role}` : `unhealthy db=${dbOk} gateway=${gatewayOk} ${role}`);
  });
  server.listen(port, '0.0.0.0', () => logger.info({ port }, 'health server listening'));
  return server;
}
