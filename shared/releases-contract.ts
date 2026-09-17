/**
 * Release-management wire contract — shared by the panel (src/pages/ReleasesPage.tsx and its
 * hooks), the admin routes (functions/api/admin/releases/*) and the rr-api / Worker build of the
 * same handlers (backend-worker/index.js). Runtime-agnostic: no imports, no DOM, no node.
 *
 * Design: docs/release-management-design.md.
 *
 * Conventions
 *  - The wire is camelCase. The SQLite columns are snake_case; `ReleaseDraftRow` is the row shape
 *    and `draftFromRow` the only place the two spellings meet.
 *  - Every response is `{ ok: true, ... }` or `{ ok: false, error }` — the shape functions/_lib/
 *    http.ts already produces, so `ApiResult<T>` is a description, never a new convention.
 *  - Versions: `version` is the human 3-part number ("1.5.4"), `tag` is "v" + version ("v1.5.4"),
 *    `manifestVersion` is the 4-part number update.xml carries ("1.5.4.0"). Never mix them.
 */

/** Bumped whenever a field changes meaning. The panel sends it as `x-releases-api`; a mismatch
 *  is a soft warning in the UI ("reload the panel"), never a hard 400.
 *  2 — make-current, server-generated ConfirmEffect[], "placeholder" token mode. */
export const RELEASES_API_VERSION = 2;

/**
 * Permission keys this feature adds to shared/panel-policy.ts, which stays the source of truth.
 * `releases.files` is owner-only (design decision 2): it gates repository file reads and writes
 * and any free-form workflow dispatch. It ends in neither ".read" nor ".write", so
 * `effectivePermissions`' write-implies-read filter does not apply to it — the file routes
 * require `releases.read` alongside it.
 */
export type ReleasesPermission = "releases.read" | "releases.write" | "releases.files";

/**
 * Repository paths the Files tab must refuse even for an owner, because a governed action owns
 * them. `update.xml` is written only by publish and make-current, which validate the target tag,
 * check the installer asset exists and mint an effect list first.
 */
export const GOVERNED_FILE_PATHS: readonly string[] = ["update.xml"];

