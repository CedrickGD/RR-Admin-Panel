// Recomputes app_sessions.error_count from telemetry_events, counting real errors only.
//
// Why (WP 2.9): ingest used to add every app_error to its session's error_count, background
// faults included (error_kind = 'background' — the desktop client's RR-E1003 loop, hundreds of
// events per session). Customers "Needs attention", the Heatmap error tiles, Live/Workers error
// badges and Customer 360 all read that counter. Ingest now skips background faults; this script
// brings the counts that are already stored in line with that rule.
//
// Production — run AFTER the rr-api redeploy that ships the ingest change, from the NAS checkout
// (the runtime image does not contain deploy/, so copy the file in; better-sqlite3 is resolved
// from the working directory, /app/node_modules in the image; DB_PATH is set in the image):
//
//   docker cp deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs razorreaper-rr-api-1:/tmp/recompute-session-error-counts.mjs
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs --dry-run
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs
//
// Options: --dry-run (read-only, prints what would change), --db <path> (default $DB_PATH),
// --batch-size <n> (sessions per write transaction, default 200).
//
// Rules
// - A real error is a telemetry_events row with service = 'app_error' AND
//   COALESCE(json_extract(metrics_json, '$.error_kind'), '') <> 'background', attributed to
//   json_extract(metrics_json, '$.session_id') trimmed — the key ingest uses (readSessionId).
// - telemetry_events keeps 90 days, app_sessions keeps everything. Only sessions that started at
//   or after the retention floor (the later of the oldest retained event and now - 90 days) are
//   recomputed; for older sessions the stored count is the only record left, so it stays.
// - A session row updated after the run started (a new event arrived meanwhile) is skipped,
//   never overwritten. Re-run to pick it up. Re-running is always safe: correct rows are not
//   written, so a second run changes nothing.
// - Writes go in BEGIN IMMEDIATE transactions of --batch-size sessions, so the write lock is
//   held briefly and ingest keeps flowing between batches. The counting read runs once, up front,
//   outside any write transaction (WAL readers do not block the writer).

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Mirrors EVENT_RETENTION_DAYS in functions/_lib/storage.ts and backend-worker/index.js. */
export const RETENTION_DAYS = 90;
export const DEFAULT_BATCH_SIZE = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

const REAL_ERROR_COUNTS_SQL = `
  SELECT TRIM(CAST(json_extract(metrics_json, '$.session_id') AS TEXT)) AS session_id,
         COUNT(*) AS errors
  FROM telemetry_events
  WHERE service = 'app_error'
    AND COALESCE(json_extract(metrics_json, '$.error_kind'), '') <> 'background'
  GROUP BY 1`;

/**
 * @param {import("better-sqlite3").Database} db
 * @param {{ dryRun?: boolean, batchSize?: number, now?: Date }} [options]
 */
