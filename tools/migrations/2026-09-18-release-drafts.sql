-- Release management (docs/release-management-design.md §3): the two tables behind #/releases.
--   release_drafts  = one row per intended release, the source of truth for a version *before*
--                     it is published; afterwards GitHub is.
--   release_events  = that draft's timeline, shown in the drawer. draft_id NULL is a repo-wide
--                     write (a Files-tab commit). It does NOT replace panel_audit: every write
--                     also inserts a panel_audit row through auditPanel.
--
-- NOTE: the Pages Functions / rr-api self-apply all of this at runtime
-- (functions/_lib/releases-store.ts ensureReleasesSchema). Running this file manually is only
-- needed for a database the app never touches, and it is safe to run on a live deployment: every
-- statement is idempotent, so there is no "skip the first statement" step here.

CREATE TABLE IF NOT EXISTS release_drafts (
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
);

-- One draft per tag: the tag is what update.xml pins and what the GitHub release carries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_release_drafts_tag ON release_drafts(tag);

CREATE TABLE IF NOT EXISTS release_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_release_events_draft ON release_events(draft_id, id DESC);

CREATE TABLE IF NOT EXISTS schema_markers (
  key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_markers (key, applied_at)
VALUES ('2026-09-18-release-drafts', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
