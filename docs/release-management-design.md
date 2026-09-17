# Release management

Design for the panel's `#/releases` page and everything behind it: draft a release, let a GitHub
runner build the installer, edit the customer-facing notes, publish — and roll back — with explicit
clicks, so the desktop app updates from the NAS and the source repo can go private.
Wire types: `shared/releases-contract.ts`. Everything below names real files; nothing is a sketch.

## 1. Goals and non-goals

- The owner drafts a release in the panel, not in a text editor and not on github.com, and a GitHub
  Windows runner builds the installer — no local MAUI workload, Inno Setup or Desktop folder.
- Customer-facing notes are written in the panel and previewed exactly as the app's What's-new list
  renders them. Raw commit messages never reach a customer.
- Publishing writes the GitHub release **and** `update.xml` in one resumable operation, so the
  manifest can never point at a tag whose asset does not exist. The browser never talks to GitHub.
- `update.xml` pins a tag and `/update/download` serves _that_ tag's asset — so a rollback is a
  **first-class governed action** (`make-current`, §6), not a hand edit and not a deleted release.
- **Publishing and rollback stay the owner's button.** Each needs a confirm token minted by a
  separate call and a modal printing the server's effect list. No schedule, no webhook, no agent, no
  "publish on green build"; Claude never creates a release or a tag. Out of scope: release branches,
  a changelog generated from commits, SSE, targeted prerelease rollout (decision 4).

## 2. Decisions

Owner decisions, recorded so the implementation does not re-litigate them.

1. **ffmpeg is not bundled by the runner build.** `RazorReaper/Tools/ffmpeg.exe` is gitignored
   (97 MB) and the `csproj` includes it only `Condition="Exists(...)"`, so a runner-built installer
   ships without it and `FfmpegProvider` downloads it at first use. Accepted — but the notes of the
   first CI-built version must state the change ("the first conversion downloads ffmpeg").
2. **Files and workflow editing are owner-only** — new permission `releases.files`, granted to the
   `owner` role only. Admins keep drafts, build, publish and rollback (§4).
3. **Notes host: `https://dl.razorreaper.app/release-notes/<tag>`** — public, cached, served by
   rr-api on the NAS. The Discord post links there and the `<changelog>` rewrite points there, so a
   customer never needs repo access.
4. **A prerelease never writes `update.xml`.** No customer is offered one, so publishing a
   prerelease skips the manifest step — refused, not merely defaulted off.
5. **Stranded 1.4.8-and-older installs** (272) are reached by a version-targeted announcement (§10).
   Spending a mandatory release on them is the owner's call, later; the private flip waits for the
   owner's adoption threshold, not a fixed date.
6. **Support and viewer seats see the Releases page read-only** — overview and releases list only.
7. **Code signing is optional in CI.** The owner signs local builds with a self-signed certificate
   (keys repo `Self-Sign/RazorReaperCodeSign.pfx`, driven by `rr_sign.bat`); `build-installer.yml`
   gains an optional step with the same signtool parameters (§7). Neither the pfx nor its password
   is copied anywhere: the workflow reads owner-created secrets and skips loudly without them.
8. **`GITHUB_RELEASE_TOKEN` currently holds the placeholder `"xxx"`** in the NAS env. The client
   treats any value not starting with `github_pat_` or `ghp_` as absent: mode `"placeholder"`,
   read-only behaviour, persistent status line naming the variable (§5).

## 3. Data model

Two tables in the same SQLite database, lazily ensured like `ensureAnnouncementsSchema`
(`functions/_lib/content.ts`) and mirrored in `tools/migrations/2026-09-18-release-drafts.sql`.

```sql
CREATE TABLE IF NOT EXISTS release_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL, tag TEXT NOT NULL,            -- "1.5.4", "v1.5.4"
  title TEXT NOT NULL DEFAULT '',
  notes_customer TEXT NOT NULL DEFAULT '',             -- one bullet per line, no "- " prefix
  notes_full_md TEXT NOT NULL DEFAULT '',              -- release body + public notes page
  commit_message TEXT NOT NULL DEFAULT '',
  mandatory INTEGER NOT NULL DEFAULT 0, prerelease INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','building','built','published','failed')),
  github_release_id INTEGER, github_run_id INTEGER, asset_name TEXT, asset_size INTEGER,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, published_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_release_drafts_tag ON release_drafts(tag);

CREATE TABLE IF NOT EXISTS release_events (  -- draft_id null = repo-wide write (a file commit)
  id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id INTEGER,
  kind TEXT NOT NULL, actor TEXT NOT NULL,   -- ReleaseEventKind, panel e-mail
  detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_release_events_draft ON release_events(draft_id, id DESC);
```

