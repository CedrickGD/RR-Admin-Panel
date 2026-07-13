-- Announcements + Feedback feature tables.
-- Apply to the remote D1 database with:
--   npx wrangler d1 execute rr_admin_panel --remote --file=tools/migrations/2026-07-13-announcements-feedback.sql
-- Idempotent (CREATE ... IF NOT EXISTS); safe to re-run. The API handlers also self-heal this
-- schema at request time via functions/_lib/content.ts, so applying this is optional but keeps
-- the canonical DB definition in one place.

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'critical')),
  is_active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, expires_at);

CREATE TABLE IF NOT EXISTS feedback (
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
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);
