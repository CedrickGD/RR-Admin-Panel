-- One-time production migration for the stats upgrade (2026-06-10).
-- Run BEFORE deploying the new backend-worker / Pages build (the ALTERs fail with
-- "duplicate column" once the new ensureTelemetrySchema has run, aborting the file):
--   npx wrangler d1 execute rr_admin_panel --remote --file tools/migrations/2026-06-10-stats-upgrade.sql
-- After deploying the worker, re-sync the lifetime counter once (heartbeats kept
-- incrementing the autoincrement between migration and deploy):
--   npx wrangler d1 execute rr_admin_panel --remote --command "UPDATE telemetry_counters SET counter_value = (SELECT seq FROM sqlite_sequence WHERE name='telemetry_events') WHERE counter_key='events_total'"

-- New session columns (ensureTelemetrySchema also adds these lazily; applied here so the
-- backfill below can run immediately).
ALTER TABLE app_sessions ADD COLUMN display_version TEXT;
ALTER TABLE app_sessions ADD COLUMN os_version TEXT;
ALTER TABLE app_sessions ADD COLUMN device_model TEXT;
ALTER TABLE app_sessions ADD COLUMN rpc_enabled INTEGER;
ALTER TABLE app_sessions ADD COLUMN features_json TEXT;

CREATE TABLE IF NOT EXISTS telemetry_counters (
  counter_key TEXT PRIMARY KEY,
  counter_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- NOTE: latest_status (write-only dead weight) is dropped AFTER the worker deploy —
-- the OLD worker still writes it on every event, so dropping it here would 500 all
-- ingest until the new worker is live:
--   npx wrangler d1 execute rr_admin_panel --remote --command "DROP TABLE IF EXISTS latest_status"

-- Seed the lifetime event counter from the events autoincrement (the true number of
-- events ever ingested, ~230k — the table itself was trimmed to 1000 rows for months).
-- MAX() upsert so the seed survives the new worker having already created/bumped the
-- counter, and a re-run never shrinks it.
INSERT INTO telemetry_counters (counter_key, counter_value, updated_at)
SELECT 'events_total', seq, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM sqlite_sequence WHERE name = 'telemetry_events'
ON CONFLICT(counter_key) DO UPDATE SET
  counter_value = MAX(counter_value, excluded.counter_value),
  updated_at = excluded.updated_at;

-- Backfill normalized display versions ("1.4.7.10" -> "1.4.7"; MAUI-default "1.0.0.x"
-- builds -> "legacy"). Generic rule: drop the 4th dot-segment when present.
UPDATE app_sessions
SET display_version = CASE
  WHEN app_version LIKE '1.0.0.%' OR app_version = '1.0.0' THEN 'legacy'
  WHEN app_version LIKE '%.%.%.%' THEN
    substr(app_version, 1, length(app_version) - length(substr(app_version, length(rtrim(app_version, '0123456789')) + 1)) - 1)
  ELSE app_version
END
WHERE app_version IS NOT NULL AND display_version IS NULL;
