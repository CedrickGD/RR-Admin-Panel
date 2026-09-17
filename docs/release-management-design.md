# Release management

Design for the panel's `#/releases` page and everything behind it: draft a release, let a GitHub
runner build the installer, edit the customer-facing notes, and publish — with one explicit click —
so the desktop app updates from the NAS and the source repo can go private.

Wire types: `shared/releases-contract.ts`. Everything below names real files; nothing is a sketch.

## 1. Goals and non-goals

Goals

- The owner drafts a release in the panel, not in a text editor and not on github.com.
- The installer is built by a GitHub Windows runner. Nothing local is required — no MAUI workload,
  no Inno Setup, no Desktop folder.
- Customer-facing notes are written in the panel and previewed exactly as the app's What's-new list
  renders them. Raw commit messages never reach a customer.
- Publishing writes the GitHub release **and** `update.xml` in one resumable operation, so the
  manifest can never point at a tag whose asset does not exist.
- The browser never talks to GitHub and never holds a token.
- `update.xml` pins a tag. `/update/download` serves *that* tag's asset, so a rollback is a
  one-field edit instead of deleting a release.

Non-goals

- **Publishing stays the owner's button.** `POST …/publish` requires a confirm token minted by a
  separate call and a confirm modal that lists every effect. No schedule, no webhook, no agent, no
  "publish on green build" path exists in this design. Claude never creates a release or a tag.
- No code signing (the installer stays unsigned — a separate project), no release branches, no
  changelog generated from commits. Commits are shown as an aid while the owner writes notes; they
  are never copied into `notes_customer`. No SSE — everything polls, like the rest of the panel.

## 2. Data model

Two tables in the same SQLite database, lazily ensured like `ensureAnnouncementsSchema`
(`functions/_lib/content.ts`) and mirrored in `tools/migrations/2026-09-18-release-drafts.sql`.

```sql
CREATE TABLE IF NOT EXISTS release_drafts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  version           TEXT NOT NULL,                       -- "1.5.4"
  tag               TEXT NOT NULL,                       -- "v1.5.4"
  title             TEXT NOT NULL DEFAULT '',
  notes_customer    TEXT NOT NULL DEFAULT '',            -- one bullet per line, no "- " prefix
  notes_full_md     TEXT NOT NULL DEFAULT '',            -- release body + public notes page
  commit_message    TEXT NOT NULL DEFAULT '',
  mandatory         INTEGER NOT NULL DEFAULT 0,
  prerelease        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','building','built','published','failed')),
  github_release_id INTEGER,
  github_run_id     INTEGER,
  asset_name        TEXT,
  asset_size        INTEGER,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  published_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_release_drafts_tag ON release_drafts(tag);
CREATE INDEX IF NOT EXISTS idx_release_drafts_status ON release_drafts(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS release_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id   INTEGER,                                    -- null for repo-wide writes (file commits)
  kind       TEXT NOT NULL,                              -- ReleaseEventKind
  actor      TEXT NOT NULL,                              -- panel e-mail
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_release_events_draft ON release_events(draft_id, id DESC);
```

`release_events` is the draft's own timeline (shown in the drawer); it does **not** replace
`auditPanel` — every write also inserts a `panel_audit` row. `ensureReleasesSchema(env)` lives in
`functions/_lib/releases-store.ts` and runs at the top of every releases handler, cached per-DB like
`ensureFeedbackSchema`. A draft is the source of truth for a version *before* it is published;
afterwards GitHub is. `status` runs `draft → building → built → published`, with `failed` reachable
from `building` and `published` (a failed publish keeps its completed steps and is resumable).

## 3. Permissions

`shared/panel-policy.ts`:

```ts
{ key: "releases.read",  label: "View releases & drafts",            group: "Releases" },
{ key: "releases.write", label: "Build, edit files & publish releases", group: "Releases" },
```

- `rolePermissions`: owner and admin already receive every permission. `support` gains
  `"releases.read"` in its explicit list. `viewer` picks up `releases.read` through the existing
  `.read` filter — that is fine, it sees the overview only.
- `PAGE_PERMISSION.releases = "releases.read"`, and `PageKey` in `src/types/telemetry.ts` gains
  `"releases"`.
- `routePermissions`, ordered — the specific branches must come first:

```ts
if (path === "/api/admin/releases/versions") return ["monitoring.read"];      // Versions page
if (path.startsWith("/api/admin/releases/files")) return ["releases.write"];  // repo source, both verbs
if (path.startsWith("/api/admin/releases")) return [write ? "releases.write" : "releases.read"];
```

