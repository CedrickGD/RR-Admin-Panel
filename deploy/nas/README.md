# RazorReaper backend on the UGREEN NAS (W3)

Target: Cloudflare stays the edge (DNS, cache, WAF, Access); the NAS is the origin behind a
**Cloudflare Tunnel** (outbound only — no router port-forwarding, home IP never exposed).

```
api.<domain>    -> rr-api          (Node 22; the Pages Functions + worker code on SQLite)   [W3.5]
media.<domain>  -> caddy           (static files from /volume1/docker/razorreaper/media)          [W3.3]
bot.<domain>    -> razorreaper-bot (Discord bot + notifier SSE)                            [W3.4]
```

Old URLs (`backend.rr-admin-panel.workers.dev`, `rr-admin-panel.pages.dev`) stay alive as thin
proxies for legacy clients. The UGOS admin UI (9999/9443) is **never** mapped into the tunnel.

## One-time prerequisites (owner)

1. Buy a domain (e.g. `razorreaper.de`) and add it to the Cloudflare account `1559784f…`
   (Cloudflare Registrar puts it on Cloudflare automatically).
2. NAS: `ssh <nas-user>@192.168.2.201`; create `/volume1/docker/razorreaper/{src,media,data/db,data/bot,backups}`;
   confirm `docker compose version` (UGOS Pro Docker app) and auto-power-on after outage.
3. Zero Trust -> Networks -> Tunnels -> **Create tunnel** `rr-nas` (cloudflared) -> copy the token into
   `.env` as `TUNNEL_TOKEN`. Public hostnames: `media.<domain>` -> `http://caddy:8080`,
   `bot.<domain>` -> `http://bot:8080`, `api.<domain>` -> `http://rr-api:8787` (add when W3.5 is live).
4. Zone settings: Rules -> Transform Rules -> **Managed Transforms -> "Add visitor location headers" ON**
   (keeps `cf-ipcity/cf-iplatitude/cf-iplongitude/cf-region/cf-timezone` flowing to rr-api);
   Caching -> Cache Rules: hostname `media.<domain>` -> Cache everything, Edge TTL 1 day;
   Security -> WAF -> Rate limiting rule: `api.<domain>` 120 req / 10 s per IP -> block 10 s.

## Deploy / update

```bash
ssh <nas-user>@192.168.2.201
cd /volume1/docker/razorreaper/src
git clone https://github.com/CedrickGD/RR-Admin-Panel.git
git clone https://github.com/CedrickGD/razorreaper-bot.git
cd RR-Admin-Panel/deploy/nas && cp .env.example .env && nano .env      # fill secrets
docker compose up -d --build
docker compose logs -f cloudflared     # expect "Registered tunnel connection"
```

Update: `git -C /volume1/docker/razorreaper/src/RR-Admin-Panel pull && git -C /volume1/docker/razorreaper/src/razorreaper-bot pull && docker compose up -d --build`.

## Media migration (W3.3)

Copy the 75 files (689 MB) from the local master
`Desktop\!!! Main\7. Selling\RazorReaper\Current Files\APP HOSTED FILES DNT` to
`/volume1/docker/razorreaper/media` (scp/rsync or the UGOS file manager), then
`curl -sI https://media.<domain>/images/presets/default.png` -> 200, compare sha256 of all 75
files, then set the worker's `MEDIA_ORIGIN=https://media.<domain>/` and redeploy the worker.

## Backups

`backup` runs nightly at 03:15: `sqlite3 .backup` of the rr-api DB into `/volume1/docker/razorreaper/backups`
(30-day retention). Media is static — copy it once to the HDD pool; optional weekly offsite with rclone -> R2.

## rr-api (W3.5)

`deploy/nas/rr-api/` is a Node 22 service that runs the repo's **unchanged** Pages Functions
(`functions/api/**`, `functions/v1/**`) and the standalone worker (`backend-worker/index.js`) on a
single SQLite file instead of D1/Pages/Workers:

- `src/d1-adapter.ts` — D1 API (`prepare().bind().run()/first()/all()`, `batch()` = one transaction)
  on better-sqlite3; WAL, `busy_timeout=5000`, `foreign_keys=ON`.
- `scripts/generate-routes.mjs` — build-time Pages file-routing table (`src/routes.generated.ts`,
  committed; `npm run routes` regenerates it, a test fails when it is stale).
