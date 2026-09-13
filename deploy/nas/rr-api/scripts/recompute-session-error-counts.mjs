// Repairs the session counters that the WP 2.9 ingest fix left behind: app_sessions.error_count,
// and — flag-guarded — app_sessions.last_status / last_event.
//
// Why (WP 2.9): ingest used to add every app_error to its session's error_count and to let it set
// the session's last_event/last_status, background faults included (error_kind = 'background' —
// the desktop client's RR-E1003 loop, hundreds of events per session). Customers "Needs
// attention", the Heatmap error tiles, Live/Workers error badges and Customer 360 all read those
// columns. Ingest now ignores background faults; this script brings the stored rows in line.
//
// WHAT IT CHANGES
//   1. error_count from retained evidence — only for sessions whose whole history is provably
//      still in telemetry_events (see PROOF below). Always part of the run.
//   2. error_count from the background-only premise — for sessions whose evidence was pruned.
//      Only with --repair-legacy-counts, and only while that premise holds.
//   3. last_status + last_event — for ENDED sessions whose stored state came from a background
//      fault. Only with --repair-status: repaired from the newest retained non-background event,
//      or, when nothing of the session is retained, from the premise to ('ok', 'session_end' |
//      'session_start').
//
// WHAT IT DELIBERATELY DOES NOT DO
//   - It writes nothing without --apply. The default is a read-only dry run.
//   - It never touches telemetry_events, never prunes app_sessions, never creates rows.
//   - It never bumps updated_at: these columns are derived from events, and moving the row's
//     ingest clock forward would make a later event look older than the row. It also keeps
//     re-runs idempotent — a row that is already right is never written.
//   - It never lowers a count it cannot account for. A session whose evidence is (partly) pruned
//     is left alone and reported, unless --repair-legacy-counts is given and the premise holds.
//   - It never touches a session that is still active (its last_status can still change on its
//     own), nor a row updated after the run started (a new event arrived meanwhile) — re-run.
//   - It repairs nothing outside app_sessions: there is no other stored error rollup, stats.ts
//     aggregates these columns live.
//
// PROOF, AND ITS LIMIT
//   telemetry_events keeps 90 days (EVENT_RETENTION_DAYS), app_sessions keeps everything, and
//   started_at is NOT a first-contact stamp: ingest rewrites it forward on every session_start
//   (functions/_lib/storage.ts, SESSION_START branch), and a legacy `install:<id>` row is one row
//   for the whole life of an install (shared/telemetry-contract.ts). So "started_at >= the
//   retention floor" does not prove a row's history is retained. A session counts as fully
//   retained only when all three hold:
//     - its id is not `install:…`,
//     - started_at >= the retention floor (the later of the oldest retained event and now-90d),
//     - no retained event attributed to it is older than started_at (that would prove started_at
//       was rewritten forward over history that may since have been pruned).
//   Every other row is "legacy", and for those the data still supports exactly one claim: the
//   deployment-wide premise that every retained app_error row is error_kind='background', i.e.
//   this client family has not recorded a single real error in the whole retained window. Where
//   the row's client version has retained app_error evidence of its own, that version-level
//   evidence is reported separately, because it is the stronger of the two.
//   The report prints the premise it verified, what it repaired under which proof, and a
//   per-reason breakdown of every row it refused to touch. If the premise fails (a real error
//   shows up in the retained window), the legacy repair refuses every row, by design.
//
// Production — run AFTER the rr-api redeploy that ships the ingest change, from the NAS checkout
// (the runtime image does not contain deploy/, so copy the file in; better-sqlite3 is resolved
// from the working directory, /app/node_modules in the image; DB_PATH is set in the image):
//
//   docker cp deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs razorreaper-rr-api-1:/tmp/recompute-session-error-counts.mjs
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs --repair-legacy-counts --repair-status
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/recompute-session-error-counts.mjs --repair-legacy-counts --repair-status --apply
//
// Options: --apply (write; without it nothing is written), --repair-legacy-counts, --repair-status,
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** The session key ingest uses (readSessionId): metrics.session_id, trimmed. */
const sessionIdExpr = (prefix = "") =>
  `TRIM(CAST(json_extract(${prefix}metrics_json, '$.session_id') AS TEXT))`;
