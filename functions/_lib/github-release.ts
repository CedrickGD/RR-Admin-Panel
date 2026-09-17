/**
 * The only module in the panel that knows a GitHub URL. Design: docs/release-management-design.md
 * §5. The Pages Functions build and the standalone backend-worker build import the same file, so
 * it uses plain `fetch` and no runtime binding; `options.fetch` is the seam a `FakeGitHub` is
 * injected through in tests (§12), the same shape `tests/api/admin-installs.test.ts` uses for D1.
 *
 * Three rules this module exists to enforce:
 *
 *  - **The token never leaves the server.** It is read from the env at call time, placed in one
 *    `Authorization` header and nowhere else. It is never logged, never part of an error message
 *    and never in a response body — `TokenStatus.source` carries the variable's *name*, not its
 *    value, including in the `"placeholder"` case.
 *  - **No GitHub error body is forwarded verbatim.** Every failure becomes a `GithubApiError`
 *    carrying a status the route can answer with and a sentence written here.
 *  - **Every repo write goes through `commitFiles`**, whose six calls run in one fixed order and
 *    whose `force: false` ref PATCH is the concurrency guard — see the comment on that method.
 */
import type { RuntimeEnv } from "./types";
import {
  MANIFEST_REPO,
  isUsableTokenValue,
  type ApiError,
  type CommitSummary,
  type GithubRelease,
  type ReleaseAsset,
  type ReleaseState,
  type RunConclusion,
  type RunStatus,
  type TokenMode,
  type TokenStatus,
  type WorkflowInputSpec,
  type WorkflowJobSummary,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from "../../shared/releases-contract";

const GITHUB_API = "https://api.github.com";

/** Sent on every call, so a GitHub API change never arrives unannounced. */
export const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_USER_AGENT = "RazorReaper-Panel";

/** The two env variables token resolution looks at, in this order. Names only — never values. */
export const RELEASE_TOKEN_VAR = "GITHUB_RELEASE_TOKEN";
export const READ_TOKEN_VAR = "GITHUB_TOKEN";

export const DEFAULT_REPO = MANIFEST_REPO;
export const DEFAULT_BRANCH = "master";

/**
 * Below this many remaining core-API calls the module stops serving non-essential GETs: a browser
 * left on the overview must not be what exhausts the hour that a publish needs. Reads inside a
 * write sequence pass `essential: true` and ignore the floor.
 */
export const RATE_LIMIT_FLOOR = 100;

/** Git blob mode for a regular file — the only mode `commitFiles` ever writes. */
const BLOB_MODE = "100644";

const MAX_CACHE_ENTRIES = 200;
const DEFAULT_RELEASE_PAGE = 30;
const DEFAULT_RUN_PAGE = 10;
const DEFAULT_LOG_LINES = 200;
const MAX_COMPARE_COMMITS = 100;
/** Matches the Files tab's own limit (§11): a bigger blob is reported, never decoded. */
const MAX_BLOB_BYTES = 512 * 1024;

const NOT_FAST_FORWARD =
  "master moved while this commit was being built — the ref update was refused.";
const MOVED_TWICE = "master moved twice while this was being written — reload and retry.";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/* ────────────────────────────────── Errors ────────────────────────────────── */

/**
 * Every failure this module raises. `status` is what the route should answer with — already
 * mapped per §5 (401/403 → 502, a missing tag → 404, a refused ref PATCH → 409) — and `message`
 * is written here, never taken from GitHub's response body.
 */
export class GithubApiError extends Error {
  readonly status: number;
  readonly code?: ApiError["code"];
  /** What GitHub answered, for a `release_events` row. Never accompanied by its body. */
  readonly githubStatus: number | null;
  /** Set on the 422 a non-fast-forward `PATCH …/git/refs/*` is refused with. */
  readonly nonFastForward: boolean;

  constructor(
    status: number,
    message: string,
    options: {
      code?: ApiError["code"];
      githubStatus?: number | null;
      nonFastForward?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
    this.code = options.code;
    this.githubStatus = options.githubStatus ?? null;
    this.nonFastForward = options.nonFastForward ?? false;
  }
}

export function isGithubApiError(value: unknown): value is GithubApiError {
  return value instanceof GithubApiError;
}

/** `{ ok: false, … }` body for a caught failure. Anything unrecognised collapses to a 502. */
export function apiErrorBody(cause: unknown): { body: ApiError; status: number } {
  if (isGithubApiError(cause)) {
    const body: ApiError = { ok: false, error: cause.message };
    if (cause.code) body.code = cause.code;
    return { body, status: cause.status };
  }
  return { body: { ok: false, error: "GitHub is unavailable." }, status: 502 };
}

/* ───────────────────────────── Token resolution ───────────────────────────── */

export interface ResolvedGithubToken {
  /** The value to authenticate with, or null to call GitHub anonymously. Never leaves here. */
  token: string | null;
  mode: TokenMode;
  /** The variable's *name*, for the status line. */
  source: string | null;
}

const TOKEN_MESSAGES: Record<TokenMode, string | null> = {
  write: null,
  "read-only": `${READ_TOKEN_VAR} is read-only: set ${RELEASE_TOKEN_VAR} to a fine-grained token with Contents, Actions and Workflows write access to draft, build, publish or roll back from the panel.`,
  placeholder: `${RELEASE_TOKEN_VAR} holds a placeholder, not a token: releases stay read-only until it carries a value beginning with github_pat_ or ghp_.`,
  missing: `${RELEASE_TOKEN_VAR} is not set: releases are read-only until it carries a fine-grained token with Contents, Actions and Workflows write access.`,
};

/**
 * `GITHUB_RELEASE_TOKEN` → `GITHUB_TOKEN` (read-only) → none, per §5.
 *
 * A `GITHUB_RELEASE_TOKEN` whose trimmed value does not begin with `github_pat_` or `ghp_` is
 * **treated as absent** — the NAS env carries the literal `"xxx"` today (decision 8) and a 401
 * storm on every click is worse than one clear status line. Resolution then falls through to
 * `GITHUB_TOKEN` so reads keep working, but the reported mode stays `"placeholder"`: that is the
 * variable the owner has to fix, and it is the one the status line must name.
 *
 * The same prefix test is applied to `GITHUB_TOKEN`, for the same reason — a placeholder there
 * would 401 exactly as loudly. With no usable value at all the client calls GitHub anonymously,
 * which is what the worker does today and what keeps the public repo readable during rollout.
 */
export function resolveGithubToken(env: RuntimeEnv): ResolvedGithubToken {
  const release = (env.GITHUB_RELEASE_TOKEN ?? "").trim();
  const readOnly = (env.GITHUB_TOKEN ?? "").trim();
  const readOnlyToken = isUsableTokenValue(readOnly) ? readOnly : null;

  if (isUsableTokenValue(release)) {
    return { token: release, mode: "write", source: RELEASE_TOKEN_VAR };
  }
  if (release.length > 0) {
    return { token: readOnlyToken, mode: "placeholder", source: RELEASE_TOKEN_VAR };
  }
  if (readOnlyToken) {
    return { token: readOnlyToken, mode: "read-only", source: READ_TOKEN_VAR };
  }
  return { token: null, mode: "missing", source: null };
}

/**
 * Rate-limit headers are a property of the token and the isolate, not of one request, so the last
 * seen pair is kept module-wide — the same "per isolate, documented" shape `ratelimit.ts` uses.
 * A handler builds a fresh client per request and would otherwise always report `null`.
 */
interface RateLimitSnapshot {
  remaining: number | null;
  resetAtMs: number | null;
}

let lastRateLimit: RateLimitSnapshot = { remaining: null, resetAtMs: null };

/** What the panel needs to decide which buttons are live. Never carries the token itself. */
export function tokenStatus(env: RuntimeEnv, nowMs: number = Date.now()): TokenStatus {
  const resolved = resolveGithubToken(env);
  const limit = currentRateLimit(nowMs);
  return {
    mode: resolved.mode,
    source: resolved.source,
    canWrite: resolved.mode === "write",
    message: TOKEN_MESSAGES[resolved.mode],
    rateLimitRemaining: limit.remaining,
    rateLimitResetAt: limit.resetAtMs === null ? null : new Date(limit.resetAtMs).toISOString(),
  };
}

/** The snapshot, forgotten once its window has reset — a stale "3 left" would freeze the page. */
function currentRateLimit(nowMs: number): RateLimitSnapshot {
  if (lastRateLimit.resetAtMs !== null && lastRateLimit.resetAtMs <= nowMs) {
    lastRateLimit = { remaining: null, resetAtMs: null };
  }
  return lastRateLimit;
}

/* ─────────────────────────── ETag cache and stale reads ─────────────────────────── */

interface CacheEntry {
  etag: string | null;
  payload: unknown;
  fetchedAtMs: number;
}

const responseCache = new Map<string, CacheEntry>();

/** Both module-level stores, so one test case cannot leak into the next. */
export function resetGithubReleaseStateForTests(): void {
  responseCache.clear();
  lastRateLimit = { remaining: null, resetAtMs: null };
}

function rememberResponse(key: string, entry: CacheEntry): void {
  if (!responseCache.has(key) && responseCache.size >= MAX_CACHE_ENTRIES) {
    // Insertion order: the oldest key is the first one the iterator yields.
    const oldest = responseCache.keys().next();
    if (!oldest.done) responseCache.delete(oldest.value);
  }
  responseCache.set(key, entry);
}

export interface ReadOptions {
  /** Serve a copy younger than this without any request at all. Omitted or 0 disables it. */
  memoiseMs?: number;
  /** An essential read ignores the rate-limit floor: a write sequence may not be half-done. */
  essential?: boolean;
  /**
   * Bypass every cache — no memoisation, no `If-None-Match`, no stale fallback. `commitFiles`
   * reads HEAD this way: a cached parent commit is exactly the bug step 1 exists to prevent.
   */
  fresh?: boolean;
  /** Names the resource in a 404, e.g. `release v1.5.4`. */
  label?: string;
}

/* ─────────────────────────────── Request/response shapes ─────────────────────────────── */

export interface GithubBlob {
  path: string;
  /** Blob sha — the optimistic-concurrency handle a `commitFiles` precondition compares. */
  sha: string;
  size: number;
  /** UTF-8 text, or null when the blob is binary or over the size cap. */
  content: string | null;
  unreadable?: "binary" | "too-large";
}

export interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size: number | null;
}

export interface CommitsSince {
  sinceTag: string | null;
  aheadBy: number;
  commits: CommitSummary[];
  truncated: boolean;
}

export interface ReleaseInput {
  tag: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface ReleasePatch {
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  tag?: string;
}

export interface CommitFileInput {
  /** Repo-relative path, no leading slash. */
  path: string;
  /** UTF-8 text. */
  content: string;
  /**
   * The blob sha the caller believes this path carries on master; `null` means "must not exist
   * yet" and omitting it means "no expectation". Re-checked against the *new* HEAD before the one
   * retry — that re-check is what makes an automatic retry safe.
   */
  baseSha?: string | null;
}

export interface CommitFilesRequest {
  files: CommitFileInput[];
  message: string;
  branch?: string;
  /**
   * An extra precondition, re-evaluated against the new HEAD before the retry rebuilds anything.
   * Returns a refusal sentence, or null when the retry may proceed.
   */
  verify?: (headSha: string) => Promise<string | null> | string | null;
}

export interface CommitFilesResult {
  commitSha: string;
  treeSha: string;
  /** The HEAD the commit was built on — its single parent. */
  parentSha: string;
  /** Blob sha per committed path, so the caller can hand the editor a fresh `baseSha`. */
  blobShas: Record<string, string>;
  /** True when the first ref PATCH was refused and the whole sequence ran a second time. */
  retried: boolean;
}

export interface DispatchInput {
  ref?: string;
  inputs?: Record<string, string>;
}

export interface RunFilter {
  event?: string;
  branch?: string;
  workflowId?: number;
  limit?: number;
  /** Overview reads are memoised 60 s, 30 s while a draft is `building` (§5). */
  memoiseMs?: number;
}

/* ─────────────────────────────── GitHub payload shapes ─────────────────────────────── */

interface RawAsset {
  id: number;
  name: string;
  size: number;
  content_type?: string;
  download_count?: number;
  updated_at?: string;
}

interface RawRelease {
  id: number;
  tag_name: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: RawAsset[];
  created_at?: string;
  published_at?: string | null;
  html_url?: string;
}

interface RawCommit {
  sha: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
}

interface RawRun {
  id: number;
  workflow_id?: number;
  name?: string | null;
  run_number?: number;
  status?: string;
  conclusion?: string | null;
  event?: string;
  head_branch?: string | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

interface RawJob {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: Array<{ name?: string; status?: string }>;
}

/* ────────────────────────────────── Mapping ────────────────────────────────── */

const RUN_STATUSES = new Set<RunStatus>(["queued", "in_progress", "completed"]);
const RUN_CONCLUSIONS = new Set<string>([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
]);

function runStatus(value: string | undefined): RunStatus {
  return value && RUN_STATUSES.has(value as RunStatus) ? (value as RunStatus) : "unknown";
}

function runConclusion(value: string | null | undefined): RunConclusion {
  return value && RUN_CONCLUSIONS.has(value) ? (value as RunConclusion) : null;
}

function releaseState(raw: RawRelease): ReleaseState {
  if (raw.draft) return "draft";
  return raw.prerelease ? "prerelease" : "published";
}

function assetFromRaw(raw: RawAsset): ReleaseAsset {
  return {
    id: raw.id,
    name: raw.name,
    size: raw.size,
    contentType: raw.content_type ?? "application/octet-stream",
    downloadCount: raw.download_count ?? 0,
    updatedAt: raw.updated_at ?? "",
  };
}

function releaseFromRaw(raw: RawRelease): GithubRelease {
  return {
    id: raw.id,
    tag: raw.tag_name,
    name: raw.name ?? raw.tag_name,
    state: releaseState(raw),
    body: raw.body ?? "",
    assets: (raw.assets ?? []).map(assetFromRaw),
    createdAt: raw.created_at ?? "",
    publishedAt: raw.published_at ?? null,
    htmlUrl: raw.html_url ?? "",
  };
}

function commitFromRaw(raw: RawCommit): CommitSummary {
  const message = raw.commit?.message ?? "";
  return {
    sha: raw.sha,
    shortSha: raw.sha.slice(0, 7),
    subject: message.split("\n", 1)[0] ?? "",
    author: raw.author?.login ?? raw.commit?.author?.name ?? "unknown",
    date: raw.commit?.author?.date ?? "",
  };
}

function runFromRaw(raw: RawRun): WorkflowRunSummary {
  return {
    id: raw.id,
    workflowId: raw.workflow_id ?? 0,
    name: raw.name ?? "",
    runNumber: raw.run_number ?? 0,
    status: runStatus(raw.status),
    conclusion: runConclusion(raw.conclusion),
    event: raw.event ?? "",
    branch: raw.head_branch ?? "",
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    htmlUrl: raw.html_url ?? "",
  };
}

function jobFromRaw(raw: RawJob): WorkflowJobSummary {
  const steps = raw.steps ?? [];
  // The line the panel shows beside a job: whatever is running, else the last step that ran.
  const running = steps.find((step) => step.status === "in_progress");
  const current = running ?? steps[steps.length - 1];
  return {
    id: raw.id,
    name: raw.name ?? "",
    status: runStatus(raw.status),
    conclusion: runConclusion(raw.conclusion),
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    currentStep: current?.name ?? null,
  };
}

/* ───────────────────────────────── URL helpers ───────────────────────────────── */

/** Encodes each segment but keeps the slashes: `a/b c.yml` → `a/b%20c.yml`. */
function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

function decodeBase64Utf8(raw: string): { content: string | null; unreadable?: "binary" } {
  try {
    const binary = atob(raw.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    // Either the base64 or the UTF-8 was not decodable; both mean "not editable text".
    return { content: null, unreadable: "binary" };
  }
}

/* ───────────────────────── Workflow YAML (the parts we need) ───────────────────────── */

/**
 * A deliberately small indentation reader — enough for the two questions the panel asks of a
 * workflow file (`on.workflow_dispatch.inputs` and whether a `release` trigger is wired) and
 * nothing more. Block scalars (`run: |`) are skipped wholesale, which is what keeps a shell
 * script full of `#` and `- ` out of the tree.
 */
interface YamlNode {
  key: string;
  value: string;
  children: YamlNode[];
  /** `- item` entries directly under this key, and the members of a `[a, b]` flow list. */
  items: string[];
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === '"' || first === "'") && trimmed[trimmed.length - 1] === first) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function stripComment(line: string): string {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]!))) return line.slice(0, index);
  }
  return line;
}

