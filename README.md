# RR-Admin-Panel

RR-Admin-Panel is the RazorReaper operations console.

It is currently built as:

- React 19 + Vite frontend in [`/src`](./src) and [`/public`](./public)
- Cloudflare Pages Functions dashboard API in [`/functions`](./functions)
- Optional standalone ingest worker in [`/backend-worker`](./backend-worker)
- D1 as primary storage, with KV fallback in the Pages app
- Cloudflare Access or in-app email/password authentication

## Current Dashboard Behavior

- `Overview` is summary-only. It keeps charts and high-signal checks without duplicating row lists from the data pages.
- `Live` shows only genuinely active sessions seen within the last 6 minutes, with a stable sort so rows do not jump while you copy from the table.
- `Sessions` is the searchable session archive and supports readable `.txt` export.
- `Errors` shows recent real application failures only.
- `Settings` shows account, storage, build, and backend status.
- The shell uses RR branding, animated network background, glass panels, a resizable desktop sidebar, and the logo favicon.

## Architecture

There are two server-side entry points in this repo:

1. Cloudflare Pages app
   - Static frontend: Vite build output in `dist`
   - API routes: [`/functions/api`](./functions/api)
   - Auth routes, admin data, session export, summary, health, and ingest all exist here

2. Standalone Cloudflare Worker
   - Source: [`/backend-worker/index.js`](./backend-worker/index.js)
   - Supports ingest and health routes
   - Dashboard routes are intentionally disabled there and return `410`

The frontend uses same-origin API routes by default. Leave `VITE_API_BASE_URL` unset for the normal Pages deployment. Do not point the dashboard at the standalone `backend-worker` unless you also add the protected dashboard routes there.

## Session and Ingest Model

- Primary ingest route: `POST /api/ingest`
- Legacy ingest route: `POST /v1/telemetry/event`
- Legacy payloads without `session_id` are normalized into session records during ingest
- Active sessions time out after 6 minutes without activity
- Session exports are generated as readable block-formatted text reports, not a single-line dump

## Repository Layout

```text
.
|-- backend-worker/
|   |-- index.js
|   `-- wrangler.template.toml
|-- functions/
|   |-- _lib/
|   |   |-- admin.ts
|   |   |-- auth.ts
|   |   |-- http.ts
|   |   |-- storage.ts
|   |   |-- types.ts
|   |   `-- users.ts
|   |-- api/
|   |   |-- admin/
|   |   |   |-- data.ts
|   |   |   |-- sessions-export.ts
|   |   |   `-- verify.ts
|   |   |-- auth/
|   |   |   |-- bootstrap.ts
|   |   |   |-- change-password.ts
|   |   |   |-- login.ts
|   |   |   |-- logout.ts
|   |   |   `-- session.ts
|   |   |-- health.ts
|   |   |-- ingest.ts
|   |   `-- summary.ts
|   `-- v1/
|       `-- telemetry/
|           `-- event.ts
|-- public/
|   |-- brand.svg
|   |-- favicon.ico
|   `-- index.html
|-- src/
|   |-- components/
|   |-- hooks/
|   |-- img/
|   |-- pages/
|   |-- types/
|   |-- utils/
|   |-- App.tsx
|   |-- index.css
|   `-- main.tsx
|-- tools/
|   `-- generate-admin-hash.mjs
|-- .dev.vars.example
|-- package.json
|-- README.md
|-- schema.sql
|-- vite.config.ts
`-- wrangler.template.toml
```

## Requirements

- Node.js 20+
- npm
- Wrangler CLI

Install dependencies:

```bash
npm install
```

## Cloudflare Setup

### Pages app

The tracked Pages config is [`wrangler.template.toml`](./wrangler.template.toml). Keep your real Pages config in a local ignored `wrangler.toml` copied from that template.

Required bindings:

- `DB`: D1 database
- `KV`: KV namespace for fallback reads/writes in the Pages app

Create the D1 database and apply schema:

```bash
npx wrangler d1 create rr_admin_panel
npx wrangler d1 execute rr_admin_panel --remote --file=schema.sql
```

Create the KV namespaces:

```bash
npx wrangler kv namespace create RR_ADMIN_PANEL
npx wrangler kv namespace create RR_ADMIN_PANEL --preview
```

Create your local real config from the template and fill in the live IDs:

```powershell
Copy-Item wrangler.template.toml wrangler.toml
```

### Standalone ingest worker

The worker in [`/backend-worker`](./backend-worker) uses D1 and is meant for ingest and health endpoints only.

Create its local real config from the template:

```powershell
Copy-Item backend-worker/wrangler.template.toml backend-worker/wrangler.toml
```