export function recomputeSessionErrorCounts(db, options = {}) {
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batch size must be a positive integer, got ${batchSize}`);
  }
  const now = options.now ?? new Date();
  const runStartedAt = now.toISOString();

  const oldestEventAt = db.prepare(`SELECT MIN(ts) AS ts FROM telemetry_events`).get()?.ts ?? null;
  const retentionCutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS).toISOString();
  const retentionFloor =
    oldestEventAt && oldestEventAt > retentionCutoff ? oldestEventAt : retentionCutoff;

  /** @type {Map<string, number>} */
  const realErrors = new Map();
  for (const row of db.prepare(REAL_ERROR_COUNTS_SQL).all()) {
    if (row.session_id) realErrors.set(row.session_id, Number(row.errors));
  }

  const all = db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(error_count), 0) AS errors FROM app_sessions`,
    )
    .get();

  const result = {
    dryRun,
    runStartedAt,
    retentionFloor,
    sessionsTotal: Number(all.sessions),
    sessionsRecomputed: 0,
    sessionsOutsideRetention: 0,
    sessionsChanged: 0,
    sessionsSkippedUpdatedDuringRun: 0,
    errorSumRecomputedBefore: 0,
    errorSumRecomputedAfter: 0,
    errorSumAllBefore: Number(all.errors),
    errorSumAllAfter: Number(all.errors),
  };
  result.sessionsOutsideRetention = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM app_sessions WHERE started_at < ?`).get(retentionFloor).n,
  );

  const page = db.prepare(
    `SELECT session_id, error_count, updated_at FROM app_sessions
     WHERE started_at >= ? AND session_id > ?
     ORDER BY session_id
     LIMIT ?`,
  );
  const update = db.prepare(
    `UPDATE app_sessions SET error_count = ?
     WHERE session_id = ? AND error_count = ? AND updated_at <= ?`,
  );

  /** One batch: read a page and write its corrections under the same (immediate) lock. */
  const runBatch = (afterSessionId) => {
    const rows = page.all(retentionFloor, afterSessionId, batchSize);
    for (const row of rows) {
      const before = Number(row.error_count);
      const target = realErrors.get(String(row.session_id).trim()) ?? 0;
      result.sessionsRecomputed += 1;
      result.errorSumRecomputedBefore += before;
      if (row.updated_at > runStartedAt) {
        // Touched since the run started: its count already moved on without us.
        if (before !== target) result.sessionsSkippedUpdatedDuringRun += 1;
        result.errorSumRecomputedAfter += before;
        continue;
      }
      if (before === target) {
        result.errorSumRecomputedAfter += before;
        continue;
      }
      if (!dryRun) {
        const changed = update.run(target, row.session_id, before, runStartedAt).changes;
        if (changed === 0) {
          result.sessionsSkippedUpdatedDuringRun += 1;
          result.errorSumRecomputedAfter += before;
          continue;
        }
      }
      result.sessionsChanged += 1;
      result.errorSumRecomputedAfter += target;
    }
    return rows.length > 0 ? rows[rows.length - 1].session_id : null;
  };
  const batch = dryRun ? runBatch : db.transaction(runBatch).immediate;

  let cursor = "";
  for (;;) {
    const last = batch(cursor);
    if (last === null) break;
    cursor = last;
  }

  result.errorSumAllAfter =
    result.errorSumAllBefore - result.errorSumRecomputedBefore + result.errorSumRecomputedAfter;
  return result;
}

/** The lines the CLI prints for a result. */
export function formatReport(result, dbPath) {
  const verb = result.dryRun ? "would change" : "changed";
  return [
    `recompute-session-error-counts${result.dryRun ? " (dry run, nothing written)" : ""}`,
    `  database:            ${dbPath}`,
    `  run started:         ${result.runStartedAt}`,
    `  retention floor:     ${result.retentionFloor}`,
    `  sessions:            ${result.sessionsTotal} total, ${result.sessionsRecomputed} recomputed, ${result.sessionsOutsideRetention} started before the floor (left as they are)`,
    `  sessions ${verb}: ${result.sessionsChanged}`,
    `  skipped, updated during the run: ${result.sessionsSkippedUpdatedDuringRun}`,
    `  error_count sum, recomputed sessions: ${result.errorSumRecomputedBefore} -> ${result.errorSumRecomputedAfter}`,
    `  error_count sum, all sessions:        ${result.errorSumAllBefore} -> ${result.errorSumAllAfter}`,
  ];
}

export function parseArgs(argv) {
  const args = { dryRun: false, dbPath: null, batchSize: DEFAULT_BATCH_SIZE, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--db") args.dbPath = argv[++index] ?? null;
    else if (arg === "--batch-size") args.batchSize = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/**
 * CLI entry. `openDatabase` and `now` are injectable for tests; without it better-sqlite3 is loaded from the
 * working directory and the database is opened (read-only for --dry-run) and closed here.
 */
export function main(argv, { log = console.log, env = process.env, openDatabase, now } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    log(
      "usage: node recompute-session-error-counts.mjs [--dry-run] [--db <path>] [--batch-size <n>]",
    );
    return null;
  }
  const dbPath = args.dbPath ?? env.DB_PATH ?? null;
  if (!dbPath) throw new Error("no database: pass --db <path> or set DB_PATH");

  let db;
  let ownsHandle = false;
  if (openDatabase) {
    db = openDatabase(dbPath, { readonly: args.dryRun });
  } else {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const Database = require("better-sqlite3");
    db = new Database(dbPath, { readonly: args.dryRun, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    ownsHandle = true;
  }
  try {
    const result = recomputeSessionErrorCounts(db, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      now,
    });
    for (const line of formatReport(result, dbPath)) log(line);
    return result;
  } finally {
    if (ownsHandle) db.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
