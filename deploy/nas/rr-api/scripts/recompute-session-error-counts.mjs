// Repairs the session counters that the WP 2.9 ingest fix left behind: app_sessions.error_count,
// and — flag-guarded — app_sessions.last_status / last_event.
//
// Why (WP 2.9): ingest used to add every app_error to its session's error_count and to let it set
// the session's last_event/last_status, background faults included (error_kind = 'background' —
// the desktop client's RR-E1003 loop, hundreds of events per session). Customers "Needs
// attention", the Heatmap error tiles, Live/Workers error badges and Customer 360 all read those
// columns. Ingest now ignores background faults; this script brings the stored rows in line.
//
// THE ONE RULE: IT ONLY TOUCHES A ROW WHOSE HISTORY IT CAN PROVE IS STILL RETAINED
//
//   telemetry_events keeps 90 days (EVENT_RETENTION_DAYS); app_sessions keeps everything. So for
//   most rows the events that produced the stored count are simply gone, and the count is the
//   only surviving record of them. Recomputing such a row does not correct it — it erases it.
//
//   The proof this script accepts is the session's OWN session_start event, still in
//   telemetry_events. Pruning is strictly by age, so an event that survived proves every event of
//   that session at or after its timestamp survived too; a session's events all follow its start;
//   therefore a retained session_start proves the session's whole history is retained and the
//   recomputed count is the complete count. Nothing weaker is accepted:
//
//     - "started_at is inside the retention window" is NOT a proof. Ingest rewrites started_at
//       forward on every session_start (functions/_lib/storage.ts, SESSION_START branch), so a
//       row whose older real errors were pruned can still look young.
//     - "no retained event is older than started_at" is NOT a proof. Pruned events are not in the
//       table to be older than anything; absence of evidence is not evidence of absence.
//     - "every retained app_error in the whole deployment is a background fault" is NOT a proof
//       about a row whose own history was pruned. It is a statement about the surviving window.
//
//   A previous revision of this script accepted all three. It could therefore zero a session
//   whose started_at had been moved forward, whose older real errors had been pruned, and whose
//   surviving events are all background noise — a session that really did record crashes. That
//   regression is what the strict rule exists to prevent, and it is pinned by tests.
//
// WHAT IT CHANGES
//   1. error_count, from retained evidence, for sessions with a retained session_start of their
//      own. Always part of the run.
//   2. last_status + last_event, for ENDED sessions whose stored state came from a background
//      fault, repaired from that session's newest retained NON-background event. Only with
//      --repair-status. This carries its own, separate proof (see settleStatus): it needs the
//      session's newest events, not its whole history, so it does not require a retained
//      session_start — but it still refuses everything it cannot read off retained rows.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   - It writes nothing without --apply. The default is a read-only dry run.
//   - It has NO premise-based, deployment-wide or version-wide path, and no flag that enables
//     one. Those paths were removed rather than defaulted off: a script an operator runs against
//     production should not carry a switch that rewrites rows on an argument about other rows.
//     Rows whose history is gone are reported as unknown history and left exactly as they are —
//     for good, not until someone passes a flag.
//   - It never touches telemetry_events, never prunes app_sessions, never creates rows.
//   - It never bumps updated_at: these columns are derived from events, and moving the row's
//     ingest clock forward would make a later event look older than the row. It also keeps
//     re-runs idempotent — a row that is already right is never written.
//   - It never touches a session that is still active (its last_status can still change on its
//     own), nor a row updated after the run started (a new event arrived meanwhile) — re-run.
//   - It repairs nothing outside app_sessions: there is no other stored error rollup, stats.ts
//     aggregates these columns live.
//
// IF A RUN ALREADY LOWERED COUNTS UNDER THE OLD, WEAKER RULE: do not re-run this script to undo
// it — it cannot, the evidence is gone. Use restore-session-error-counts.mjs with the pre-run
// backup; it puts back exactly the rows this script's proof does not cover.
//
// Production — run AFTER the rr-api redeploy that ships the ingest change, from the NAS checkout
// (the runtime image does not contain deploy/, so copy the file in; better-sqlite3 is resolved
// from the working directory, /app/node_modules in the image; DB_PATH is set in the image):
//
//   docker cp deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs razorreaper-rr-api-1:/tmp/recompute-session-error-counts.mjs
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs --repair-status
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs --repair-status --apply
//
// Options: --apply (write; without it nothing is written), --repair-status,
// --db <path> (default $DB_PATH), --batch-size <n> (sessions per write transaction, default 200),
// --dry-run (accepted, and the default anyway).
//
// Writes go in BEGIN IMMEDIATE transactions of --batch-size sessions, so the write lock is held
// briefly and ingest keeps flowing between batches. The reads that classify the database run once,
// up front, outside any write transaction (WAL readers do not block the writer).

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Mirrors EVENT_RETENTION_DAYS in functions/_lib/storage.ts and backend-worker/index.js. */
export const RETENTION_DAYS = 90;
export const DEFAULT_BATCH_SIZE = 200;
/** Legacy pseudo-session ids: one row for the whole life of an install, so its history spans it. */
export const LEGACY_SESSION_ID_PREFIX = "install:";
/** The event ingest writes when a session starts (functions/_lib/storage.ts, SESSION_START). */
export const SESSION_START_SERVICE = "session_start";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The session key ingest uses (readSessionId): metrics.session_id, trimmed. */
const sessionIdExpr = (prefix = "") =>
  `TRIM(CAST(json_extract(${prefix}metrics_json, '$.session_id') AS TEXT))`;