Reading repository files is deliberately `releases.write`: on a private repo those are the sources,
and a read-only panel seat is not a code-reading seat.

No change to `requireDashboardAccess` (`functions/_lib/admin.ts:54`): it already resolves
`routePermissions`, enforces the same-origin guard for mutations and sets `permissionChecked`, so
routes call it first and never need `requireAdminRole`.

## 4. GitHub client module

`functions/_lib/github-release.ts` — the only file in the panel that knows a GitHub URL. The
backend-worker build imports the same module (it is plain `fetch`, no runtime bindings).

**Token resolution**, in order: `GITHUB_RELEASE_TOKEN` (fine-grained: Contents RW, Actions RW,
Workflows, Metadata) → `GITHUB_TOKEN` (the existing Contents read-only token) → none.
`tokenStatus(env): TokenStatus` reports `mode: "write" | "read-only" | "missing"`. With anything but
`write`, every mutating handler returns `409 { code: "no-write-token" }` and the page shows a
persistent status line. The token is never echoed, never logged, never sent to the browser — the
overview response carries `TokenStatus` only.

**Calls used** (all `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: RazorReaper-Panel`):

| Purpose | Call |
| --- | --- |
| List / read releases | `GET /repos/{r}/releases`, `GET …/releases/tags/{tag}` |
| Create / edit / publish | `POST /repos/{r}/releases`, `PATCH …/releases/{id}` (`draft`, `body`, `name`, `prerelease`) |
| Assets | `GET …/releases/{id}/assets`, `DELETE …/releases/assets/{id}` (upload is the runner's job) |
| Commits since a tag | `GET /repos/{r}/compare/{tag}...{branch}` |
| Read a file / tree | `GET …/contents/{path}?ref=`, `GET …/git/trees/{sha}` |
| Atomic multi-file commit | `POST …/git/blobs` → `POST …/git/trees` (`base_tree`) → `POST …/git/commits` → `PATCH …/git/refs/heads/master` |
| Workflows | `GET …/actions/workflows`, `POST …/actions/workflows/{id}/dispatches`, `GET …/actions/runs`, `GET …/actions/runs/{id}/jobs`, `GET …/actions/jobs/{id}/logs` |

**Why Git Data for writes.** The version bump touches six fields across two files and the publish
step touches `update.xml`; a Contents-API write per file would leave master half-bumped if the
second call failed. Blobs → tree → commit → `PATCH ref` is one ref move, and `PATCH ref` without
`force` fails when master advanced meanwhile — that is the concurrency guard, surfaced as `409`.

**Caching and limits.** Every GET stores its `ETag` in a module-level `Map` keyed by URL and replays
it as `If-None-Match`; a `304` costs no rate-limit quota. Overview reads are additionally memoised
for 60 s (30 s while a draft is `building`). `x-ratelimit-remaining` / `-reset` from the last
response feed `TokenStatus`; below 100 remaining the module refuses non-essential GETs and the
overview comes back `stale: true` from the last good snapshot instead of failing.

**Error mapping**: `401/403` → `502 "GitHub rejected the panel's token."` (plus a `release_events`
`error` row); `404` on a tag → `404` with the tag named; `409`/`422` on `PATCH ref` → `409 "master
moved while this was being written — reload and retry."`; `429`/secondary rate limit → `429` with
`retry-after` honoured from the response. Network failure → `502`. No GitHub error body is ever
forwarded verbatim; it can contain the repo's private paths.

## 5. Admin API contract

All under `functions/api/admin/releases/`, all JSON, all behind `requireDashboardAccess`. Types are
in `shared/releases-contract.ts`; only the behaviour is described here.

| Method + path | Behaviour |
| --- | --- |
| `GET /api/admin/releases` | `ReleasesOverviewResponse`: token status, latest published release, all releases (30), drafts, last 10 workflow runs, `update.xml` state incl. the tag it pins, and adoption of the latest version from `app_sessions`. One call — the page makes no others on load. |
| `GET …/commits?since=<tag>` | `CommitsSinceResponse` from `compare`. Default `since` = latest published tag. Capped at 100 commits, `truncated` set. |
| `GET …/drafts/:id/events` | `ReleaseEventsResponse`, newest first. |
| `POST …/drafts` | Creates a draft. `version` required and must be > the latest published version; `tag` defaults to `v{version}`, `title` to `RazorReaper {version}`, `commit_message` to `release: {version}`. 409 on a duplicate tag. |
| `PUT …/drafts/:id` | Partial update with `expectedUpdatedAt`; mismatch → `409 { code: "stale" }`. Refused once `status = 'published'`. |
| `DELETE …/drafts/:id` | Only while `draft` or `failed`. Deletes the row; never touches GitHub. |
| `POST …/drafts/:id/build` | Needs `confirmToken`. (1) commits the version bump — five `csproj` fields + `MyAppVersion` in the `.iss` — via Git Data using the draft's `commit_message`, unless master already carries that version; (2) dispatches `build-installer.yml` with `version`, `notes`, `prerelease`; (3) resolves the new run id (poll `GET …/actions/runs?event=workflow_dispatch&branch=master` for ≤15 s) and stores it; status → `building`. |
| `GET …/drafts/:id/run` | `RunDetailResponse`: run, jobs, last ~200 log lines. Sets `status` to `built` on success (recording `asset_name`/`asset_size` from the draft release's assets) or `failed` on failure. `pollAfterSeconds` is 10 while running, 0 when finished. |
| `POST …/drafts/:id/publish` | Needs `confirmToken` + `expectedStatus`. See below. |
| `POST …/releases/:id/unpublish-to-draft` | `PATCH …/releases/{id}` with `draft: true`. GitHub keeps the tag and the assets, so this is reversible; it does **not** rewrite `update.xml` — the response tells the panel to fix the manifest, which stays an explicit second action. Refused when `update.xml` still pins that tag. |
| `GET …/files?path=` | A blob (`RepoFile`) or a directory listing (`RepoTreeResponse`), `ref` = master. |
| `PUT …/files` | `FilePutRequest`. Validates the path against the denylist (§11), requires `baseSha` to match, commits via Git Data with the given message. A path under `.github/workflows` additionally requires `workflowsConfirm: true` and a live Workflows scope, and is refused with `403 { code: "denied-path" }` otherwise. |
| `GET …/workflows` | `WorkflowSummary[]`, `inputs` parsed from each workflow file's `workflow_dispatch` block. |
| `POST …/workflows/:id/dispatch` | `WorkflowDispatchRequest`; rate-limited to 10 dispatches / hour / actor. |
| `GET …/workflows/runs?workflowId=&limit=` | `WorkflowRunSummary[]`. |
| `GET …/releases/versions` | `VersionsResponse` for the Versions page — `monitoring.read`, cached 15 min. |
| `POST …/confirm` | `ConfirmTokenRequest` → `ConfirmTokenResponse`. The token is `HMAC-SHA256(JWT_SECRET, action + subject + actor + issuedAt)`, TTL 120 s, single-use (an in-memory burnt-token set, re-mintable). `effects` is the exact list the modal prints. |

**Publish, step by step.** Each step is idempotent and its completion is written to
`release_events` before the next begins, so a retry with the same confirm token resumes at
`failedStep` rather than repeating GitHub writes:

1. `release_upserted` — find or create the release for `tag` (`draft: true`), record
   `github_release_id`.
2. `body_written` — `PATCH` the release: `name` = title, `body` = `notes_full_md` (falling back to
   the customer bullets), `prerelease`.
3. `release_published` — `PATCH … { draft: false }`. Refused unless the release carries
   `RazorReaper-Setup.exe`; publishing a release with no installer is the one thing that would
   strand every client.
4. `manifest_committed` — one Git Data commit on master with `update.xml` rewritten:
   `<version>` = `1.5.4.0`, `<url>` = `https://dl.razorreaper.app/update/download`, `<changelog>` =
   `https://dl.razorreaper.app/release-notes/v1.5.4`, `<mandatory>`, `<notes>` = the customer
   bullets (XML-escaped, `- ` prefixed). Skipped when `skipManifest` or `prerelease`.
5. `recorded` — `status = 'published'`, `published_at`, `auditPanel(env, actor, tag, "release.publish", …)`.

## 6. Client-repo changes (`CedrickGD/RazorReaper`)

### `.github/workflows/build-installer.yml` (new)

```yaml
on:
  workflow_dispatch:
    inputs:
      version:    { description: "3-part version, e.g. 1.5.4", required: true, type: string }
      notes:      { description: "Customer bullets, one per line", required: false, type: string }
      prerelease: { description: "Mark the draft release as a prerelease", type: boolean, default: false }
permissions: { contents: write }
jobs:
  build:
    runs-on: windows-latest
```

Steps: `actions/checkout@v4` → `actions/setup-dotnet@v4` with `dotnet-version: 10.0.x` (and
`global.json` already pins the SDK band) → **guard**: fail unless `installer/RazorReaper.iss`
contains `#define MyAppVersion "${{ inputs.version }}"` and `RazorReaper.csproj`'s
`ApplicationDisplayVersion` matches — the panel bumps those, the workflow only verifies →
`dotnet workload install maui-windows` → `dotnet build RazorReaper/RazorReaper.csproj -c Release`
(the `Release` property group already sets `SelfContained` / `WindowsAppSDKSelfContained`) →
`choco install innosetup -y` → `ISCC /O"${{ github.workspace }}\artifacts" installer\RazorReaper.iss`.

`ISCC /O<dir>` overrides `OutputDir`, so `RazorReaper.iss` needs **no** change and a local build
still lands on the Desktop. (Plan B if a future ISCC drops `/O`: guard the line with
`#ifndef OutputDirOverride` … `#else` `OutputDir={#OutputDirOverride}` `#endif` and pass `/D`. `/D`
cannot carry the *version* either way — the script's own unconditional `#define MyAppVersion` would
override it, which is why the version comes from the committed files.)

Final step, `gh` CLI with `GITHUB_TOKEN`: `gh release view v{version} || gh release create v{version}
--draft --title … --notes …`, then `gh release upload v{version} artifacts/RazorReaper-Setup.exe
--clobber`. `--draft` is load-bearing: **this workflow never publishes.** It also uploads
`artifacts/` as a workflow artifact so a failed release step is still recoverable.

Known difference: `RazorReaper/Tools/ffmpeg.exe` is gitignored (97 MB) and the `csproj` includes it
only `Condition="Exists(...)"`, so a runner-built installer ships **without** bundled ffmpeg and
`FfmpegProvider` downloads it at first use. That is the documented fallback, but it is a real
change from today's local installer — see the open questions.

### `.github/workflows/update-manifest.yml`

Drop the `release: { types: [released] }` trigger. The panel writes `update.xml` now, and leaving
the trigger in means two writers racing on master. Keep `workflow_dispatch(tag_name)` untouched as
the manual fallback for a day the panel or the NAS is down.

### `.github/workflows/discord-release.yml`

Keep as is, with one change: the posted release link becomes
`https://dl.razorreaper.app/release-notes/${tag_name}` instead of `.release.html_url`, which is dead
for anyone without repo access once the repo is private. The push-notification half is unaffected.

### Version bump

Made by the panel, not by CI: one Git Data commit touching `RazorReaper/RazorReaper.csproj`
(`ApplicationDisplayVersion`, `Version`, `AssemblyVersion`, `FileVersion`, and `ApplicationVersion`
incremented by one) and `installer/RazorReaper.iss` (`MyAppVersion`).
`tests/RazorReaper.UnitTests/ReleaseReadinessTests.cs` already asserts that these agree and that
`update.xml`'s version never exceeds the built one — the design keeps that true by bumping before
the build and writing the manifest only after the asset exists.

## 7. rr-api / Worker (`backend-worker/index.js`)

- `GET /update/update.xml` — unchanged except that `<changelog>` is rewritten the same way `<url>`
  already is, to `{origin}/release-notes/{tag}`. Clients on a private repo then have a working
  "Full changelog" link.
- `GET /update/download[/free|/latest]` — **pinning.** Read `update.xml` (same Contents call, same
  cache), take the tag out of `<url>` or `<version>`, and resolve
  `GET /repos/{r}/releases/tags/{tag}` for the asset. Fall back to `releases/latest` when that tag
  has no matching asset, and log which path was taken. `/update/download/latest` keeps today's
  explicit latest-wins behaviour. This is what makes a rollback a `update.xml` edit.
- `GET /release-notes/:tag` (new, public, no auth) — minimal calm HTML: version, date, the bullets,
  then `notes_full_md` rendered. Source order: `release_drafts.notes_full_md` for that tag, else the
  GitHub release body, else 404. Cached 10 min (`cache-control: public, max-age=600`). No panel
  chrome, no customer data, no scripts. Caddy on the NAS routes `dl.razorreaper.app/release-notes/*`
  to rr-api exactly as it routes `/update/*`.

## 8. Panel page `#/releases`

`src/pages/ReleasesPage.tsx`, lazy in `src/App.tsx`, `PAGE_META.releases = { group:
"Administration", label: "Releases" }`, and a `["releases", <Rocket />]` item in the
`Administration` group in `src/components/Navbar.tsx` (above `team`). English UI, tokens only, no
new colours.

**KPI row** — four `KpiStatCard` 64 px one-line tiles: *Latest published* (`1.5.3 · 4 d ago`),
*Adoption of latest* (`67%`), *Draft* (`1.5.4 · built`), *Last build* (`success · 12 min`).

**`ds/Tabs`** for the page sections: `Releases | Drafts | Workflows | Files`.

- **Releases** — `PageToolbar` directly above the table (`ds/SearchInput` by tag/title, a
  `SegmentedControl` for `All | Published | Draft | Prerelease`). `DataTable` columns: tag, state
  (`ds/Badge`), assets, published, notes preview. Row actions: open notes, copy the notes-page link,
  *Unpublish to draft*.
- **Drafts** — the editor. Version (prefilled with `nextPatch()` of the latest published), tag,
  title, `notes_customer` textarea with a live preview rendered with the app's What's-new list
  markup, `notes_full_md`, commit message, `mandatory`, `prerelease`. Buttons: **Save**, **Build
  installer**, **Publish**. Commits since the last tag sit in a collapsed list beside the notes as
  writing material. A run panel appears while `status = 'building'`: jobs, current step, log tail,
  polling `…/drafts/:id/run` every 10 s and stopping on a terminal status.
- **Workflows** — the workflow list, a dispatch form built from each workflow's declared inputs, and
  the recent runs table.
- **Files** — a path field plus a tree browser (Git Trees on master), a monospace textarea, a commit
  message field and **Commit** behind a confirm modal. Denylisted paths render read-only with the
  reason.

**Confirm modals** (`ds/Modal`, sheets ≤600 px) print the `effects` list the server minted —
e.g. *"Publish v1.5.4 on GitHub · Point update.xml at v1.5.4 · 829 installs will be offered this
update · This is not automatic: nothing else publishes."* Publish additionally requires typing the
tag. When `token.canWrite` is false, a persistent status line sits under the `PageHeader` and every
write button is disabled with that reason as its title.

Layout: the KPI row wraps to 2×2 at 390 px, tables use the existing `TableFrame` horizontal scroll,
and the editor is a single column below 900 px. No horizontal page scroll at 1440 with the rail open
or at 390 without it.

## 9. Versions page

`src/hooks/useLatestVersion.ts` and `useReleaseVersions.ts` stop calling `api.github.com` and
`raw.githubusercontent.com`; both read `GET /api/admin/releases/versions` (`VersionsResponse`)
through the panel's normal fetch helper, keeping their current return shapes (`string`, `string[]`)
and their `localStorage` caches so `VersionsPage.tsx` and `matchReleaseVersion` need no change.
This is the last GitHub call in the browser — after it the repo can go private.

## 10. Announcement targeting

`announcements` gains `min_version TEXT` and `max_version TEXT` (both nullable, added by
`ensureAnnouncementsSchema` and by `tools/migrations/2026-09-18-announcement-version-range.sql`).
The Announcements page gets two optional `ds/Select` fields ("From version" / "Up to version")
populated from `VersionsResponse.releases`, above the schedule fields.

`GET /api/announcements/active?v=1.5.3` filters with `versionInRange` from the contract. A client
that sends no `v` — every build up to 1.5.3 — matches everything, exactly as today, so nothing
regresses for the 272 installs on 1.4.8 and older. `AnnouncementService.GetActiveAsync` appends
`?v={AppVersionInfo.VersionString}`. This is what lets a "you are on an unsupported version,
download the new installer" banner reach only the stranded clients.

## 11. Security

- **Token**: server-side only, read from env at call time, never in a response body, never logged,
  never in an error message forwarded to the browser. `TokenStatus` carries the *name* of the
  variable, not its value.
- **Auth**: every route goes through `requireDashboardAccess`, which already enforces the panel
  session, the permission from `routePermissions` and — for mutations — `enforceSameOriginMutation`.
- **Confirm tokens** for `publish`, `unpublish`, `build`, `commit` and `dispatch`: minted by
  `POST …/confirm`, HMAC over `JWT_SECRET`, 120 s TTL, single-use. They stop a replayed or
  cross-tab click; they are not a second authentication factor.
- **File denylist** for `PUT …/files`: reject anything outside the repo root, any `..` segment, any
  path matching `**/*.pfx`, `**/*.snk`, `**/*.env*`, `**/appsettings*.json`, `.git/**`, and any file
  over 512 KB or non-UTF-8. `.github/workflows/**` is allowed only with `workflowsConfirm: true`, a
  live Workflows scope and its own modal — a workflow edit is remote code execution on a runner that
  holds the release token.
- **Rate limits** via `enforceRateLimit`: dispatch 10/h/actor, build 10/h/actor, file commits
  30/h/actor, publish 10/h/actor.
- **Audit**: every write inserts a `release_events` row *and* calls `auditPanel`. Details are short
  and carry no secrets and no customer data.

## 12. Testing

Vitest, in `tests/api/` and `tests/` alongside the existing suites, with a `FakeGitHub` client
injected into `github-release.ts` (the module takes its `fetch` from a parameter defaulting to
`globalThis.fetch`, the seam `tests/api/admin-installs.test.ts` already uses for D1).

- `tests/releases-policy.test.ts` — `routePermissions` ordering (a `files` GET needs
  `releases.write`, `versions` needs `monitoring.read`), `PAGE_PERMISSION`, `canVisit` for all four
  roles, and that `PageKey`, `PAGE_META` and the Navbar item agree.
- `tests/api/admin-releases.test.ts` — validation (version must increase, duplicate tag → 409, stale
  `expectedUpdatedAt` → 409), the no-write-token refusal, and the confirm-token TTL/single-use.
- `tests/api/releases-publish.test.ts` — the five publish steps in order; a failure injected at
  `manifest_committed` leaves `status = 'failed'` with the first three recorded, and a retry with
  the same token performs only step 4 and 5. Publishing a release with no asset is refused.
- `tests/api/releases-files.test.ts` — denylist, `baseSha` mismatch → 409, workflows path without
  `workflowsConfirm` → 403.
- `tests/releases-contract.test.ts` — `tagForVersion` / `manifestVersion` / `nextPatch` /
  `notesLines` / `compareVersions` / `versionInRange` round-trips.
- `tests/releases-page.test.tsx` — fixture preview mock of the overview payload: tabs render, write
  buttons disabled without a token, publish modal lists the effects, no horizontal scroll at 1440 and
  390 (the check `tests/license-table-fit.test.ts` already performs).
- Screenshots at 1440 (rail open) and 390 for the review.

## 13. Rollout order, and the private-flip checklist

1. Contract + policy + schema + `github-release.ts` behind a read-only token. Nothing writes yet.
2. `GET /api/admin/releases` and `GET …/releases/versions`; switch the two browser hooks. **After
   this step the browser no longer talks to GitHub.**
3. `/release-notes/:tag` on rr-api + the Caddy route, and `<changelog>` rewriting in
   `/update/update.xml`. Verify from a client on 1.5.3 that "Full changelog" opens the NAS page.
4. `/update/download` pinning, with the latest-release fallback. Verify a download resolves the tag
   `update.xml` names.
5. Owner adds `GITHUB_RELEASE_TOKEN` to the NAS `rr-api.env` **and** as a Worker secret. Drafts,
   build dispatch, run polling, publish, files.
6. `build-installer.yml`; dispatch it once for the *current* version and confirm the produced
   installer installs and updates. Then trim `update-manifest.yml` and repoint `discord-release.yml`.
7. Announcement version targeting; publish a banner aimed at `max_version = 1.4.8` pointing the 272
   stranded installs at `https://dl.razorreaper.app/update/download/free`.

**Before flipping the repo to private**, all of these must be true:

- [ ] `GITHUB_RELEASE_TOKEN` set on the NAS *and* the Cloudflare Worker, and `GET /api/admin/releases`
      reports `mode: "write"` on both.
- [ ] `https://dl.razorreaper.app/release-notes/v1.5.3` returns the notes page.
- [ ] `useLatestVersion` / `useReleaseVersions` ship from the server; no `api.github.com` or
      `raw.githubusercontent.com` string remains in `src/`.
- [ ] `/update/update.xml` and `/update/download` both succeed with the token *and* the repo private
      (test with a private throwaway repo first, or immediately after the flip with a rollback ready).
- [ ] The 1.4.8-and-older stock has been offered an update — by a targeted announcement and, ideally,
      one mandatory release — or has been accepted as lost.
- [ ] One release has been published end-to-end through the panel while the repo was still public.