- `src/app.ts` — Hono: `GET /health` -> `{ ok: true, service: "rr-api" }`; `/api/ingest`,
  `/v1/telemetry/event`, `/api/install/register`, `/api/health`, `/healthz`, `/media/*`, `/update/*`
  go to the worker (`worker.fetch`), everything else through the Pages route table; unknown -> 404.
- `src/cf-request.ts` — rebuilds `request.cf` (country/city/region/lat/lon/timezone/continent/ray)
  from the `cf-*` headers the tunnel forwards; `cf-connecting-ip` is read from the header as before.
- `src/server.ts` — opens `DB_PATH`, listens on `PORT`, runs `worker.scheduled` (expired-license
  cleanup) via node-cron (`CRON_LICENSE_CLEANUP`, default `30 3 * * *`), graceful SIGTERM/SIGINT.

### Environment

Copy `rr-api/.env.example` to `rr-api/.env` (git-ignored) and fill it. Every variable from the
repo README's env table is passed through 1:1; rr-api adds:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | listen port inside the container |
| `DB_PATH` | `/data/db/rr.sqlite` | SQLite file (volume `${DATA_DIR}/db`) |
| `DB_BOOTSTRAP_SCHEMA` | `false` | `true` = run `schema.sql` once when the DB has no tables |
| `SCHEMA_PATH` | `/app/schema.sql` | where `schema.sql` lives in the image |
| `CRON_LICENSE_CLEANUP` | `30 3 * * *` | cron for the nightly license cleanup |
| `RL_INGEST_PER_MINUTE` / `RL_REGISTER_PER_MINUTE` | `60` / `5` | in-process rate limiters that replace the `RL_*` bindings |
| `APP_SHARED_KEY` | – | legacy ingest key for the worker routes (falls back to `INGEST_TOKEN`) |
| `MEDIA_ORIGIN` | `https://media.razorreaper.app` | `/media/*` upstream (legacy route) |
| `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH` / `UPDATE_ASSET_NAME` | worker defaults | `/update/*` proxy |

`STORAGE_BACKEND` is forced to `d1` (SQLite is authoritative; there is no KV).

### Database

Import the D1 export once (the export already contains the `CREATE TABLE` statements, so leave
`DB_BOOTSTRAP_SCHEMA=false`):

```bash
# on the workstation
npx wrangler d1 export rr-admin-panel --remote --output d1-export.sql
scp d1-export.sql <nas-user>@192.168.2.201:/volume1/docker/razorreaper/
# on the NAS (container stopped; the volume dir must be writable by uid 1000 = `node`)
sudo chown -R 1000:1000 /volume1/docker/razorreaper/data/db
sqlite3 /volume1/docker/razorreaper/data/db/rr.sqlite < /volume1/docker/razorreaper/d1-export.sql
sqlite3 /volume1/docker/razorreaper/data/db/rr.sqlite "PRAGMA journal_mode=WAL;"
```

A fresh install without history: set `DB_BOOTSTRAP_SCHEMA=true` for the first start instead. The
handlers' `ensure*` helpers still add newer columns idempotently on first use either way.

rr-api opens the file in WAL mode (`rr.sqlite-wal` / `rr.sqlite-shm` appear next to it — back up
with `sqlite3 .backup`, never by copying the three files while the service runs; the `backup`
container already does this nightly).

### Build, run, verify

```bash
cd /volume1/docker/razorreaper/src/RR-Admin-Panel/deploy/nas
cp rr-api/.env.example rr-api/.env && nano rr-api/.env
docker compose up -d --build rr-api
docker compose logs -f rr-api          # expect: [rr-api] listening {"port":8787,"pagesRoutes":47,...}
docker compose exec rr-api wget -qO- http://127.0.0.1:8787/health
```

Then add the tunnel public hostname `api.<domain>` -> `http://rr-api:8787`, put a Cloudflare
Access policy in front of `api.<domain>/api/admin/*` (same `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`
values go into `.env`), and keep the "Add visitor location headers" transform on so geo
telemetry keeps flowing. The old `backend.*.workers.dev` and `*.pages.dev` URLs become thin
proxies to `api.<domain>` for legacy clients (W3.6).

Local development: `cd deploy/nas/rr-api && npm ci && npm run build && DB_PATH=./rr.sqlite DB_BOOTSTRAP_SCHEMA=true npm start`
(the repo root's `npm test` / `npm run typecheck` cover `tests/rr-api/**` and `deploy/nas/rr-api/src/**`;
run `npm ci` inside `deploy/nas/rr-api` once so better-sqlite3 is available to vitest).
