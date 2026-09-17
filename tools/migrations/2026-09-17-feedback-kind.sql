-- Feedback inbox split: every feedback row carries a kind.
--   'support'  = the client's "report a problem" flow (the report that carries the diagnostics snapshot)
--   'feedback' = ideas and opinions
--
-- NOTE: the Pages Functions / rr-api self-apply this column at runtime
-- (functions/_lib/content.ts ensureFeedbackSchema) and run the same backfill once, right after
-- the column was added. Running this file manually is only needed for a database the app never
-- touches, and it is safe to skip on a live deployment. The ALTER errors with "duplicate column
-- name" when already applied; that is harmless. The UPDATE and the CREATE INDEX are idempotent.

ALTER TABLE feedback ADD COLUMN kind TEXT NOT NULL DEFAULT 'feedback' CHECK (kind IN ('feedback', 'support'));

CREATE INDEX IF NOT EXISTS idx_feedback_kind_status ON feedback(kind, status, created_at DESC);

-- Historic reports from clients that predate the field (1.5.2 and below): the ones that came
-- with a diagnostics snapshot were "report a problem" submissions.
UPDATE feedback SET kind = 'support'
 WHERE kind = 'feedback'
   AND id IN (SELECT feedback_id FROM feedback_diagnostics);