/** The background fault predicate ingest uses (isBackgroundError). */
const backgroundExpr = (prefix = "") =>
  `COALESCE(json_extract(${prefix}metrics_json, '$.error_kind'), '') = 'background'`;

/**
 * One pass over telemetry_events per session id: when its retained history begins, whether that
 * beginning is its own session_start, and how many real (non-background) errors are retained.
 */
const EVIDENCE_SQL = `
  SELECT ${sessionIdExpr()} AS session_id,
         MIN(ts) AS first_ts,
         MIN(CASE WHEN service = '${SESSION_START_SERVICE}' THEN ts END) AS first_start_ts,
         COALESCE(SUM(CASE WHEN service = 'app_error' AND NOT (${backgroundExpr()}) THEN 1 ELSE 0 END), 0)
           AS real_errors
  FROM telemetry_events
  WHERE ${sessionIdExpr()} IS NOT NULL AND ${sessionIdExpr()} <> ''
  GROUP BY 1`;

/**
 * Per session: its newest retained event, and its newest retained non-background event. Pruning
 * drops the OLDEST rows, so a session with any retained event still has its newest one, and any
 * event newer than the newest retained non-background one is itself retained. That is what makes
 * the status repair a proof and not a guess — and why it needs no retained session_start.
 */
const STATUS_EVIDENCE_SQL = `
  WITH events AS (
    SELECT ${sessionIdExpr("e.")} AS session_id, e.id AS id, e.ts AS ts,
           e.service AS service, e.status AS status,
           CASE WHEN e.service = 'app_error' AND ${backgroundExpr("e.")} THEN 1 ELSE 0 END AS background
    FROM telemetry_events e
    WHERE ${sessionIdExpr("e.")} IS NOT NULL AND ${sessionIdExpr("e.")} <> ''
  ),
  ranked AS (
    SELECT session_id, ts, service, status, background,
           ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts DESC, id DESC) AS newest_rank,
           ROW_NUMBER() OVER (PARTITION BY session_id, background ORDER BY ts DESC, id DESC)
             AS newest_of_kind_rank
    FROM events
  )
  SELECT session_id, ts, service, status, background, newest_rank
  FROM ranked
  WHERE newest_rank = 1 OR (background = 0 AND newest_of_kind_rank = 1)`;

const tally = (bucket, reason, errors) => {
  const entry = bucket[reason] ?? { sessions: 0, errors: 0 };
  entry.sessions += 1;
  entry.errors += errors;
  bucket[reason] = entry;
};

/**
 * Everything both scripts need to know about what telemetry_events still holds. Built once, read
 * many times; restore-session-error-counts.mjs imports this so the two scripts cannot drift into
 * disagreeing about what "proven" means.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{ now?: Date, statusEvidence?: boolean }} [options]
 */
