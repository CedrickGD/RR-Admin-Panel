# Proxy shells (W3.7): worker + Pages become thin proxies to rr-api

**Status:** approved 2026-08-21 (plan `~/.claude/plans/bro-i-thought-you-iridescent-charm.md`, W3.7).
**Goal:** `backend.rr-admin-panel.workers.dev` (standalone worker) and `rr-admin-panel.pages.dev`
(Pages Functions) keep their URLs forever (they are baked into shipped app builds) but stop owning
any data logic once rr-api on the NAS is authoritative. In proxy mode they forward requests to
rr-api over the Cloudflare Tunnel hostname `origin.razorreaper.app` and return its response.
Nothing changes for clients. The code stays deployable with proxy mode OFF (today) and ON (after
cut-over); the switch is configuration only.

## Configuration

| Where | Name | Kind | Meaning |
|---|---|---|---|
| worker | `ORIGIN_BASE` | var | e.g. `https://origin.razorreaper.app` (no trailing slash). Proxy mode is ON iff `ORIGIN_BASE` and `ORIGIN_KEY` are both non-empty. |
| worker | `ORIGIN_KEY` | secret | random >= 32 chars, shared with rr-api |
| Pages | `ORIGIN_BASE` / `ORIGIN_KEY` | var / secret | same semantics |
| rr-api | `ORIGIN_KEY` | env | same value; empty/unset = trusted forwarding disabled |
| rr-api | `ORIGIN_HOST` | env, optional | e.g. `origin.razorreaper.app`; requests whose `Host` equals it MUST carry a valid key, else `401 {ok:false,error:"Unauthorized origin request."}` |

Why a separate `origin.` hostname: worker/Pages subrequests reach the zone from Cloudflare egress
IPs, so the WAF rate-limit rule on `api.razorreaper.app` (120 req/10 s per IP) would count all
legacy traffic as one IP. `origin.razorreaper.app` points at the same rr-api container and is not
rate-limited at the edge; rr-api rejects anything on that host without the key.

## Shared implementation: `shared/origin-proxy.ts`

Runtime-agnostic (imported by `backend-worker/index.js`, the Pages middleware and tests).

```ts
export interface OriginProxyConfig { originBase: string; originKey: string; timeoutMs?: number /* default 15000 */ }
export function isProxyModeEnabled(env: { ORIGIN_BASE?: unknown; ORIGIN_KEY?: unknown }): boolean
export function buildOriginRequest(request: Request, cfg: OriginProxyConfig): Request   // pure, testable
export async function proxyToOrigin(request: Request, cfg: OriginProxyConfig, fetchImpl = fetch): Promise<Response>
```

`buildOriginRequest`:
- URL = `originBase + url.pathname + url.search` (path and query byte-for-byte, no normalisation).
- Method and body passed through unchanged (`body: request.body`, `redirect: "manual"`); GET/HEAD have no body.
- Request headers copied EXCEPT (case-insensitive): `host`, every `cf-*`, every `x-forwarded-*`,
  `x-real-ip`, `content-length`, `connection`, `keep-alive`, `transfer-encoding`, `upgrade`,
  `te`, `trailer`, `proxy-authorization`, `proxy-connection`, and every `x-rr-origin-key`,
  `x-rr-client-ip`, `x-rr-client-cf`, `x-rr-forwarded-host`, `x-rr-forwarded-proto` a client may
  have sent (anti-spoofing). `cf-access-jwt-assertion`, `cookie`, `authorization`,
  `content-type`, `x-rr-install`, `x-rr-timestamp`, `x-rr-signature`, `x-app-key`, `user-agent`
  are ordinary headers and MUST be forwarded unchanged (install signatures are computed over
  METHOD/PATH/TIMESTAMP/body-hash only, so proxying keeps them valid).
- Added headers: `X-RR-Origin-Key: <originKey>`; `X-RR-Client-IP: <cf-connecting-ip of the incoming request, or empty>`;
  `X-RR-Client-CF: <base64url(JSON)>` of `{country, city, region, regionCode, postalCode, latitude, longitude, timezone, continent, colo, asn, asOrganization}` taken from `request.cf` (only keys that are present; `{}` when `request.cf` is absent); `X-RR-Forwarded-Host: <incoming url.host>`; `X-RR-Forwarded-Proto: https`.

`proxyToOrigin`:
- `fetchImpl(buildOriginRequest(...), { signal: AbortSignal.timeout(timeoutMs) })`.
- Network error / timeout -> `503 {ok:false,error:"Backend temporarily unavailable."}` (JSON), and
  `console.error("origin_proxy_failed", { requestId?, message })` — never the origin URL/key.
