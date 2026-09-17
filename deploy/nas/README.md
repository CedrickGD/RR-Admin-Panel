# RazorReaper backend on the UGREEN NAS (W3)

> **Cut-over executed 2026-08-21 (evening):** rr-api on the NAS is authoritative; the worker and Pages run in proxy mode (`ORIGIN_BASE=https://origin.razorreaper.app`).

Target: Cloudflare stays the edge (DNS, cache, WAF, Access); the NAS is the origin behind a
**Cloudflare Tunnel** (outbound only — no router port-forwarding, home IP never exposed).

```
api.<domain>    -> rr-api          (Node 22; the Pages Functions + worker code on SQLite)   [W3.5]
admin.<domain>  -> admin           (Caddy; dashboard SPA + same-origin API gateway)
origin.<domain> -> rr-api          (same container; upstream of the worker/Pages proxy shells,
                                    key-gated via ORIGIN_KEY, not WAF-rate-limited)         [W3.7]
media.<domain>  -> caddy           (static files from /volume1/docker/razorreaper/media)          [W3.3]
dl.<domain>     -> caddy -> rr-api (stable URL redirect + free-download counter)
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
   `.env` as `TUNNEL_TOKEN`. Public hostnames: `media.<domain>` and `dl.<domain>` -> `http://caddy:8080`,
   `bot.<domain>` -> `http://bot:8080`, `api.<domain>` -> `http://rr-api:8787` (add when W3.5 is live),
   `origin.<domain>` -> `http://rr-api:8787` (W3.7; worker/Pages subrequests come from Cloudflare
   egress IPs, so this hostname must stay OUT of the `api.<domain>` WAF rate-limit rule — rr-api
   rejects anything on it without the `ORIGIN_KEY`).
   Add `admin.<domain>` -> `http://admin:8080` as well, and add `admin.<domain>` to the **same
   Cloudflare Access application** as the Pages dashboard so it keeps the existing Access audience.
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
BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
docker compose logs -f cloudflared     # expect "Registered tunnel connection"
```

Update: `git -C /volume1/docker/razorreaper/src/RR-Admin-Panel pull && git -C /volume1/docker/razorreaper/src/razorreaper-bot pull && BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build`.

**Always prefix `docker compose up --build` with `BUILD_SHA=$(git rev-parse --short HEAD)`** (that is
what `tools/deploy-nas.ps1` does). The value is baked into the rr-api image as an `ENV`, so the
System health page reports the commit the running image was built from. Without the prefix the
image is stamped empty and the page says `unknown`; a plain `docker compose up -d` (no `--build`)
keeps whatever the existing image was stamped with, which is correct by construction.
`${DATA_DIR}/env/rr-api.env` must **not** contain a `BUILD_SHA=` line — `env_file` beats the image
`ENV`, so an empty key there blanks the commit on every path.

### Admin panel emergency/redeploy path

The dashboard is served directly from the NAS so it does not depend on the Cloudflare Pages
Functions daily quota. `admin` serves the Vite SPA and reverse-proxies `/api/*` and `/v1/*` to
`rr-api` on the private Compose network. The browser therefore remains same-origin and Caddy
preserves the Cloudflare Access JWT, `Origin`, cookies and original `Host` on every API request.
Its dedicated `admin.env` contains only the same `ORIGIN_KEY` already used by rr-api; that lets
rr-api authenticate Caddy's forwarding headers and reconstruct the public HTTPS URL.

After pulling this commit on the NAS, build the new service and restart cloudflared so its
process reloads the tracked tunnel ingress file. Restarting cloudflared drops every public
hostname for ~10 s (502 on all of them): only with the owner's okay and in an agreed window;
the day-to-day admin redeploy (`npm run deploy:nas -- -Service admin`) never restarts it.

```bash
cd /volume1/docker/razorreaper/src/RR-Admin-Panel/deploy/nas
grep -m1 '^ORIGIN_KEY=' /volume1/docker/razorreaper/data/env/rr-api.env > /volume1/docker/razorreaper/data/env/admin.env
chmod 600 /volume1/docker/razorreaper/data/env/admin.env
docker compose up -d --build admin
docker compose restart cloudflared
docker compose ps rr-api admin cloudflared
```

One-time Cloudflare setup: create the DNS route/CNAME for `admin.razorreaper.app` to the existing
`rr-nas` tunnel, then add `admin.razorreaper.app` as another public hostname on the existing
dashboard Access application (do not create a second application/audience). Verify
`https://admin.razorreaper.app/api/health` returns JSON and opening
`https://admin.razorreaper.app/#/live` loads the dashboard. The legacy
`rr-admin-panel.pages.dev` shell redirects there while preserving query strings and hash routes;
its `_routes.json` keeps all static UI requests outside the Pages Functions invocation quota.

## Media migration (W3.3)

Copy the 75 files (689 MB) from the local master
`Desktop\!!! Main\7. Selling\RazorReaper\Current Files\APP HOSTED FILES DNT` to
`/volume1/docker/razorreaper/media` (scp/rsync or the UGOS file manager), then
`curl -sI https://media.<domain>/images/presets/default.png` -> 200, compare sha256 of all 75
files, then set the worker's `MEDIA_ORIGIN=https://media.<domain>/` and redeploy the worker.

## Backups

`backup` runs nightly at 03:15 (the container's clock, UTC): `sqlite3 .backup` of the rr-api DB into
`/volume1/docker/razorreaper/backups` (30-day retention). Media is static — copy it once to the HDD pool;
optional weekly offsite with rclone -> R2.

A backup counts only once it is verified. `backup/backup.sh` requires the copy to be at least 1 MB and to
hold app sessions (`SELECT COUNT(*) FROM app_sessions`, `PRAGMA integrity_check` alone answers ok on an
empty database), runs `PRAGMA integrity_check` on it and `gzip -t` on the archive, and only then rewrites
`/volume1/docker/razorreaper/backups/.last-success` (one line: `<ISO-8601 UTC> <file name>`). A failed check exits non-zero, removes what it produced and leaves the
marker as it was. Two readers make that visible:

- the `backup` service's healthcheck fails when the marker is missing or older than 36 h (`docker ps`
  shows `unhealthy`; the System health page raises `container-unhealthy-backup`);
- rr-api reads the marker's line, so "Last backup" on the System health page is the time since the last
  verified success, not the newest file's mtime, and `backup-stale` (26 h) is measured from it. Without a
  marker the page falls back to the newest `rr-*.sqlite.gz` and labels it "not verified".

First healthy state: at container start `backup.sh seed` dates a missing marker from the newest archive
that passes `gzip -t`, so a recreate on an existing backup folder is healthy within one probe interval
(5 min). A fresh volume has nothing to seed from; the healthcheck's 26 h start period keeps the container
at `health: starting` until the first 03:15 run writes the marker. To prove the whole path once:
`docker exec razorreaper-backup-1 sh /backup.sh` (expect `backup ok rr-<stamp>.sqlite.gz`, a new archive and
a fresh marker line). Negative check: `touch -d "3 days ago"` the marker and wait for the next probe — the
container turns unhealthy and the page shows it; the next run, or the manual one, clears it.

## Docker access for the System health page

The page's container table is fed through two hops, `rr-api -> docker-gateway -> docker-proxy`,
on two `internal` networks; rr-api has no route to the socket proxy itself.
`docker-socket-proxy` can only gate whole API *sections* — `CONTAINERS=1` allows every non-POST
call under `/containers`, for **every** container on the host, which includes reading another
container's `Config.Env` and pulling arbitrary files out of it via `/archive`.
`docker-gateway` (`caddy:2-alpine`, config in `docker-gateway/Caddyfile`) is the path allowlist
that the socket proxy cannot be. It permits exactly two `GET` shapes:

| Request rr-api may make | Forwarded as |
| --- | --- |
| `GET /containers/json` | `/containers/json?all=1&filters={"label":["com.docker.compose.project=razorreaper"]}` |
| `GET /containers/razorreaper-<service>-<n>/stats` | same path, `?stream=false` |

Everything else gets `403` from the gateway without the socket proxy being touched: `/archive`,
`/logs`, `/export`, `/top`, `/changes`, any container outside this compose project, any non-GET
method — and **inspect, `/containers/<name>/json`, for every container without exception**.

Inspect is not health data. It returns `Config.Env` verbatim, and every service here keeps
secrets there: `admin.env` holds `ORIGIN_KEY`, `rr-api.env` holds 35 values including the ingest
tokens, the app keys and `JWT_SECRET`, `bot.env` holds the Discord `TOKEN` and the
`NOTIFIER_*`/`VERIFY_*` values. The same response also carries `HostConfig` and `Mounts`, i.e. the
host's directory layout and every bind mount. rr-api is the internet-facing service behind the
tunnel, so one rr-api bug that can reach the gateway would otherwise read all of that back out of
Docker — including from rr-api's own container, which is why there is no "own container"
exception. Caddy cannot reliably strip fields out of a proxied JSON body, so the route is refused
rather than filtered.

The cost is visible and intended. `State.StartedAt` and `RestartCount` exist only in inspect, so
on the System health page:

- **Restarts** is `—` for every row. The table caption and the note under it say the figure is
  not available; the reason is this file, because the page keeps its own lines short.
- **Uptime** is the duration out of the container list's `Status` string ("Up 3 minutes
  (healthy)"), printed in Docker's own words — "3 minutes", "12 days", "About an hour" — so the
  column never reads more precisely than `docker ps` does. Blank for a container that is not
  running.
- **Health** comes from the same string — Docker writes the healthcheck verdict into it — so a
  failing healthcheck is still visible, and a container that is down still reads as down.

Adding a service to `compose.yml` needs no gateway change: the list is filtered by compose project
and stats is matched by pattern, so a new service appears with the same columns as the rest.

Verify after a deploy (from inside rr-api, which is the only container that can reach the gateway):

```bash
docker compose exec rr-api sh -lc '
  for p in /containers/json /containers/razorreaper-bot-1/stats \
           /containers/razorreaper-rr-api-1/json /containers/razorreaper-bot-1/json \
           /containers/razorreaper-cloudflared-1/archive?path=/etc/cloudflared/creds \
           /containers/razorreaper-bot-1/logs /containers/homeassistant-app-1/json /images/json; do
    printf "%s -> " "$p"
    wget -qS -O /dev/null "http://docker-gateway:2375$p" 2>&1 | sed -n "s|.*HTTP/1.1 ||p" | head -1
  done'
```

Expected: `200` for the first two, `403` for the rest — `/containers/razorreaper-rr-api-1/json`
included.

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
BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build rr-api
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
   `${DATA_DIR}/env/rr-api.env` (never `ORIGIN_BASE` — that is a shell-side variable, and never
   `BUILD_SHA` — see *Deploy / update*);
   `BUILD_SHA=$(git rev-parse --short HEAD) docker compose up -d --build rr-api`.
   `origin.<domain>` and `api.<domain>` both answer `/health`
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

### What actually happened at the cut-over (2026-08-21, for the record)

T0 export 19:14Z -> `sqlite3` transactional import (5.7 s) -> rr-api up -> Pages `ORIGIN_BASE`
secret + redeploy -> worker `ORIGIN_BASE` var + deploy (19:17:35Z) -> T1 export 19:22Z ->
`python tools/d1-delta-import.py T0.sql T1.sql delta.sql` (line diff; 82 statements) -> applied.
Proof of routing: a probe install registered via the worker and a probe feedback posted via
pages.dev both landed only in the NAS database. D1 is kept read-only as a fallback; delete after
30 days (2026-09-20).