`release_events` is the draft's timeline (shown in the drawer); it does **not** replace `auditPanel`
— every write also inserts a `panel_audit` row. `ensureReleasesSchema(env)` in
`functions/_lib/releases-store.ts` runs at the top of every handler, cached per-DB like
`ensureFeedbackSchema`. A draft is the source of truth for a version _before_ publish; afterwards
GitHub is. `failed` is reachable from `building` and `published` — a failed publish keeps its
completed steps and resumes. A `make-current` rollback writes only `release_events` + `panel_audit`.

## 4. Permissions

`shared/panel-policy.ts` gains three permissions, `rolePermissions` must stop handing owner and
admin the same list (decision 2), and `routePermissions` branches stay ordered specific-first:

```ts
{ key: "releases.read",  label: "View releases & drafts",            group: "Releases" },
{ key: "releases.write", label: "Draft, build, publish & roll back", group: "Releases" },
{ key: "releases.files", label: "Edit repository files & workflows", group: "Releases" },

if (role === "owner") return PERMISSIONS.map((p) => p.key);
if (role === "admin") return PERMISSIONS.map((p) => p.key).filter((k) => k !== "releases.files");

if (path === "/api/admin/releases/versions") return ["monitoring.read"];         // Versions page
if (path.startsWith("/api/admin/releases/files")) return ["releases.read", "releases.files"];
if (path.startsWith("/api/admin/releases/workflows"))
  return write ? ["releases.read", "releases.files"] : ["releases.read"];
if (path.startsWith("/api/admin/releases")) return [write ? "releases.write" : "releases.read"];
```

`support` gains `"releases.read"` explicitly; `viewer` picks it up through the existing `.read`
filter. Neither ever matches `releases.files`, which ends in neither `.read` nor `.write` — so
`effectivePermissions`' write-implies-read filter does **not** cover it, which is why the file routes
demand `releases.read` alongside it. `PAGE_PERMISSION.releases = "releases.read"`, and `PageKey` in
`src/types/telemetry.ts` gains `"releases"`. Dispatching an _arbitrary_ workflow is remote code
execution on a runner holding the release token, so it sits with files; the draft's own
`…/drafts/:id/build` dispatch stays `releases.write` because its inputs are the draft, not free
text. `requireDashboardAccess` (`functions/_lib/admin.ts:54`) is unchanged — it already resolves
`routePermissions`, enforces the same-origin guard and sets `permissionChecked`.

## 5. GitHub client module

`functions/_lib/github-release.ts` — the only file in the panel that knows a GitHub URL; the
backend-worker build imports the same module (plain `fetch`, no runtime bindings).