export function buildEvidenceIndex(db, options = {}) {
  const now = options.now ?? new Date();
  const oldestEventAt = db.prepare(`SELECT MIN(ts) AS ts FROM telemetry_events`).get()?.ts ?? null;
  const retentionCutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS).toISOString();
  const retentionFloor =
    oldestEventAt && oldestEventAt > retentionCutoff ? oldestEventAt : retentionCutoff;

  /** session_id -> retained real (non-background) errors. @type {Map<string, number>} */
  const realErrors = new Map();
  /** session ids whose whole history is provably retained. @type {Set<string>} */
  const covered = new Set();
  /** session ids with retained events whose oldest retained event is not a session_start. */
  const startedBeforeRetainedHistory = new Set();
  /** session ids with any retained event at all. @type {Set<string>} */
  const seen = new Set();

  for (const row of db.prepare(EVIDENCE_SQL).all()) {
    const sessionId = String(row.session_id ?? "");
    if (!sessionId) continue;
    seen.add(sessionId);
    realErrors.set(sessionId, Number(row.real_errors ?? 0));
    const firstStartAt = row.first_start_ts == null ? null : String(row.first_start_ts);
    const firstEventAt = String(row.first_ts);
    if (sessionId.startsWith(LEGACY_SESSION_ID_PREFIX)) continue;
    if (firstStartAt === null) continue;
    if (firstStartAt > firstEventAt) {
      // Retained events predate this session's oldest retained session_start: the row was already
      // running before that start, so an earlier start — and its errors — may have been pruned.
      startedBeforeRetainedHistory.add(sessionId);
      continue;
    }
    covered.add(sessionId);
  }

  /** session_id -> newest retained event / newest retained non-background event. */
  const newestEvent = new Map();
  const newestNonBackgroundEvent = new Map();
  if (options.statusEvidence) {
    for (const row of db.prepare(STATUS_EVIDENCE_SQL).all()) {
      const sessionId = String(row.session_id);
      const event = {
        service: String(row.service),
        status: String(row.status),
        background: Number(row.background) === 1,
      };
      if (Number(row.newest_rank) === 1) newestEvent.set(sessionId, event);
      if (!event.background) newestNonBackgroundEvent.set(sessionId, event);
    }
  }

  return {
    now,
    oldestRetainedEventAt: oldestEventAt,
    retentionFloor,
    realErrors,
    covered,
    seen,
    startedBeforeRetainedHistory,
    newestEvent,
    newestNonBackgroundEvent,
    hasStatusEvidence: options.statusEvidence === true,
  };
}

/**
 * Why this session's history is NOT provably retained — null when it is. The caller must treat a
 * non-null answer as "do not touch the stored count", never as "probably fine".
 */
export function coverageGap(index, sessionId) {
  const id = String(sessionId);
  if (index.covered.has(id)) return null;
  if (id.startsWith(LEGACY_SESSION_ID_PREFIX)) return "legacy-install-id";
  if (!index.seen.has(id)) return "no-retained-events";
  if (index.startedBeforeRetainedHistory.has(id)) return "events-precede-the-retained-start";
  return "no-retained-session-start";
}

/** The error_count a covered session's retained evidence accounts for. */
export function countTargetFor(index, sessionId) {
  return index.realErrors.get(String(sessionId).trim()) ?? 0;
}

/**
 * The (last_status, last_event) the retained events prove for a session whose stored state came
 * from a background fault — or the reason no retained row proves anything.
 *
 * @returns {{ ok: true, lastStatus: string, lastEvent: string }
 *           | { ok: false, reason: string }}
 */
