# rr-api — the RazorReaper backend (Pages Functions + standalone worker code) on Node 22 + SQLite.
# Build context = repository root:
#   docker build -f deploy/nas/rr-api/Dockerfile -t rr-api .
# (compose.yml does exactly that.) The bundle only externalises better-sqlite3; everything else
# (hono, node-cron, the repo's functions/ + shared/ + backend-worker/ code) is inlined by esbuild.

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# better-sqlite3 ships prebuilt binaries for Node 22 on linux-x64/arm64 (glibc); prebuild-install
# downloads them during `npm ci`, so no toolchain is needed. If a future Node/OS combination has
# no prebuild, uncomment the next line so node-gyp can compile it from source.
# RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

# Only the pieces the bundle imports; keeps the layer cache stable when the dashboard UI changes.
COPY functions ./functions
COPY shared ./shared
COPY backend-worker ./backend-worker
COPY schema.sql ./schema.sql
COPY deploy/nas/rr-api/package.json deploy/nas/rr-api/package-lock.json ./deploy/nas/rr-api/
RUN cd deploy/nas/rr-api && npm ci --no-audit --no-fund
COPY deploy/nas/rr-api/scripts ./deploy/nas/rr-api/scripts
COPY deploy/nas/rr-api/src ./deploy/nas/rr-api/src
RUN cd deploy/nas/rr-api && npm run build && npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/db/rr.sqlite \
    SCHEMA_PATH=/app/schema.sql
WORKDIR /app

# wget only for the container HEALTHCHECK (the slim image ships neither wget nor curl).
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/db \
 && chown -R node:node /data /app

COPY --from=build --chown=node:node /repo/deploy/nas/rr-api/dist ./dist
COPY --from=build --chown=node:node /repo/deploy/nas/rr-api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/deploy/nas/rr-api/package.json ./package.json
COPY --from=build --chown=node:node /repo/schema.sql ./schema.sql

USER node
EXPOSE 8787
VOLUME ["/data/db"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/server.mjs"]