**Token resolution**, in order: `GITHUB_RELEASE_TOKEN` (fine-grained: Contents RW, Actions RW,
Workflows, Metadata) → `GITHUB_TOKEN` (the existing Contents read-only token) → none.
`tokenStatus(env): TokenStatus` reports `mode: "write" | "read-only" | "placeholder" | "missing"`. A
`GITHUB_RELEASE_TOKEN` whose trimmed value does not start with `github_pat_` or `ghp_` is **treated
as absent** and reported as `"placeholder"` — the NAS env carries the literal `"xxx"` today
(decision 8), and a 401 storm on every click is worse than a clear status line. With anything but
`write` every mutating handler returns `409 { code: "no-write-token" }`. The token is never echoed,
logged or sent to the browser; `TokenStatus.source` is the variable's _name_.
**Calls used**, all with `X-GitHub-Api-Version: 2022-11-28` and `User-Agent: RazorReaper-Panel`:
`GET|POST /repos/{r}/releases`, `GET …/releases/tags/{tag}`, `PATCH …/releases/{id}`
(`draft`/`body`/`name`/`prerelease`); `GET …/releases/{id}/assets`, `DELETE …/releases/assets/{id}`
(upload is the runner's job); `GET …/compare/{tag}...{branch}`, `…/contents/{path}?ref=`,
`…/git/trees/{sha}`; and the Actions endpoints for workflows, dispatches, runs, jobs and job logs.

**The atomic commit sequence.** Every panel write to the repo — version bump, `update.xml` on
publish or `make-current`, a Files-tab commit — goes through `commitFiles(repo, branch, files,
message)` in this exact order:

1. `GET /repos/{r}/git/ref/heads/{branch}` → `object.sha` = **headSha**. Nothing is written before
   HEAD is read: a commit built on a stale parent is the bug this step prevents.
2. `GET /repos/{r}/git/commits/{headSha}` → `tree.sha` = **baseTreeSha**.
3. `POST …/git/blobs` once per file (`encoding: "utf-8"`).
4. `POST …/git/trees` with `base_tree: baseTreeSha`, one entry per blob (`mode: "100644"`).
5. `POST …/git/commits` with `message`, the new tree, and `parents: [headSha]`.
6. `PATCH …/git/refs/heads/{branch}` with `{ sha: newCommitSha, force: false }`.

**Step 6 is the concurrency guard.** `force: false` makes GitHub refuse a non-fast-forward, so if
master advanced between step 1 and step 6 the PATCH fails (422 "Update is not a fast forward")
instead of silently discarding the other commit. That refusal — not an ETag, not a lock — is what
makes the sequence safe. **Retry policy: exactly one retry.** Re-read HEAD (steps 1–2), re-verify
the preconditions against the _new_ HEAD, rebuild blobs/tree/commit on the new base, PATCH again.
The re-verification is what makes an automatic retry safe: if any path in the commit changed on
master meanwhile — a Files-tab `baseSha` no longer matches, or `update.xml` was rewritten — the
retry is abandoned with `409 { code: "stale" }` so a human resolves it. A second non-fast-forward
gives up with `409 "master moved twice while this was being written — reload and retry."` No third
attempt, no backoff loop. (A Contents write per file would leave master half-bumped if the second
call failed; this is one ref move for all files at once.)
**Caching, limits, errors.** Every GET replays its stored `ETag` as `If-None-Match`; overview reads
are memoised 60 s, 30 s while `building`. `x-ratelimit-remaining` / `-reset` feed `TokenStatus`;
below 100 remaining the module refuses non-essential GETs and the overview returns `stale: true`.
`401/403` → `502 "GitHub rejected the panel's token."` plus a `release_events` `error` row; `404` on
a tag → `404` naming it; `422` on `PATCH ref` → the retry above, then `409`. No GitHub error body is
forwarded verbatim.

## 6. Admin API contract

All under `functions/api/admin/releases/`, all JSON, all behind `requireDashboardAccess`. Types are
in `shared/releases-contract.ts`; only behaviour is described here.

| Method + path                                                          | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/releases`                                              | `ReleasesOverviewResponse`: token status, latest published release, all releases (30), drafts, last 10 workflow runs, `update.xml` state incl. the tag it pins, adoption of the latest version from `app_sessions`. One call — the page makes no others on load.                                                                                                                                                      |
| `GET …/commits?since=<tag>`, `…/drafts/:id/events`                     | `CommitsSinceResponse` from `compare` (default `since` = latest published tag, capped at 100, `truncated` set); `ReleaseEventsResponse`, newest first.                                                                                                                                                                                                                                                                |
| `POST …/drafts`                                                        | Creates a draft. `version` required and > the latest published version; `tag` defaults to `v{version}`, `title` to `RazorReaper {version}`, `commit_message` to `release: {version}`. 409 on duplicate.                                                                                                                                                                                                               |
| `PUT` / `DELETE …/drafts/:id`                                          | Partial update with `expectedUpdatedAt`, mismatch → `409 { code: "stale" }`, refused once `published`. Delete only while `draft` or `failed`; it drops the row and never touches GitHub.                                                                                                                                                                                                                              |
| `POST …/drafts/:id/build`                                              | Needs `confirmToken`. (1) commits the version bump — five `csproj` fields + `MyAppVersion` in the `.iss` — via `commitFiles` with the draft's `commit_message`, unless master already carries that version; (2) dispatches `build-installer.yml` with `version`, `notes`, `prerelease`; (3) resolves the new run id (poll `GET …/actions/runs?event=workflow_dispatch&branch=master` for ≤15 s); status → `building`. |
| `GET …/drafts/:id/run`                                                 | `RunDetailResponse`: run, jobs, last ~200 log lines. Sets `built` on success (recording `asset_name`/`asset_size`) or `failed`. `pollAfterSeconds` 10 while running, 0 when finished.                                                                                                                                                                                                                                 |
| `POST …/drafts/:id/publish`                                            | Needs `confirmToken` + `expectedStatus`. See below.                                                                                                                                                                                                                                                                                                                                                                   |
| `POST …/:id/make-current`                                     | **Rollback and roll-forward.** See below.                                                                                                                                                                                                                                                                                                                                                                             |
| `POST …/:id/unpublish-to-draft`                               | `PATCH …/releases/{id}` with `draft: true`; GitHub keeps tag and assets, so it is reversible. Refused while `update.xml` pins that tag — see below.                                                                                                                                                                                                                                                                   |
| `GET` / `PUT …/files`                                                  | A blob (`RepoFile`) or a directory listing (`RepoTreeResponse`), `ref` = master. `PUT` takes a `FilePutRequest`: denylist (§11), `baseSha` must match, commits via `commitFiles`; `.github/workflows` additionally needs `workflowsConfirm: true` and a live Workflows scope, else `403 { code: "denied-path" }`.                                                                                                     |
| `GET …/workflows`, `…/workflows/runs`, `POST …/workflows/:id/dispatch` | `WorkflowSummary[]` (`inputs` parsed from each `workflow_dispatch` block), `WorkflowRunSummary[]`, and a `WorkflowDispatchRequest` rate-limited to 10 / hour / actor.                                                                                                                                                                                                                                                 |
| `GET …/versions`                                              | `VersionsResponse` for the Versions page — `monitoring.read`, cached 15 min.                                                                                                                                                                                                                                                                                                                                          |
| `POST …/confirm`                                                       | `ConfirmTokenRequest` → `ConfirmTokenResponse`. Token = `HMAC-SHA256(JWT_SECRET, action + subject + actor + issuedAt)`, TTL 120 s, single-use (in-memory burnt-token set, re-mintable).                                                                                                                                                                                                                               |

**Confirm effects are server-generated, always.** `ConfirmTokenResponse.effects` is a
`ConfirmEffect[]` the handler computes from live state — the current manifest, the target release,
the adoption query, the workflow files. The modal prints exactly those lines and nothing else: the
client never composes, reorders or supplements one, and no illustrative or hard-coded effect copy
exists in `ReleasesPage.tsx`. In particular, **the Discord line is mandatory whenever a GitHub
release event will fire.** `.github/workflows/discord-release.yml` is triggered by
`release: { types: [published, prereleased] }` and posts to `DISCORD_WEBHOOK_2` (updates channel)
and `RIP_DISCORD_UPDATE_WEBHOOK`, so every `publish` confirm — prerelease included — carries a
`kind: "discord"` effect: _"Discord: a release post goes to the updates channel and the RIP webhook
(discord-release.yml, on release published)."_ The handler decides by reading that workflow file;
if the read fails it emits the line anyway — a surprise post is worse than a redundant warning — and
the live `tag_name != 'v1.5.0'` guard is reflected for that tag only. `make-current` fires **no**
release event, so its line says exactly that: _"Discord: nothing is posted — update.xml only."_
**Publish, step by step.** Each step is idempotent and its completion is written to `release_events`
before the next begins, so a retry with the same confirm token resumes at `failedStep`:

1. `release_upserted` — find or create the release for `tag` (`draft: true`), record the id.
2. `body_written` — `PATCH`: `name` = title, `body` = `notes_full_md` (falling back to the bullets),
   `prerelease`.
3. `release_published` — `PATCH … { draft: false }`. Refused unless the release carries
   `RazorReaper-Setup.exe`; publishing with no installer strands every client. **This is the step
   that triggers the Discord post.**
4. `manifest_committed` — one `commitFiles` commit rewriting `update.xml`: `<version>` = `1.5.4.0`,
   `<mandatory>`, `<notes>` = the customer bullets (XML-escaped, `- ` prefixed), and — deliberately
   — **github.com URLs, exactly as the file carries today**: `<url>` =
   `https://github.com/CedrickGD/RazorReaper/releases/download/v1.5.4/RazorReaper-Setup.exe`,
   `<changelog>` = `https://github.com/CedrickGD/RazorReaper/releases/tag/v1.5.4`.
   `tests/RazorReaper.UnitTests/ReleaseReadinessTests.cs` asserts both substrings against the
   committed file (`/releases/download/{tag}/RazorReaper-Setup.exe`, `/releases/tag/{tag}`) and that
   `<version>` ≤ `ApplicationDisplayVersion + ".0"` — committing NAS URLs here would fail that test
   on every future build; rr-api produces them at _serving_ time instead (§8). **Skipped entirely
   for a prerelease** (decision 4); `skipManifest` covers the deliberate case otherwise.
5. `recorded` — `status = 'published'`, `published_at`, `auditPanel(…, "release.publish", …)`.

**`POST …/:id/make-current`** — the governed rollback. `:id` is the GitHub release id, so
it works for any published release, with or without a draft row. It needs a `make-current`
`confirmToken` and an editable `commitMessage` (default `release: point update.xml at {tag}`).
**Validated before anything is written**: the target release exists, is **published** (not a draft),
is **not a prerelease** (decision 4), and **carries the `RazorReaper-Setup.exe` asset** — any
failure is a `400`/`409` naming the reason, with nothing committed. **Effects**: the version change,
_"update.xml: 1.5.4 → 1.5.3"_; the affected install count from the adoption query the KPI row uses,
_"829 installs are on 1.5.4; they are not downgraded, but every new check now resolves 1.5.3"_; and
the Discord line. Then one `commitFiles` commit rewriting `update.xml` to the target tag's
`<version>`, `<url>`, `<changelog>`, `<mandatory>` and `<notes>` — same github.com shapes as step 4
— with the operator's message, recording `manifest_committed` + `auditPanel`.
**`POST …/:id/unpublish-to-draft`** does _not_ rewrite the manifest, and is refused while
`update.xml` pins that tag — unpublishing the release customers are being offered strands every
client mid-download. The refusal is not a dead end: it returns `409 { ok: false, code:
"manifest-pinned", blockedBy: "manifest", makeCurrentCandidates: [...] }`, each candidate a
published, non-prerelease release carrying the installer asset, newest first. **The "explicit second
action" this design refers to is exactly `make-current`**: the page lists the candidates inline with
a _Make current_ button each, the owner points the manifest at another tag, and the unpublish
succeeds on a second click — no other way to clear the block, and no "unpublish anyway" override.

## 7. Client-repo changes (`CedrickGD/RazorReaper`)

**`.github/workflows/build-installer.yml` (new)** — `on: workflow_dispatch` with inputs `version`
(3-part, required), `notes` (customer bullets, one per line, optional) and `prerelease` (boolean,
default false); `permissions: { contents: write }`; one job on `runs-on: windows-latest`. Steps:
`actions/checkout@v4` → `actions/setup-dotnet@v4` with `dotnet-version: 10.0.x` (`global.json`
already pins the band) → **guard**: fail unless `installer/RazorReaper.iss` contains `#define
MyAppVersion "${{ inputs.version }}"` and `RazorReaper.csproj`'s `ApplicationDisplayVersion` matches
— the panel bumps those, the workflow only verifies → `dotnet workload install maui-windows` →
`dotnet build RazorReaper/RazorReaper.csproj -c Release` → _sign (optional)_ → `choco install
innosetup -y` → `ISCC /O"${{ github.workspace }}\artifacts" installer\RazorReaper.iss` → _sign
(optional) again_. `ISCC /O<dir>` overrides `OutputDir`, so `RazorReaper.iss` needs **no** change and
a local build still lands on the Desktop.

**Optional signing** (decision 7), run on `RazorReaper.exe` after the build and on
`artifacts\RazorReaper-Setup.exe` after ISCC, guarded by
`if: ${{ env.RR_SIGN_PFX_BASE64 != '' && env.RR_SIGN_PFX_PASSWORD != '' }}`:

- Both values come from repository secrets `RR_SIGN_PFX_BASE64` / `RR_SIGN_PFX_PASSWORD` only the
  owner can create. **This design copies, prints and stores neither the pfx nor its password**; the
  step decodes the base64 into a runner-temp file, uses it, and the runner is destroyed. Never echo
  the password or log it without `::add-mask::`.
- signtool ships with the Windows SDK already on `windows-latest`. Use the parameters `rr_sign.bat`
  uses locally: `sign /f <pfx> /p <password> /fd SHA256 /tr http://timestamp.digicert.com /td SHA256
/v <target>`, falling back to the same command without `/tr` and `/td` when the timestamp server
  fails. Before `verify /pa /v <target>` the runner must trust the self-signed certificate the way
  `rr_sign.bat` does: export the public `.cer` from the decoded pfx (`Get-PfxCertificate` +
  `Export-Certificate`) and `Import-Certificate` it into `Cert:\LocalMachine\Root` and
  `Cert:\LocalMachine\TrustedPublisher`. A failed `sign` fails the job; a failed `verify` only warns
  (`continue-on-error: true` on that step), so a runner-side trust quirk cannot block a release.
- When either secret is absent the step is skipped with a visible `::warning::` and a
  `$GITHUB_STEP_SUMMARY` line: _"Unsigned build — RR_SIGN_PFX_BASE64 / RR_SIGN_PFX_PASSWORD not
  set."_ A missing signature never fails the build; a _silently_ unsigned one is what we prevent.

Final step, `gh` CLI with `GITHUB_TOKEN`: `gh release view v{version} || gh release create v{version}
--draft …`, then `gh release upload v{version} artifacts/RazorReaper-Setup.exe --clobber`. `--draft`
is load-bearing — **this workflow never publishes**, so it never fires the Discord post — and
`artifacts/` also goes up as a workflow artifact so a failed release step is recoverable.

**`update-manifest.yml`**: drop the `release: { types: [released] }` trigger — the panel writes
`update.xml` now, and leaving it in means two writers racing on master. Keep
`workflow_dispatch(tag_name)` as the fallback for a day the panel or the NAS is down.
**`discord-release.yml`**: **keep the `release` trigger** — the post on publish is wanted, and §6
makes it an explicit, server-generated line in the confirm modal instead of a surprise. One change:
the posted link becomes `https://dl.razorreaper.app/release-notes/${tag_name}` instead of
`.release.html_url`, dead for anyone without repo access once the repo is private (decision 3).
**The version bump** is made by the panel, not CI: one commit touching `RazorReaper.csproj`
(`ApplicationDisplayVersion`, `Version`, `AssemblyVersion`, `FileVersion`, `ApplicationVersion` + 1)
and `installer/RazorReaper.iss` (`MyAppVersion`). `ReleaseReadinessTests` asserts these agree and
that `update.xml`'s version never exceeds the built one — kept true by bumping _before_ the build
and writing the manifest only _after_ the asset exists.

## 8. rr-api / Worker (`backend-worker/index.js`)

- `GET /update/update.xml` — fetches the committed file and rewrites **two** elements before
  serving. `<url>` → `{origin}/update/download` (exists today, ~line 344). `<changelog>` →
  `{origin}/release-notes/{tag}` (**new**), `{tag}` taken from the committed `<url>`'s
  `/releases/download/<tag>/` segment, falling back to `v` + the 3-part `<version>`. This split is
  the whole point of §6 step 4: **the repo keeps github.com URLs so `ReleaseReadinessTests` passes,
  and the customer only ever sees NAS URLs**, because the rewrite happens on the way out.
- `GET /update/download[/free|/latest]` — **pinning.** Read `update.xml` (same Contents call, same
  cache), take the tag out of `<url>`, resolve `GET /repos/{r}/releases/tags/{tag}` for the asset.
  Fall back to `releases/latest` when that tag has no matching asset, and log which path was taken;
  `/update/download/latest` keeps today's latest-wins behaviour. This is what makes `make-current`
  an actual rollback rather than a cosmetic manifest edit.
- `GET /release-notes/:tag` (new, public, no auth) — minimal calm HTML: version, date, the bullets,
  then `notes_full_md` rendered, sourced from `release_drafts.notes_full_md` for that tag, else the
  GitHub release body, else 404. `cache-control: public, max-age=600`. No chrome, no customer data.

**Caddy (`deploy/nas/caddy/Caddyfile`).** Today the `dl.razorreaper.app` host matches **only the
exact path `/`** (`@download` → rewrite to `/update/download/free` → `reverse_proxy rr-api:8787`),
and a second matcher `@downloadNotFound` 404s _everything else on that host_ — so
`dl.razorreaper.app/update/update.xml` and `/release-notes/v1.5.3` return 404 right now, and both
stay unreachable until this file changes. `handle` blocks are mutually exclusive and evaluated in
written order, so the two new blocks go **after `@download` and before `@downloadNotFound`**:

```caddyfile
	@updateProxy {
		host dl.razorreaper.app
		method GET HEAD
		path /update/*
	}
	handle @updateProxy { reverse_proxy rr-api:8787 }

	@releaseNotes {
		host dl.razorreaper.app
		method GET HEAD
		path /release-notes/*
	}
	handle @releaseNotes { reverse_proxy rr-api:8787 }
```

Neither block sets `Cache-Control`: rr-api already sends `public, max-age=120` for the manifest,
`no-store` for the download redirect and `public, max-age=600` for a notes page, and a blanket
`no-store` here (as `@download` rightly uses for the installer) would defeat all three. The
`@downloadNotFound` 404 stays where it is and keeps closing the host to everything else; the media
`handle` at the bottom is untouched. **This needs a Caddy reload, and the reload is an owner step.**
`caddy reload` re-reads the config in place without dropping connections; a restart or
`docker compose up -d` on the caddy container **must never be done without the owner's explicit go**
— it takes the media origin and the installer URL down with it (§13 step 3).

## 9. Panel page `#/releases`

`src/pages/ReleasesPage.tsx`, lazy in `src/App.tsx`, `PAGE_META.releases = { group:
"Administration", label: "Releases" }`, and a `["releases", <Rocket />]` item in the `Administration`
group in `src/components/Navbar.tsx` (above `team`). English UI, tokens only, no new colours. **KPI
row** — four `KpiStatCard` 64 px tiles: _Latest published_, _Adoption of latest_, _Draft_, _Last
build_. **`ds/Tabs`**: `Releases | Drafts | Workflows | Files` — the last two hidden entirely
without `releases.files` (decision 2); support and viewer see `Releases` plus the KPI row, nothing
writable (decision 6).

- **Releases** — `PageToolbar` above the table (`ds/SearchInput` by tag/title, `SegmentedControl` for
  `All | Published | Draft | Prerelease`). `DataTable` columns: tag, state (`ds/Badge`), assets,
  published, notes preview, and a _Current_ badge on the tag `update.xml` pins. Row actions: open
  notes, copy the notes-page link, **Make current**, _Unpublish to draft_. **Make current is the
  rollback UI** — disabled with a reason on a draft, a prerelease, a release without the installer
  asset, and on the already-current tag. A blocked unpublish renders its `makeCurrentCandidates`
  inline, each with its own button, so the explicit second action is one click away.
- **Drafts** — the editor: version (prefilled with `nextPatch()`), tag, title, `notes_customer` with
  a live preview in the app's What's-new markup, `notes_full_md`, commit message, `mandatory`,
  `prerelease`; **Save**, **Build installer**, **Publish**; commits since the last tag collapsed
  beside the notes; and while `building` a run panel polling `…/drafts/:id/run` every 10 s.
- **Workflows** — the workflow list, a dispatch form built from each workflow's declared inputs, the
  recent runs table. **Files** — a path field, a tree browser (Git Trees on master), a monospace
  textarea, a commit field, **Commit** behind a confirm modal. Denylisted paths render read-only
  with the reason — `update.xml` among them, pointing at _Make current_ / _Publish_.

**Confirm modals** (`ds/Modal`, sheets ≤600 px) print the server's `ConfirmEffect[]` verbatim and in
order, with no client text of their own. Publish requires typing the tag; `make-current` requires
typing the target tag too, because it is the one action that moves customers _backwards_. When
`token.canWrite` is false a persistent status line sits under the `PageHeader` (with the
`"placeholder"` wording from decision 8) and every write button is disabled with that reason as its
title. The KPI row wraps to 2×2 at 390 px, the editor is one column below 900 px, and there is no
horizontal page scroll at 1440 or 390.

## 10. Versions page and announcement targeting

`src/hooks/useLatestVersion.ts` and `useReleaseVersions.ts` stop calling `api.github.com` and
`raw.githubusercontent.com`; both read `GET /api/admin/releases/versions` (`VersionsResponse`)
through the panel's normal fetch helper, keeping their return shapes (`string`, `string[]`) and
their `localStorage` caches, so `VersionsPage.tsx` and `matchReleaseVersion` need no change. This is
the last GitHub call in the browser — after it the repo can go private.
`announcements` gains `min_version TEXT` / `max_version TEXT` (nullable). The table already exists on
the live database, so `CREATE TABLE IF NOT EXISTS` cannot add them: `ensureAnnouncementsSchema` gets
the `feedback.kind` idiom (`functions/_lib/content.ts:102-137`) — `ALTER TABLE announcements ADD
COLUMN …` guarded by the `isDuplicateColumn` try/catch plus a `schema_markers` row — mirrored step for
step in `tools/migrations/2026-09-18-announcement-version-range.sql`; the
Announcements page two optional `ds/Select` fields populated from `VersionsResponse.releases`.
`GET /api/announcements/active?v=1.5.3` filters with `versionInRange`; a client that sends no `v` —
every build up to 1.5.3 — matches everything as today, so nothing regresses for the 272 installs on
1.4.8 and older. `AnnouncementService.GetActiveAsync` appends `?v={AppVersionInfo.VersionString}`.
This is the mechanism decision 5 depends on.

## 11. Security

- **Token**: server-side only, read from env at call time, never in a response body, never logged,
  never in an error forwarded to the browser; `TokenStatus` carries the variable's _name_, not its
  value, including in the `"placeholder"` case. **Auth**: every route goes through
  `requireDashboardAccess` (session, `routePermissions`, `enforceSameOriginMutation` for mutations).
  **Confirm tokens** for `publish`, `make-current`, `unpublish`, `build`, `commit` and `dispatch`
  are HMACs over `JWT_SECRET`, 120 s TTL, single-use: they stop a replayed or cross-tab click, and
  are not a second authentication factor.
- **File denylist** for `PUT …/files`: reject anything outside the repo root, any `..` segment, any
  path matching `**/*.pfx`, `**/*.snk`, `**/*.env*`, `**/appsettings*.json`, `.git/**`, and any file
  over 512 KB or non-UTF-8. **`update.xml` is on the denylist**: it decides what every customer
  downloads and is written only by `publish` and `make-current`, which validate the tag and the
  asset and mint an effect list — a free-text editor over it would be exactly the ungoverned
  rollback path this revision removes. `.github/workflows/**` is allowed only with
  `workflowsConfirm: true`, a live Workflows scope and its own modal — a workflow edit is remote
  code execution on a runner holding the release token.
- **Rate limits** via `enforceRateLimit`: dispatch, build and publish + make-current (shared bucket)
  10/h/actor each, file commits 30/h/actor. **Audit**: every write inserts a `release_events` row
  _and_ calls `auditPanel`, details short and free of secrets and customer data.

## 12. Testing

Vitest in `tests/api/` and `tests/`, with a `FakeGitHub` injected into `github-release.ts` (the
module takes its `fetch` from a parameter defaulting to `globalThis.fetch` — the seam
`tests/api/admin-installs.test.ts` already uses for D1). New suites and what each must prove:
`releases-policy` — route ordering, `releases.files` absent for admin and present for owner.
`api/admin-releases` — version must increase, duplicate tag → 409, the `"placeholder"` refusal.
`api/releases-publish` — the five steps in order; a failure at `manifest_committed` leaves `failed`
with three recorded and a retry performs only 4–5; no asset → refused; a prerelease runs 1–3 and 5
and **never** writes `update.xml`; the committed manifest matches both substrings
`ReleaseReadinessTests` asserts. `api/releases-make-current` — refuses a draft, a prerelease and an
asset-less release; the effects carry the version change, an install count and a Discord line; a
blocked unpublish returns `blockedBy: "manifest"` then succeeds after a `make-current`.
`api/releases-commit` — the six-call order, `force: false`, one retry, `409` when a path changed
under it. `api/releases-files` — denylist incl. `update.xml`, refused for an admin seat.
`releases-page` — Files tab hidden without `releases.files`, the modal printing server effects
verbatim, no horizontal scroll; plus `releases-contract` for the pure helpers.

## 13. Rollout order, and the private-flip checklist

1. Contract + policy + schema + `github-release.ts` behind a read-only token. Nothing writes yet.
2. `GET /api/admin/releases` and `GET …/versions`; switch the two browser hooks. **After
   this step the browser no longer talks to GitHub.**
3. `/release-notes/:tag` on rr-api, `<changelog>` rewriting in `/update/update.xml`, and the two new
   Caddy `handle` blocks (§8). **Owner step:** that Caddyfile change needs a `caddy reload`, and the
   caddy container is never restarted without the owner's explicit go. Verify "Full changelog" and
   `/update/update.xml` both answer on `dl.razorreaper.app`.
4. `/update/download` pinning with the latest-release fallback; verify a download resolves the tag
   `update.xml` names.
5. **Owner step:** replace the `"xxx"` placeholder — the real `GITHUB_RELEASE_TOKEN` on the NAS
   `rr-api.env` **and** as a Worker secret (decision 8). Then drafts, build dispatch, run polling,
   publish, `make-current`, files.
6. `build-installer.yml`; dispatch it once for the _current_ version and confirm the installer
   installs and updates and that its notes mention the ffmpeg change (decision 1). **Owner step,
   optional:** add `RR_SIGN_PFX_BASE64` / `RR_SIGN_PFX_PASSWORD` (decision 7) — the owner creates
   those secrets, nobody else handles the pfx. Then trim `update-manifest.yml`, repoint
   `discord-release.yml`.
7. Announcement version targeting; a banner at `max_version = 1.4.8` pointing the 272 stranded
   installs at `dl.razorreaper.app/update/download/free` (decision 5).

**Before flipping the repo to private**, all of these must be true:

- [ ] `GITHUB_RELEASE_TOKEN` is a real token (not `"xxx"`) on the NAS _and_ the Worker, and
      `GET /api/admin/releases` reports `mode: "write"` on both.
- [ ] `dl.razorreaper.app/release-notes/v1.5.3` returns the notes page and
      `dl.razorreaper.app/update/update.xml` the rewritten manifest.
- [ ] `useLatestVersion` / `useReleaseVersions` ship from the server; no `api.github.com` or
      `raw.githubusercontent.com` string remains in `src/`.
- [ ] `/update/update.xml` and `/update/download` both succeed with the token _and_ the repo private
      (rehearse on a private throwaway repo first).
- [ ] One release published end-to-end through the panel and one `make-current` rollback exercised,
      while the repo was still public.
- [ ] The 1.4.8-and-older stock has been offered an update, or accepted as lost (decision 5).
