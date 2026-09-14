// Undoes, from a pre-run backup, the part of an earlier recompute-session-error-counts run that
// the strict coverage rule cannot justify.
//
// WHY THIS EXISTS
//   The first production run of recompute-session-error-counts.mjs used a weaker coverage test:
//   "started_at is inside the retention window, the id is not install-scoped, and no retained
//   event is older than started_at". That does not prove a session's history is retained — older
//   events may simply have been pruned, and ingest rewrites started_at forward on every
//   session_start. Under it the run lowered error_count on rows whose real errors were already
//   gone from telemetry_events, so the stored count was the last record of them.
//
//   recompute-session-error-counts.mjs now only writes a row whose OWN session_start event is
//   still retained. This script applies that same rule to the rows the earlier run already
//   changed: every row the strict rule cannot prove gets its pre-run value back; every row it can
//   prove keeps the corrected value. The proof helpers are imported from that script, not
//   reimplemented, so the two cannot drift apart.
//
// WHAT IT RESTORES, AND WHAT IT REFUSES TO TOUCH
//   error_count — only where the live value is LOWER than the backup's (the run only ever
//   lowered) AND the live value is exactly what a recompute writes today (so the current value is
//   attributable to that run, not to something else) AND the strict rule cannot prove the row.
//   last_status / last_event — only for rows that were a status-repair subject IN THE BACKUP
//   (last_event = 'app_error' AND last_status <> 'ok'); those are the only rows the recompute
//   script can ever write. Every other status difference between backup and live is ordinary
//   ingest traffic since the backup was taken and is reported, never restored — putting a stale
//   'session_active' back over a live 'session_end' would be its own data loss.
//
//   It never restores a row whose count GREW since the backup, never inserts a session that is
//   only in the backup, never deletes a session that is only in the live database, never touches
//   telemetry_events, and never writes to the backup: that file is opened read-only.
//
//   It does not bump updated_at, for the same reason the recompute script does not: these columns
//   are derived from events, and moving the row's ingest clock forward would make a later event
//   look older than the row. Every write is a compare-and-set against the value this run read, so
//   a concurrent ingest write is skipped and reported rather than clobbered.
//
// IDEMPOTENT: after a successful --apply, every restored row matches the backup again and is
// reported as unchanged. Running it twice changes nothing the second time.
//
// Production (dry run first, read the report, then --apply):
//
//   docker cp deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs razorreaper-rr-api-1:/tmp/recompute-session-error-counts.mjs
//   docker cp deploy/nas/rr-api/scripts/restore-session-error-counts.mjs   razorreaper-rr-api-1:/tmp/restore-session-error-counts.mjs
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/restore-session-error-counts.mjs --backup /backups/rr-pre-errors-20260913.sqlite
//   docker exec -w /app razorreaper-rr-api-1 node /tmp/restore-session-error-counts.mjs --backup /backups/rr-pre-errors-20260913.sqlite --apply
//
//   (the backup must be readable inside the container — mount it read-only, or copy it in.)
//
// Options: --backup <path> (required), --db <path> (default $DB_PATH), --apply (write; without it
// nothing is written), --batch-size <n> (sessions per write transaction, default 200), --dry-run.

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildEvidenceIndex,
  countTargetFor,
  coverageGap,
  DEFAULT_BATCH_SIZE,
  statusRepairFor,
} from "./recompute-session-error-counts.mjs";

/** The stored state the recompute script's status repair is allowed to rewrite. */
const isStatusRepairSubject = (lastEvent, lastStatus) =>
  String(lastEvent ?? "") === "app_error" && String(lastStatus ?? "") !== "ok";

const tally = (bucket, reason, errors) => {
  const entry = bucket[reason] ?? { sessions: 0, errors: 0 };
  entry.sessions += 1;
  entry.errors += errors;
  bucket[reason] = entry;
};

/**
 * @param {import("better-sqlite3").Database} db the live database
 * @param {import("better-sqlite3").Database} backup the pre-run backup, opened read-only
 * @param {{ apply?: boolean, batchSize?: number, now?: Date }} [options]
 */