/** Index of the `key:` colon — the first one outside quotes followed by space or end of line. */
function keyColonIndex(text: string): number {
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ":" && (index + 1 === text.length || /\s/.test(text[index + 1]!))) return index;
  }
  return -1;
}

function flowList(value: string): string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  return value
    .slice(1, -1)
    .split(",")
    .map(unquote)
    .filter((entry) => entry.length > 0);
}

function parseYaml(source: string): YamlNode {
  const root: YamlNode = { key: "", value: "", children: [], items: [] };
  const stack: Array<{ indent: number; node: YamlNode }> = [{ indent: -1, node: root }];
  let blockIndent: number | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    if (blockIndent !== null) {
      if (indent > blockIndent) continue;
      blockIndent = null;
    }
    const text = stripComment(rawLine).trim();
    if (!text) continue;

    if (text.startsWith("- ") || text === "-") {
      // A list item belongs to the key above it even when it is not indented past it.
      while (stack.length > 1 && indent < stack[stack.length - 1]!.indent) stack.pop();
      stack[stack.length - 1]!.node.items.push(unquote(text.slice(1)));
      continue;
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const colon = keyColonIndex(text);
    if (colon < 0) continue;
    const value = unquote(text.slice(colon + 1));
    const node: YamlNode = { key: unquote(text.slice(0, colon)), value, children: [], items: [] };
    node.items = flowList(value);
    if (node.items.length > 0) node.value = "";
    stack[stack.length - 1]!.node.children.push(node);
    stack.push({ indent, node });
    if (/^[|>][+-]?\d*$/.test(value)) {
      node.value = "";
      blockIndent = indent;
    }
  }
  return root;
}

