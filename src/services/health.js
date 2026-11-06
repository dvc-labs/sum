import http from 'node:http';
import { logger } from './logger.js';

/**
 * Tiny health endpoint for Coolify / Docker HEALTHCHECK.
 * GET /healthz → 200 "ok" when the gateway is ready and the DB answers, else 503.
 * Binds to 0.0.0.0 inside the container; do NOT publish this port publicly.
 */
export function startHealthServer({ port, client, db }) {
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
    res.end(ok ? 'ok' : `unhealthy db=${dbOk} gateway=${gatewayOk}`);
  });
  server.listen(port, '0.0.0.0', () => logger.info({ port }, 'health server listening'));
  return server;
}
