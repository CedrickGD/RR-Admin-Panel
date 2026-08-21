# RazorReaper backend on the UGREEN NAS (W3)

> **Cut-over executed 2026-08-21 (evening):** rr-api on the NAS is authoritative; the worker and Pages run in proxy mode (`ORIGIN_BASE=https://origin.razorreaper.app`).

Target: Cloudflare stays the edge (DNS, cache, WAF, Access); the NAS is the origin behind a
**Cloudflare Tunnel** (outbound only — no router port-forwarding, home IP never exposed).

```
api.<domain>    -> rr-api          (Node 22; the Pages Functions + worker code on SQLite)   [W3.5]
origin.<domain> -> rr-api          (same container; upstream of the worker/Pages proxy shells,
                                    key-gated via ORIGIN_KEY, not WAF-rate-limited)         [W3.7]
media.<domain>  -> caddy           (static files from /volume1/docker/razorreaper/media)          [W3.3]
bot.<domain>    -> razorreaper-bot (Discord bot + notifier SSE)                            [W3.4]
```

Old URLs (`backend.rr-admin-panel.workers.dev`, `rr-admin-panel.pages.dev`) stay alive as thin
proxies for legacy clients: in proxy mode (`ORIGIN_BASE` + `ORIGIN_KEY`, see
`docs/superpowers/specs/2026-08-21-proxy-shells.md`) they forward `/api/*` + `/v1/*` to
`origin.<domain>` and return rr-api's answer. The UGOS admin UI (9999/9443) is **never** mapped
into the tunnel.

## One-time prerequisites (owner)

1. Buy a domain (e.g. `razorreaper.de`) and add it to the Cloudflare account `1559784f…`
   (Cloudflare Registrar puts it on Cloudflare automatically).
2. NAS: `ssh <nas-user>@192.168.2.201`; create `/volume1/docker/razorreaper/{src,media,data/db,data/bot,backups}`;
   confirm `docker compose version` (UGOS Pro Docker app) and auto-power-on after outage.
3. Zero Trust -> Networks -> Tunnels -> **Create tunnel** `rr-nas` (cloudflared) -> copy the token into
   `.env` as `TUNNEL_TOKEN`. Public hostnames: `media.<domain>` -> `http://caddy:8080`,
   `bot.<domain>` -> `http://bot:8080`, `api.<domain>` -> `http://rr-api:8787` (add when W3.5 is live),
   `origin.<domain>` -> `http://rr-api:8787` (W3.7; worker/Pages subrequests come from Cloudflare
   egress IPs, so this hostname must stay OUT of the `api.<domain>` WAF rate-limit rule — rr-api
   rejects anything on it without the `ORIGIN_KEY`).
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
| `ORIGIN_KEY` | – | shared secret of the proxy shells (`X-RR-Origin-Key`); the same value is the worker's + Pages' `ORIGIN_KEY` secret. Empty = trusted forwarding disabled (`X-RR-*` headers are ignored and stripped) |
| `ORIGIN_HOST` | – | e.g. `origin.razorreaper.app`; requests on that `Host` without a valid key -> `401 Unauthorized origin request.` (`/health` exempt) |
| `WORKER_HOST` | – | hostname(s) of the standalone worker shell, comma-separated (`backend.rr-admin-panel.workers.dev`); trusted requests forwarded from there are answered by the embedded worker only (its routes; 410/404 for the rest), never by the Pages routes |
| `ORIGIN_BASE` | – | **ignored** on rr-api (dropped by `buildRuntimeEnv`): rr-api is the origin and must never proxy to itself |

