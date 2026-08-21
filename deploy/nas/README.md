# RazorReaper backend on the UGREEN NAS (W3)

Target: Cloudflare stays the edge (DNS, cache, WAF, Access); the NAS is the origin behind a
**Cloudflare Tunnel** (outbound only — no router port-forwarding, home IP never exposed).

```
api.<domain>    -> rr-api          (Node 22; the Pages Functions + worker code on SQLite)   [W3.5]
media.<domain>  -> caddy           (static files from /volume1/razorreaper/media)          [W3.3]
bot.<domain>    -> razorreaper-bot (Discord bot + notifier SSE)                            [W3.4]
```

Old URLs (`backend.rr-admin-panel.workers.dev`, `rr-admin-panel.pages.dev`) stay alive as thin
proxies for legacy clients. The UGOS admin UI (9999/9443) is **never** mapped into the tunnel.

## One-time prerequisites (owner)

1. Buy a domain (e.g. `razorreaper.de`) and add it to the Cloudflare account `1559784f…`
   (Cloudflare Registrar puts it on Cloudflare automatically).
2. NAS: `ssh <nas-user>@192.168.2.201`; create `/volume1/razorreaper/{src,media,data/db,data/bot,backups}`;
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
cd /volume1/razorreaper/src
git clone https://github.com/CedrickGD/RR-Admin-Panel.git
git clone https://github.com/CedrickGD/razorreaper-bot.git
cd RR-Admin-Panel/deploy/nas && cp .env.example .env && nano .env      # fill secrets
docker compose up -d --build
docker compose logs -f cloudflared     # expect "Registered tunnel connection"
```

Update: `git -C /volume1/razorreaper/src/RR-Admin-Panel pull && git -C /volume1/razorreaper/src/razorreaper-bot pull && docker compose up -d --build`.

## Media migration (W3.3)

Copy the 75 files (689 MB) from the local master
`Desktop\!!! Main\7. Selling\RazorReaper\Current Files\APP HOSTED FILES DNT` to
`/volume1/razorreaper/media` (scp/rsync or the UGOS file manager), then
`curl -sI https://media.<domain>/images/presets/default.png` -> 200, compare sha256 of all 75
files, then set the worker's `MEDIA_ORIGIN=https://media.<domain>/` and redeploy the worker.

## Backups

`backup` runs nightly at 03:15: `sqlite3 .backup` of the rr-api DB into `/volume1/razorreaper/backups`
(30-day retention). Media is static — copy it once to the HDD pool; optional weekly offsite with rclone -> R2.
