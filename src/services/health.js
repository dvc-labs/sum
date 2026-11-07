import http from 'node:http';
import { logger } from './logger.js';

/**
 * Tiny health endpoint for Coolify / Docker HEALTHCHECK.
 * GET /healthz → 200 "ok" when the gateway is ready and the DB answers, else 503.
 * Binds to 0.0.0.0 inside the container; do NOT publish this port publicly.
 */
export function startHealthServer({ port, gatewayReady, db, leader }) {
  const probe = db.prepare('SELECT 1 AS ok');
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || (req.url !== '/healthz' && req.url !== '/readyz')) {
      res.writeHead(404).end();
      return;
    }
    let dbOk = false;
    let active = false;
    try {
      dbOk = probe.get().ok === 1;
      active = dbOk && leader.isLeader();
    } catch {
      dbOk = false;
    }
    const gatewayOk = gatewayReady();
    const ok = dbOk && gatewayOk && (req.url === '/healthz' || active);
    res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain' });
    const role = active ? 'leader' : 'standby';
    res.end(ok ? `ok ${role}` : `unhealthy db=${dbOk} gateway=${gatewayOk} ${role}`);
  });
  server.listen(port, '0.0.0.0', () => logger.info({ port }, 'health server listening'));
  return server;
}