/** The background fault predicate ingest uses (isBackgroundError). */
const backgroundExpr = (prefix = "") =>
  `COALESCE(json_extract(${prefix}metrics_json, '$.error_kind'), '') = 'background'`;

const REAL_ERROR_COUNTS_SQL = `
  SELECT ${sessionIdExpr()} AS session_id, COUNT(*) AS errors
  FROM telemetry_events
  WHERE service = 'app_error' AND NOT (${backgroundExpr()})
  GROUP BY 1`;

/** The deployment-wide premise: how much app_error evidence is retained, and how much is real. */
const PREMISE_SQL = `
  SELECT COUNT(*) AS app_errors,
         COALESCE(SUM(CASE WHEN ${backgroundExpr()} THEN 0 ELSE 1 END), 0) AS real_errors
  FROM telemetry_events
  WHERE service = 'app_error'`;

/** The same premise per client version, from the sessions the retained app_error rows belong to. */
const VERSION_PREMISE_SQL = `
  SELECT COALESCE(s.app_version, '') AS version,
         COUNT(*) AS app_errors,
         COALESCE(SUM(CASE WHEN ${backgroundExpr("e.")} THEN 0 ELSE 1 END), 0) AS real_errors
  FROM telemetry_events e
  JOIN app_sessions s ON s.session_id = ${sessionIdExpr("e.")}
  WHERE e.service = 'app_error'
  GROUP BY 1`;

/** Sessions with retained evidence older than their own started_at: started_at was moved forward. */
const REWRITTEN_STARTED_AT_SQL = `
  SELECT s.session_id AS session_id
  FROM app_sessions s
  JOIN (
    SELECT ${sessionIdExpr()} AS session_id, MIN(ts) AS first_ts
    FROM telemetry_events
    GROUP BY 1
  ) e ON e.session_id = s.session_id
  WHERE e.first_ts < s.started_at`;

/**
 * For every session whose stored state looks like it came from an app_error: its newest retained
 * event, and its newest retained non-background event. Pruning drops the OLDEST rows, so a session
 * with any retained event still has its newest one — that is what makes this a proof and not a
 * guess.
 */
