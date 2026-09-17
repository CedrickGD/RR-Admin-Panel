# Update Proxy → make the RazorReaper repo private

The desktop auto-updater used to fetch two things straight from GitHub, unauthenticated:

1. the manifest — `raw.githubusercontent.com/CedrickGD/RazorReaper/master/update.xml`
2. the installer — the `RazorReaper-Setup.exe` asset on the GitHub release

Both 404 the moment the repo goes private. The **backend worker** now proxies both so the app
never touches GitHub directly, with a server-side token doing the auth. That's what lets the repo
go private.

## What was built

- **Worker** (`backend-worker/index.js`, deployed):
  - `GET /update/update.xml` — fetches the manifest via the GitHub Contents API and rewrites its
    `<url>` to `…/update/download`.
  - `GET /update/download` — resolves the **latest** GitHub release's `RazorReaper-Setup.exe` and
    **302-redirects** to GitHub's short-lived signed asset URL (the installer is ~73 MB — not the
    ~750 MB this doc previously said — and it never streams through the worker either way).
  - The GitHub token is **optional**: while the repo is public these work unauthenticated. Set
    `GITHUB_TOKEN` before flipping to private.
  - The same `backend-worker/index.js` code is also what runs as `rr-api` on the NAS, serving
    `dl.razorreaper.app` / `api.razorreaper.app` — see step 4's "Set it in both places" below.
- **App** (`UpdateService.cs`): manifest URL now points at
  `https://backend.rr-admin-panel.workers.dev/update/update.xml` instead of raw.githubusercontent.
  `AutoUpdateManager` downloads from the manifest's `<url>`, which the worker rewrites — so no other
  app change is needed.

Verified live (public repo, no token): manifest returns correct version + rewritten `<url>`;
`/update/download` 302s to the signed installer URL (HTTP 206 on a range probe).

## ⚠️ Rollout order — do NOT make the repo private yet

Every **already-installed** client (v1.4.8 and older) has the *old* raw.githubusercontent URL baked
into its binary. If the repo goes private now, those clients can never update again. So:

1. **Now (done):** worker proxy live, app points at it. Repo stays public.
2. **Ship a transition release** (e.g. v1.4.9) through the *current* public flow — this build contains
   the worker-pointing `UpdateService`. Old clients download it from public GitHub and upgrade →
   from then on they check the worker, not GitHub.
   - Merge the app branch `user-suspension-license-check-22b656` → `master`, bump the version, build,
     publish the release as usual. update.xml auto-updates via the existing Action.
3. **Wait for adoption** — watch the admin panel Versions/telemetry until the bulk of clients report
   v1.4.9+. As of the 2026-09-17 audit (last 30 days, 829 distinct installs), the split is:
   1.5.2 = 397, 1.4.8 = 253, 1.4.9 = 110, 1.4.10 = 41, 1.5.0 = 9, older = 7, legacy = 12.
   **v1.4.8 and older = 272 of those 829 installs (~33%).** Those are the ones this doc calls
   "stranded" below, and they are not a fringe case — see "Why they don't just update anyway"
   in `RazorReaper`'s `docs/release-process.md` (v1.4.8 stages its installer but only runs it
   from a window-close handler that its tray-minimize `X` button never triggers). Clients on
   ≤1.4.8 will be stranded when you go private and would need a manual reinstall from the shop.