function childNode(node: YamlNode | undefined, key: string): YamlNode | undefined {
  return node?.children.find((child) => child.key === key);
}

const INPUT_TYPES = new Set<WorkflowInputSpec["type"]>([
  "string",
  "boolean",
  "choice",
  "number",
  "environment",
]);

/**
 * `on.workflow_dispatch.inputs` as `WorkflowSummary.inputs`, so the dispatch form renders the
 * fields the workflow actually declares rather than a free-text blob.
 */
export function parseWorkflowDispatchInputs(yaml: string): WorkflowInputSpec[] {
  const inputs = childNode(
    childNode(childNode(parseYaml(yaml), "on"), "workflow_dispatch"),
    "inputs",
  );
  if (!inputs) return [];
  return inputs.children.map((child) => {
    const type = childNode(child, "type")?.value ?? "string";
    const optionsNode = childNode(child, "options");
    const spec: WorkflowInputSpec = {
      name: child.key,
      description: childNode(child, "description")?.value ?? "",
      required: childNode(child, "required")?.value === "true",
      type: INPUT_TYPES.has(type as WorkflowInputSpec["type"])
        ? (type as WorkflowInputSpec["type"])
        : "string",
    };
    const fallback = childNode(child, "default")?.value;
    if (fallback !== undefined && fallback !== "") spec.default = fallback;
    if (optionsNode && optionsNode.items.length > 0) spec.options = optionsNode.items;
    return spec;
  });
}

