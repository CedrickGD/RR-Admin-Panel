# Backend Hardening (W1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shipped shared ingest key with per-install ECDSA request signing, bind every session write to its install, verify Cloudflare Access JWTs in code, rate-limit every public route, and stop leaking internals — on the code that is live today (`main`), without changing what telemetry collects or stores.

**Architecture:** Pure, runtime-agnostic modules under `shared/` (telemetry contract, install signature verification, install store) are imported by both the standalone worker (`backend-worker/index.js`) and the Pages Functions (`functions/**`), and later by `rr-api` on the NAS. Pages-only helpers (`access-jwt`, `ratelimit`, `install-auth` middleware) live in `functions/_lib/`. Every task ends with vitest coverage; nothing is deployed by this plan (Task 11 is the runbook the operator executes).

**Tech Stack:** TypeScript (Pages Functions + shared), plain ESM JS (worker, bundled by wrangler/esbuild which resolves `.ts` imports), WebCrypto (ECDSA P-256 / RSASSA-PKCS1-v1_5 / SHA-256), Cloudflare D1, vitest 3, wrangler 4.

**Baseline:** branch `feat/backend-hardening` @ `8d47ab2` in `C:\Users\cedri\source\repos\CedrickGD\RR-Admin-Panel` (== live `main` + test harness). The 2026-08-16 WIP lives on `wip/store-telemetry-quality-2026-08-16` — do **not** merge it; only the harness was adopted.

## Global Constraints

- **Do not change what is collected or stored**: client-supplied `client_*` geo/IP/hwid/discord_user/machine_name metrics keep flowing exactly as today; no purge, no retention, no consent logic. (User ruling 2026-08-21.)
- **No role gate on viewer mutations** (product ruling from the 2026-08-16 spec).
- Contract: `docs/superpowers/specs/2026-08-21-install-signing-contract.md` is binding (header names, signing string, status codes).
- Legacy clients (≤ 1.4.8 and the pre-1.4 30 s-heartbeat installs) must keep working: unsigned `access/status`, `license/validate|activate`, `feedback` stay allowed until `REQUIRE_INSTALL_SIGNATURE=true`; the shared ingest key stays accepted while `LEGACY_INGEST_KEY_ENABLED=true` (default `"true"` in config; operator flips).
- Public error bodies never contain `err.message`, SQL, paths or upstream bodies → use `internalError(request, message, cause)` from `functions/_lib/responses.ts` (allowed public messages: `"Internal server error."`, `"Internal service failure."`, `"Unable to complete the request."`, `"Unable to save the operation."`).
- Tests: `npm test` must stay green after every task; `npm run typecheck` and `node --check backend-worker/index.js` too. Commit after every task on `feat/backend-hardening` (or the task worktree branch). Never push, never deploy, never call production, never apply remote migrations.
- Prettier is configured (`prettier.config.mjs`); format touched files with `npx prettier --write <files>`.
- D1 access goes through the `D1Database` interface in `functions/_lib/types.ts` (`prepare().bind().run()/first()/all()`, `batch()`); tests use `tests/helpers/mock-d1.ts` (`createMockD1({run,first,all})` resolvers matched by SQL substring/regex; inspect `operations`).

---

### Task 2: Shared telemetry contract module

**Files:**
- Create: `shared/telemetry-contract.ts`
- Create: `tests/telemetry/contract.test.ts`
- Create: `tests/telemetry/fixtures/canonical-v2.json`, `tests/telemetry/fixtures/legacy-heartbeat.json`
- Modify: `functions/api/ingest.ts` (import from the module, delete the duplicated helpers)

