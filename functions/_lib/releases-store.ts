/**
 * Storage for the release-management feature: `release_drafts` (one row per intended release)
 * and `release_events` (a draft's timeline). Design: docs/release-management-design.md §3.
 *
 * The repo has no migration framework, so — exactly like `ensureFeedbackSchema`
 * (functions/_lib/content.ts) — every handler runs the idempotent DDL up front and the same
 * statements live in tools/migrations/2026-09-18-release-drafts.sql for a database the app never
 * touches. A draft is the source of truth for a version *before* publish; afterwards GitHub is.
 *
 * `release_events` does **not** replace `auditPanel`: every write also inserts a `panel_audit`
 * row. Nothing here talks to GitHub, and no helper ever stores a token or a customer identifier.
 */
import { nowIso } from "./http";
import type { D1Database, RuntimeEnv } from "./types";
import {
  draftFromRow,
  isReleaseDraftStatus,
  tagForVersion,
  versionForTag,
  type ReleaseDraft,
  type ReleaseDraftInput,
  type ReleaseDraftPatch,
  type ReleaseDraftRow,
  type ReleaseDraftStatus,
  type ReleaseEvent,
  type ReleaseEventKind,
} from "../../shared/releases-contract";

/** Recorded in `schema_markers` once the two tables are in place, the feedback.kind idiom. */
export const RELEASES_SCHEMA_MARKER = "2026-09-18-release-drafts";