export function restoreSessionErrorCounts(db, backup, options = {}) {
  const apply = options.apply ?? false;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batch size must be a positive integer, got ${batchSize}`);
  }
  const now = options.now ?? new Date();
  const runStartedAt = now.toISOString();

  // The strict rule, read off the LIVE database: that is where a recompute run reads it today,
  // and the question this script answers is "can the current evidence justify the change?".
  const index = buildEvidenceIndex(db, { now, statusEvidence: true });

  /** session_id -> the pre-run row. The backup is a snapshot; 18k rows fit comfortably. */
  const snapshot = new Map();
  for (const row of backup
    .prepare(`SELECT session_id, error_count, last_status, last_event FROM app_sessions`)
    .iterate()) {
    snapshot.set(String(row.session_id), {
      errorCount: Number(row.error_count),
      lastStatus: row.last_status == null ? null : String(row.last_status),
      lastEvent: row.last_event == null ? null : String(row.last_event),
    });
  }

  const live = db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(error_count), 0) AS errors FROM app_sessions`,
    )
    .get();

  const result = {
    dryRun: !apply,
    runStartedAt,
    retentionFloor: index.retentionFloor,
    sessionsLive: Number(live.sessions),
    sessionsInBackup: snapshot.size,
    sessionsScanned: 0,
    counts: {
      restored: 0,
      /** error_count handed back to the rows the strict rule cannot prove. */
      errorsRestored: 0,
      /** Rows the strict rule proves: they keep the recomputed value. */
      provenKept: 0,
      /** error_count that stays dropped because the strict rule proves those rows. */
      errorsProvenDropped: 0,
      /** @type {Record<string, { sessions: number, errors: number }>} */
      refused: {},
      sumBefore: Number(live.errors),
      sumAfter: Number(live.errors),
    },
    status: {
      /** Rows that were a repair subject in the backup: the only ones a recompute may rewrite. */
      subjects: 0,
      restored: 0,
      provenKept: 0,
      /** @type {Record<string, { sessions: number, errors: number }>} */
      refused: {},
    },
  };

  const page = db.prepare(
    `SELECT session_id, error_count, last_status, last_event, updated_at
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

  const settleCount = (row, before) => {
    const sessionId = String(row.session_id);
    const liveCount = Number(row.error_count);
    const backupCount = before.errorCount;
    const refuse = (reason) => tally(result.counts.refused, reason, liveCount);

    if (liveCount === backupCount) {
      refuse("count-unchanged-since-the-backup");
      return;
    }
    if (liveCount > backupCount) {
      // The recompute run only ever lowered counts; this row gained errors from ingest.
      refuse("count-grew-since-the-backup");
      return;
    }
    if (liveCount !== countTargetFor(index, sessionId)) {
      // Lower than the backup, but not the value a recompute writes: something else set it, so
      // this script cannot say what putting the backup value back would undo.
      refuse("count-not-attributable-to-the-recompute-run");
      return;
    }
    if (coverageGap(index, sessionId) === null) {
      // Proven: the whole history is retained and really does account for the lowered count.
      result.counts.provenKept += 1;
      result.counts.errorsProvenDropped += backupCount - liveCount;
      return;
    }
    if (String(row.updated_at) > runStartedAt) {
      refuse("updated-during-the-run");
      return;
    }
    if (apply) {
      const changed = updateCount.run(backupCount, sessionId, liveCount, runStartedAt).changes;
      if (changed === 0) {
        refuse("updated-during-the-run");
        return;
      }
    }
    result.counts.restored += 1;
    result.counts.errorsRestored += backupCount - liveCount;
    result.counts.sumAfter += backupCount - liveCount;
  };

  const settleStatus = (row, before) => {
    const sessionId = String(row.session_id);
    const liveStatus = row.last_status == null ? null : String(row.last_status);
    const liveEvent = row.last_event == null ? null : String(row.last_event);
    const same = liveStatus === before.lastStatus && liveEvent === before.lastEvent;
    const refuse = (reason) => tally(result.status.refused, reason, 0);

    if (!isStatusRepairSubject(before.lastEvent, before.lastStatus)) {
      // Not something a recompute run could have written. Any difference here is ingest.
      if (!same) refuse("status-not-a-recompute-subject-in-the-backup");
      return;
    }
    result.status.subjects += 1;
    if (same) {
      refuse("status-unchanged-since-the-backup");
      return;
    }

    const repair = statusRepairFor(index, sessionId);
    if (repair.ok && repair.lastStatus === liveStatus && repair.lastEvent === liveEvent) {
      // The live value is exactly what the strict status repair proves from retained events.
      result.status.provenKept += 1;
      return;
    }
    if (String(row.updated_at) > runStartedAt) {
      refuse("updated-during-the-run");
      return;
    }
    if (apply) {
      const changed = updateStatus.run(
        before.lastStatus,
        before.lastEvent,
        sessionId,
        liveStatus,
        liveEvent,
        runStartedAt,
      ).changes;
      if (changed === 0) {
        refuse("updated-during-the-run");
        return;
      }
    }
    result.status.restored += 1;
  };

  const runBatch = (afterSessionId) => {
    const rows = page.all(afterSessionId, batchSize);
    for (const row of rows) {
      result.sessionsScanned += 1;
      const before = snapshot.get(String(row.session_id));
      if (!before) {
        // Created after the backup was taken: there is nothing to restore it to.
        tally(result.counts.refused, "not-in-the-backup", Number(row.error_count));
        continue;
      }
      settleCount(row, before);
      settleStatus(row, before);
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
        (withErrors ? `, ${refused[reason].errors} error_count as stored` : ""),
    );

export function formatReport(result, dbPath, backupPath) {
  const verb = result.dryRun ? "would restore" : "restored";
  const kept = result.dryRun ? "would keep" : "kept";
  return [
    `restore-session-error-counts${result.dryRun ? " (dry run, nothing written)" : ""}`,
    `  live database:       ${dbPath}`,
    `  backup (read-only):  ${backupPath}`,
    `  run started:         ${result.runStartedAt}`,
    `  retention floor:     ${result.retentionFloor}`,
    `  coverage proof:      the session's own session_start event must still be retained`,
    `  sessions:            ${result.sessionsLive} live, ${result.sessionsInBackup} in the backup, ${result.sessionsScanned} scanned`,
    "",
    `  RESTORED — the strict rule CANNOT prove these rows, so the pre-run value goes back`,
    `    error_count ${verb}:            ${plural(result.counts.restored, "session")}, +${result.counts.errorsRestored} error_count`,
    `    last_status/last_event ${verb}: ${plural(result.status.restored, "session")}`,
    "",
    `  KEPT AT THE CORRECTED VALUE — the strict rule PROVES these rows`,
    `    error_count ${kept}:            ${plural(result.counts.provenKept, "session")}, ${result.counts.errorsProvenDropped} error_count stays dropped`,
    `    last_status/last_event ${kept}: ${plural(result.status.provenKept, "session")}`,
    "",
    `  NOT TOUCHED (error_count)`,
    ...breakdown(result.counts.refused, true),
    `  NOT TOUCHED (last_status/last_event), ${plural(result.status.subjects, "backup repair subject")}`,
    ...breakdown(result.status.refused, false),
    "",
    `  error_count sum, all sessions:    ${result.counts.sumBefore} -> ${result.counts.sumAfter}`,
  ];
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    dbPath: null,
    backupPath: null,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--db") args.dbPath = argv[++index] ?? null;
    else if (arg === "--backup") args.backupPath = argv[++index] ?? null;
    else if (arg === "--batch-size") args.batchSize = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/**
 * CLI entry. `openDatabase` and `now` are injectable for tests; without them better-sqlite3 is
 * loaded from the working directory. The backup is ALWAYS opened read-only.
 */