**Interfaces (Produces):**
```ts
export type TelemetryStatus = "ok" | "degraded" | "down";
export interface CanonicalPayload { source: string; service: string; timestamp: string; status: TelemetryStatus; metrics: Record<string, unknown>; message?: string }
export interface RequestContext { clientIp: string | null; country: string | null; city: string | null; region: string | null; latitude: number | null; longitude: number | null; timezone: string | null }
export const MAX_BODY_BYTES = 16 * 1024; export const MAX_METRICS_KEYS = 64; export const MAX_METRICS_BYTES = 8 * 1024; export const MAX_MESSAGE_LENGTH = 500; export const MAX_TIMESTAMP_SKEW_MS = 10 * 60 * 1000;
export function normalizePayload(raw: unknown): { valid: true; payload: CanonicalPayload } | { valid: false; message: string; details?: unknown };
export function validatePayload(payload: CanonicalPayload): { valid: true } | { valid: false; message: string; details?: unknown };
export function readRequestContext(request: Request): RequestContext;          // request.cf + cf-connecting-ip/x-forwarded-for/cf-ipcountry, unchanged semantics
export function attachRequestContext(metrics: Record<string, unknown>, ctx: RequestContext): Record<string, unknown>; // fill-if-absent, unchanged semantics
export function clampTimestamp(clientIso: string, nowMs: number, maxSkewMs?: number): { iso: string; adjusted: boolean };
export async function readBodyTextLimited(request: Request, maxBytes?: number): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413; message: string }>;
export function sanitizeIdentifier(value: string, fallback: string): string;
```
Behaviour is a **verbatim move** of `normalizePayload/tryNormalizeCanonicalPayload/tryNormalizeLegacyPayload/validatePayload/readRequestContext/attachRequestContext/ipVersion/normalizeCoordinate/toText/toFiniteNumber/sanitizeIdentifier/normalizeLegacyService/deriveLegacySessionId/deriveLegacyStatus/deriveLegacyMessage/coerceLegacyScalar` from `functions/api/ingest.ts:145-562` (they are byte-identical to the worker's copies). `clampTimestamp` is new: unparsable or `|client − now| > maxSkewMs` → `{ iso: new Date(nowMs).toISOString(), adjusted: true }`, else `{ iso: new Date(client).toISOString(), adjusted: false }`. `readBodyTextLimited` reuses the `content-length` pre-check + byte measure from `functions/_lib/http.ts readJsonBody` but returns the raw text (callers parse JSON themselves; the same text is what signatures are computed over). Empty body → `{ ok: true, text: "" }` (callers decide).

- [ ] **Step 1: Write the failing tests** — `tests/telemetry/contract.test.ts`:
  - canonical fixture normalizes to itself; legacy `{install_id,event_name:"heartbeat",timestamp_utc,properties:{session_id}}` → `service === "session_active"`, `metrics.session_id` kept, `metrics.install_id` set; legacy without `session_id` → `install:<id>`.
  - `validatePayload` rejects: bad `source` chars, 65 metric keys, metrics > 8 KB, message > 500, status `"meh"`, timestamp `"yesterday"`.
  - `attachRequestContext` fills `client_ip/country/city/region/latitude/longitude/timezone/client_geo_source="edge_ip"/client_geo_signal_source="ip"` only when absent; a client-supplied `client_latitude` is **kept** (ruling).
  - `clampTimestamp`: in-window unchanged; +7 h → adjusted to now; garbage → adjusted.
  - `readBodyTextLimited`: 16 KB+1 body → `{ok:false,status:413}`; declared `content-length` too large → 413 without reading; normal body → text.
- [ ] **Step 2:** `npx vitest run tests/telemetry` → FAIL (module missing).
- [ ] **Step 3:** Create `shared/telemetry-contract.ts` by moving the code; then rewrite `functions/api/ingest.ts` to `import { normalizePayload, validatePayload, readRequestContext, attachRequestContext, readBodyTextLimited, clampTimestamp } from "../../shared/telemetry-contract";` and delete the local copies. Keep `onRequest` behaviour identical for now (auth stays the shared-key check; Task 6 changes it). Parse via `readBodyTextLimited` + `JSON.parse` (400 on parse error).
- [ ] **Step 4:** `npx vitest run tests/telemetry && npm run typecheck` → PASS.
- [ ] **Step 5:** `npx prettier --write shared/telemetry-contract.ts functions/api/ingest.ts tests/telemetry/contract.test.ts && git add -A && git commit -m "feat(shared): extract the telemetry contract into a runtime-agnostic module"`.

### Task 3: Install signature verification + install store

**Files:**
- Create: `shared/install-auth.ts`, `shared/installs-store.ts`
- Create: `tests/helpers/install-signer.ts`, `tests/install-auth/install-auth.test.ts`, `tests/install-auth/installs-store.test.ts`, `tests/install-auth/fixtures/vectors.json` (generated by a test when `GENERATE_VECTORS=1`)
- Docs: `docs/superpowers/specs/2026-08-21-install-signing-contract.md` (already written; keep in sync)

**Interfaces (Produces):**
```ts
// shared/install-auth.ts
export const INSTALL_HEADER = "x-rr-install"; export const TIMESTAMP_HEADER = "x-rr-timestamp"; export const SIGNATURE_HEADER = "x-rr-signature"; export const MAX_CLOCK_SKEW_SECONDS = 300;
export const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface PublicKeyJwk { kty: "EC"; crv: "P-256"; x: string; y: string }
export interface InstallRecord { installId: string; publicKeyJwk: PublicKeyJwk; revokedAt: string | null }
export type SignedRequestVerdict = { ok: true; installId: string } | { ok: false; status: 400 | 401; reason: "missing_headers" | "bad_install_id" | "bad_timestamp" | "stale_timestamp" | "bad_signature_encoding" | "unknown_install" | "revoked" | "bad_signature" };
export function hasSignatureHeaders(request: Request): boolean;
export function buildSigningString(method: string, pathname: string, timestamp: string, bodySha256Hex: string): string; // `${METHOD}\n${pathname}\n${timestamp}\n${hash}`
export async function sha256Hex(text: string): Promise<string>;
export function isValidPublicKeyJwk(value: unknown): value is PublicKeyJwk;  // x,y base64url decode to 32 bytes each
export async function importP256PublicKey(jwk: PublicKeyJwk): Promise<CryptoKey>;
export function base64UrlEncode(bytes: Uint8Array): string; export function base64UrlDecode(text: string): Uint8Array | null;
export async function verifySignedRequest(request: Request, bodyText: string, deps: { lookupInstall: (installId: string) => Promise<InstallRecord | null>; nowSeconds?: () => number }): Promise<SignedRequestVerdict>;
export function validateRegistrationBody(raw: unknown): { ok: true; value: { installId: string; hwid: string; publicKeyJwk: PublicKeyJwk; appVersion: string | null; licenseKey: string | null } } | { ok: false; message: string };
// shared/installs-store.ts  (D1Database from functions/_lib/types)
export const INSTALLS_DDL: string[];  // CREATE TABLE IF NOT EXISTS installs(...) + CREATE INDEX IF NOT EXISTS idx_installs_hwid ON installs(hwid)
export async function ensureInstallsSchema(db: D1Database): Promise<void>;   // once per isolate (module flag)
export async function findInstall(db: D1Database, installId: string): Promise<InstallRecord & { hwid: string | null; appVersion: string | null; createdAt: string; lastSeenAt: string | null; licenseId: number | null } | null>;
export async function registerInstall(db: D1Database, input: { installId: string; hwid: string; publicKeyJwk: PublicKeyJwk; appVersion: string | null; licenseKey: string | null; nowIso: string }): Promise<{ outcome: "created" | "same" | "conflict" | "revoked"; registeredAt: string | null }>;
export async function countInstallsForHwidSince(db: D1Database, hwid: string, sinceIso: string): Promise<number>;
export async function touchInstall(db: D1Database, installId: string, nowIso: string): Promise<void>; // UPDATE ... WHERE last_seen_at IS NULL OR last_seen_at < datetime(now,'-5 minutes')
export async function revokeInstall(db: D1Database, installId: string, reason: string | null, nowIso: string): Promise<boolean>;
export async function listInstallsForHwid(db: D1Database, hwid: string): Promise<Array<...>>;
```
`registerInstall`: `licenseKey` → `license_id` only if a row in `licenses` with that key exists and `status='active'` (best-effort; null otherwise). Conflict = row exists with different `public_key_jwk`; same = identical jwk (`x`,`y` compare); revoked = `revoked_at IS NOT NULL`.

- [ ] **Step 1: Write the failing tests.** `tests/helpers/install-signer.ts`: `generateInstallKeyPair()` (WebCrypto ECDSA P-256, extractable) → `{ privateKey, publicKeyJwk }`; `signRequest(privateKey, { method, pathname, timestamp, bodyText })` → signature base64url (P1363 — WebCrypto's native ECDSA output already is `r||s`); `signedHeaders(...)`. Tests: valid signature verifies; tampered body / changed path / changed method fail with `bad_signature`; timestamp 301 s old → `stale_timestamp`; non-numeric → `bad_timestamp`; missing one header → `missing_headers`; unknown install → `unknown_install`; revoked → `revoked`; signature not base64url / wrong length → `bad_signature_encoding`; `validateRegistrationBody` rejects bad GUID, hwid > 64 chars or with control chars, jwk with 31-byte `x`; `installs-store` tests with `createMockD1`: DDL runs once, `registerInstall` outcomes (created/same/conflict/revoked) via resolvers on `SELECT ... FROM installs`, `touchInstall` SQL contains `-5 minutes`. Vector test: when `process.env.GENERATE_VECTORS === "1"` write `fixtures/vectors.json` (private key PKCS#8 base64, jwk, 3 signed requests incl. an empty-body GET); otherwise read it and verify all vectors (this is what the C# client tests will replay).
- [ ] **Step 2:** `npx vitest run tests/install-auth` → FAIL.
- [ ] **Step 3:** Implement both modules. `verifySignedRequest`: read headers → validate install id → parse timestamp (`/^\d{1,12}$/`) → skew check → decode signature (must be 64 bytes) → `lookupInstall` → revoked check → `importP256PublicKey` → `crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"}, key, sig, utf8(signingString))`. Use `new URL(request.url).pathname` (no query). Method uppercased.
- [ ] **Step 4:** `GENERATE_VECTORS=1 npx vitest run tests/install-auth` once (creates fixture), then `npx vitest run tests/install-auth && npm run typecheck` → PASS.
- [ ] **Step 5:** `npx prettier --write shared tests/install-auth tests/helpers && git add -A && git commit -m "feat(shared): per-install ES256 request signing + install store"`.

### Task 4: Cloudflare Access JWT verification, allow-list fail-closed, CSRF guard

**Files:**
- Create: `functions/_lib/access-jwt.ts`, `functions/_lib/csrf.ts`
- Create: `tests/helpers/access-token.ts`, `tests/access/access-jwt.test.ts`, `tests/access/require-dashboard-access.test.ts`, `tests/access/csrf.test.ts`
- Modify: `functions/_lib/http.ts` (`isAllowedAccessIdentity` empty → `false`; keep `getAccessIdentity` only as the header-based fallback used by app-auth mode), `functions/_lib/admin.ts` (`requireDashboardAccess` uses the verified identity + CSRF guard), `functions/_lib/types.ts` (`RuntimeEnv.ACCESS_TEAM_DOMAIN?`, `ACCESS_AUD?`), `wrangler.template.toml` (document `ACCESS_TEAM_DOMAIN="rr-adminpanel.cloudflareaccess.com"`, `ACCESS_AUD="<prod-aud>,<preview-aud>"`), `README.md` (Access section), `tests/helpers/request.ts` (`accessIdentityHeaders` now mints a test JWT).

**Interfaces (Produces):**
```ts
// access-jwt.ts
export interface AccessJwks { keys: Array<{ kid: string; kty: "RSA"; n: string; e: string; alg?: string }> }
export type AccessJwtVerdict = { ok: true; email: string; sub: string | null } | { ok: false; reason: "malformed" | "unsupported_alg" | "unknown_kid" | "bad_signature" | "expired" | "not_yet_valid" | "bad_issuer" | "bad_audience" | "no_email" };
export async function verifyAccessJwt(token: string, opts: { teamDomain: string; audiences: string[]; nowSeconds?: () => number; fetchJwks?: (teamDomain: string) => Promise<AccessJwks> }): Promise<AccessJwtVerdict>;
export async function resolveAccessIdentity(request: Request, env: RuntimeEnv, deps?: { nowSeconds?: () => number; fetchJwks?: (teamDomain: string) => Promise<AccessJwks> }): Promise<{ ok: true; email: string } | { ok: false; status: 401 | 500; message: string }>;
export function parseAudiences(raw: string | undefined): string[];
// csrf.ts
export function enforceSameOriginMutation(request: Request): Response | null; // null = ok
```
`verifyAccessJwt`: compact JWS split, base64url-decode header/payload JSON, `alg === "RS256"`, kid → JWKS (default fetcher caches per module for 1 h and re-fetches once on unknown kid), `crypto.subtle.importKey("jwk", {kty,n,e}, {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["verify"])`, verify `header.payload` bytes; claims: `iss === "https://" + teamDomain`, `aud` (string or array) ∩ audiences ≠ ∅, `exp > now`, `nbf <= now` if present, `email` string. `resolveAccessIdentity`: 500 if `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` missing ("Access verification is not configured."), 401 if header missing/invalid, email lower-cased. `enforceSameOriginMutation`: for `POST|PUT|PATCH|DELETE`: if `sec-fetch-site` present and not `same-origin`/`none` → 403; if `origin` present and its host ≠ request host → 403; if the request has a body (`content-length` > 0 or `transfer-encoding`) and `content-type` doesn't start with `application/json` → 415. `requireDashboardAccess` (access mode): `resolveAccessIdentity` → allow-list (`isAllowedAccessIdentity`; empty list now **denies** with 403 "Access allow-list is empty.") → `enforceSameOriginMutation` for non-GET → role as before. App mode unchanged except the CSRF guard also applies.

- [ ] **Step 1: Write the failing tests.** `tests/helpers/access-token.ts`: `createAccessSigner()` → RSA-2048 keypair, `jwks`, `sign(claims)` compact JWT with `kid`. Tests: valid token → email; expired → `expired`; wrong aud → `bad_audience`; wrong iss → `bad_issuer`; unknown kid → `unknown_kid`; tampered payload → `bad_signature`; `alg:"none"` → `unsupported_alg`; `resolveAccessIdentity` 500 when env missing; `requireDashboardAccess` 401 without JWT even if `cf-access-authenticated-user-email` is set; 403 when allow-list empty; 403 when `sec-fetch-site: cross-site`; 415 when POST body with `text/plain`; OK for same-origin JSON POST; DELETE without body and `sec-fetch-site: same-origin` OK.
- [ ] **Step 2:** `npx vitest run tests/access` → FAIL.
- [ ] **Step 3:** Implement. Update `tests/helpers/request.ts accessIdentityHeaders(email)` to return `cf-access-jwt-assertion` signed by a shared test signer (export `testAccessEnv()` = `{ACCESS_TEAM_DOMAIN:"test.cloudflareaccess.com", ACCESS_AUD:"aud-test", ACCESS_ALLOWED_EMAIL: email}` and `testAccessDeps()` with the fake `fetchJwks`). Thread `deps` through `requireDashboardAccess(request, env, deps?)`.
- [ ] **Step 4:** `npx vitest run tests/access && npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** `npx prettier --write functions/_lib/access-jwt.ts functions/_lib/csrf.ts functions/_lib/admin.ts functions/_lib/http.ts tests/access tests/helpers && git add -A && git commit -m "feat(access): verify Cloudflare Access JWTs, fail-closed allow-list, CSRF guard"`.

### Task 5: Rate limiter for Pages routes

**Files:**
- Create: `functions/_lib/ratelimit.ts`, `tests/http/ratelimit.test.ts`
- Modify: `functions/api/license/validate.ts`, `functions/api/license/activate.ts`, `functions/api/access/status.ts`, `functions/api/feedback/index.ts`, `functions/api/announcements/active.ts`, `functions/api/discord/oauth-start.ts`, `functions/api/usage/consume.ts`, `functions/api/usage/status.ts`, `functions/api/ingest.ts`

**Interfaces (Produces):**
```ts
export interface RateLimitRule { route: string; limit: number; windowSeconds: number; key?: string }  // key defaults to cf-connecting-ip ?? "unknown"
export function enforceRateLimit(request: Request, rule: RateLimitRule, nowMs?: number): Response | null; // 429 JSON {ok:false,error:"Too many requests."} + retry-after header
export function resetRateLimitsForTests(): void;
```
Implementation: module-level `Map<string, { windowStart: number; count: number }>`, key `${route}|${key}`; prune entries older than 2 windows when the map exceeds 10 000 entries. (Per-isolate by design; documented limitation — real WAF limits come with the zone in W3.)

Rules: validate 30/60 s/IP; activate 10/60 s/IP **and** `{route:"license/activate:key", key: licenseKey, limit: 20, windowSeconds: 3600}`; access/status 30/60 s; feedback 5/60 s; announcements/active 60/60 s; oauth-start 10/60 s; usage/consume 60/60 s; usage/status 60/60 s; ingest 60/60 s.

- [ ] **Step 1:** Tests: 3 calls under limit → null; 4th → 429 with `retry-after`; new window resets; different IPs independent; `reset` clears. Route tests (one example each via `createSyntheticRequest` + `createMockD1`): 31st `license/validate` from one IP → 429.
- [ ] **Step 2:** FAIL → **Step 3:** implement + wire (first line of each handler, before any DB work). **Step 4:** `npm test && npm run typecheck` PASS. **Step 5:** commit `feat(api): per-isolate rate limits on every public route`.

### Task 6: Pages install-auth middleware, ownership binding, ingest signed/legacy

**Files:**
- Create: `functions/_lib/install-auth.ts`, `tests/api/install-auth-middleware.test.ts`, `tests/api/ingest.test.ts`, `tests/api/public-routes.test.ts`
- Modify: `functions/api/ingest.ts`, `functions/v1/telemetry/event.ts` (unchanged re-export), `functions/_lib/storage.ts` (`storeTelemetry(env, event, options?)`, `SessionOwnershipError`, `ingest_auth_mode` column), `functions/api/feedback/index.ts`, `functions/api/access/status.ts` (POST only), `functions/api/usage/consume.ts`, `functions/api/usage/status.ts`, `functions/api/license/validate.ts`, `functions/api/license/activate.ts`, `functions/_lib/types.ts` (`LEGACY_INGEST_KEY_ENABLED?`, `REQUIRE_INSTALL_SIGNATURE?`), `wrangler.template.toml`, `README.md`

**Interfaces (Produces):**
```ts
// functions/_lib/install-auth.ts
export type InstallAuthMode = "required" | "optional";
export async function requireInstallAuth(context: { request: Request; env: RuntimeEnv }, mode: InstallAuthMode): Promise<{ ok: true; installId: string | null; bodyText: string } | { ok: false; response: Response }>;
// storage.ts
export class SessionOwnershipError extends Error { constructor(public readonly sessionId: string) }
export async function storeTelemetry(env: RuntimeEnv, event: TelemetryEvent, options?: { ownerInstallId?: string | null; authMode: "signed" | "legacy_key" }): Promise<StorageBackend>;
```
`requireInstallAuth`: `readBodyTextLimited` (413/400 → response); if `hasSignatureHeaders` → `verifySignedRequest` with `lookupInstall = findInstall(env.DB)` (after `ensureInstallsSchema`) → failure ⇒ 401 `{ok:false,error:"Invalid install signature."}`; success ⇒ `touchInstall` best-effort, `installId`; if no headers: `mode==="required"` or `env.REQUIRE_INSTALL_SIGNATURE==="true"` ⇒ 401 `{ok:false,error:"Install signature required."}`, else `installId:null`. Handlers parse `JSON.parse(bodyText)` (400 on error) instead of `readJsonBody`.

Ingest (`functions/api/ingest.ts`): order = rate limit → `requireInstallAuth(ctx,"optional")` → if `installId` null: legacy key check (existing `validateIngestAuthorization`) allowed only when `env.LEGACY_INGEST_KEY_ENABLED !== "false"` (default on) else 401; → normalize/validate → `clampTimestamp` → `attachRequestContext` → when signed: `metrics.install_id = installId` → `storeTelemetry(env, event, { ownerInstallId: installId, authMode })`. `SessionOwnershipError` → 403 `{ok:false,error:"Session belongs to another install."}`. Storage: `storeTelemetryD1` reads the existing session row; if `ownerInstallId` and `existing.install_id` differ → throw; `telemetry_events` INSERT gets `ingest_auth_mode` (ALTER `ADD COLUMN ingest_auth_mode TEXT` in `ensureTelemetrySchema` alter list). `metrics_json` unchanged otherwise.

Routes: `usage/consume|status` → `requireInstallAuth(ctx,"required")` (usage/status is GET: body text `""`); `feedback`, `access/status` (delete `onRequestGet`), `license/validate`, `license/activate` → `"optional"`.

- [ ] **Step 1:** Tests (mock-d1 + install-signer + `resetRateLimitsForTests`): signed ingest 202 and `INSERT INTO telemetry_events` values include `"signed"`; legacy key 202 with `"legacy_key"`; legacy key + `LEGACY_INGEST_KEY_ENABLED="false"` → 401; no auth → 401; signed ingest against a session row owned by another install → 403 and no UPSERT; signed request sets `metrics.install_id`; usage/consume unsigned → 401, signed → reaches `consumeUse`; feedback unsigned → 201 (legacy allowed), `REQUIRE_INSTALL_SIGNATURE="true"` → 401; access/status GET → 405; bad signature on feedback → 401.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `npm test && npm run typecheck` PASS → **Step 5:** commit `feat(api): install signatures on app routes, session ownership, legacy ingest flag`.

### Task 7: Worker hardening (`backend-worker/index.js`)

**Files:**
- Modify: `backend-worker/index.js`, `backend-worker/wrangler.template.toml`, the untracked real `backend-worker/wrangler.toml` (add the same bindings/vars)
- Create: `tests/worker/helpers.ts` (build env: `createMockD1`, fake limiters `{ limit: async ({key}) => ({ success }) }`, secrets), `tests/worker/ingest.test.ts`, `tests/worker/register.test.ts`, `tests/worker/hygiene.test.ts`

**Changes:**
1. `import { … } from "../shared/telemetry-contract.ts"`, `"../shared/install-auth.ts"`, `"../shared/installs-store.ts"` (explicit `.ts` — wrangler/esbuild and vitest both resolve it); delete the duplicated helpers from index.js.
2. Routing: `POST /api/install/register` → `handleRegister`; `POST /api/ingest|/v1/telemetry/event` → `handleIngest`; `GET /health|/api/health|/healthz` → `json({ok:true,service:"backend"})` — **no DB access**; everything else as before.
3. `handleRegister`: `env.RL_REGISTER?.limit({key: ip})` → 429; body ≤ 4 KB; `validateRegistrationBody`; `ensureInstallsSchema`; `countInstallsForHwidSince(hwid, now-24h) >= 3` → 429 `{error:"Too many installs for this device."}`; `registerInstall` → 201/200/409/401 per contract.
4. `handleIngest`: `env.RL_INGEST?.limit({key: ip})` → 429; `readBodyTextLimited` (413); signature headers → `verifySignedRequest` (401 on failure) else legacy key (`APP_SHARED_KEY ?? INGEST_TOKEN`) only if `env.LEGACY_INGEST_KEY_ENABLED !== "false"` (else 401); normalize/validate; `clampTimestamp`; `attachRequestContext`; signed ⇒ `metrics.install_id = installId`; `storeTelemetryD1(env, event, ownerInstallId, authMode)` with the same ownership rule → 403; `ingest_auth_mode` stored.
5. Schema: `ensureTelemetrySchema` keeps its once-per-isolate guard, adds `ALTER TABLE telemetry_events ADD COLUMN ingest_auth_mode TEXT` (dup-tolerant) and runs `INSTALLS_DDL`. (Full removal of DDL from the request path is deferred to rr-api; keep it cheap.)
6. `withCors` is applied **only** to `/media/*` responses (`Access-Control-Allow-Origin: *` already set there); API responses carry no `access-control-*` headers; `OPTIONS` on API → 204 without CORS headers.
7. Top-level catch and `storeTelemetry` failure → `json({ok:false,error:"Internal error.",requestId},500)` where `requestId = crypto.randomUUID()`; `console.error("internal_error", {requestId, message: err?.message})`. No `details`.
8. `wrangler.template.toml` + real `wrangler.toml`: 
   ```toml
   [vars]
   LEGACY_INGEST_KEY_ENABLED = "true"
   [[unsafe.bindings]]
   name = "RL_INGEST"
   type = "ratelimit"
   namespace_id = "1001"
   simple = { limit = 60, period = 60 }
   [[unsafe.bindings]]
   name = "RL_REGISTER"
   type = "ratelimit"
   namespace_id = "1002"
   simple = { limit = 5, period = 60 }
   ```
- [ ] **Step 1:** Tests import `backend-worker/index.js` default export and call `fetch(request, env, ctx)`: register 201/200/409/429(hwid cap)/400; ingest signed 202 (INSERT binds contain `signed`), legacy key 202, legacy disabled 401, unsigned 401, bad signature 401, ownership 403, body 16 KB+1 → 413, RL fake returns `success:false` → 429; `/api/health` → 200 and **zero** recorded D1 operations; `OPTIONS /api/ingest` → no `access-control-allow-origin`; `/media/x` still has it (fetch mocked); forced storage error → 500 body has `requestId` and no SQL text.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** `npx vitest run tests/worker && node --check backend-worker/index.js && npm test` PASS → **Step 5:** `npx prettier --write backend-worker/index.js tests/worker && git add -A && git commit -m "feat(worker): install registration, signed ingest, ownership, rate limits, hygiene"`.

### Task 8: internalError sweep, `?secret=` removal

**Files:**
- Modify: every `functions/api/**/*.ts` that returns `err instanceof Error ? err.message : null` (grep: `grep -rn "err.message" functions/api`), `functions/api/discord/verify.ts`, `functions/api/discord/status.ts`
- Create: `tests/http/no-raw-errors.test.ts` (source scan), `tests/api/discord-auth.test.ts`

- [ ] **Step 1:** Tests: the scan test reads every `functions/api/**/*.ts` and asserts no `err.message`/`error.message` appears in a `return error(` call (regex over source); `discord/verify` with `?secret=<correct>` and no Bearer → 401; with Bearer → proceeds (mock D1).
- [ ] **Step 2:** FAIL → **Step 3:** replace each `return error(500, "...", err instanceof Error ? err.message : null)` with `return internalError(context.request, "Unable to complete the request.", err)` (`import { internalError } from "../../_lib/responses"`; adjust relative depth); delete the `url.searchParams.get("secret")` fallbacks. **Step 4:** `npm test && npm run typecheck` PASS. **Step 5:** commit `fix(api): never return raw errors; bot secret only via Bearer`.

### Task 9: Admin installs API + UI

**Files:**
- Create: `functions/api/admin/installs/index.ts` (`GET ?hwid=` → installs for a device), `functions/api/admin/installs/[id]/revoke.ts` (`POST {reason?}`), `tests/api/admin-installs.test.ts`
- Modify: `src/types/telemetry.ts` (`InstallRecord`), `src/utils/api.ts` (`fetchInstalls(hwid)`, `revokeInstall(id, reason)`), `src/pages/WorkersPage.tsx` (expanded row: "Installs" list with `install_id` (short), `app_version`, `last_seen_at`, verified badge when `license_id`, Revoke button with confirm; `legacy_key` ingest shows as an "unsigned" tag on the session when `ingest_auth_mode` is exposed — optional)

- [ ] Tests: GET requires dashboard access (401 without JWT), returns rows from mock D1; revoke POST updates `revoked_at` (mock records UPDATE with the id), second revoke → 200 idempotent; CSRF guard 403 on cross-site. UI: typecheck + `npm run build` only (no UI tests in repo).
- [ ] Commit `feat(admin): list and revoke installs per device`.

### Task 10: Final verification

- [ ] `npm run typecheck && npm test && npm run build && node --check backend-worker/index.js && npx prettier --check "functions/**/*.ts" "shared/**/*.ts" "backend-worker/**/*.js" "tests/**/*.ts"` all green; `git status --short` empty; `git log --oneline main..feat/backend-hardening` lists the task commits.
- [ ] Review the diff of `functions/_lib/storage.ts` and `backend-worker/index.js` once more for any change to *what* is stored (must be none except the new `ingest_auth_mode` column and `installs` table).

### Task 11: Operator runbook (executed by the session owner with the user, not by implementers)

1. Backup: `cd backend-worker && npx wrangler d1 export rr_admin_panel --remote --output ../.local/backup-<date>.sql` (`.local/` is gitignored).
2. Pages secrets/vars: `npx wrangler pages secret put ACCESS_TEAM_DOMAIN --project-name rr-admin-panel` (= `rr-adminpanel.cloudflareaccess.com`), `ACCESS_AUD` (= prod `14aedcc82d8c83376f49b14943599bdc058c5838cbf40ec01c9f3420c42dc26a,f37500a898d820071aedba2576de95cb6667c78b844917c91ead226722bf14a3`), `ACCESS_ALLOWED_EMAIL` (= the user's Access login e-mail(s)), `LEGACY_INGEST_KEY_ENABLED=true`, `REQUIRE_INSTALL_SIGNATURE=false`.
3. Worker: real `wrangler.toml` updated (bindings + vars); `npx wrangler deploy` from `backend-worker/`; `npx wrangler d1 execute rr_admin_panel --remote --file=../tools/installs.sql` (same DDL as `INSTALLS_DDL`, optional — the worker self-heals).
4. Merge `feat/backend-hardening` → `main`, push (Pages deploys). Check `git log origin/main..main` first.
5. Probes: unsigned ingest → 401; legacy key → 202; 100 rapid → 429; `GET /api/health` → `{ok:true}`; no `access-control-*` on `/api/ingest`; `pages.dev/api/admin/data` → 302; `curl -H "cf-access-jwt-assertion: x" pages.dev/api/admin/data` → still 302 (Access) and unit tests prove 401 from code; dashboard login works with the allow-listed email; a test registration + signed ingest with the vector fixture keys → 201/202.
6. Later: flip `LEGACY_INGEST_KEY_ENABLED=false` + `REQUIRE_INSTALL_SIGNATURE` per the 14-day rule; delete `APP_SHARED_KEY`/`INGEST_TOKEN` secrets.
