import {
  normalizeFeedbackKind,
  type FeedbackKind,
  type FeedbackUnread,
} from "../../shared/feedback-contract";
import type { D1Database, RuntimeEnv } from "./types";

/**
 * Self-healing schema for the announcements + feedback features. The repo has no migration
 * framework, so — exactly like ensureAuthSchema in users.ts — every handler runs these
 * idempotent CREATE statements up front. This keeps a fresh deploy working without a manual
 * `wrangler d1 execute`; the same DDL also lives in schema.sql and tools/migrations/.
 */

export type AnnouncementLevel = "info" | "warning" | "critical";
export type FeedbackStatus = "new" | "read" | "archived";
export type { FeedbackKind, FeedbackUnread } from "../../shared/feedback-contract";
export {
  FEEDBACK_KINDS,
  defaultFeedbackKind,
  isFeedbackKind,
  normalizeFeedbackKind,
} from "../../shared/feedback-contract";

export interface AnnouncementRow {
  id: number;
  title: string;
  body: string;
  level: AnnouncementLevel;
  is_active: number;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackRow {
  id: number;
  message: string;
  contact: string | null;
  hwid: string | null;
  install_id: string | null;
  license_key: string | null;
  machine_name: string | null;
  app_version: string | null;
  platform: string | null;
  status: FeedbackStatus;
  kind: FeedbackKind;
  created_at: string;
}

const ANNOUNCEMENTS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'critical')),
    is_active INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, expires_at)`,
];

const FEEDBACK_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    contact TEXT,
    hwid TEXT,
    install_id TEXT,
    license_key TEXT,
    machine_name TEXT,
    app_version TEXT,
    platform TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
    kind TEXT NOT NULL DEFAULT 'feedback' CHECK (kind IN ('feedback', 'support')),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC)`,
  // One row per one-time data fix the app has applied (see FEEDBACK_KIND_MARKER). Also in schema.sql.
  `CREATE TABLE IF NOT EXISTS schema_markers (
    key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
];

/**
 * The kind column shipped after the feedback table. SQLite has no `ADD COLUMN IF NOT EXISTS`: on a
 * database that already has it the ALTER fails with "duplicate column name", which is the success
 * case (same pattern as ensureLicenseOrderColumns). The historic rows get sorted once: a report
 * that came with a diagnostics snapshot was the client's "report a problem" flow. Whether that
 * backfill has run is a row in schema_markers, written after it went through — not the outcome
 * of the ALTER, so a first call that added the column and then failed (index, backfill) leaves
 * the marker absent and the next call backfills. A database that got the column before the marker
 * existed is backfilled once more, which only touches rows still marked feedback despite a
 * snapshot. The same statements live in tools/migrations/2026-09-17-feedback-kind.sql for a
 * database the app never touches.
 */
const FEEDBACK_KIND_COLUMN = `ALTER TABLE feedback ADD COLUMN kind TEXT NOT NULL DEFAULT 'feedback'
  CHECK (kind IN ('feedback', 'support'))`;
const FEEDBACK_KIND_INDEX = `CREATE INDEX IF NOT EXISTS idx_feedback_kind_status
  ON feedback(kind, status, created_at DESC)`;
const FEEDBACK_KIND_MARKER = "2026-09-17-feedback-kind";
const FEEDBACK_KIND_BACKFILL = `UPDATE feedback SET kind = 'support'
  WHERE kind = 'feedback' AND id IN (SELECT feedback_id FROM feedback_diagnostics)`;

// Per database, not per module: one process can talk to more than one DB (the tests open a fresh
// in-memory database per case), and a module-wide flag would skip the DDL for every DB after the first.
const feedbackSchemaReady = new WeakMap<object, Promise<void>>();

function isDuplicateColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return message.includes("duplicate column name") || message.includes("already exists");
}

async function prepareFeedbackSchema(db: D1Database): Promise<void> {
  for (const query of FEEDBACK_SCHEMA_STATEMENTS) {
    await db.prepare(query).run();
  }
  try {
    await db.prepare(FEEDBACK_KIND_COLUMN).run();
  } catch (err) {
    if (!isDuplicateColumn(err)) throw err;
  }
  await db.prepare(FEEDBACK_KIND_INDEX).run();
  if (await hasSchemaMarker(db, FEEDBACK_KIND_MARKER)) return;
  if (await hasFeedbackDiagnosticsTable(db)) {
    await db.prepare(FEEDBACK_KIND_BACKFILL).run();
  }
  await db
    .prepare(`INSERT OR IGNORE INTO schema_markers (key, applied_at) VALUES (?, ?)`)
    .bind(FEEDBACK_KIND_MARKER, new Date().toISOString())
    .run();
}

async function hasSchemaMarker(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare(`SELECT key FROM schema_markers WHERE key = ?`).bind(key).first();
  return row !== null;
}

/**
 * A database that only ever saw legacy clients has no feedback_diagnostics table, and then there
 * is nothing to backfill: without the probe the subquery would fail instead of matching nothing.
 */
async function hasFeedbackDiagnosticsTable(db: D1Database): Promise<boolean> {
  try {
    await db.prepare(`SELECT feedback_id FROM feedback_diagnostics LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

export async function ensureAnnouncementsSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);
  for (const query of ANNOUNCEMENTS_SCHEMA_STATEMENTS) {
    await db.prepare(query).run();
  }
}

export async function ensureFeedbackSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);
  let ready = feedbackSchemaReady.get(db);
  if (!ready) {
    ready = prepareFeedbackSchema(db);
    feedbackSchemaReady.set(db, ready);
    ready.catch(() => feedbackSchemaReady.delete(db));
  }
  await ready;
}

/** Unread counts per inbox. Runs after ensureFeedbackSchema; independent of any list filter. */
export async function loadFeedbackUnread(db: D1Database): Promise<FeedbackUnread> {
  const { results } = await db
    .prepare(`SELECT kind, COUNT(*) AS count FROM feedback WHERE status = 'new' GROUP BY kind`)
    .all<{ kind: string; count: number }>();
  const unread: FeedbackUnread = { feedback: 0, support: 0, total: 0 };
  for (const row of results) {
    const count = Number(row.count) || 0;
    unread[normalizeFeedbackKind(row.kind)] += count;
    unread.total += count;
  }
  return unread;
}

/** Normalizes a client-supplied datetime string to ISO-8601, or null if empty/invalid. */
export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function requireDb(env: RuntimeEnv): D1Database {
  if (!env.DB) {
    throw new Error("D1 binding DB is required.");
  }
  return env.DB;
}