export interface WorkflowReleaseTrigger {
  /** True when the file runs on a `release` event of a type publishing fires. */
  wired: boolean;
  /**
   * Tags an `if:` guard excludes (`github.event.release.tag_name != 'v1.5.0'`). Read with a
   * deliberately coarse scan of the whole file: a guard may sit on any job, and a tag the file
   * mentions this way is one the confirm modal must not promise a post for.
   */
  excludedTags: string[];
}

/** The release-trigger half of a workflow file — what `discordEffectForPublish` decides on. */
export function parseWorkflowReleaseTrigger(yaml: string): WorkflowReleaseTrigger {
  const release = childNode(childNode(parseYaml(yaml), "on"), "release");
  const types = childNode(release, "types");
  // A `release:` trigger with no `types:` runs on every release activity, publishing included.
  const wired = Boolean(
    release && (!types || types.items.some((t) => t === "published" || t === "prereleased")),
  );
  const excludedTags = new Set<string>();
  for (const match of yaml.matchAll(/tag_name\s*!=\s*['"]([^'"]+)['"]/g)) {
    if (match[1]) excludedTags.add(match[1]);
  }
  return { wired, excludedTags: [...excludedTags] };
}

/* ─────────────────────────────────── The client ─────────────────────────────────── */

export interface GithubClientOptions {
  /** The test seam. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  repo?: string;
  branch?: string;
  now?: () => number;
}

export class GithubReleaseClient {
  readonly repo: string;
  readonly branch: string;

  private readonly doFetch: FetchLike;
  private readonly resolved: ResolvedGithubToken;
  private readonly env: RuntimeEnv;
  private readonly now: () => number;
  private staleRead = false;

  constructor(env: RuntimeEnv, options: GithubClientOptions = {}) {
    this.env = env;
    this.resolved = resolveGithubToken(env);
    this.repo = (options.repo ?? env.GITHUB_REPO ?? DEFAULT_REPO).trim();
    this.branch = (options.branch ?? env.GITHUB_BRANCH ?? DEFAULT_BRANCH).trim();
    this.now = options.now ?? (() => Date.now());
    this.doFetch = options.fetch ?? ((input, init) => (globalThis.fetch as FetchLike)(input, init));
  }

  /** Never carries the token; `source` is the variable's name. */
  tokenStatus(): TokenStatus {
    return tokenStatus(this.env, this.now());
  }

  get canWrite(): boolean {
    return this.resolved.mode === "write";
  }

  /** True when any read this request served came from cache instead of GitHub (§5). */
  get stale(): boolean {
    return this.staleRead;
  }

  /* ── Releases ── */

  async listReleases(options: ReadOptions & { limit?: number } = {}): Promise<GithubRelease[]> {
    const perPage = Math.max(1, Math.min(options.limit ?? DEFAULT_RELEASE_PAGE, 100));
    const raw = await this.get<RawRelease[]>(
      `/repos/${this.repo}/releases?per_page=${perPage}`,
      options,
    );
    return raw.map(releaseFromRaw);
  }