4. **Create the token + flip to private:**
   - GitHub → Settings → Developer settings → **Fine-grained PAT**: Resource owner = CedrickGD,
     Repository = **RazorReaper only**, Permissions → **Contents: Read-only**. Copy the token.
   - **Set it in both places — this is not optional, and they are two separate deployments of the
     same code:**
     ```bash
     # 1. The Cloudflare Worker (backend.rr-admin-panel.workers.dev)
     cd RR-Admin-Panel/backend-worker
     npx wrangler secret put GITHUB_TOKEN   # paste the token when prompted
     ```
     ```bash
     # 2. The NAS's rr-api (dl.razorreaper.app / api.razorreaper.app) — same index.js,
     #    deployed separately; see deploy/nas/rr-api/.env.example for the variable name.
     #    Edit rr-api.env on the NAS and restart the service.
     GITHUB_TOKEN=...
     ```
     As of the 2026-09-17 audit: the NAS `rr-api.env` **is** set; the Worker's `wrangler secret`
     has **not been verified** — confirm it before flipping visibility, since only one of the two
     being set is enough to leave the other endpoint 404ing once the repo is private.
   - (Token also raises the rate limit from 60/h-per-IP unauth to 5000/h with auth — worth setting
     even before going private if you have many users.)
   - Verify the worker still serves with the repo private:
     `curl -s https://backend.rr-admin-panel.workers.dev/update/update.xml` (expect the XML) and
     `curl -sL -r 0-0 https://backend.rr-admin-panel.workers.dev/update/download -o /dev/null -w "%{http_code}\n"` (expect 206).
     Repeat both against the NAS's own `dl.razorreaper.app` / `api.razorreaper.app` host.
   - GitHub → repo → Settings → Danger Zone → **Change visibility → Private**.

## Notes

- The GitHub Action that regenerates `update.xml` on release keeps working on a private repo
  (Actions run inside the repo; the worker reads the file via the authed Contents API).
- **`<changelog>` is never rewritten — only `<url>` is** (`handleUpdateManifest` in
  `backend-worker/index.js` touches exactly one element). It still points at the GitHub release
  *tag page*, which 404s for non-members once private. It's a non-critical "view changelog" link
  (the in-app "What's new" — `RazorReaper/Components/Shared/WhatsNewOverlay.razor` — reads the
  embedded `<notes>`, which are unaffected), but it is a dead link for signed-out visitors on a
  private repo until it's repointed at Discord `#changelog` or something the panel proxies.
- **The client's own fallback is public-repo-only, separately from the worker.** `UpdateService.cs`
  falls back to `raw.githubusercontent.com/CedrickGD/RazorReaper/master/update.xml` when the worker
  call itself fails (timeout, 5xx, DNS). That fallback 404s once the repo is private, same as the
  worker's own two proxied endpoints would if the token were missing. In practice this means: once
  private, a worker outage is no longer a "degraded, try the mirror" event for any client — it's a
  full update outage until the worker recovers, with no third path.
- **`/update/download` serves the *latest* GitHub release, not necessarily the release
  `update.xml` names.** `handleUpdateDownload` always calls `GET /repos/.../releases/latest`; the
  code comment justifying this ("the manifest's version always matches the latest release") is an
  assumption the workflow normally keeps true (`update-manifest.yml` only runs on `release:
  released`), but nothing enforces it structurally. Publishing any release out of band — a hotfix,
  a prerelease later marked latest, or a manual `workflow_dispatch` run against the wrong tag —
  desyncs the two: `update.xml` would still describe version A while `/update/download` starts
  handing out installer B, silently.
- **The panel's own Versions page reads GitHub unauthenticated, from the browser, and will not
  notice a private repo.** `src/hooks/useReleaseVersions.ts` (`GET
  api.github.com/.../releases`) and `src/hooks/useLatestVersion.ts` (`GET
  raw.githubusercontent.com/.../update.xml`) both call GitHub directly with no token, cache the
  result in `localStorage` for an hour, and fall back to a hard-coded version — `"1.4.2"` in
  `useLatestVersion.ts` — on any failure. Once the repo is private both calls 404 for every
  visitor, and the page quietly shows stale/cached or the 1.4.2 fallback with no error surfaced.
  This page needs its own authenticated path (through the worker, presumably) before or alongside
  the private flip; it's the gap the panel's planned release-management page is meant to close.
- Env overrides (optional): `GITHUB_REPO`, `GITHUB_BRANCH`, `UPDATE_ASSET_NAME` — defaults are
  `CedrickGD/RazorReaper`, `master`, `RazorReaper-Setup.exe`.