With a valid `ORIGIN_KEY` the request is *trusted*: `cf-connecting-ip` becomes the forwarded
`X-RR-Client-IP` (when it is a valid IP literal), `request.cf` is the tunnel's geo overlaid by
the forwarded `X-RR-Client-CF`, and `request.url` is rebuilt on the forwarded
`X-RR-Forwarded-Proto://X-RR-Forwarded-Host` (when it is a plain hostname[:port]) so the
dashboard's same-origin CSRF guard compares the browser's `Origin` with the Pages hostname it
actually used — not with `origin.<domain>` — and session cookies keep their `Secure` flag. Rate
limits and telemetry see the real client, not Cloudflare's egress. A wrong key is always `401`;
an untrusted request never gets its ip/geo/URL rewritten. (`src/trusted-forwarding.ts`.)

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
proxies to `origin.<domain>` for legacy clients (W3.7, see the cut-over runbook below).

Local development: `cd deploy/nas/rr-api && npm ci && npm run build && DB_PATH=./rr.sqlite DB_BOOTSTRAP_SCHEMA=true npm start`
(the repo root's `npm test` / `npm run typecheck` cover `tests/rr-api/**` and `deploy/nas/rr-api/src/**`;
run `npm ci` inside `deploy/nas/rr-api` once so better-sqlite3 is available to vitest).

## Cut-over runbook (W3.7: rr-api becomes authoritative)

Spec: `docs/superpowers/specs/2026-08-21-proxy-shells.md`. Nothing changes for clients; the
switch is configuration only, and every step is reversible by unsetting `ORIGIN_BASE` again.

1. **rr-api up with a full copy (T0).** Export D1 and import it into the NAS database
   (`npx wrangler d1 export rr-admin-panel --remote --output export-T0.sql`, then on the NAS
   `sqlite3 /volume1/docker/razorreaper/data/db/rr.sqlite < export-T0.sql` — see *Database*
   above). `ORIGIN_KEY` (random >= 32 chars, e.g. `openssl rand -base64 48`),
   `ORIGIN_HOST=origin.<domain>` and `WORKER_HOST=backend.rr-admin-panel.workers.dev` are set in
   `${DATA_DIR}/env/rr-api.env` (never `ORIGIN_BASE` — that is a shell-side variable);
   `docker compose up -d --build rr-api`. `origin.<domain>` and `api.<domain>` both answer `/health`
   (`curl -s https://origin.<domain>/health` -> `{"ok":true,"service":"rr-api"}`, and
   `curl -si https://origin.<domain>/api/health` -> `401 Unauthorized origin request.`), and the
   parity probes (ingest, register, license validate, admin data with an Access JWT) are green
   against `api.<domain>`.
2. **Flip the shells (T1).** Worker: `cd backend-worker && npx wrangler secret put ORIGIN_KEY`
   (paste the same value), set `ORIGIN_BASE = "https://origin.<domain>"` in the real
   `wrangler.toml` `[vars]`, `npx wrangler deploy`. Pages: `npx wrangler pages secret put
   ORIGIN_KEY --project-name rr-admin-panel`, set `ORIGIN_BASE` in the Pages project variables
   (or `wrangler.toml` `[vars]`), push `main`. From T1 every write lands on the NAS; verify with
   a heartbeat from a test install and `sqlite3 rr.sqlite "SELECT MAX(received_at) FROM
   telemetry_events;"` on the NAS.
3. **Delta (T0 -> T1).** Export D1 once more (`export-T1.sql`). Rewrite the dump so it only adds
   rows that are missing on the NAS: drop every `CREATE ...` statement and turn `INSERT INTO`
   into `INSERT OR IGNORE INTO`
   (`grep -v '^CREATE' export-T1.sql | sed 's/^INSERT INTO/INSERT OR IGNORE INTO/' > delta.sql`),
   then `sqlite3 rr.sqlite < delta.sql`. Rows created on Cloudflare between T0 and T1 are added;
   rows that already exist on the NAS keep the NAS state (it is newer).
4. **Verify.** `SELECT COUNT(*)` per table on both sides (NAS >= CF for every table), dashboard
   numbers identical on `rr-admin-panel.pages.dev` (now served by rr-api) and the probes green.
5. **Fallback window.** Keep the D1 database read-only for 30 days (no writer points at it any
   more); to roll back, unset `ORIGIN_BASE` on worker + Pages and redeploy. After 30 days delete
   the D1 database and the KV namespace.
