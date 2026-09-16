import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COVERAGE_PROOF } from "../deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs";
import {
  ingestWriteSince,
  main,
  restoreSessionErrorCounts,
} from "../deploy/nas/rr-api/scripts/restore-session-error-counts.mjs";
import {
  backgroundFault,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "./helpers/telemetry-db";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date("2026-09-14T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

/** The live database, and the pre-run backup the restore reads (app_sessions only). */
let live: TelemetryTestDb;
let backup: TelemetryTestDb;

afterEach(() => {
  live.close();
  backup.close();
});

interface SessionRow {
  errorCount?: number;
  lastEvent?: string | null;
  lastStatus?: "ok" | "degraded" | "down";
  startedAt?: string;
  updatedAt?: string;
  isActive?: boolean;
}

function insertSession(target: TelemetryTestDb, sessionId: string, row: SessionRow = {}) {
  const startedAt = row.startedAt ?? ago(2 * DAY);
  target.handle
    .prepare(
      `INSERT INTO app_sessions (session_id, install_id, hwid, source, app_version, started_at,
                                 last_seen_at, ended_at, is_active, last_event, last_status,
                                 error_count, updated_at)
       VALUES (?, ?, ?, 'desktop-app', '1.5.2', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      `inst-${sessionId}`,
      `HW-${sessionId}`,
      startedAt,
      startedAt,
      row.isActive ? null : ago(1 * DAY),
      row.isActive ? 1 : 0,
      row.lastEvent === undefined ? "session_end" : row.lastEvent,
      row.lastStatus ?? "ok",
      row.errorCount ?? 0,
      row.updatedAt ?? startedAt,
    );
}

/** The same session in both databases, differing only in what the earlier run left behind. */
function insertPair(sessionId: string, before: SessionRow, after: SessionRow) {
  insertSession(backup, sessionId, before);
  insertSession(live, sessionId, after);
}

function errorCounts(): Record<string, number> {
  const rows = live.handle
    .prepare(`SELECT session_id, error_count FROM app_sessions ORDER BY session_id`)
    .all() as Array<{ session_id: string; error_count: number }>;
  return Object.fromEntries(rows.map((row) => [row.session_id, row.error_count]));
}

function sessionState(sessionId: string): { lastStatus: string; lastEvent: string | null } {
  const row = live.handle
    .prepare(`SELECT last_status, last_event FROM app_sessions WHERE session_id = ?`)
    .get(sessionId) as { last_status: string; last_event: string | null };
  return { lastStatus: row.last_status, lastEvent: row.last_event };
}

const startEvent = (sessionId: string, msAgo: number) => ({
  service: "session_start",
  status: "ok" as const,
  ts: ago(msAgo),
  metrics: { session_id: sessionId },
});

/** The client's update_check, fired moments before session_start as part of the same run. */
const updateCheck = (sessionId: string, msAgo: number) => ({
  service: "update_check",
  status: "ok" as const,
  ts: ago(msAgo),
  metrics: { session_id: sessionId },
});

const loop = (sessionId: string, count: number, startMsAgo: number) =>
  Array.from({ length: count }, (_, index) =>
    backgroundFault(ago(startMsAgo - index * 1000), { session_id: sessionId }),
  );

const run = (options: { apply?: boolean; batchSize?: number } = {}) =>
  restoreSessionErrorCounts(live.handle, backup.handle, { ...options, now: NOW });

beforeEach(() => {
  backup = createTelemetryTestDb();
  live = createTelemetryTestDb();
  live.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);

  // --- the strict rule PROVES these: the earlier run's correction stands --------------------
  // Background noise only, own session_start retained.
  insertPair("p-proven", { errorCount: 500 }, { errorCount: 0 });
  live.insertEvents([startEvent("p-proven", 2 * DAY), ...loop("p-proven", 6, 2 * DAY - MINUTE)]);
  // Proven, and two of its errors were real: the run lowered 9 -> 2, which is what the
  // retained evidence accounts for.
  insertPair("p-proven-real", { errorCount: 9 }, { errorCount: 2 });
  live.insertEvents([
    startEvent("p-proven-real", 2 * DAY),
    realError(ago(2 * DAY - MINUTE), { session_id: "p-proven-real" }),
    realError(ago(2 * DAY - 2 * MINUTE), { session_id: "p-proven-real" }),
    ...loop("p-proven-real", 3, 2 * DAY - 10 * MINUTE),
  ]);
  // Its update_check fired 30 s before its session_start — the prelude of the same run, inside
  // the window — so the start anchors the history and the run's 400 -> 0 stands.
  insertPair("p-prelude", { errorCount: 400 }, { errorCount: 0 });
  live.insertEvents([
    updateCheck("p-prelude", 2 * DAY + 30_000),
    startEvent("p-prelude", 2 * DAY),
    ...loop("p-prelude", 6, 2 * DAY - MINUTE),
  ]);

  // --- the strict rule CANNOT prove these: the pre-run count goes back ----------------------
  // started_at was rewritten forward; the real errors behind the stored 300 were pruned.
  insertPair("u-forward", { errorCount: 300 }, { errorCount: 0 });
  live.insertEvents(loop("u-forward", 4, 1 * DAY));
  // Nothing of it survives at all.
  insertPair(
    "u-pruned",
    { errorCount: 40, startedAt: ago(200 * DAY) },
    { errorCount: 0, startedAt: ago(200 * DAY) },
  );
  // Legacy pseudo-session: one row for the whole life of an install.
  insertPair("install:abc", { errorCount: 12 }, { errorCount: 0 });
  live.insertEvents([
    startEvent("install:abc", 1 * DAY),
    ...loop("install:abc", 2, 1 * DAY - MINUTE),
  ]);
  // An event 20 minutes before its retained start: outside the prelude window, so that start does
  // not anchor the history and the pre-run 50 goes back.
  insertPair("u-prelude-late", { errorCount: 50 }, { errorCount: 0 });
  live.insertEvents([
    updateCheck("u-prelude-late", 2 * DAY + 20 * MINUTE),
    startEvent("u-prelude-late", 2 * DAY),
    ...loop("u-prelude-late", 2, 2 * DAY - MINUTE),
  ]);
  // A genuine prelude beside an older event from an earlier use of the id: the older event decides.
  insertPair("u-prelude-reused", { errorCount: 60 }, { errorCount: 0 });
  live.insertEvents([
    ...loop("u-prelude-reused", 2, 2 * DAY + 12 * HOUR),
    updateCheck("u-prelude-reused", 2 * DAY + 30_000),
    startEvent("u-prelude-reused", 2 * DAY),
  ]);

  // --- rows the restore must not touch ------------------------------------------------------
  // Unprovable like u-pruned — but INGEST wrote this row after the backup (updated_at moved),
  // so the pre-run 77 is not the value to put back and the script must leave the row alone.
  insertPair(
    "u-ingest",
    { errorCount: 77, startedAt: ago(150 * DAY) },
    { errorCount: 0, startedAt: ago(150 * DAY), updatedAt: ago(1 * HOUR) },
  );
  // Ingest added errors since the backup: the recompute run only ever lowered.
  insertPair("n-grew", { errorCount: 4 }, { errorCount: 9 });
  // Never changed.
  insertPair("n-same", { errorCount: 3 }, { errorCount: 3 });
  // Lower than the backup, but not the value a recompute writes (its evidence accounts for 0):
  // something else set it, so putting 30 back would undo an unknown change.
  insertPair("n-odd", { errorCount: 30 }, { errorCount: 2 });
  // Created after the backup was taken.
  insertSession(live, "n-new", { errorCount: 5 });

  // --- last_status / last_event -------------------------------------------------------------
  // A repair subject in the backup whose new state nothing retained proves: restore it.
  insertPair(
    "st-unproven",
    { lastEvent: "app_error", lastStatus: "down", startedAt: ago(150 * DAY) },
    { lastEvent: "session_end", lastStatus: "ok", startedAt: ago(150 * DAY) },
  );
  // A repair subject whose new state is exactly what the retained events prove: keep it.
  insertPair(
    "st-proven",
    { lastEvent: "app_error", lastStatus: "down" },
    { lastEvent: "session_start", lastStatus: "ok" },
  );
  live.insertEvents([startEvent("st-proven", 2 * DAY), ...loop("st-proven", 3, 1 * DAY)]);
  // Ordinary ingest traffic since the backup: never a recompute subject, never restored.
  insertPair(
    "st-churn",
    { lastEvent: "session_active", lastStatus: "ok" },
    { lastEvent: "session_end", lastStatus: "ok", updatedAt: ago(1 * HOUR) },
  );
  // A repair subject the earlier run left alone.
  insertPair(
    "st-untouched",
    { lastEvent: "app_error", lastStatus: "down", startedAt: ago(150 * DAY) },
    { lastEvent: "app_error", lastStatus: "down", startedAt: ago(150 * DAY) },
  );
  // THE HAZARD. Identical to st-unproven — a backup repair subject whose live state nothing
  // retained proves — EXCEPT that its updated_at has moved. The recompute never bumps updated_at,
  // so this (session_end, ok) was written by ingest after the backup: it is current, legitimate
  // state, and rolling 'app_error'/'down' back over it would re-flag the session for good.
  insertPair(
    "st-ingest",
    { lastEvent: "app_error", lastStatus: "down", startedAt: ago(150 * DAY) },
    {
      lastEvent: "session_end",
      lastStatus: "ok",
      startedAt: ago(150 * DAY),
      updatedAt: ago(1 * HOUR),
    },
  );
  // A backup repair subject whose live last_event is NULL. No recompute writes NULL, and a
  // `last_event = NULL` compare-and-set matches no row — so this must be named for what it is,
  // not reported as a lost race.
  insertPair(
    "st-null",
    { lastEvent: "app_error", lastStatus: "down", startedAt: ago(150 * DAY) },
    { lastEvent: null, lastStatus: "ok", startedAt: ago(150 * DAY) },
  );
});

describe("restore-session-error-counts", () => {
  it("restores only what the strict rule cannot prove, and says which is which", () => {
    const result = run({ apply: true, batchSize: 3 });

    expect(result.sessionsLive).toBe(19);
    expect(result.sessionsInBackup).toBe(18);
    expect(result.sessionsScanned).toBe(19);

    expect(result.counts.restored).toBe(5);
    expect(result.counts.errorsRestored).toBe(462);
    expect(result.counts.provenKept).toBe(3);
    expect(result.counts.errorsProvenDropped).toBe(907);
    expect(result.counts.notRestoredIngestWrote).toBe(1);
    expect(result.counts.errorsNotRestoredIngestWrote).toBe(77);
    expect(result.counts.refused).toEqual({
      "count-grew-since-the-backup": { sessions: 1, errors: 9 },
      "count-unchanged-since-the-backup": { sessions: 7, errors: 3 },
      "count-not-attributable-to-the-recompute-run": { sessions: 1, errors: 2 },
      "not-in-the-backup": { sessions: 1, errors: 5 },
      "row-written-by-ingest-since-the-backup": { sessions: 1, errors: 0 },
    });
    expect(result.counts.sumBefore).toBe(21);
    expect(result.counts.sumAfter).toBe(483);
    // Projected, then measured: the report never claims a sum it did not read back.
    expect(result.counts.sumAfterObserved).toBe(483);

    expect(errorCounts()).toEqual({
      "install:abc": 12,
      "n-grew": 9,
      "n-new": 5,
      "n-odd": 2,
      "n-same": 3,
      "p-prelude": 0,
      "p-proven": 0,
      "p-proven-real": 2,
      "st-churn": 0,
      "st-ingest": 0,
      "st-null": 0,
      "st-proven": 0,
      "st-untouched": 0,
      "st-unproven": 0,
      "u-forward": 300,
      "u-ingest": 0,
      "u-prelude-late": 50,
      "u-prelude-reused": 60,
      "u-pruned": 40,
    });
  });

  it("applies the prelude rule the recompute script applies, through the same helper", () => {
    const result = run({ apply: true });

    // A prelude inside the window: the start anchors the history, the corrected 0 stands.
    expect(errorCounts()["p-prelude"]).toBe(0);
    // Outside the window, or beside an older event from an earlier use: unprovable, restored.
    expect(errorCounts()["u-prelude-late"]).toBe(50);
    expect(errorCounts()["u-prelude-reused"]).toBe(60);
    expect(result.counts.provenKept).toBe(3);
    expect(result.counts.restored).toBe(5);
  });

  it("restores a status only where no retained event proves the new one", () => {
    const result = run({ apply: true });

    expect(result.status.subjects).toBe(5);
    expect(result.status.restored).toBe(1);
    expect(result.status.provenKept).toBe(1);
    expect(result.status.refused).toEqual({
      "status-unchanged-since-the-backup": { sessions: 1, errors: 0 },
      "status-not-a-recompute-subject-in-the-backup": { sessions: 1, errors: 0 },
      "row-written-by-ingest-since-the-backup": { sessions: 1, errors: 0 },
      "live-last-event-is-null-no-recompute-wrote-it": { sessions: 1, errors: 0 },
    });
    expect(sessionState("st-unproven")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
    expect(sessionState("st-proven")).toEqual({ lastStatus: "ok", lastEvent: "session_start" });
    // Ingest moved this one on after the backup: a stale 'session_active' must not come back.
    expect(sessionState("st-churn")).toEqual({ lastStatus: "ok", lastEvent: "session_end" });
    expect(sessionState("st-untouched")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
  });

  it("never rolls a status back over a value ingest wrote after the backup", () => {
    // st-unproven and st-ingest are the same row in every respect the old rule looked at: both
    // were (app_error, down) repair subjects in the backup, both now read (session_end, ok), and
    // neither has a retained event that proves the new state. The ONLY difference is updated_at.
    const result = run({ apply: true });

    expect(sessionState("st-ingest")).toEqual({ lastStatus: "ok", lastEvent: "session_end" });
    expect(sessionState("st-unproven")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
    expect(result.status.restored).toBe(1);
    expect(result.status.notRestoredIngestWrote).toBe(1);
    expect(result.status.refused["row-written-by-ingest-since-the-backup"]).toEqual({
      sessions: 1,
      errors: 0,
    });
    // And it is NOT reported as a concurrency event, which is the reason it used to collapse into.
    expect(result.status.refused["updated-during-the-run"]).toBeUndefined();
    expect(result.status.refused["row-changed-between-the-read-and-the-write"]).toBeUndefined();
  });

  it("never rolls a count back over a value ingest wrote after the backup", () => {
    // u-pruned and u-ingest are both unprovable rows the run lowered to 0; only updated_at differs.
    const result = run({ apply: true });

    expect(errorCounts()["u-pruned"]).toBe(40);
    expect(errorCounts()["u-ingest"]).toBe(0);
    expect(result.counts.notRestoredIngestWrote).toBe(1);
    expect(result.counts.errorsNotRestoredIngestWrote).toBe(77);
    expect(result.counts.refused["row-written-by-ingest-since-the-backup"]).toEqual({
      sessions: 1,
      errors: 0,
    });
  });

  it("names a NULL live last_event instead of reporting it as a lost race", () => {
    const result = run({ apply: true });

    expect(sessionState("st-null")).toEqual({ lastStatus: "ok", lastEvent: null });
    expect(result.status.refused["live-last-event-is-null-no-recompute-wrote-it"]).toEqual({
      sessions: 1,
      errors: 0,
    });
    expect(result.status.refused["row-changed-between-the-read-and-the-write"]).toBeUndefined();
  });

  it("writes nothing without apply", () => {
    const before = errorCounts();

    const result = run();

    expect(result.dryRun).toBe(true);
    expect(result.counts.restored).toBe(5);
    expect(result.counts.sumAfter).toBe(483);
    // Nothing was written, so there is no measured sum to report.
    expect(result.counts.sumAfterObserved).toBeNull();
    expect(result.status.restored).toBe(1);
    expect(errorCounts()).toEqual(before);
    expect(sessionState("st-unproven")).toEqual({ lastStatus: "ok", lastEvent: "session_end" });
  });

  it("is idempotent: a second run restores nothing more", () => {
    run({ apply: true });
    const second = run({ apply: true, batchSize: 2 });

    expect(second.counts.restored).toBe(0);
    expect(second.counts.errorsRestored).toBe(0);
    expect(second.status.restored).toBe(0);
    expect(second.counts.sumBefore).toBe(483);
    expect(second.counts.sumAfter).toBe(483);
    expect(second.counts.sumAfterObserved).toBe(483);
    expect(second.counts.refused["count-unchanged-since-the-backup"]).toEqual({
      sessions: 12,
      errors: 465,
    });
    expect(second.status.refused["status-unchanged-since-the-backup"]).toEqual({
      sessions: 2,
      errors: 0,
    });
    // The ingest-written rows are still held back, for the same named reason.
    expect(second.counts.refused["row-written-by-ingest-since-the-backup"]).toEqual({
      sessions: 1,
      errors: 0,
    });
  });

  it("stops at the compare-and-set when a row moves between the read and the write", () => {
    // A batch reads its whole page, then settles the rows one at a time. 'u-forward' sorts before
    // 'u-pruned', so this trigger plays the part of an ingest write landing mid-batch: by the time
    // u-pruned is written its updated_at no longer matches what the page read.
    live.handle.exec(
      `CREATE TRIGGER ingest_lands AFTER UPDATE OF error_count ON app_sessions
       WHEN NEW.session_id = 'u-forward'
       BEGIN
         UPDATE app_sessions SET updated_at = '2026-09-14T12:30:00.000Z'
         WHERE session_id = 'u-pruned';
       END`,
    );

    const result = run({ apply: true });

    expect(result.counts.restored).toBe(4);
    expect(result.counts.refused["row-changed-between-the-read-and-the-write"]).toEqual({
      sessions: 1,
      errors: 0,
    });
    // Not restored, and not silently reported as an ingest write either.
    expect(errorCounts()["u-pruned"]).toBe(0);
    expect(errorCounts()["u-forward"]).toBe(300);
    expect(result.counts.sumAfter).toBe(443);
    expect(result.counts.sumAfterObserved).toBe(443);
  });

  it("rejects a batch size that is not a positive integer", () => {
    expect(() => run({ batchSize: 0 })).toThrow(/positive integer/);
    expect(() => run({ batchSize: 1.5 })).toThrow(/positive integer/);
  });
});

describe("the ingest discriminator", () => {
  // recompute-session-error-counts.mjs never bumps updated_at; every ingest write sets it.
  it("passes a row whose updated_at has not moved since the backup", () => {
    expect(ingestWriteSince("2026-09-13T15:52:55.167Z", "2026-09-13T15:52:55.167Z")).toBeNull();
  });

  it("refuses a row whose updated_at has moved, in either direction", () => {
    expect(ingestWriteSince("2026-09-14T09:00:00.000Z", "2026-09-13T15:52:55.167Z")).toBe(
      "row-written-by-ingest-since-the-backup",
    );
    expect(ingestWriteSince("2026-09-12T09:00:00.000Z", "2026-09-13T15:52:55.167Z")).toBe(
      "row-written-by-ingest-since-the-backup",
    );
  });

  it("refuses rather than treating two missing values as equal", () => {
    expect(ingestWriteSince(null, null)).toBe("row-has-no-updated-at-to-compare");
    expect(ingestWriteSince(null, "2026-09-13T15:52:55.167Z")).toBe(
      "row-has-no-updated-at-to-compare",
    );
    expect(ingestWriteSince("2026-09-13T15:52:55.167Z", null)).toBe(
      "row-has-no-updated-at-to-compare",
    );
  });
});

describe("restore-session-error-counts CLI", () => {
  const openBoth = (liveReadonly: boolean) => (file: string, options: { readonly: boolean }) => {
    if (file === "/backups/pre-run.sqlite") {
      // The backup is opened read-only whatever the mode: this script never writes to it.
      expect(options.readonly).toBe(true);
      return backup.handle;
    }
    expect(options.readonly).toBe(liveReadonly);
    return live.handle;
  };

  it("dry-runs read-only and prints both sides of the split", () => {
    const lines: string[] = [];

    const result = main(["--db", "/data/db/rr.sqlite", "--backup", "/backups/pre-run.sqlite"], {
      log: (line) => lines.push(line),
      now: NOW,
      openDatabase: openBoth(true),
    });

    expect(result?.counts.restored).toBe(5);
    expect(lines[0]).toBe("restore-session-error-counts (dry run, nothing written)");
    expect(lines).toContain("  live database:       /data/db/rr.sqlite");
    expect(lines).toContain("  backup (read-only):  /backups/pre-run.sqlite");
    // The same one-line rule the recompute script prints, from the same constant.
    expect(lines).toContain(`  coverage proof:      ${COVERAGE_PROOF}`);
    expect(COVERAGE_PROOF).toContain("10-minute prelude");
    expect(lines).toContain(
      "  RESTORED — the strict rule CANNOT prove these rows, so the pre-run value goes back",
    );
    expect(lines).toContain(
      "    error_count would restore:            5 sessions, +462 error_count",
    );
    expect(lines).toContain(
      "    error_count would keep:            3 sessions, 907 error_count stays dropped",
    );
    expect(lines).toContain(
      "  HELD BACK — the strict rule cannot prove these either, but INGEST wrote them since the backup",
    );
    expect(lines).toContain(
      "    error_count left as it stands:  1 session, 77 error_count NOT handed back",
    );
    expect(lines).toContain("    last_status/last_event left:    1 session");
    expect(lines).toContain("  error_count sum, all sessions:    21 -> 483 (projected)");
    expect(lines.some((line) => line.includes("re-read after the write"))).toBe(false);
    expect(errorCounts()["u-forward"]).toBe(0);
    // Written for the report: the exact output on this test database.
    console.log(lines.join("\n"));
  });

  it("opens the live database writable for --apply", () => {
    const lines: string[] = [];

    const result = main(
      ["--apply", "--db", "/data/db/rr.sqlite", "--backup", "/backups/pre-run.sqlite"],
      { log: (line) => lines.push(line), now: NOW, openDatabase: openBoth(false) },
    );

    expect(result?.dryRun).toBe(false);
    expect(lines[0]).toBe("restore-session-error-counts");
    expect(errorCounts()["u-forward"]).toBe(300);
    expect(errorCounts()["p-proven"]).toBe(0);
    // The value it wrote, read back out of the database rather than projected.
    expect(lines).toContain("  error_count sum, all sessions:    21 -> 483");
    expect(lines).toContain("  error_count sum, re-read after the write: 483");
    console.log(lines.join("\n"));
  });

  it("insists on a backup, refuses the live file as its own backup, and prints usage", () => {
    const lines: string[] = [];
    expect(main(["--help"], { log: (line) => lines.push(line) })).toBeNull();
    expect(lines[0]).toContain("usage: node restore-session-error-counts.mjs");
    expect(() => main(["--db", "/data/db/rr.sqlite"], { log: () => {} })).toThrow(/no backup/);
    expect(() => main(["--backup", "/b.sqlite"], { log: () => {}, env: {} })).toThrow(
      /no database/,
    );
    expect(() =>
      main(["--db", "/data/rr.sqlite", "--backup", "/data/rr.sqlite"], { log: () => {} }),
    ).toThrow(/same file/);
    expect(() => main(["--nope"], { log: () => {} })).toThrow(/unknown argument: --nope/);
  });
});
