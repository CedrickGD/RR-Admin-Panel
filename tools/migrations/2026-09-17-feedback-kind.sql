-- Feedback inbox split: every feedback row carries a kind.
--   'support'  = the client's "report a problem" flow (the report that carries the diagnostics snapshot)
--   'feedback' = ideas and opinions
--
-- NOTE: the Pages Functions / rr-api self-apply all of this at runtime
-- (functions/_lib/content.ts ensureFeedbackSchema): the column, the index and — once, recorded in
-- schema_markers — the backfill. Running this file manually is only needed for a database the app
-- never touches, and it is safe to skip on a live deployment.
--
-- Two starting points:
--   * Column absent (a database the app never touched): run the whole file.
--   * Column present (the app, or an earlier run of this file, added it): the ALTER errors with
--     "duplicate column name" and `wrangler d1 execute` stops there. Skip the ALTER — the first
--     statement — and run the rest: every remaining statement is idempotent, and the UPDATE is a
--     no-op once the marker row exists, so the backfill never runs twice.
-- Expects 2026-09-03-support-diagnostics-license-operations.sql (feedback_diagnostics) to be applied.

ALTER TABLE feedback ADD COLUMN kind TEXT NOT NULL DEFAULT 'feedback' CHECK (kind IN ('feedback', 'support'));

CREATE INDEX IF NOT EXISTS idx_feedback_kind_status ON feedback(kind, status, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_markers (
  key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Historic reports from clients that predate the field (1.5.2 and below): the ones that came
-- with a diagnostics snapshot were "report a problem" submissions. Guarded by the marker, so a
-- second run of this file, or the app's own ensure after it, leaves the rows alone.
UPDATE feedback SET kind = 'support'
 WHERE kind = 'feedback'
   AND id IN (SELECT feedback_id FROM feedback_diagnostics)
   AND NOT EXISTS (SELECT 1 FROM schema_markers WHERE key = '2026-09-17-feedback-kind');

INSERT OR IGNORE INTO schema_markers (key, applied_at)
VALUES ('2026-09-17-feedback-kind', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