- Success (any status, including 4xx/5xx from rr-api) -> new Response with the origin status and body,
  headers copied EXCEPT hop-by-hop (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`,
  `te`, `trailer`), `content-length` and `content-encoding` (the runtime recomputes them). Never add CORS headers.

## Worker (`backend-worker/index.js`)

Proxy mode ON (`isProxyModeEnabled(env)`):
- `/media/*`, `/update/*`, `/api/health`, `/healthz` -> unchanged local handlers (media origin swap
  and update proxy stay on the worker; health stays local and minimal).
- Any other `/api/*` or `/v1/*` path (incl. `/api/ingest`, `/v1/telemetry/event`,
  `/api/install/register`) -> keep the existing cheap guards that run BEFORE the handler today
  (method checks are NOT required; body-size cap and the in-memory rate limiter for ingest/register
  MAY stay in front — if they stay, a rejected request is answered locally exactly as today), then
  `return proxyToOrigin(request, cfg)`. No D1 access on that path.
- Every other path -> unchanged (404 etc.).
- Proxy mode OFF -> byte-for-byte today's behavior (all existing worker tests pass with an env that has no `ORIGIN_BASE`).

## Pages (`functions/api/_middleware.ts`, `functions/v1/_middleware.ts`)

- Pages middleware runs before the file routes. If `isProxyModeEnabled(context.env)` and the path
  is not `/api/health` -> `return proxyToOrigin(context.request, cfg)`; else `return context.next()`.
- Forwarded as-is (they are ordinary headers): `cf-access-jwt-assertion`, `cookie` — rr-api
  verifies the Access JWT itself (`ACCESS_AUD` already lists the Pages app AUDs).
- rr-api's generated route table must NOT pick up `_middleware.ts` files as routes
  (`deploy/nas/rr-api/scripts/generate-routes.mjs`: skip `_*.ts`; add a test).

## rr-api (`deploy/nas/rr-api/src/*`)

New `src/trusted-forwarding.ts` applied in `app.ts` before `attachCloudflareContext`:
- `ORIGIN_KEY` empty/unset -> trusted forwarding disabled: strip any incoming `X-RR-*` forwarding
  headers (key, client-ip, client-cf, forwarded-host/proto) and continue as today.
- `ORIGIN_KEY` set and request carries `X-RR-Origin-Key`:
  - timing-safe equal -> TRUSTED: build a new Request (same method/body/url) whose headers have
    `cf-connecting-ip` := `X-RR-Client-IP` when it is a syntactically valid IPv4/IPv6 (else leave
    the tunnel value), and whose `cf` object = tunnel-derived properties overlaid by the decoded
    `X-RR-Client-CF` JSON (only whitelisted string keys, each <= 128 chars; malformed base64/JSON ->
    ignore the header). Strip the `X-RR-*` forwarding headers afterwards so handlers never see them.
  - not equal -> `401 {ok:false,error:"Unauthorized origin request."}`.
- `ORIGIN_HOST` set and `Host` header (or `X-Forwarded-Host`/`:authority` as the tunnel delivers
  it) equals it and the request is NOT trusted -> 401 as above. `/health` is exempt (container healthcheck).
- The Hono `/health` route stays first and unconditional.

## Tests (vitest, must be green in `npm run check`)

- `tests/shared/origin-proxy.test.ts` (or under `tests/worker/`): header filtering/adding, URL
  path+query preservation, method/body passthrough, 503 on fetch rejection and on timeout,
  response passthrough incl. 4xx/5xx, hop-by-hop stripping, no CORS added, key never logged.
- `tests/worker/proxy-mode.test.ts`: mode ON -> `/api/ingest`, `/v1/telemetry/event`,
  `/api/install/register`, `/api/anything` forwarded (fetch mock asserts target URL + headers),
  D1 mock sees zero operations; `/media/*`, `/update/*`, `/api/health`, `/healthz` NOT forwarded;
  mode OFF -> existing suites unchanged.
- `tests/api/proxy-middleware.test.ts`: middleware forwards with `cf-access-jwt-assertion` and
  `cookie`, skips `/api/health`, calls `next()` when mode OFF.
- `tests/rr-api/trusted-forwarding.test.ts`: valid key -> cf-connecting-ip and cf overridden and
  X-RR headers stripped; invalid key -> 401; ORIGIN_HOST enforcement (+ `/health` exempt); no key
  configured -> headers ignored+stripped; malformed client-cf ignored.
- `tests/rr-api/routes.test.ts`: generated table contains no `_middleware` entries.

## Docs

- Repo `README.md` env table + `deploy/nas/README.md` + `deploy/nas/rr-api/.env.example`:
  `ORIGIN_BASE`, `ORIGIN_KEY`, `ORIGIN_HOST`.
- `backend-worker/wrangler.template.toml` and `wrangler.template.toml`: commented `ORIGIN_BASE` var.
- `deploy/nas/cloudflared/config.yml`: add `origin.razorreaper.app -> http://rr-api:8787`.
- `deploy/nas/README.md` -> new section **Cut-over runbook**:
  1. rr-api running on the NAS with an import of D1 export T0 (`sqlite3 rr.sqlite < export.sql`),
     `origin.razorreaper.app` + `api.razorreaper.app` healthy, parity probes green.
  2. `wrangler secret put ORIGIN_KEY` (worker + Pages) and set `ORIGIN_BASE`; deploy worker, push
     Pages -> from T1 all writes land on the NAS.
  3. Delta: export D1 again (T1), rewrite `INSERT INTO` -> `INSERT OR IGNORE INTO` and drop the
     `CREATE ...` statements, apply to rr.sqlite. Rows created on CF between T0 and T1 are added;
     rows that already exist on the NAS keep the NAS state (newer).
  4. Verify counts per table (NAS >= CF for every table), dashboard numbers identical, probes green.
  5. Keep the D1 database read-only as a fallback for 30 days, then delete.