  /** The release for `tag`, or null. Publish's step 1 ("find or create") wants the null. */
  async findReleaseByTag(tag: string): Promise<GithubRelease | null> {
    const raw = await this.tryGet<RawRelease>(
      `/repos/${this.repo}/releases/tags/${encodeURIComponent(tag)}`,
      { essential: true, label: `release tagged ${tag}` },
    );
    return raw ? releaseFromRaw(raw) : null;
  }

  /** Same call, but a missing tag is the 404 naming it that §5 asks for. */
  async getReleaseByTag(tag: string): Promise<GithubRelease> {
    const release = await this.findReleaseByTag(tag);
    if (!release)
      throw new GithubApiError(404, `GitHub has no release tagged ${tag}.`, { githubStatus: 404 });
    return release;
  }

  async getRelease(id: number): Promise<GithubRelease> {
    const raw = await this.get<RawRelease>(`/repos/${this.repo}/releases/${id}`, {
      essential: true,
      label: `release ${id}`,
    });
    return releaseFromRaw(raw);
  }

  async createRelease(input: ReleaseInput): Promise<GithubRelease> {
    const raw = await this.send<RawRelease>("POST", `/repos/${this.repo}/releases`, {
      tag_name: input.tag,
      name: input.name ?? input.tag,
      body: input.body ?? "",
      // A release the panel creates is always a draft first: publishing is its own recorded step,
      // and it is the step that fires the Discord post.
      draft: input.draft ?? true,
      prerelease: input.prerelease ?? false,
    });
    return releaseFromRaw(raw);
  }

