# RR Admin Panel

Private admin dashboard for Cloudflare telemetry.

## Layout

- `Program.cs`: ASP.NET host + `/api/cloudflare/*` proxy.
- `backend/`: Cloudflare Worker admin/telemetry API.
- `frontend/`: React UI source.
- `wwwroot/`: published frontend assets served by the host.
- `scripts/`: local maintenance scripts.

## Run locally

```powershell
dotnet run
```

Default URL: `http://localhost:5035`

## Cloudflare proxy config

Set in `appsettings.Development.json`:

```json
"CloudflareAdmin": {
  "Enabled": true,
  "BaseUrl": "https://backend.rr-admin-panel.workers.dev",
  "AdminApiKey": "YOUR_ADMIN_KEY"
}
```

Main proxied telemetry endpoints:
- `/api/cloudflare/overview`
- `/api/cloudflare/events-by-type`
- `/api/cloudflare/daily?days=30`
- `/api/cloudflare/app-opens?days=30`
- `/api/cloudflare/workers`
- `/api/cloudflare/sessions?days=7&limit=25`

## Publish frontend to host

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-frontend.ps1
```

This builds `frontend` and syncs `dist` into `wwwroot`, including stale hashed bundle cleanup.