export function isGovernedFilePath(path: string): boolean {
  const normalised = path
    .trim()
    .replace(/^\.?\//, "")
    .toLowerCase();
  return GOVERNED_FILE_PATHS.some((p) => p.toLowerCase() === normalised);
}

/* ─────────────────────────── Versions and the update manifest ─────────────────────────── */

/** "1.5.4" → "v1.5.4". */
export function tagForVersion(version: string): string {
  return `v${version.trim().replace(/^v/i, "")}`;
}

/** "v1.5.4" / "1.5.4.0" → "1.5.4". */
export function versionForTag(tag: string): string {
  return tag.trim().replace(/^v/i, "").split(".").slice(0, 3).join(".");
}

/** "1.5.4" → "1.5.4.0" — what <version> in update.xml and AssemblyVersion carry. */
export function manifestVersion(version: string): string {
  const parts = versionForTag(version).split(".");
  while (parts.length < 3) parts.push("0");
  return `${parts.slice(0, 3).join(".")}.0`;
}

/** Suggested next patch for the draft editor's version field: "1.5.3" → "1.5.4". */
export function nextPatch(version: string): string {
  const [major = "1", minor = "0", patch = "0"] = versionForTag(version).split(".");
  return `${major}.${minor}.${Number(patch) + 1}`;
}

/**
 * The five fields update.xml carries, plus the notes bullet list. Model, not XML.
 *
 * `url` and `changelog` are the values **as committed to the repo**: github.com URLs, exactly the
 * shapes RazorReaper/tests/RazorReaper.UnitTests/ReleaseReadinessTests.cs asserts against the file
 * (`/releases/download/<tag>/RazorReaper-Setup.exe` and `/releases/tag/<tag>`). Committing NAS URLs
 * here would fail that test on every future build. rr-api rewrites **both** elements to NAS URLs
 * when it serves GET /update/update.xml, so the customer never sees a github.com link.
 */
export interface UpdateXmlModel {
  /** 4-part, e.g. "1.5.3.0". Must be <= ApplicationDisplayVersion + ".0". */
  version: string;
  /** Committed installer URL: github.com/…/releases/download/<tag>/RazorReaper-Setup.exe. */
  url: string;
  /** Committed changelog URL: github.com/…/releases/tag/<tag>. */
  changelog: string;
  mandatory: boolean;
  /** Inno Setup silent-install switches. */
  args: string;
  /** One customer-facing bullet per entry, already stripped of its "- " prefix. */
  notes: string[];
}

/** Default repo for the committed manifest URLs. */
export const MANIFEST_REPO = "CedrickGD/RazorReaper";
export const INSTALLER_ASSET_NAME = "RazorReaper-Setup.exe";

/** The exact `<url>` / `<changelog>` pair publish and make-current must commit for `tag`. */
export function manifestUrlsForTag(
  tag: string,
  repo: string = MANIFEST_REPO,
): { url: string; changelog: string } {
  const normalised = tagForVersion(tag);
  return {
    url: `https://github.com/${repo}/releases/download/${normalised}/${INSTALLER_ASSET_NAME}`,
    changelog: `https://github.com/${repo}/releases/tag/${normalised}`,
  };
}

/** The tag a committed `<url>` pins, for the worker's rewrite and `UpdateXmlState.pinnedTag`. */
export function tagFromManifestUrl(url: string): string | null {
  const match = /\/releases\/download\/([^/]+)\//.exec(url);
  return match?.[1] ? match[1] : null;
}

/** What the panel shows about the live manifest on master. */
export interface UpdateXmlState extends UpdateXmlModel {
  /** Blob sha of update.xml on master — the optimistic-concurrency handle for a commit. */
  sha: string;
  /** The tag `url` resolves to, or null when it points somewhere unrecognised. */
  pinnedTag: string | null;
  /** True when `pinnedTag` names the newest published release. */
  pinnedTagIsLatest: boolean;
  fetchedAt: string;
}

/* ─────────────────────────────────── Drafts ─────────────────────────────────── */

export type ReleaseDraftStatus = "draft" | "building" | "built" | "published" | "failed";

export const RELEASE_DRAFT_STATUSES: readonly ReleaseDraftStatus[] = [
  "draft",
  "building",
  "built",
  "published",
  "failed",
];

export function isReleaseDraftStatus(value: unknown): value is ReleaseDraftStatus {
  return typeof value === "string" && (RELEASE_DRAFT_STATUSES as readonly string[]).includes(value);
}

/** A draft the owner is still shaping. One row per intended release. */
export interface ReleaseDraft {
  id: number;
  /** 3-part, e.g. "1.5.4". */
  version: string;
  /** "v1.5.4". Derived on create, editable afterwards. */
  tag: string;
  /** Release title, e.g. "RazorReaper 1.5.4". */
  title: string;
  /**
   * Customer-facing notes: one bullet per line, no "- " prefix stored. This is what the
   * What's-new overlay renders and what update.xml's <notes> carries. Never a commit log.
   */
  notesCustomer: string;
  /** Long-form markdown for the GitHub release body and the public notes page. */
  notesFullMd: string;
  /** Commit message for the version bump and the update.xml commit. Editable, defaulted. */
  commitMessage: string;
  mandatory: boolean;
  prerelease: boolean;
  status: ReleaseDraftStatus;
  /** GitHub's numeric release id, once a draft release exists. */
  githubReleaseId: number | null;
  /** The build-installer.yml run that produced (or is producing) the asset. */
  githubRunId: number | null;
  assetName: string | null;
  assetSize: number | null;
  /** Panel e-mail of whoever created the draft. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** The SQLite row. Column names are the migration's; nothing else may spell them. */
export interface ReleaseDraftRow {
  id: number;
  version: string;
  tag: string;
  title: string;
  notes_customer: string;
  notes_full_md: string;
  commit_message: string;
  mandatory: number;
  prerelease: number;
  status: string;
  github_release_id: number | null;
  github_run_id: number | null;
  asset_name: string | null;
  asset_size: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export function draftFromRow(row: ReleaseDraftRow): ReleaseDraft {
  return {
    id: row.id,
    version: row.version,
    tag: row.tag,
    title: row.title,
    notesCustomer: row.notes_customer,
    notesFullMd: row.notes_full_md,
    commitMessage: row.commit_message,
    mandatory: row.mandatory === 1,
    prerelease: row.prerelease === 1,
    status: isReleaseDraftStatus(row.status) ? row.status : "draft",
    githubReleaseId: row.github_release_id,
    githubRunId: row.github_run_id,
    assetName: row.asset_name,
    assetSize: row.asset_size,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

/** POST body. PUT takes the same fields, all optional, plus `expectedUpdatedAt`. */
export interface ReleaseDraftInput {
  version: string;
  tag?: string;
  title?: string;
  notesCustomer?: string;
  notesFullMd?: string;
  commitMessage?: string;
  mandatory?: boolean;
  prerelease?: boolean;
}

export type ReleaseDraftPatch = Partial<ReleaseDraftInput> & {
  /** Lost-update guard: the `updatedAt` the editor loaded. A mismatch is 409. */
  expectedUpdatedAt?: string;
};

/** Notes textarea → bullets, for the live preview and for update.xml. */
export function notesLines(notesCustomer: string): string[] {
  return notesCustomer
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

/* ─────────────────────────────── Draft audit trail ─────────────────────────────── */

export type ReleaseEventKind =
  | "draft_created"
  | "draft_updated"
  | "draft_deleted"
  | "version_bumped"
  | "build_dispatched"
  | "build_succeeded"
  | "build_failed"
  | "release_upserted"
  | "asset_attached"
  | "published"
  | "unpublished"
  | "manifest_committed"
  | "file_committed"
  | "workflow_dispatched"
  | "error";

export interface ReleaseEvent {
  id: number;
  draftId: number | null;
  kind: ReleaseEventKind;
  /** Panel e-mail. */
  actor: string;
  /** One short line. Never a token, never a customer identifier. */
  detail: string;
  createdAt: string;
}

/* ───────────────────────────── GitHub-side read models ───────────────────────────── */

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  contentType: string;
  downloadCount: number;
  updatedAt: string;
}

export type ReleaseState = "draft" | "prerelease" | "published";

export interface GithubRelease {
  id: number;
  tag: string;
  name: string;
  state: ReleaseState;
  /** Markdown body as GitHub holds it. */
  body: string;
  assets: ReleaseAsset[];
  createdAt: string;
  publishedAt: string | null;
  /** github.com URL. Shown to the operator only; never handed to a customer. */
  htmlUrl: string;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  /** First line only. */
  subject: string;
  author: string;
  date: string;
}

export interface CommitsSinceResponse {
  ok: true;
  /** The tag the comparison started at, or null when the repo has no releases yet. */
  sinceTag: string | null;
  aheadBy: number;
  commits: CommitSummary[];
  truncated: boolean;
}

/* ──────────────────────────────── Workflows and runs ──────────────────────────────── */

export type RunStatus = "queued" | "in_progress" | "completed" | "unknown";
export type RunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | null;

export interface WorkflowSummary {
  id: number;
  name: string;
  /** ".github/workflows/build-installer.yml" */
  path: string;
  state: string;
  /** Declared workflow_dispatch inputs, so the panel can render the right fields. */
  inputs: WorkflowInputSpec[];
}

export interface WorkflowInputSpec {
  name: string;
  description: string;
  required: boolean;
  type: "string" | "boolean" | "choice" | "number" | "environment";
  default?: string;
  options?: string[];
}

export interface WorkflowRunSummary {
  id: number;
  workflowId: number;
  name: string;
  runNumber: number;
  status: RunStatus;
  conclusion: RunConclusion;
  event: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface WorkflowJobSummary {
  id: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  startedAt: string | null;
  completedAt: string | null;
  /** Current or last step name — the one line the panel shows next to the job. */
  currentStep: string | null;
}

export interface RunDetailResponse {
  ok: true;
  run: WorkflowRunSummary | null;
  jobs: WorkflowJobSummary[];
  /** Last ~200 lines of the failing or running job, secrets already masked by GitHub. */
  logTail: string[];
  /** Seconds the panel should wait before polling again. 10 while running, 0 when finished. */
  pollAfterSeconds: number;
}

export interface WorkflowDispatchRequest {
  /** Branch or tag to run on. Defaults to the repo's default branch. */
  ref?: string;
  inputs: Record<string, string>;
  confirmToken: string;
}

/* ─────────────────────────── Files on master (Git Data API) ─────────────────────────── */

export interface RepoTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size: number | null;
  /** False when the path is on the denylist — the panel greys it out. */
  editable: boolean;
}

export interface RepoFile {
  path: string;
  /** Blob sha; required on PUT for the lost-update guard. */
  sha: string;
  size: number;
  /** UTF-8 text. Binary and oversized files come back with `content: null`. */
  content: string | null;
  /** Set when `content` is null: "binary" | "too-large". */
  unreadable?: "binary" | "too-large";
  editable: boolean;
  /** Why an edit is refused, when `editable` is false. */
  editRefusal?: string;
}

export interface RepoTreeResponse {
  ok: true;
  ref: string;
  path: string;
  entries: RepoTreeEntry[];
}

export interface FilePutRequest {
  path: string;
  content: string;
  /** The blob sha the editor loaded. Mismatch → 409, never a silent overwrite. */
  baseSha: string;
  commitMessage: string;
  confirmToken: string;
  /** Required, and separately confirmed, for a path under .github/workflows. */
  workflowsConfirm?: boolean;
}

export interface FilePutResponse {
  ok: true;
  commitSha: string;
  path: string;
  sha: string;
}

/* ──────────────────────────────── Build and publish ──────────────────────────────── */

export interface BuildRequest {
  confirmToken: string;
  /** Re-run a build for a draft that already has a run. */
  rebuild?: boolean;
}

export interface BuildResponse {
  ok: true;
  draft: ReleaseDraft;
  runId: number | null;
  /** True when the version bump commit was pushed as part of this call. */
  bumped: boolean;
}

/**
 * Publish is a sequence, and each step is recorded so a failed call resumes instead of
 * repeating work. A retry sends the same `confirmToken` until it expires.
 */
export type PublishStep =
  | "release_upserted"
  | "body_written"
  | "release_published"
  | "manifest_committed"
  | "recorded";

export const PUBLISH_STEPS: readonly PublishStep[] = [
  "release_upserted",
  "body_written",
  "release_published",
  "manifest_committed",
  "recorded",
];

export interface PublishRequest {
  confirmToken: string;
  /** The status the panel believed the draft had. Mismatch → 409. */
  expectedStatus: ReleaseDraftStatus;
  /** Skip the update.xml commit — for a prerelease nobody should auto-update to. */
  skipManifest?: boolean;
}

export interface PublishResponse {
  ok: true;
  draft: ReleaseDraft;
  completedSteps: PublishStep[];
  /** Set when the run stopped early; POST again with the same token to resume here. */
  failedStep?: PublishStep;
  failureReason?: string;
  release: GithubRelease | null;
  manifest: UpdateXmlModel | null;
}

/** A confirm token is minted per action and burnt on use. */
export type ConfirmAction =
  | "publish"
  | "make-current"
  | "unpublish"
  | "build"
  | "commit"
  | "dispatch";

export interface ConfirmTokenRequest {
  action: ConfirmAction;
  /** Draft id, release id, file path or workflow id — whatever the action names. */
  subject: string;
}

/**
 * What kind of consequence a line describes, so the modal can group and icon them. `note` is the
 * catch-all; it never carries something that belongs in one of the others.
 */
export type ConfirmEffectKind = "github" | "manifest" | "installs" | "discord" | "note";

/**
 * One line the confirm modal prints. **Always server-generated from live state** — the current
 * manifest, the target release, the adoption query and the workflow files. The client renders
 * `text` verbatim and in order; it never composes, reorders or supplements a line, and no
 * illustrative or hard-coded effect copy exists in the page.
 */
export interface ConfirmEffect {
  kind: ConfirmEffectKind;
  text: string;
}

export interface ConfirmTokenResponse {
  ok: true;
  token: string;
  expiresAt: string;
  /**
   * The exact list the modal shows. Invariant: a `publish` (prerelease included) always carries
   * exactly one `kind: "discord"` line while .github/workflows/discord-release.yml is wired to
   * `release: { types: [published, prereleased] }` — and, when that workflow cannot be read, the
   * line is emitted anyway. `make-current` carries a `discord` line saying nothing is posted.
   */
  effects: ConfirmEffect[];
}

/** Guard the publish/make-current handlers assert before minting a token. */
export function hasDiscordEffect(effects: readonly ConfirmEffect[]): boolean {
  return effects.some((effect) => effect.kind === "discord");
}

/* ─────────────────── Make current (rollback) and unpublish ─────────────────── */

/**
 * POST /api/admin/releases/:id/make-current — the governed way to repoint update.xml at another
 * published tag. `:id` is the GitHub release id, so it works with or without a draft row. The
 * handler refuses a draft, a prerelease (design decision 4) and any release that does not carry
 * RazorReaper-Setup.exe, then commits update.xml through the Git Data helper.
 */
export interface MakeCurrentRequest {
  confirmToken: string;
  /** Editable, defaulted to `release: point update.xml at {tag}`. */
  commitMessage: string;
  /** The tag the operator believes is current. Mismatch → 409 { code: "stale" }. */
  expectedCurrentTag?: string | null;
}

export interface MakeCurrentResponse {
  ok: true;
  /** The tag update.xml now pins. */
  tag: string;
  /** The tag it pinned before, for the confirmation toast and the audit line. */
  previousTag: string | null;
  commitSha: string;
  manifest: UpdateXmlModel;
}

/** A release the panel may offer as the next `make-current` target. */
export interface MakeCurrentCandidate {
  /** GitHub release id — the `:id` of the make-current call. */
  releaseId: number;
  tag: string;
  version: string;
  publishedAt: string | null;
  /** Always true for a candidate; the server filters asset-less releases out. */
  hasInstallerAsset: boolean;
}

export interface UnpublishResponse {
  ok: true;
  release: GithubRelease;
}

/**
 * Refusal of unpublish-to-draft while update.xml still pins that tag. The "explicit second action"
 * the design refers to is exactly make-current: the page renders these candidates inline with a
 * Make-current button each, and the unpublish succeeds on a second click. There is no override.
 */
export interface UnpublishBlockedResponse {
  ok: false;
  error: string;
  code: "manifest-pinned";
  blockedBy: "manifest";
  makeCurrentCandidates: MakeCurrentCandidate[];
}

export type UnpublishResult = UnpublishResponse | UnpublishBlockedResponse | ApiError;

/* ─────────────────────────────────── Overview ─────────────────────────────────── */

/**
 * "placeholder" is `GITHUB_RELEASE_TOKEN` set to something that is not a token — today the NAS env
 * carries the literal "xxx". Any value whose trimmed form does not start with `github_pat_` or
 * `ghp_` is treated as absent, so the panel shows one clear status line instead of 401-ing on
 * every click. It behaves exactly like "missing" for authorisation.
 */
export type TokenMode = "write" | "read-only" | "placeholder" | "missing";

export function isUsableTokenValue(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  return trimmed.startsWith("github_pat_") || trimmed.startsWith("ghp_");
}

/** What the panel needs to decide which buttons are live. Never carries the token itself. */
export interface TokenStatus {
  mode: TokenMode;
  /** Name of the env var in play, for the status line: "GITHUB_RELEASE_TOKEN". Never its value. */
  source: string | null;
  canWrite: boolean;
  /** One sentence for the persistent status line when `canWrite` is false. */
  message: string | null;
  /** Remaining core-API calls, from the last response's headers. */
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
}

export interface AdoptionSnapshot {
  /** The version the share is for — normally the latest published one. */
  version: string;
  /** Distinct installs on that version in the window. */
  installs: number;
  /** Distinct installs on any version in the window. */
  totalInstalls: number;
  /** installs / totalInstalls, 0–1. */
  share: number;
  windowDays: number;
}

export interface ReleasesOverviewResponse {
  ok: true;
  apiVersion: number;
  token: TokenStatus;
  latestPublished: GithubRelease | null;
  releases: GithubRelease[];
  drafts: ReleaseDraft[];
  recentRuns: WorkflowRunSummary[];
  updateXml: UpdateXmlState | null;
  adoption: AdoptionSnapshot | null;
  /** Stale-read marker: set when GitHub was unreachable and this came from cache. */
  stale: boolean;
}

export interface ReleaseEventsResponse {
  ok: true;
  events: ReleaseEvent[];
}

/* ─────────────────── Versions page (replaces the two browser hooks) ─────────────────── */

export interface VersionsResponse {
  ok: true;
  /** Published, non-draft release versions, 3-part and newest first: ["1.5.3", "1.5.2", …]. */
  releases: string[];
  /** The version update.xml currently points at, 3-part. */
  latest: string;
  /** Cache age in seconds, so the page can show "as of …". */
  ageSeconds: number;
}

/* ──────────────────── Announcement targeting (version range) ──────────────────── */

/**
 * Both bounds are inclusive and optional; null means open-ended. A client that sends no `v`
 * (1.5.3 and below) matches every announcement, exactly as today.
 */
export interface AnnouncementVersionRange {
  minVersion: string | null;
  maxVersion: string | null;
}

/** Semver-ish compare over 1–4 numeric parts. Non-numeric input sorts last. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((p) => Number(p) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function versionInRange(version: string | null, range: AnnouncementVersionRange): boolean {
  if (!version) return true;
  if (range.minVersion && compareVersions(version, range.minVersion) < 0) return false;
  if (range.maxVersion && compareVersions(version, range.maxVersion) > 0) return false;
  return true;
}

/* ─────────────────────────────────── Envelope ─────────────────────────────────── */

export interface ApiError {
  ok: false;
  error: string;
  /** Present on the conflicts the editor must handle: "stale", "status-mismatch", "no-write-token". */
  code?:
    | "stale"
    | "status-mismatch"
    | "no-write-token"
    | "denied-path"
    | "manifest-pinned"
    | "rate-limited";
  requestId?: string;
}

export type ApiResult<T> = T | ApiError;