const STATUS_EVIDENCE_SQL = `
  WITH candidates AS (
    SELECT session_id FROM app_sessions WHERE last_event = 'app_error' AND last_status <> 'ok'
  ),
  events AS (
    SELECT ${sessionIdExpr("e.")} AS session_id, e.id AS id, e.ts AS ts,
           e.service AS service, e.status AS status,
           CASE WHEN e.service = 'app_error' AND ${backgroundExpr("e.")} THEN 1 ELSE 0 END AS background
    FROM telemetry_events e
    JOIN candidates c ON c.session_id = ${sessionIdExpr("e.")}
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
 * @param {import("better-sqlite3").Database} db
 * @param {{ apply?: boolean, repairLegacyCounts?: boolean, repairStatus?: boolean,
 *           batchSize?: number, now?: Date }} [options]
 */
export function recomputeSessionErrorCounts(db, options = {}) {
  const apply = options.apply ?? false;
  const repairLegacyCounts = options.repairLegacyCounts ?? false;
  const repairStatus = options.repairStatus ?? false;
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

  /** session_id -> retained real (non-background) errors. @type {Map<string, number>} */
  const realErrors = new Map();
  for (const row of db.prepare(REAL_ERROR_COUNTS_SQL).all()) {
    if (row.session_id) realErrors.set(row.session_id, Number(row.errors));
  }

  const premiseRow = db.prepare(PREMISE_SQL).get();
  const retainedAppErrors = Number(premiseRow?.app_errors ?? 0);
  const retainedRealErrors = Number(premiseRow?.real_errors ?? 0);
  // Proven only with evidence in hand: an empty retained window proves nothing about the past.
  const premiseProven = retainedAppErrors > 0 && retainedRealErrors === 0;

  /** Client versions whose own retained app_error evidence is background-only. */
  const provenVersions = new Set();
  for (const row of db.prepare(VERSION_PREMISE_SQL).all()) {
    if (Number(row.app_errors) > 0 && Number(row.real_errors) === 0) {
      provenVersions.add(String(row.version ?? ""));
    }
  }

  const rewrittenStartedAt = new Set(
    db
      .prepare(REWRITTEN_STARTED_AT_SQL)
      .all()
      .map((row) => String(row.session_id)),
  );

  /** session_id -> newest retained event / newest retained non-background event. */
  const newestEvent = new Map();
  const newestRealEvent = new Map();
  if (repairStatus) {
    for (const row of db.prepare(STATUS_EVIDENCE_SQL).all()) {
      const sessionId = String(row.session_id);
      const event = {
        service: String(row.service),
        status: String(row.status),
        background: Number(row.background) === 1,
      };
      if (Number(row.newest_rank) === 1) newestEvent.set(sessionId, event);
      if (!event.background) newestRealEvent.set(sessionId, event);
    }
  }

  const all = db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(error_count), 0) AS errors FROM app_sessions`,
    )
    .get();

  const result = {
    dryRun: !apply,
    repairLegacyCounts,
    repairStatus,
    runStartedAt,
    retentionFloor,
    premise: {
      retainedAppErrors,
      retainedRealErrors,
      proven: premiseProven,
      provenVersions: provenVersions.size,
    },
    sessionsTotal: Number(all.sessions),
    sessionsScanned: 0,
    sessionsOutsideRetention: 0,
    counts: {
      changed: 0,
      changedFromRetainedHistory: 0,
      changedFromVersionPremise: 0,
      changedFromDeploymentPremise: 0,
      /** @type {Record<string, { sessions: number, errors: number }>} reason -> left untouched */
      refused: {},
      sumBefore: Number(all.errors),
      sumAfter: Number(all.errors),
    },
    status: {
      candidates: 0,
      changed: 0,
      changedFromRetainedEvent: 0,
      changedFromPremise: 0,
      /** @type {Record<string, { sessions: number, errors: number }>} */
      refused: {},
    },
  };
  result.sessionsOutsideRetention = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM app_sessions WHERE started_at < ?`).get(retentionFloor).n,
  );

  const page = db.prepare(
    `SELECT session_id, started_at, app_version, error_count, last_event, last_status,
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

  /** Why this row's stored count is not backed by retained evidence — null when it is. */
  const historyGap = (row) => {
    const sessionId = String(row.session_id);
    if (sessionId.startsWith(LEGACY_SESSION_ID_PREFIX)) return "legacy-install-id";
    if (String(row.started_at) < retentionFloor) return "started-before-retention-floor";
    if (rewrittenStartedAt.has(sessionId)) return "started-at-rewritten-forward";
    return null;
  };

  const settleCount = (row) => {
    const sessionId = String(row.session_id);
    const before = Number(row.error_count);
    const target = realErrors.get(sessionId.trim()) ?? 0;
    if (before === target) return;

    const refuse = (reason) => tally(result.counts.refused, reason, before);
    if (String(row.updated_at) > runStartedAt) {
      // Touched since the run started: its count already moved on without us.
      refuse("updated-during-the-run");
      return;
    }

    const gap = historyGap(row);
    let proof = "retained-history";
    if (gap) {
      if (!repairLegacyCounts) {
        refuse(gap);
        return;
      }
      if (target > 0) {
        // Real errors are retained for this row, but older ones may have been pruned: the stored
        // count is the larger record. Lowering it to what is left would destroy evidence.
        refuse("retained-real-errors");
        return;
      }
      if (!premiseProven) {
        refuse(
          retainedAppErrors === 0 ? "no-retained-evidence" : "retained-history-has-real-errors",
        );
        return;
      }
      proof = provenVersions.has(String(row.app_version ?? ""))
        ? "version-premise"
        : "deployment-premise";
    }

    if (apply) {
      const changed = updateCount.run(target, row.session_id, before, runStartedAt).changes;
      if (changed === 0) {
        refuse("updated-during-the-run");
        return;
      }
    }
    result.counts.changed += 1;
    if (proof === "retained-history") result.counts.changedFromRetainedHistory += 1;
    else if (proof === "version-premise") result.counts.changedFromVersionPremise += 1;
    else result.counts.changedFromDeploymentPremise += 1;
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

    const sessionId = String(row.session_id);
    const newest = newestEvent.get(sessionId);
    if (newest && !newest.background) {
      // The stored state matches a retained event that is not a background fault: it is real.
      refuse("newest-retained-event-is-not-a-background-fault");
      return;
    }

    const previous = newestRealEvent.get(sessionId);
    let nextStatus;
    let nextEvent;
    let proof;
    if (previous) {
      nextStatus = previous.status;
      nextEvent = previous.service;
      proof = "retained-event";
    } else {
      // Nothing of this session survives except background faults (or nothing at all).
      if (!premiseProven) {
        refuse(
          retainedAppErrors === 0 ? "no-retained-evidence" : "retained-history-has-real-errors",
        );
        return;
      }
      nextStatus = "ok";
      nextEvent = row.ended_at ? "session_end" : "session_start";
      proof = "premise";
    }
    if (nextStatus === String(row.last_status) && nextEvent === String(row.last_event)) return;

    if (apply) {
      const changed = updateStatus.run(
        nextStatus,
        nextEvent,
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
    if (proof === "retained-event") result.status.changedFromRetainedEvent += 1;
    else result.status.changedFromPremise += 1;
  };

  /** One batch: read a page and write its corrections under the same (immediate) lock. */
  const runBatch = (afterSessionId) => {
    const rows = page.all(afterSessionId, batchSize);
    for (const row of rows) {
      result.sessionsScanned += 1;
      settleCount(row);
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

const breakdown = (refused, withErrors) =>
  Object.keys(refused)
    .sort()
    .map(
      (reason) =>
        `    refused, ${reason}: ${plural(refused[reason].sessions, "session")}` +
        (withErrors ? `, ${refused[reason].errors} error_count still standing` : ""),
    );

/** The lines the CLI prints for a result. */
export function formatReport(result, dbPath) {
  const verb = result.dryRun ? "would change" : "changed";
  const repairs = [
    result.repairLegacyCounts ? "legacy counts" : null,
    result.repairStatus ? "last_status" : null,
  ].filter(Boolean);
  const premise = result.premise.proven
    ? `proven: ${result.premise.retainedAppErrors} retained app_error rows, all background (${plural(result.premise.provenVersions, "client version")} with retained evidence of its own)`
    : `NOT proven: ${result.premise.retainedAppErrors} retained app_error rows, ${result.premise.retainedRealErrors} of them real`;
  return [
    `recompute-session-error-counts${result.dryRun ? " (dry run, nothing written)" : ""}`,
    `  database:            ${dbPath}`,
    `  run started:         ${result.runStartedAt}`,
    `  retention floor:     ${result.retentionFloor}`,
    `  repairs enabled:     ${repairs.length > 0 ? repairs.join(", ") : "none (error_count from retained evidence only)"}`,
    `  background-only premise: ${premise}`,
    `  sessions:            ${result.sessionsTotal} total, ${result.sessionsScanned} scanned, ${result.sessionsOutsideRetention} started before the floor`,
    `  error_count ${verb}: ${plural(result.counts.changed, "session")} (${result.counts.changedFromRetainedHistory} from retained history, ${result.counts.changedFromVersionPremise} from their version's premise, ${result.counts.changedFromDeploymentPremise} from the deployment premise)`,
    ...breakdown(result.counts.refused, true),
    `  last_status/last_event ${verb}: ${result.status.changed} of ${result.status.candidates} candidates (${result.status.changedFromRetainedEvent} from a retained event, ${result.status.changedFromPremise} from the premise)`,
    ...breakdown(result.status.refused, false),
    `  error_count sum, all sessions:        ${result.counts.sumBefore} -> ${result.counts.sumAfter}`,
  ];
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    repairLegacyCounts: false,
    repairStatus: false,
    dbPath: null,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--repair-legacy-counts") args.repairLegacyCounts = true;
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
      "usage: node recompute-session-error-counts.mjs [--apply] [--repair-legacy-counts] [--repair-status] [--db <path>] [--batch-size <n>]",
    );
    log("without --apply nothing is written: the default is a read-only dry run.");
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
      repairLegacyCounts: args.repairLegacyCounts,
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