export function main(argv, { log = console.log, env = process.env, openDatabase, now } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    log(
      "usage: node restore-session-error-counts.mjs --backup <path> [--db <path>] [--apply] [--batch-size <n>]",
    );
    log("without --apply nothing is written: the default is a read-only dry run.");
    log("restores the pre-run error_count only for sessions whose history the strict rule cannot");
    log("prove; rows it can prove keep the recomputed value.");
    return null;
  }
  const dbPath = args.dbPath ?? env.DB_PATH ?? null;
  if (!dbPath) throw new Error("no database: pass --db <path> or set DB_PATH");
  if (!args.backupPath) throw new Error("no backup: pass --backup <path>");
  if (path.resolve(args.backupPath) === path.resolve(dbPath)) {
    throw new Error("the backup and the live database are the same file");
  }

  const open =
    openDatabase ??
    ((file, openOptions) => {
      const require = createRequire(path.join(process.cwd(), "package.json"));
      const Database = require("better-sqlite3");
      const handle = new Database(file, { ...openOptions, fileMustExist: true });
      handle.pragma("busy_timeout = 5000");
      return handle;
    });

  const db = open(dbPath, { readonly: !args.apply });
  const backup = open(args.backupPath, { readonly: true });
  try {
    const result = restoreSessionErrorCounts(db, backup, {
      apply: args.apply,
      batchSize: args.batchSize,
      now,
    });
    for (const line of formatReport(result, dbPath, args.backupPath)) log(line);
    return result;
  } finally {
    if (!openDatabase) {
      db.close();
      backup.close();
    }
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
