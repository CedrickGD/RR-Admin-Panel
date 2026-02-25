# RR-Admin-Panel (Cloudflare Pages + Functions)

RR-Admin-Panel is now a Cloudflare Pages full-stack app:

- Frontend SPA: Vite + TypeScript (`/public` + `/src`)
- Backend API: Pages Functions (`/functions/api/*`)
- Storage: D1 primary, KV fallback
- Auth mode `access`: Cloudflare Access only
- Auth mode `app`: email/password accounts with secure session cookie

## MANUAL SETUP REQUIRED

Complete every checkbox yourself. These steps cannot be automated from this repo.

- [ ] Install prerequisites locally: Node.js 20+, npm, Wrangler CLI.
  - Command: `npm install -g wrangler`
- [ ] Install project dependencies.
  - Command: `npm install`
- [ ] Create a Cloudflare D1 database (primary storage).
  - Command: `npx wrangler d1 create rr_admin_panel`
  - Copy returned `database_id` into `wrangler.toml` (`[[d1_databases]]` block).
- [ ] Apply schema to D1.
  - Command: `npx wrangler d1 execute rr_admin_panel --remote --file=schema.sql`
- [ ] Create Cloudflare KV namespaces (fallback storage).
  - Command: `npx wrangler kv namespace create RR_ADMIN_PANEL`
  - Command: `npx wrangler kv namespace create RR_ADMIN_PANEL --preview`
  - Copy IDs into `wrangler.toml` (`[[kv_namespaces]]` block).
- [ ] Push this repository to GitHub (Cloudflare Pages deploy source).
  - Commands:
  - `git add .`
  - `git commit -m "Migrate RR-Admin-Panel to Cloudflare Pages + Functions"`
  - `git push`
- [ ] Create Cloudflare Pages project from GitHub.
  - Cloudflare Dashboard -> `Workers & Pages` -> `Create` -> `Pages` -> `Connect to Git`.
  - Select this GitHub repo and target branch.
  - Build command: `npm run build`
  - Build output directory: `dist`
  - Root directory: `/`
- [ ] Bind storage in Pages project settings.
  - Cloudflare Pages project -> `Settings` -> `Bindings` -> `Add` -> `D1 database`: add binding `DB` -> your D1 database.
  - Cloudflare Pages project -> `Settings` -> `Bindings` -> `Add` -> `KV namespace`: add binding `KV` -> your namespace.
- [ ] Add required secrets/variables in Pages project settings (Production + Preview as needed).
  - Cloudflare Pages project -> `Settings` -> `Variables and Secrets`.
  - Secrets:
  - `INGEST_TOKEN` = long random bearer token for device ingestion
  - `JWT_SECRET` = long random secret for app session signing
- Variables:
  - `AUTH_MODE` = `access` (Cloudflare-only) or `app` (in-app email/password)
  - `STORAGE_BACKEND` = `d1`
  - `ACCESS_ENFORCEMENT` = `strict` for Access-protected routes (recommended in `AUTH_MODE=access`)
  - `ACCESS_ALLOWED_EMAIL` = optional comma-separated Access identity allowlist
  - `AUTH_SESSION_COOKIE` = optional, default `rr_session`
  - `BUILD_SHA` = optional commit marker (or leave unset to use `CF_PAGES_COMMIT_SHA`)
- [ ] (Alternative to dashboard) Set Pages secrets via Wrangler CLI.
  - Command: `npx wrangler pages secret put INGEST_TOKEN --project-name <your-pages-project>`
- [ ] (Optional) Configure Cloudflare Access for the Pages domain (edge auth).
  - Zero Trust Dashboard -> `Access` -> `Applications` -> `Add an application`.
  - Create app `RR Admin UI` as `Self-hosted`.
  - Domain: your Pages/custom domain, path `/*`.
  - Policy: `Allow` -> include only `cedrickgrabe@outlook.de`.
  - Save and deploy policy.
- [ ] (Optional) Create Cloudflare Access Service Token for CLI/API calls (used by curl against protected routes).
  - Zero Trust Dashboard -> `Access` -> `Service Auth` -> `Service Tokens` -> `Create service token`.
  - Add an Access policy that allows this service token for the protected app.
  - Save `CF-Access-Client-Id` and `CF-Access-Client-Secret` securely.
- [ ] Create a second Access app/policy for ingestion path bypass (recommended for headless devices).
  - Zero Trust Dashboard -> `Access` -> `Applications` -> `Add an application`.
  - App name: `RR Admin Ingest`.
  - Domain/path: same domain, path `/api/ingest*`.
  - Action: `Bypass`.
  - Keep app-level bearer security in code via `INGEST_TOKEN`.
