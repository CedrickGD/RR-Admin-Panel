# RR Admin Panel Dashboard

## Run

```powershell
cd RR-Admin-Panel
dotnet run
```

The host runs on `http://localhost:5035` by default.

## Login flow

The first screen prompts only for the private backend key.

- The key is required before opening the dashboard.
- It is sent as `X-Admin-Key` on each Cloudflare admin request.
- Backend URL is fixed to the local host proxy (`http://localhost:5035/api`).
- Auth state is session-only (startup always returns to the key prompt).

## Cloudflare integration (optional)

After sign-in, the dashboard polls backend admin endpoints continuously (default every 15s).
If backend data is unavailable, the UI shows explicit empty/error states instead of synthetic placeholder metrics.

To proxy Cloudflare admin data through ASP.NET, configure `appsettings.json` or `appsettings.Development.json`:

```json
"CloudflareAdmin": {
  "Enabled": true,
  "BaseUrl": "https://backend.rr-admin-panel.workers.dev",
  "AdminApiKey": "YOUR_ADMIN_KEY"
}
```

Proxied endpoints:
- `GET /api/cloudflare/overview`
- `GET /api/cloudflare/events-by-type`
- `GET /api/cloudflare/daily?days=30`
- `GET /api/cloudflare/workers`

Weather on overview is fetched from Open-Meteo (Berlin, DE) every 15 minutes.

## Frontend source

React + TypeScript source lives in `frontend/src`.

Structure:
- `frontend/src/app` app entry + shell
- `frontend/src/features/auth` login flow
- `frontend/src/features/dashboard` dashboard sections, feature data, and API service
- `frontend/src/shared/ui` reusable UI primitives
- `frontend/src/shared/types` shared domain types

Backend Worker source:
- `backend/src/index.ts` route registration
- `backend/src/handlers` endpoint handlers
- `backend/src/lib` shared helper utilities
- `backend/src/types` runtime/env types

If you change frontend code:

```powershell
cd RR-Admin-Panel/frontend
npm install
npm run build
Copy-Item -Path dist\* -Destination ..\wwwroot -Recurse -Force
```

Frontend npm commands are self-healing for dependencies:
- `npm run dev`, `npm run build`, `npm run lint`, and `npm run preview` in `frontend` auto-install missing deps (including `typescript`) before running.
- For deterministic setup on a fresh machine, you can still run `npm ci` first.