Deploy it with:

```bash
cd backend-worker
npx wrangler deploy
```

## Environment Variables

Use [`.dev.vars.example`](./.dev.vars.example) as the local template.

Core variables:

- `INGEST_TOKEN`: required bearer token for ingest
- `TELEMETRY_APP_KEY`: optional legacy header key for `POST /v1/telemetry/event`
- `JWT_SECRET`: required for `AUTH_MODE=app`
- `AUTH_MODE`: `access` or `app`
- `STORAGE_BACKEND`: usually `d1`
- `ACCESS_ENFORCEMENT`: `strict` or `off`
- `ACCESS_ALLOWED_EMAIL`: optional comma-separated allowlist
- `ACCESS_ADMIN_EMAIL`: optional comma-separated admin list for Access mode
- `AUTH_SESSION_COOKIE`: optional app-auth cookie name, default `rr_session`
- `BUILD_SHA`: optional build marker for Settings/Health output

## Local Development

Copy local variables:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Then fill the secrets in `.dev.vars`.

The real Cloudflare binding IDs and any personal allowlists should stay in your local ignored `wrangler.toml` files, not in tracked files.

Useful commands:

```bash
npm run dev
npm run dev:pages
npm run typecheck
npm run build
```

What they do:

- `npm run dev`: frontend-only Vite dev server
- `npm run dev:pages`: builds the frontend and starts Cloudflare Pages local dev with Functions
- `npm run typecheck`: TypeScript type check
- `npm run build`: production frontend build to `dist`

## Deployment

### Pages preview or branch deploy

```bash
npm run build
npx wrangler pages deploy dist --project-name rr-admin-panel --branch <branch-name>
```

### Main Pages deploy

```bash
npm run build
npx wrangler pages deploy dist --project-name rr-admin-panel --branch main
```

### Standalone ingest worker deploy

```bash
cd backend-worker
npx wrangler deploy
```

## Public Repo Hygiene

If you want the repo public:

- keep secrets in Cloudflare dashboard secrets or local `.dev.vars`
- keep live Cloudflare binding IDs and personal emails in local ignored `wrangler.toml` files only
- commit only the `wrangler.template.toml` files with placeholders

Important: cleaning the current files does not erase old commits. If you want the old email or Cloudflare IDs removed from git history too, you need a history rewrite and force-push.

## Authentication

### `AUTH_MODE=access`

- The Pages dashboard is expected to sit behind Cloudflare Access / Zero Trust
- Dashboard requests use the Access identity headers
- This is the normal operator-facing deployment mode

### `AUTH_MODE=app`

- The dashboard uses its own email/password login
- On first boot, if no users exist, the app shows bootstrap account creation
- Session state is stored in a signed cookie

## API Routes

### Pages app routes

- `GET /api/health`
  - Public health payload with storage/build info
- `GET /api/summary`
  - Unprotected telemetry summary payload
- `POST /api/ingest`
  - Bearer-token ingest
- `POST /v1/telemetry/event`
  - Legacy-compatible ingest route
- `GET /api/auth/session`
  - Resolves current dashboard auth state
- `POST /api/auth/bootstrap`
  - One-time first admin creation in app-auth mode
- `POST /api/auth/login`
  - App-auth login
- `POST /api/auth/logout`
  - App-auth logout
- `POST /api/auth/change-password`
  - App-auth password change
- `GET /api/admin/data`
  - Protected dashboard payload used by the UI
- `GET /api/admin/sessions-export`
  - Protected readable `.txt` session export

### Standalone worker routes

- `GET /health`
  - Simple worker health check
- `GET /api/health`
  - Health payload from worker storage path
- `POST /api/ingest`
  - Ingest endpoint
- `POST /v1/telemetry/event`
  - Legacy ingest endpoint

These routes are intentionally disabled on the standalone worker:

- `GET /api/summary`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/admin/data`

## Session Export

The session export endpoint writes a readable `.txt` report generated by [`loadSessionExportText`](./functions/_lib/storage.ts). It includes:

- generation timestamp
- storage backend
- total session count
- one labeled block per session

The protected route is [`/api/admin/sessions-export`](./functions/api/admin/sessions-export.ts).

## Notes

- Keep `VITE_API_BASE_URL` empty for the normal Pages dashboard unless you are intentionally targeting another full dashboard API.
- The Live page is intentionally stricter than the broader session archive: it only shows sessions seen within the last 6 minutes.
- D1 is the primary store. KV exists as Pages fallback support.
- Do not commit `.dev.vars`, `.wrangler`, `dist`, or `node_modules`.