- [ ] (Optional but recommended) Add a custom domain to Pages for stable public URL.
  - Cloudflare Pages project -> `Custom domains` -> Add domain.
- [ ] (Only for `AUTH_MODE=app`) Initialize first admin account (one-time, in app).
  - Open your deployed URL.
  - If no account exists, the app shows `Create Admin Account`.
  - Create your email + password directly in the UI.
- [ ] Verify live deployment from a different network/device.
  - Open `https://<your-domain>` and confirm:
  - Login screen appears (or Access challenge first if `ACCESS_ENFORCEMENT=strict`).
  - Dashboard data loads after successful sign-in.

## Repository Layout

```text
.
|-- functions/
|   |-- _lib/
|   |   |-- auth.ts
|   |   |-- http.ts
|   |   |-- storage.ts
|   |   |-- users.ts
|   |   `-- types.ts
|   `-- api/
|       |-- admin/
|       |   |-- data.ts
|       |   `-- verify.ts
|       |-- auth/
|       |   |-- bootstrap.ts
|       |   |-- change-password.ts
|       |   |-- login.ts
|       |   |-- logout.ts
|       |   `-- session.ts
|       |-- health.ts
|       |-- ingest.ts
|       `-- summary.ts
|-- public/
|   |-- brand.svg
|   `-- index.html
|-- src/
|   |-- main.ts
|   |-- styles.css
|   `-- vite-env.d.ts
|-- tools/
|   `-- generate-admin-hash.mjs
|-- .dev.vars.example
|-- .gitignore
|-- package.json
|-- schema.sql
|-- tsconfig.json
|-- vite.config.ts
`-- wrangler.toml
```

## Security Model

1. `AUTH_MODE=access`: `GET /api/admin/data` requires valid Cloudflare Access identity.
2. `AUTH_MODE=app`: `GET /api/admin/data` requires valid app session cookie.
3. Optional Cloudflare Access layer can also be enforced in app mode (`ACCESS_ENFORCEMENT=strict`).
4. `POST /api/ingest` requires `Authorization: Bearer <INGEST_TOKEN>`.

## Local Development

1. Copy local vars file:
   - `Copy-Item .dev.vars.example .dev.vars`
2. Fill `.dev.vars` with local secrets.
3. For local dev without Access edge headers, keep `ACCESS_ENFORCEMENT=off` in `.dev.vars`.
4. Build frontend:
   - `npm run build`
5. Run Pages Functions + static output locally:
   - `npm run pages:dev`
6. Open local URL reported by Wrangler (usually `http://127.0.0.1:8788`).

## API Endpoints

- `POST /api/ingest`
  - Auth: `Authorization: Bearer <INGEST_TOKEN>`
  - Writes telemetry event, updates latest status, caps history to 500.
- `GET /api/summary`
  - Returns latest status + recent events + counts.
- `GET /api/health`
  - Returns API/storage state, last ingest, event count, build info.
- `GET /api/admin/data`
  - Auth: Cloudflare Access identity (`AUTH_MODE=access`) or app session cookie (`AUTH_MODE=app`).
  - Returns protected summary + health payload.
- `GET /api/auth/session`
  - Returns current auth session state and whether users exist.
- `POST /api/auth/bootstrap`
  - One-time first admin creation (only if no users exist).
- `POST /api/auth/login`
  - Email/password login.
- `POST /api/auth/logout`
  - Clears session cookie.
- `POST /api/auth/change-password`
  - Updates signed-in user password.

## curl Examples

For production routes protected by Access, include `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers (or run curl from an already authenticated Access session).

### 1) Ingest Telemetry

```bash
curl -X POST "https://<your-domain>/api/ingest" \
  -H "Authorization: Bearer <INGEST_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "razorreaper-host",
    "timestamp": "2026-02-25T12:00:00Z",
    "service": "collector",
    "status": "ok",
    "metrics": { "cpu_pct": 14.2, "mem_mb": 712, "queue_depth": 1 },
    "message": "heartbeat"
  }'
```

### 2) Read Summary

```bash
curl "https://<your-domain>/api/summary" \
  -H "CF-Access-Client-Id: <ACCESS_SERVICE_CLIENT_ID>" \
  -H "CF-Access-Client-Secret: <ACCESS_SERVICE_CLIENT_SECRET>"
```

## Notes

- No secrets are committed to source.
- D1 is primary; KV is automatic fallback if D1 is unavailable.
- Keep repo source-only; do not commit `node_modules`, `dist`, `.wrangler`, logs, or local env files.
