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
  - `GET /update/download` — resolves the latest release's `RazorReaper-Setup.exe` and **302-redirects**
    to GitHub's short-lived signed asset URL (the ~750 MB never streams through the worker).
  - The GitHub token is **optional**: while the repo is public these work unauthenticated. Set
    `GITHUB_TOKEN` before flipping to private.
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
   v1.4.9+. (Clients still on ≤1.4.8 will be stranded when you go private — that's the unavoidable tail;
   they'd need a manual reinstall from the shop.)
4. **Create the token + flip to private:**
   - GitHub → Settings → Developer settings → **Fine-grained PAT**: Resource owner = CedrickGD,
     Repository = **RazorReaper only**, Permissions → **Contents: Read-only**. Copy the token.
   - Set it on the worker:
     ```bash
     cd RR-Admin-Panel/backend-worker
     npx wrangler secret put GITHUB_TOKEN   # paste the token when prompted
     ```
   - (Token also raises the rate limit from 60/h-per-IP unauth to 5000/h with auth — worth setting
     even before going private if you have many users.)
   - Verify the worker still serves with the repo private:
     `curl -s https://backend.rr-admin-panel.workers.dev/update/update.xml` (expect the XML) and
     `curl -sL -r 0-0 https://backend.rr-admin-panel.workers.dev/update/download -o /dev/null -w "%{http_code}\n"` (expect 206).
   - GitHub → repo → Settings → Danger Zone → **Change visibility → Private**.

## Notes

- The GitHub Action that regenerates `update.xml` on release keeps working on a private repo
  (Actions run inside the repo; the worker reads the file via the authed Contents API).
- `<changelog>` in the manifest still points at the GitHub release *tag page*, which 404s for
  non-members once private. It's a non-critical "view changelog" link — the in-app "What's new"
  uses the embedded `<notes>`, which are unaffected. Can be repointed to Discord #changelog later.
- Env overrides (optional): `GITHUB_REPO`, `GITHUB_BRANCH`, `UPDATE_ASSET_NAME` — defaults are
  `CedrickGD/RazorReaper`, `master`, `RazorReaper-Setup.exe`.
