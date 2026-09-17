-- Announcement version targeting (docs/release-management-design.md §10): an announcement may
-- name the app versions it is for. Both bounds are inclusive and nullable; both null is "everyone",
-- which is what every existing row keeps meaning, so nothing is backfilled and nothing regresses
-- for the 1.4.8-and-older installs decision 5 is about.
--
-- NOTE: the Pages Functions / rr-api self-apply all of this at runtime
-- (functions/_lib/content.ts ensureAnnouncementsSchema): both columns and the marker. Running this
-- file manually is only needed for a database the app never touches, and it is safe to skip on a
-- live deployment.
--
-- Two starting points:
--   * Columns absent (a database the app never touched): run the whole file.
--   * Columns present (the app, or an earlier run of this file, added them): the first ALTER errors
--     with "duplicate column name" and `wrangler d1 execute` stops there. Skip both ALTERs — the
--     first two statements — and run the rest: every remaining statement is idempotent.

ALTER TABLE announcements ADD COLUMN min_version TEXT;

ALTER TABLE announcements ADD COLUMN max_version TEXT;

CREATE TABLE IF NOT EXISTS schema_markers (
  key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_markers (key, applied_at)
VALUES ('2026-09-18-announcement-version-range', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