export const RELEASES_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS release_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    tag TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    notes_customer TEXT NOT NULL DEFAULT '',
    notes_full_md TEXT NOT NULL DEFAULT '',
    commit_message TEXT NOT NULL DEFAULT '',
    mandatory INTEGER NOT NULL DEFAULT 0,
    prerelease INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft','building','built','published','failed')),
    github_release_id INTEGER,
    github_run_id INTEGER,
    asset_name TEXT,
    asset_size INTEGER,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT
  )`,
  // One draft per tag: the tag is what update.xml pins and what the GitHub release carries, so a
  // second row for it would make "the draft for v1.5.4" ambiguous at publish time.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_release_drafts_tag ON release_drafts(tag)`,
  // draft_id null = a repo-wide write, e.g. a Files-tab commit that belongs to no release.
  `CREATE TABLE IF NOT EXISTS release_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id INTEGER,
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_release_events_draft ON release_events(draft_id, id DESC)`,
  // One row per one-time schema step the app has applied. Also in schema.sql.
  `CREATE TABLE IF NOT EXISTS schema_markers (
    key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
];

// Per database, not per module: one process can talk to more than one DB (the tests open a fresh
// in-memory database per case), and a module-wide flag would skip the DDL for every DB after the
// first.
const releasesSchemaReady = new WeakMap<object, Promise<void>>();

function requireDb(env: RuntimeEnv): D1Database {
  if (!env.DB) {
    throw new Error("D1 binding DB is required.");
  }
  return env.DB;
}

async function prepareReleasesSchema(db: D1Database): Promise<void> {
  for (const query of RELEASES_SCHEMA_STATEMENTS) {
    await db.prepare(query).run();
  }
  // Written last, so a call that created the tables and then failed leaves the marker absent and
  // the next one runs the (idempotent) DDL again.
  await db
    .prepare(`INSERT OR IGNORE INTO schema_markers (key, applied_at) VALUES (?, ?)`)
    .bind(RELEASES_SCHEMA_MARKER, nowIso())
    .run();
}

/** Runs at the top of every releases handler. Idempotent, and cached per D1 binding. */
export async function ensureReleasesSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);
  let ready = releasesSchemaReady.get(db);
  if (!ready) {
    ready = prepareReleasesSchema(db);
    releasesSchemaReady.set(db, ready);
    ready.catch(() => releasesSchemaReady.delete(db));
  }
  await ready;
}

/* ─────────────────────────────────── Drafts ─────────────────────────────────── */

const DRAFT_COLUMNS = `id, version, tag, title, notes_customer, notes_full_md, commit_message,
  mandatory, prerelease, status, github_release_id, github_run_id, asset_name, asset_size,
  created_by, created_at, updated_at, published_at`;

/** Statuses a draft may still be deleted in: nothing has been published under its tag yet. */
export const DELETABLE_DRAFT_STATUSES: readonly ReleaseDraftStatus[] = ["draft", "failed"];

/**
 * A draft update carries the editor's fields (`ReleaseDraftPatch`) and, for the build and publish
 * handlers, the server-owned ones. Every key is optional; only the keys present are written.
 */
export interface ReleaseDraftUpdate extends ReleaseDraftPatch {
  status?: ReleaseDraftStatus;
  githubReleaseId?: number | null;
  githubRunId?: number | null;
  assetName?: string | null;
  assetSize?: number | null;
  publishedAt?: string | null;
}

export interface UpdateDraftOptions {
  /**
   * Publish's last step writes `status = 'published'` to the row it is publishing; the editor
   * never may, which is what the `PUT` route's "refused once published" means.
   */
  allowPublished?: boolean;
}

export type CreateDraftResult =
  | { ok: true; draft: ReleaseDraft }
  | { ok: false; reason: "duplicate" };

export type UpdateDraftResult =
  | { ok: true; draft: ReleaseDraft }
  | { ok: false; reason: "not-found" }
  /** The row moved under the editor, or the tag is already another draft's — both reload. */
  | { ok: false; reason: "stale" | "published" | "duplicate"; draft: ReleaseDraft };

export type DeleteDraftResult =
  | { ok: true; draft: ReleaseDraft }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "not-deletable"; draft: ReleaseDraft };

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return message.includes("unique constraint") || message.includes("constraint failed");
}

/**
 * `updated_at` is the lost-update handle, so it has to move on every write: two updates inside the
 * same millisecond would otherwise share a timestamp and the second editor's `expectedUpdatedAt`
 * would still match a row it never saw.
 */
function nextUpdatedAt(previous: string, now: string): string {
  if (now > previous) return now;
  const parsed = Date.parse(previous);
  return Number.isFinite(parsed) ? new Date(parsed + 1).toISOString() : now;
}

export async function listDrafts(db: D1Database): Promise<ReleaseDraft[]> {
  const { results } = await db
    .prepare(`SELECT ${DRAFT_COLUMNS} FROM release_drafts ORDER BY id DESC`)
    .all<ReleaseDraftRow>();
  return results.map(draftFromRow);
}

export async function getDraft(db: D1Database, id: number): Promise<ReleaseDraft | null> {
  const row = await db
    .prepare(`SELECT ${DRAFT_COLUMNS} FROM release_drafts WHERE id = ?`)
    .bind(id)
    .first<ReleaseDraftRow>();
  return row ? draftFromRow(row) : null;
}

export async function getDraftByTag(db: D1Database, tag: string): Promise<ReleaseDraft | null> {
  const row = await db
    .prepare(`SELECT ${DRAFT_COLUMNS} FROM release_drafts WHERE tag = ?`)
    .bind(tagForVersion(tag))
    .first<ReleaseDraftRow>();
  return row ? draftFromRow(row) : null;
}

/**
 * Creates a draft with the design's defaults: `tag` = `v{version}`, `title` =
 * `RazorReaper {version}`, `commitMessage` = `release: {version}`. The caller validates that the
 * version is newer than the latest published one — the store only refuses a tag already taken.
 */
export async function createDraft(
  db: D1Database,
  input: ReleaseDraftInput,
  createdBy: string,
  now: string = nowIso(),
): Promise<CreateDraftResult> {
  const version = versionForTag(input.version);
  const tag = tagForVersion(input.tag?.trim() || version);
  const existing = await getDraftByTag(db, tag);
  if (existing) return { ok: false, reason: "duplicate" };
  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO release_drafts (version, tag, title, notes_customer, notes_full_md,
          commit_message, mandatory, prerelease, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        version,
        tag,
        input.title?.trim() || `RazorReaper ${version}`,
        input.notesCustomer ?? "",
        input.notesFullMd ?? "",
        input.commitMessage?.trim() || `release: ${version}`,
        input.mandatory ? 1 : 0,
        input.prerelease ? 1 : 0,
        createdBy,
        now,
        now,
      )
      .run();
  } catch (err) {
    // The unique index is the real guard: two creates can pass the SELECT above at once.
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate" };
    throw err;
  }
  const id = Number(result?.meta?.last_row_id);
  const draft = Number.isSafeInteger(id) && id > 0 ? await getDraft(db, id) : null;
  if (!draft) throw new Error("The release draft was inserted but could not be read back.");
  return { ok: true, draft };
}

/** Wire field → column, in the order the UPDATE writes them. */
const UPDATE_COLUMNS: Array<[keyof ReleaseDraftUpdate, string]> = [
  ["version", "version"],
  ["tag", "tag"],
  ["title", "title"],
  ["notesCustomer", "notes_customer"],
  ["notesFullMd", "notes_full_md"],
  ["commitMessage", "commit_message"],
  ["mandatory", "mandatory"],
  ["prerelease", "prerelease"],
  ["status", "status"],
  ["githubReleaseId", "github_release_id"],
  ["githubRunId", "github_run_id"],
  ["assetName", "asset_name"],
  ["assetSize", "asset_size"],
  ["publishedAt", "published_at"],
];

function updateValue(field: keyof ReleaseDraftUpdate, value: unknown): unknown {
  if (field === "version") return versionForTag(String(value));
  if (field === "tag") return tagForVersion(String(value));
  if (field === "mandatory" || field === "prerelease") return value ? 1 : 0;
  return value ?? null;
}

/**
 * Partial update behind the `expectedUpdatedAt` lost-update guard. A mismatch is `"stale"`, a
 * published row is `"published"` unless the caller is publish itself, and a tag another draft
 * already holds is `"duplicate"` — each conflict returns the row as it stands so the editor can
 * reload rather than guess.
 */
export async function updateDraft(
  db: D1Database,
  id: number,
  patch: ReleaseDraftUpdate,
  options: UpdateDraftOptions = {},
  now: string = nowIso(),
): Promise<UpdateDraftResult> {
  const current = await getDraft(db, id);
  if (!current) return { ok: false, reason: "not-found" };
  if (patch.expectedUpdatedAt && patch.expectedUpdatedAt !== current.updatedAt)
    return { ok: false, reason: "stale", draft: current };
  if (current.status === "published" && !options.allowPublished)
    return { ok: false, reason: "published", draft: current };
  if (patch.status !== undefined && !isReleaseDraftStatus(patch.status))
    throw new Error(`Unknown release draft status: ${String(patch.status)}`);

  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of UPDATE_COLUMNS) {
    if (patch[field] === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(updateValue(field, patch[field]));
  }
  const updatedAt = nextUpdatedAt(current.updatedAt, now);
  assignments.push("updated_at = ?");
  values.push(updatedAt);

  try {
    await db
      .prepare(
        // The WHERE repeats the guard: between the read above and this write another request
        // could have saved, and then this update must lose rather than overwrite it.
        `UPDATE release_drafts SET ${assignments.join(", ")} WHERE id = ? AND updated_at = ?`,
      )
      .bind(...values, id, current.updatedAt)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate", draft: current };
    throw err;
  }
  const draft = await getDraft(db, id);
  if (!draft) return { ok: false, reason: "not-found" };
  if (draft.updatedAt !== updatedAt) return { ok: false, reason: "stale", draft };
  return { ok: true, draft };
}

/**
 * Drops a draft row while it is still `draft` or `failed`. It never touches GitHub, and it leaves
 * the draft's `release_events` in place: the timeline is an audit trail, and the handler records a
 * `draft_deleted` row on top of it.
 */
export async function deleteDraft(db: D1Database, id: number): Promise<DeleteDraftResult> {
  const draft = await getDraft(db, id);
  if (!draft) return { ok: false, reason: "not-found" };
  if (!DELETABLE_DRAFT_STATUSES.includes(draft.status))
    return { ok: false, reason: "not-deletable", draft };
  await db.prepare(`DELETE FROM release_drafts WHERE id = ?`).bind(id).run();
  return { ok: true, draft };
}

/* ─────────────────────────────── Draft audit trail ─────────────────────────────── */

export interface ReleaseEventInput {
  /** Null (or omitted) for a repo-wide write such as a Files-tab commit. */
  draftId?: number | null;
  kind: ReleaseEventKind;
  /** Panel e-mail. */
  actor: string;
  /** One short line. Never a token, never a customer identifier. */
  detail?: string;
}

export interface ListEventsOptions {
  /** A draft's own timeline. `null` selects the repo-wide rows; omit the key for both. */
  draftId?: number | null;
  limit?: number;
}

const EVENT_COLUMNS = "id, draft_id, kind, actor, detail, created_at";
const DEFAULT_EVENT_LIMIT = 100;

interface ReleaseEventRow {
  id: number;
  draft_id: number | null;
  kind: string;
  actor: string;
  detail: string;
  created_at: string;
}

function eventFromRow(row: ReleaseEventRow): ReleaseEvent {
  return {
    id: row.id,
    draftId: row.draft_id,
    kind: row.kind as ReleaseEventKind,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export async function appendEvent(
  db: D1Database,
  input: ReleaseEventInput,
  now: string = nowIso(),
): Promise<ReleaseEvent> {
  const draftId = input.draftId ?? null;
  const detail = input.detail ?? "";
  const result = await db
    .prepare(
      `INSERT INTO release_events (draft_id, kind, actor, detail, created_at) VALUES (?,?,?,?,?)`,
    )
    .bind(draftId, input.kind, input.actor, detail, now)
    .run();
  return {
    id: Number(result?.meta?.last_row_id ?? 0),
    draftId,
    kind: input.kind,
    actor: input.actor,
    detail,
    createdAt: now,
  };
}

/** Newest first, the order `ReleaseEventsResponse` and the drawer both want. */
export async function listEvents(
  db: D1Database,
  options: ListEventsOptions = {},
): Promise<ReleaseEvent[]> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_EVENT_LIMIT, 500));
  const scope =
    options.draftId === undefined
      ? { where: "", values: [] as unknown[] }
      : options.draftId === null
        ? { where: "WHERE draft_id IS NULL", values: [] }
        : { where: "WHERE draft_id = ?", values: [options.draftId] };
  const { results } = await db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM release_events ${scope.where} ORDER BY id DESC LIMIT ?`)
    .bind(...scope.values, limit)
    .all<ReleaseEventRow>();
  return results.map(eventFromRow);
}
