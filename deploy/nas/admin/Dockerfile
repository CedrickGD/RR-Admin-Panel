# NAS-hosted admin SPA. The build context is the repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY public ./public
COPY src ./src
COPY shared ./shared
COPY vite.config.ts ./vite.config.ts
RUN npx vite build

FROM caddy:2-alpine AS runtime
COPY deploy/nas/admin/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/dist /srv/admin

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