export function statusRepairFor(index, sessionId) {
  const id = String(sessionId);
  const newest = index.newestEvent.get(id);
  if (!newest) return { ok: false, reason: "no-retained-events" };
  if (!newest.background) {
    // The stored state matches a retained event that is not a background fault: it is real.
    return { ok: false, reason: "newest-retained-event-is-not-a-background-fault" };
  }
  const previous = index.newestNonBackgroundEvent.get(id);
  if (!previous) {
    // Only background noise survives. What the session's state was before it is unknown history.
    return { ok: false, reason: "no-retained-non-background-event" };
  }
  return { ok: true, lastStatus: previous.status, lastEvent: previous.service };
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {{ apply?: boolean, repairStatus?: boolean, batchSize?: number, now?: Date }} [options]
 */
export function recomputeSessionErrorCounts(db, options = {}) {
  const apply = options.apply ?? false;
  const repairStatus = options.repairStatus ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batch size must be a positive integer, got ${batchSize}`);
  }
  const now = options.now ?? new Date();
  const runStartedAt = now.toISOString();

  const index = buildEvidenceIndex(db, { now, statusEvidence: repairStatus });

  const all = db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(error_count), 0) AS errors FROM app_sessions`,
    )
    .get();

  const result = {
    dryRun: !apply,
    repairStatus,
    runStartedAt,
    retentionFloor: index.retentionFloor,
    oldestRetainedEventAt: index.oldestRetainedEventAt,
    sessionsTotal: Number(all.sessions),
    sessionsScanned: 0,
    /** Sessions whose whole history is provably still in telemetry_events. */
    sessionsProven: 0,
    /** Sessions whose history is (partly) gone: nothing here may write to them. */
    sessionsUnknownHistory: 0,
    counts: {
      changed: 0,
      /** @type {Record<string, { sessions: number, errors: number }>} reason -> left untouched */
      refused: {},
      sumBefore: Number(all.errors),
      sumAfter: Number(all.errors),
      /** error_count standing on rows left untouched because their history is unknown. */
      errorsOnUnknownHistory: 0,
      /** How many of those rows carry a non-zero count — the ones a weaker rule would erase. */
      sessionsWithErrorsOnUnknownHistory: 0,
    },
    status: {
      candidates: 0,
      changed: 0,
      /** @type {Record<string, { sessions: number, errors: number }>} */
      refused: {},
    },
  };

  const page = db.prepare(
    `SELECT session_id, started_at, error_count, last_event, last_status,
            is_active, ended_at, updated_at
     FROM app_sessions
     WHERE session_id > ?
     ORDER BY session_id
     LIMIT ?`,
  );
  const updateCount = db.prepare(
    `UPDATE app_sessions SET error_count = ?
     WHERE session_id = ? AND error_count = ? AND updated_at <= ?`,
  );
  const updateStatus = db.prepare(
    `UPDATE app_sessions SET last_status = ?, last_event = ?
     WHERE session_id = ? AND last_status = ? AND last_event = ? AND updated_at <= ?`,
  );

  const settleCount = (row, gap) => {
    const sessionId = String(row.session_id);
    const before = Number(row.error_count);
    const refuse = (reason) => tally(result.counts.refused, reason, before);

    if (gap) {
      // Unknown history. The stored count may be the only surviving record of real errors, so it
      // stays — there is no flag, and no premise, that makes this row writable.
      result.counts.errorsOnUnknownHistory += before;
      if (before > 0) result.counts.sessionsWithErrorsOnUnknownHistory += 1;
      refuse(gap);
      return;
    }

    const target = countTargetFor(index, sessionId);
    if (before === target) return;
    if (String(row.updated_at) > runStartedAt) {
      // Touched since the run started: its count already moved on without us.
      refuse("updated-during-the-run");
      return;
    }
    if (apply) {
      const changed = updateCount.run(target, row.session_id, before, runStartedAt).changes;
      if (changed === 0) {
        refuse("updated-during-the-run");
        return;
      }
    }
    result.counts.changed += 1;
    result.counts.sumAfter += target - before;
  };

  const settleStatus = (row) => {
    if (String(row.last_event) !== "app_error" || String(row.last_status) === "ok") return;
    result.status.candidates += 1;

    // The stored error_count is the count repair's subject, not this one's: keep it out of here.
    const refuse = (reason) => tally(result.status.refused, reason, 0);
    if (!repairStatus) {
      refuse("repair-status-not-enabled");
      return;
    }
    if (Number(row.is_active) === 1) {
      // Still live: the next event sets last_status itself, and ingest no longer lets a
      // background fault write it.
      refuse("session-still-active");
      return;
    }
    if (String(row.updated_at) > runStartedAt) {
      refuse("updated-during-the-run");
      return;
    }

    const repair = statusRepairFor(index, String(row.session_id));
    if (!repair.ok) {
      refuse(repair.reason);
      return;
    }
    if (
      repair.lastStatus === String(row.last_status) &&
      repair.lastEvent === String(row.last_event)
    ) {
      return;
    }

    if (apply) {
      const changed = updateStatus.run(
        repair.lastStatus,
        repair.lastEvent,
        row.session_id,
        row.last_status,
        row.last_event,
        runStartedAt,
      ).changes;
      if (changed === 0) {
        refuse("updated-during-the-run");
        return;
      }
    }
    result.status.changed += 1;
  };

  /** One batch: read a page and write its corrections under the same (immediate) lock. */
  const runBatch = (afterSessionId) => {
    const rows = page.all(afterSessionId, batchSize);
    for (const row of rows) {
      result.sessionsScanned += 1;
      const gap = coverageGap(index, String(row.session_id));
      if (gap) result.sessionsUnknownHistory += 1;
      else result.sessionsProven += 1;
      settleCount(row, gap);
      settleStatus(row);
    }
    return rows.length > 0 ? rows[rows.length - 1].session_id : null;
  };
  const batch = apply ? db.transaction(runBatch).immediate : runBatch;

  let cursor = "";
  for (;;) {
    const last = batch(cursor);
    if (last === null) break;
    cursor = last;
  }
  return result;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const breakdown = (refused, withErrors, indent = "      ") =>
  Object.keys(refused)
    .sort()
    .map(
      (reason) =>
        `${indent}${reason}: ${plural(refused[reason].sessions, "session")}` +
        (withErrors ? `, ${refused[reason].errors} error_count left standing` : ""),
    );

/** The lines the CLI prints for a result. */
export function formatReport(result, dbPath) {
  const verb = result.dryRun ? "would change" : "changed";
  return [
    `recompute-session-error-counts${result.dryRun ? " (dry run, nothing written)" : ""}`,
    `  database:            ${dbPath}`,
    `  run started:         ${result.runStartedAt}`,
    `  retention floor:     ${result.retentionFloor} (oldest retained event: ${result.oldestRetainedEventAt ?? "none"})`,
    `  coverage proof:      the session's own ${SESSION_START_SERVICE} event must still be retained`,
    `  status repair:       ${result.repairStatus ? "on (from retained non-background events only)" : "off (--repair-status)"}`,
    `  sessions:            ${result.sessionsTotal} total, ${result.sessionsScanned} scanned`,
    "",
    `  PROVEN  — history fully retained, safe to rewrite: ${plural(result.sessionsProven, "session")}`,
    `    error_count ${verb}:            ${plural(result.counts.changed, "session")}`,
    `    last_status/last_event ${verb}: ${result.status.changed} of ${plural(result.status.candidates, "candidate")}`,
    "",
    `  UNKNOWN HISTORY — evidence pruned, NOTHING written: ${plural(result.sessionsUnknownHistory, "session")}`,
    `    error_count kept as stored:     ${result.counts.errorsOnUnknownHistory} across ${plural(result.counts.sessionsWithErrorsOnUnknownHistory, "session")} — a weaker rule would erase these`,
    ...breakdown(result.counts.refused, true),
    ...(Object.keys(result.status.refused).length > 0
      ? ["", `  last_status/last_event left alone`, ...breakdown(result.status.refused, false)]
      : []),
    "",
    `  error_count sum, all sessions:    ${result.counts.sumBefore} -> ${result.counts.sumAfter}`,
  ];
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    repairStatus: false,
    dbPath: null,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--repair-status") args.repairStatus = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--db") args.dbPath = argv[++index] ?? null;
    else if (arg === "--batch-size") args.batchSize = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/**
 * CLI entry. `openDatabase` and `now` are injectable for tests; without them better-sqlite3 is
 * loaded from the working directory and the database is opened (read-only unless --apply) and
 * closed here.
 */
export function main(argv, { log = console.log, env = process.env, openDatabase, now } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    log(
      "usage: node recompute-session-error-counts.mjs [--apply] [--repair-status] [--db <path>] [--batch-size <n>]",
    );
    log("without --apply nothing is written: the default is a read-only dry run.");
    log(
      "only sessions whose own session_start event is still retained are ever written; rows whose",
    );
    log("history was pruned are reported as unknown history and left alone.");
    return null;
  }
  const dbPath = args.dbPath ?? env.DB_PATH ?? null;
  if (!dbPath) throw new Error("no database: pass --db <path> or set DB_PATH");

  let db;
  let ownsHandle = false;
  if (openDatabase) {
    db = openDatabase(dbPath, { readonly: !args.apply });
  } else {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const Database = require("better-sqlite3");
    db = new Database(dbPath, { readonly: !args.apply, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    ownsHandle = true;
  }
  try {
    const result = recomputeSessionErrorCounts(db, {
      apply: args.apply,
      repairStatus: args.repairStatus,
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
