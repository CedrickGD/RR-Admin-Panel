import type { D1Database, RuntimeEnv } from "./types";

/**
 * Self-healing schema for the announcements + feedback features. The repo has no migration
 * framework, so — exactly like ensureAuthSchema in users.ts — every handler runs these
 * idempotent CREATE statements up front. This keeps a fresh deploy working without a manual
 * `wrangler d1 execute`; the same DDL also lives in schema.sql and tools/migrations/.
 */

export type AnnouncementLevel = "info" | "warning" | "critical";
export type FeedbackStatus = "new" | "read" | "archived";

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
  `CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, expires_at)`
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
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC)`
];

export async function ensureAnnouncementsSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);
  for (const query of ANNOUNCEMENTS_SCHEMA_STATEMENTS) {
    await db.prepare(query).run();
  }
}

export async function ensureFeedbackSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);
  for (const query of FEEDBACK_SCHEMA_STATEMENTS) {
    await db.prepare(query).run();
  }
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
