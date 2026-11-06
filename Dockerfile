# syntax=docker/dockerfile:1

# ── Build stage: install production deps (compiles better-sqlite3 if no prebuild) ──
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Runtime stage ──
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HEALTH_PORT=3000
WORKDIR /app

# /data must exist and belong to the unprivileged "node" user (uid 1000) so a
# fresh Docker named volume inherits that ownership on first mount.
RUN mkdir -p /data && chown node:node /data && chmod 700 /data

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "src/index.js"]