  async updateRelease(id: number, patch: ReleasePatch): Promise<GithubRelease> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.body !== undefined) body.body = patch.body;
    if (patch.draft !== undefined) body.draft = patch.draft;
    if (patch.prerelease !== undefined) body.prerelease = patch.prerelease;
    if (patch.tag !== undefined) body.tag_name = patch.tag;
    const raw = await this.send<RawRelease>("PATCH", `/repos/${this.repo}/releases/${id}`, body);
    return releaseFromRaw(raw);
  }

  /** Publish step 3, and the only call in the panel that fires a GitHub release event. */
  async publishRelease(id: number): Promise<GithubRelease> {
    return this.updateRelease(id, { draft: false });
  }

  async listAssets(releaseId: number): Promise<ReleaseAsset[]> {
    const raw = await this.get<RawAsset[]>(`/repos/${this.repo}/releases/${releaseId}/assets`, {
      essential: true,
      label: `release ${releaseId}`,
    });
    return raw.map(assetFromRaw);
  }

  /**
   * Deletes one asset. There is deliberately no upload counterpart: `build-installer.yml` uploads
   * `RazorReaper-Setup.exe` with the `gh` CLI (§7), so the panel never streams a 73 MB installer
   * through a Worker — it only ever removes a superseded one.
   */
  async deleteAsset(assetId: number): Promise<void> {
    await this.send<null>("DELETE", `/repos/${this.repo}/releases/assets/${assetId}`);
  }

  /* ── Commits ── */

  async compareSinceTag(
    tag: string | null,
    head: string = this.branch,
    limit = MAX_COMPARE_COMMITS,
  ): Promise<CommitsSince> {
    if (!tag) return { sinceTag: null, aheadBy: 0, commits: [], truncated: false };
    const raw = await this.get<{ ahead_by?: number; commits?: RawCommit[] }>(
      `/repos/${this.repo}/compare/${encodeURIComponent(tag)}...${encodeURIComponent(head)}`,
      { label: `tag ${tag}` },
    );
    const commits = (raw.commits ?? []).map(commitFromRaw).reverse();
    return {
      sinceTag: tag,
      aheadBy: raw.ahead_by ?? commits.length,
      commits: commits.slice(0, limit),
      truncated: commits.length > limit,
    };
  }

  /* ── Contents and the Git Data API ── */

  /**
   * One blob off the Contents API. `essential` **defaults to true** because the readers that
   * matter run inside a write sequence — `verifyAgainstHead`, publish's manifest read,
   * `discordEffectForPublish` — and a half-written release is worse than a spent rate limit. A
   * browsing call site (the Workflows tab's per-file input read) passes `essential: false` so the
   * §5 floor still applies to it.
   */
  async getContent(
    path: string,
    options: ReadOptions & { ref?: string } = {},
  ): Promise<GithubBlob | null> {
    const ref = options.ref ?? this.branch;
    const raw = await this.tryGet<{
      path?: string;
      sha?: string;
      size?: number;
      content?: string;
      encoding?: string;
      type?: string;
    }>(`/repos/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, {
      essential: true,
      ...options,
    });
    if (!raw || raw.type === "dir" || !raw.sha) return null;
    const size = raw.size ?? 0;
    const blob: GithubBlob = { path: raw.path ?? path, sha: raw.sha, size, content: null };
    if (size > MAX_BLOB_BYTES || raw.encoding !== "base64") {
      blob.unreadable = size > MAX_BLOB_BYTES ? "too-large" : "binary";
      return blob;
    }
    const decoded = decodeBase64Utf8(raw.content ?? "");
    blob.content = decoded.content;
    if (decoded.unreadable) blob.unreadable = decoded.unreadable;
    return blob;
  }

  /** The tree browser's listing. `sha` may be a branch name, a commit sha or a tree sha. */
  async getTree(sha: string, options: { recursive?: boolean } = {}): Promise<GithubTreeEntry[]> {
    const suffix = options.recursive ? "?recursive=1" : "";
    const raw = await this.get<{
      tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
    }>(`/repos/${this.repo}/git/trees/${encodeURIComponent(sha)}${suffix}`, {
      label: `tree ${sha}`,
    });
    return (raw.tree ?? [])
      .filter(
        (entry) => entry.path && entry.sha && (entry.type === "blob" || entry.type === "tree"),
      )
      .map((entry) => ({
        path: entry.path!,
        type: entry.type as "blob" | "tree",
        sha: entry.sha!,
        size: entry.size ?? null,
      }));
  }

  /** Step 1: the sha `commitFiles` builds on and the one the final PATCH must fast-forward. */
  async getRef(branch: string = this.branch): Promise<string> {
    const raw = await this.get<{ object?: { sha?: string } }>(
      `/repos/${this.repo}/git/ref/heads/${encodePath(branch)}`,
      { essential: true, fresh: true, label: `branch ${branch}` },
    );
    const sha = raw.object?.sha;
    if (!sha) throw new GithubApiError(502, `GitHub returned no sha for branch ${branch}.`);
    return sha;
  }

  /** Step 2: the tree the new one is based on. */
  async getCommitTree(commitSha: string): Promise<string> {
    const raw = await this.get<{ tree?: { sha?: string } }>(
      `/repos/${this.repo}/git/commits/${encodeURIComponent(commitSha)}`,
      { essential: true, fresh: true, label: `commit ${commitSha}` },
    );
    const sha = raw.tree?.sha;
    if (!sha) throw new GithubApiError(502, "GitHub returned a commit without a tree.");
    return sha;
  }

  /**
   * Every panel write to the repo — the version bump, `update.xml` on publish or `make-current`,
   * a Files-tab commit — runs these six calls in this exact order (§5):
   *
   *   1. `GET …/git/ref/heads/{branch}`     → headSha. Nothing is written before HEAD is read.
   *   2. `GET …/git/commits/{headSha}`      → baseTreeSha.
   *   3. `POST …/git/blobs`                 once per file.
   *   4. `POST …/git/trees`                 with `base_tree`, one `100644` entry per blob.
   *   5. `POST …/git/commits`               with `parents: [headSha]`.
   *   6. `PATCH …/git/refs/heads/{branch}`  with `{ sha, force: false }`.
   *
   * **Step 6 is the concurrency guard.** `force: false` makes GitHub refuse a non-fast-forward,
   * so if master advanced between step 1 and step 6 the PATCH fails with a 422 instead of
   * silently discarding the other commit. That refusal — not an ETag, not a lock — is what makes
   * the sequence safe, and it is why one ref move writes all the files rather than a Contents
   * call per file leaving master half-bumped.
   *
   * **Retry policy: exactly one retry.** Re-read HEAD, re-verify the preconditions against the
   * *new* HEAD, rebuild blobs/tree/commit on the new base and PATCH again. The re-verification is
   * what makes the automatic retry safe: if any guarded path changed on master meanwhile the
   * retry is abandoned with `409 { code: "stale" }` so a human resolves it. A second
   * non-fast-forward gives up. No third attempt and no backoff loop.
   */
  async commitFiles(request: CommitFilesRequest): Promise<CommitFilesResult> {
    this.requireWrite();
    if (request.files.length === 0) {
      throw new GithubApiError(400, "A commit needs at least one file.");
    }
    const branch = request.branch ?? this.branch;

    for (let attempt = 0; ; attempt += 1) {
      const parentSha = await this.getRef(branch);
      const baseTreeSha = await this.getCommitTree(parentSha);

      if (attempt > 0) {
        const refusal = await this.verifyAgainstHead(request, parentSha);
        if (refusal) throw new GithubApiError(409, refusal, { code: "stale" });
      }

      const blobShas: Record<string, string> = {};
      for (const file of request.files) {
        blobShas[file.path] = await this.createBlob(file.content);
      }
      const treeSha = await this.createTree(baseTreeSha, request.files, blobShas);
      const commitSha = await this.createCommit(request.message, treeSha, parentSha);

      try {
        await this.patchRef(branch, commitSha);
        return { commitSha, treeSha, parentSha, blobShas, retried: attempt > 0 };
      } catch (cause) {
        if (!isGithubApiError(cause) || !cause.nonFastForward) throw cause;
        if (attempt >= 1) throw new GithubApiError(409, MOVED_TWICE, { code: "stale" });
      }
    }
  }

  /** Step 3. */
  private async createBlob(content: string): Promise<string> {
    const raw = await this.send<{ sha?: string }>("POST", `/repos/${this.repo}/git/blobs`, {
      content,
      encoding: "utf-8",
    });
    if (!raw.sha) throw new GithubApiError(502, "GitHub returned a blob without a sha.");
    return raw.sha;
  }

  /** Step 4. */
  private async createTree(
    baseTreeSha: string,
    files: CommitFileInput[],
    blobShas: Record<string, string>,
  ): Promise<string> {
    const raw = await this.send<{ sha?: string }>("POST", `/repos/${this.repo}/git/trees`, {
      base_tree: baseTreeSha,
      tree: files.map((file) => ({
        path: file.path,
        mode: BLOB_MODE,
        type: "blob",
        sha: blobShas[file.path],
      })),
    });
    if (!raw.sha) throw new GithubApiError(502, "GitHub returned a tree without a sha.");
    return raw.sha;
  }

  /** Step 5. */
  private async createCommit(message: string, treeSha: string, parentSha: string): Promise<string> {
    const raw = await this.send<{ sha?: string }>("POST", `/repos/${this.repo}/git/commits`, {
      message,
      tree: treeSha,
      parents: [parentSha],
    });
    if (!raw.sha) throw new GithubApiError(502, "GitHub returned a commit without a sha.");
    return raw.sha;
  }

  /** Step 6 — the guard. `force: false` is the whole point and is never configurable. */
  private async patchRef(branch: string, commitSha: string): Promise<void> {
    try {
      await this.send<unknown>(
        "PATCH",
        `/repos/${this.repo}/git/refs/heads/${encodePath(branch)}`,
        {
          sha: commitSha,
          force: false,
        },
      );
    } catch (cause) {
      if (isGithubApiError(cause) && cause.githubStatus === 422) {
        throw new GithubApiError(409, NOT_FAST_FORWARD, {
          code: "stale",
          githubStatus: 422,
          nonFastForward: true,
        });
      }
      throw cause;
    }
  }

  /**
   * The retry's re-verification: every guarded path must still carry the blob sha the caller
   * loaded. A path that moved under the commit is exactly the case an automatic retry must not
   * paper over — the caller's content was written against the old blob.
   */
  private async verifyAgainstHead(
    request: CommitFilesRequest,
    headSha: string,
  ): Promise<string | null> {
    for (const file of request.files) {
      if (file.baseSha === undefined) continue;
      const current = await this.getContent(file.path, { ref: headSha });
      const currentSha = current?.sha ?? null;
      if (currentSha !== file.baseSha) {
        return `${file.path} changed on master while this commit was being written — reload and retry.`;
      }
    }
    return request.verify ? ((await request.verify(headSha)) ?? null) : null;
  }

  /* ── Actions ── */

  async listWorkflows(options: { withInputs?: boolean } = {}): Promise<WorkflowSummary[]> {
    const raw = await this.get<{
      workflows?: Array<{ id?: number; name?: string; path?: string; state?: string }>;
    }>(`/repos/${this.repo}/actions/workflows?per_page=100`, {});
    const summaries: WorkflowSummary[] = (raw.workflows ?? [])
      .filter((workflow) => typeof workflow.id === "number" && workflow.path)
      .map((workflow) => ({
        id: workflow.id!,
        name: workflow.name ?? workflow.path!,
        path: workflow.path!,
        state: workflow.state ?? "unknown",
        inputs: [],
      }));
    if (!options.withInputs) return summaries;
    for (const summary of summaries) {
      // One extra Contents read per workflow: the dispatch inputs are declared in the file, not
      // in the Actions API. A failed read leaves `inputs` empty rather than failing the list.
      // `essential: false` is load-bearing — `getContent` defaults to essential because publish
      // and make-current read through it mid-sequence, but N reads fired by a browser parked on
      // the Workflows tab are exactly the browsing the §5 floor exists to stop.
      const blob = await this.getContent(summary.path, { essential: false }).catch(() => null);
      if (blob?.content) summary.inputs = parseWorkflowDispatchInputs(blob.content);
    }
    return summaries;
  }

  /** `workflowId` may be the numeric id or the file name, exactly as GitHub accepts it. */
  async dispatchWorkflow(workflowId: number | string, input: DispatchInput = {}): Promise<void> {
    await this.send<null>(
      "POST",
      `/repos/${this.repo}/actions/workflows/${encodeURIComponent(String(workflowId))}/dispatches`,
      { ref: input.ref ?? this.branch, inputs: input.inputs ?? {} },
    );
  }

  async listRuns(filter: RunFilter = {}): Promise<WorkflowRunSummary[]> {
    const params = new URLSearchParams({
      per_page: String(Math.max(1, Math.min(filter.limit ?? DEFAULT_RUN_PAGE, 100))),
    });
    if (filter.event) params.set("event", filter.event);
    if (filter.branch) params.set("branch", filter.branch);
    const path = filter.workflowId
      ? `/repos/${this.repo}/actions/workflows/${filter.workflowId}/runs`
      : `/repos/${this.repo}/actions/runs`;
    const raw = await this.get<{ workflow_runs?: RawRun[] }>(`${path}?${params}`, {
      memoiseMs: filter.memoiseMs,
    });
    return (raw.workflow_runs ?? []).map(runFromRaw);
  }

  async getRun(runId: number): Promise<WorkflowRunSummary> {
    const raw = await this.get<RawRun>(`/repos/${this.repo}/actions/runs/${runId}`, {
      essential: true,
      label: `run ${runId}`,
    });
    return runFromRaw(raw);
  }

  async listJobs(runId: number): Promise<WorkflowJobSummary[]> {
    const raw = await this.get<{ jobs?: RawJob[] }>(
      `/repos/${this.repo}/actions/runs/${runId}/jobs?per_page=100`,
      { essential: true, label: `run ${runId}` },
    );
    return (raw.jobs ?? []).map(jobFromRaw);
  }

  /**
   * The tail of one job's log. GitHub masks secrets in these before it serves them, and the
   * endpoint answers with a redirect to plain text rather than JSON — so this is the one read
   * that never touches the ETag cache. A log that cannot be fetched is an empty tail, not an
   * error: the run panel still has the job list to show.
   */
  async getJobLogs(jobId: number, maxLines = DEFAULT_LOG_LINES): Promise<string[]> {
    const response = await this.rawFetch(
      "GET",
      `/repos/${this.repo}/actions/jobs/${jobId}/logs`,
      undefined,
      "application/vnd.github.raw+json",
    ).catch(() => null);
    if (response) this.recordRateLimit(response);
    if (!response?.ok) return [];
    const text = await response.text().catch(() => "");
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    return lines.slice(Math.max(0, lines.length - maxLines));
  }

  /* ── Transport ── */

  private requireWrite(): void {
    if (this.canWrite) return;
    throw new GithubApiError(409, TOKEN_MESSAGES[this.resolved.mode] ?? TOKEN_MESSAGES.missing!, {
      code: "no-write-token",
    });
  }

  private headers(accept: string, withBody: boolean, etag: string | null): HeadersInit {
    const headers: Record<string, string> = {
      accept,
      "user-agent": GITHUB_USER_AGENT,
      "x-github-api-version": GITHUB_API_VERSION,
    };
    // The only place the token is ever written. It is not logged, not echoed and not returned.
    if (this.resolved.token) headers.authorization = `Bearer ${this.resolved.token}`;
    if (withBody) headers["content-type"] = "application/json";
    if (etag) headers["if-none-match"] = etag;
    return headers;
  }

  private rawFetch(
    method: string,
    path: string,
    body: unknown,
    accept: string,
    etag: string | null = null,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: this.headers(accept, body !== undefined, etag),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return this.doFetch(`${GITHUB_API}${path}`, init);
  }

  private recordRateLimit(response: Response): void {
    const remaining = Number.parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10);
    const reset = Number.parseInt(response.headers.get("x-ratelimit-reset") ?? "", 10);
    if (!Number.isFinite(remaining)) return;
    lastRateLimit = {
      remaining,
      resetAtMs: Number.isFinite(reset) ? reset * 1000 : null,
    };
  }

  /**
   * Maps a GitHub status to the one this panel answers with (§5). The response body is never
   * read: a token, a private path or a rate-limit hint in GitHub's prose must not reach a browser.
   */
  private mapStatus(response: Response, label: string | undefined): GithubApiError {
    const status = response.status;
    const exhausted = response.headers.get("x-ratelimit-remaining") === "0";
    if (status === 429 || (status === 403 && exhausted)) {
      return new GithubApiError(429, "GitHub's rate limit is exhausted; try again shortly.", {
        code: "rate-limited",
        githubStatus: status,
      });
    }
    if (status === 401 || status === 403) {
      return new GithubApiError(502, "GitHub rejected the panel's token.", {
        githubStatus: status,
      });
    }
    if (status === 404) {
      return new GithubApiError(
        404,
        label ? `GitHub has no ${label}.` : "GitHub has no such resource.",
        { githubStatus: 404 },
      );
    }
    if (status === 409) {
      return new GithubApiError(409, "GitHub reported a conflict — reload and retry.", {
        code: "stale",
        githubStatus: 409,
      });
    }
    if (status === 422) {
      return new GithubApiError(422, "GitHub refused the request as invalid.", {
        githubStatus: 422,
      });
    }
    if (status >= 500) {
      return new GithubApiError(502, "GitHub is unavailable.", { githubStatus: status });
    }
    return new GithubApiError(502, `GitHub refused the request (${status}).`, {
      githubStatus: status,
    });
  }

  private cacheKey(path: string): string {
    // The token decides what a private repo answers, so two sources must not share an entry.
    return `${this.resolved.source ?? "anonymous"} ${this.repo} ${path}`;
  }

  /** A GET whose 404 is `null` rather than an error. */
  private async tryGet<T>(path: string, options: ReadOptions = {}): Promise<T | null> {
    try {
      return await this.get<T>(path, options);
    } catch (cause) {
      if (isGithubApiError(cause) && cause.status === 404) return null;
      throw cause;
    }
  }

  /**
   * One GET, with the ETag replay, the memoisation window, the rate-limit floor and the stale
   * fallback §5 asks for. `fresh` opts out of all four — the reads inside `commitFiles` use it,
   * because a cached HEAD is the stale parent that whole sequence exists to prevent.
   */
  private async get<T>(path: string, options: ReadOptions = {}): Promise<T> {
    const key = this.cacheKey(path);
    const cached = options.fresh ? undefined : responseCache.get(key);
    const nowMs = this.now();

    if (cached && options.memoiseMs && nowMs - cached.fetchedAtMs < options.memoiseMs) {
      return cached.payload as T;
    }
    if (!options.essential && this.rateLimitBelowFloor(nowMs)) {
      if (cached) return this.serveStale<T>(cached);
      throw new GithubApiError(
        429,
        "GitHub's rate limit is nearly exhausted; this read was skipped.",
        { code: "rate-limited" },
      );
    }

    let response: Response;
    try {
      response = await this.rawFetch(
        "GET",
        path,
        undefined,
        "application/vnd.github+json",
        cached?.etag ?? null,
      );
    } catch {
      // Unreachable, not refused: a cached copy is better than an error page.
      if (cached) return this.serveStale<T>(cached);
      throw new GithubApiError(502, "GitHub is unreachable.");
    }
    this.recordRateLimit(response);

    if (response.status === 304 && cached) {
      cached.fetchedAtMs = nowMs;
      return cached.payload as T;
    }
    if (!response.ok) {
      const mapped = this.mapStatus(response, options.label);
      // A 5xx or an exhausted limit is a bad moment, not a bad request — fall back if we can.
      if (cached && (response.status >= 500 || mapped.code === "rate-limited")) {
        return this.serveStale<T>(cached);
      }
      throw mapped;
    }

    const payload = (await response.json().catch(() => null)) as T;
    rememberResponse(key, { etag: response.headers.get("etag"), payload, fetchedAtMs: nowMs });
    return payload;
  }

  private serveStale<T>(entry: CacheEntry): T {
    this.staleRead = true;
    return entry.payload as T;
  }

  private rateLimitBelowFloor(nowMs: number): boolean {
    const remaining = currentRateLimit(nowMs).remaining;
    return remaining !== null && remaining < RATE_LIMIT_FLOOR;
  }

  /** Every mutation: token-gated, never cached, never stale. */
  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.requireWrite();
    let response: Response;
    try {
      response = await this.rawFetch(method, path, body, "application/vnd.github+json");
    } catch {
      throw new GithubApiError(502, "GitHub is unreachable.");
    }
    this.recordRateLimit(response);
    if (!response.ok) throw this.mapStatus(response, undefined);
    if (response.status === 204) return null as T;
    return ((await response.json().catch(() => null)) ?? null) as T;
  }
}

/** The one constructor handlers use. */
export function createGithubClient(
  env: RuntimeEnv,
  options: GithubClientOptions = {},
): GithubReleaseClient {
  return new GithubReleaseClient(env, options);
}
