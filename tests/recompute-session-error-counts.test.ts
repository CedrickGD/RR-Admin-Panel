import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  main,
  parseArgs,
  recomputeSessionErrorCounts,
} from "../deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs";
import {
  backgroundFault,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "./helpers/telemetry-db";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date("2026-09-13T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

let db: TelemetryTestDb;

afterEach(() => {
  db.close();
});

interface SessionRow {
  startedAt: string;
  errorCount?: number;
  updatedAt?: string;
  appVersion?: string;
  lastEvent?: string;
  lastStatus?: "ok" | "degraded" | "down";
  isActive?: boolean;
  endedAt?: string | null;
}

function insertSession(sessionId: string, row: SessionRow) {
  db.handle
    .prepare(
      `INSERT INTO app_sessions (session_id, install_id, hwid, source, app_version, started_at,
                                 last_seen_at, ended_at, is_active, last_event, last_status,
                                 error_count, updated_at)
       VALUES (?, ?, ?, 'desktop-app', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      `inst-${sessionId}`,
      `HW-${sessionId}`,
      row.appVersion ?? "1.5.2",
      row.startedAt,
      row.updatedAt ?? row.startedAt,
      row.endedAt ?? null,
      row.isActive ? 1 : 0,
      row.lastEvent ?? "session_end",
      row.lastStatus ?? "ok",
      row.errorCount ?? 0,
      row.updatedAt ?? row.startedAt,
    );
}

function errorCounts(): Record<string, number> {
  const rows = db.handle
    .prepare(`SELECT session_id, error_count FROM app_sessions ORDER BY session_id`)
    .all() as Array<{ session_id: string; error_count: number }>;
  return Object.fromEntries(rows.map((row) => [row.session_id, row.error_count]));
}

function sessionState(sessionId: string): { lastStatus: string; lastEvent: string } {
  const row = db.handle
    .prepare(`SELECT last_status, last_event FROM app_sessions WHERE session_id = ?`)
    .get(sessionId) as { last_status: string; last_event: string };
  return { lastStatus: row.last_status, lastEvent: row.last_event };
}

/** The session's own start event — the only coverage proof the script accepts. */
const startEvent = (sessionId: string, msAgo: number) => ({
  service: "session_start",
  status: "ok" as const,
  ts: ago(msAgo),
  metrics: { session_id: sessionId },
});

const loop = (sessionId: string, count: number, startMsAgo: number) =>
  Array.from({ length: count }, (_, index) =>
    backgroundFault(ago(startMsAgo - index * 1000), {
      base_exception_type: "System.NullReferenceException",
      session_id: sessionId,
    }),
  );

/**
 * The coverage test the FIRST production run used, reproduced here so the tests can show which
 * rows it would have written. It is not a proof: pruned history is not in the table to be found.
 */
function passesTheOldWeakerRule(sessionId: string, startedAt: string, floor: string): boolean {
  if (sessionId.startsWith("install:")) return false;
  if (startedAt < floor) return false;
  const oldest = db.handle
    .prepare(
      `SELECT MIN(ts) AS ts FROM telemetry_events
       WHERE TRIM(CAST(json_extract(metrics_json, '$.session_id') AS TEXT)) = ?`,
    )
    .get(sessionId) as { ts: string | null };
  return oldest.ts === null || oldest.ts >= startedAt;
}

describe("recompute-session-error-counts, the strict coverage rule", () => {
  beforeEach(() => {
    db = createTelemetryTestDb();
    // An unattributed event three days back: it sets the retention floor and nothing else.
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);

    // --- PROVEN: their own session_start is still retained ------------------------------------
    // Background noise only.
    insertSession("s-proven-bg", {
      startedAt: ago(2 * DAY),
      errorCount: 267,
      updatedAt: ago(1 * DAY),
    });
    db.insertEvents([
      startEvent("s-proven-bg", 2 * DAY),
      ...loop("s-proven-bg", 267, 2 * DAY - MINUTE),
    ]);
    // Two real errors plus three background faults; the second id carries stray whitespace.
    insertSession("s-proven-mixed", {
      startedAt: ago(2 * DAY),
      errorCount: 5,
      updatedAt: ago(1 * DAY),
    });
    db.insertEvents([
      startEvent("s-proven-mixed", 2 * DAY),
      realError(ago(2 * DAY - 10 * MINUTE), { session_id: "s-proven-mixed" }),
      realError(ago(2 * DAY - 20 * MINUTE), { session_id: " s-proven-mixed " }),
      ...loop("s-proven-mixed", 3, 2 * DAY - 30 * MINUTE),
    ]);
    // Already right.
    insertSession("s-proven-ok", { startedAt: ago(1 * DAY), errorCount: 1 });
    db.insertEvents([
      startEvent("s-proven-ok", 1 * DAY),
      realError(ago(1 * DAY - MINUTE), { session_id: "s-proven-ok" }),
    ]);
    // No errors at all.
    insertSession("s-none", { startedAt: ago(60 * MINUTE) });
    db.insertEvents([startEvent("s-none", 60 * MINUTE)]);
    // Proven, but a new event landed while the run was going: skipped, not overwritten.
    insertSession("s-busy", {
      startedAt: ago(1 * DAY),
      errorCount: 10,
      updatedAt: new Date(NOW.getTime() + MINUTE).toISOString(),
    });
    db.insertEvents([startEvent("s-busy", 1 * DAY), ...loop("s-busy", 10, 1 * DAY - MINUTE)]);

    // --- UNKNOWN HISTORY: the regression the strict rule exists to prevent ---------------------
    // started_at was rewritten forward by a session_start that has since been pruned, together
    // with the real errors that produced the stored 300. Everything still retained for it is
    // background noise, and every retained event is NEWER than started_at — so the old rule saw
    // a young, fully covered session and would have zeroed a count that recorded real crashes.
    insertSession("s-forward-start", {
      startedAt: ago(2 * DAY),
      errorCount: 300,
      updatedAt: ago(1 * DAY),
    });
    db.insertEvents(loop("s-forward-start", 4, 1 * DAY));
    // Retained events predate its oldest retained session_start: it was already running before
    // that start, so an earlier start and its errors may be gone.
    insertSession("s-events-precede-start", { startedAt: ago(1 * DAY), errorCount: 7 });
    db.insertEvents([
      ...loop("s-events-precede-start", 2, 2 * DAY),
      startEvent("s-events-precede-start", 1 * DAY),
    ]);
    // Would be covered but for its id: one row for the whole life of an install.
    insertSession("install:abc", { startedAt: ago(1 * DAY), errorCount: 12 });
    db.insertEvents([
      startEvent("install:abc", 1 * DAY),
      ...loop("install:abc", 4, 1 * DAY - MINUTE),
    ]);
    // Nothing of it survives.
    insertSession("s-no-events", { startedAt: ago(200 * DAY), errorCount: 40 });

    // --- status-repair subjects ---------------------------------------------------------------
    // Ended on a real error: "down" is genuine.
    insertSession("a-down-real", {
      startedAt: ago(1 * DAY),
      errorCount: 1,
      endedAt: ago(1 * DAY - 2 * MINUTE),
      lastEvent: "app_error",
      lastStatus: "down",
    });
    db.insertEvents([
      startEvent("a-down-real", 1 * DAY),
      realError(ago(1 * DAY - MINUTE), { session_id: "a-down-real" }),
    ]);
    // Ended on a background fault, with its earlier events still retained.
    insertSession("a-down-bg", {
      startedAt: ago(2 * DAY),
      errorCount: 2,
      endedAt: ago(1 * DAY),
      lastEvent: "app_error",
      lastStatus: "down",
    });
    db.insertEvents([startEvent("a-down-bg", 2 * DAY), ...loop("a-down-bg", 2, 1 * DAY)]);
    // Ended on a background fault whose evidence is long gone.
    insertSession("a-down-pruned", {
      startedAt: ago(150 * DAY),
      endedAt: ago(149 * DAY),
      lastEvent: "app_error",
      lastStatus: "down",
    });
  });

  it("refuses the rewritten-started_at session the old rule would have zeroed", () => {
    const floor = ago(3 * DAY);
    // The old rule's three conditions all hold for this row — that is exactly the bug.
    expect(passesTheOldWeakerRule("s-forward-start", ago(2 * DAY), floor)).toBe(true);

    const result = recomputeSessionErrorCounts(db.handle, { apply: true, now: NOW });

    expect(result.counts.refused["no-retained-session-start"]).toEqual({
      sessions: 1,
      errors: 300,
    });
    // The count that recorded real crashes is still there.
    expect(errorCounts()["s-forward-start"]).toBe(300);
  });

  it("only writes sessions whose own session_start is retained, and is idempotent", () => {
    const first = recomputeSessionErrorCounts(db.handle, { apply: true, now: NOW, batchSize: 2 });

    expect(first.retentionFloor).toBe(ago(3 * DAY));
    expect(first.sessionsTotal).toBe(12);
    expect(first.sessionsScanned).toBe(12);
    expect(first.sessionsProven).toBe(7);
    expect(first.sessionsUnknownHistory).toBe(5);
    expect(first.counts.changed).toBe(3);
    expect(first.counts.refused).toEqual({
      "no-retained-session-start": { sessions: 1, errors: 300 },
      "events-precede-the-retained-start": { sessions: 1, errors: 7 },
      "legacy-install-id": { sessions: 1, errors: 12 },
      "no-retained-events": { sessions: 2, errors: 40 },
      "updated-during-the-run": { sessions: 1, errors: 10 },
    });
    expect(first.counts.errorsOnUnknownHistory).toBe(359);
    expect(first.counts.sessionsWithErrorsOnUnknownHistory).toBe(4);
    expect(first.counts.sumBefore).toBe(645);
    expect(first.counts.sumAfter).toBe(373);
    expect(errorCounts()).toEqual({
      "a-down-bg": 0,
      "a-down-pruned": 0,
      "a-down-real": 1,
      "install:abc": 12,
      "s-busy": 10,
      "s-events-precede-start": 7,
      "s-forward-start": 300,
      "s-no-events": 40,
      "s-none": 0,
      "s-proven-bg": 0,
      "s-proven-mixed": 2,
      "s-proven-ok": 1,
    });

    const second = recomputeSessionErrorCounts(db.handle, { apply: true, now: NOW, batchSize: 1 });
    expect(second.counts.changed).toBe(0);
    expect(second.counts.sumBefore).toBe(second.counts.sumAfter);
    expect(errorCounts()["s-proven-mixed"]).toBe(2);
  });

  it("defaults to a dry run: reports the same changes without writing", () => {
    const before = errorCounts();

    const result = recomputeSessionErrorCounts(db.handle, { now: NOW });

    expect(result.dryRun).toBe(true);
    expect(result.counts.changed).toBe(3);
    expect(result.counts.sumAfter).toBe(373);
    expect(errorCounts()).toEqual(before);
  });

  it("repairs a status only from a retained non-background event", () => {
    const result = recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairStatus: true,
      now: NOW,
      batchSize: 3,
    });

    expect(result.status.candidates).toBe(3);
    expect(result.status.changed).toBe(1);
    expect(result.status.refused).toEqual({
      "newest-retained-event-is-not-a-background-fault": { sessions: 1, errors: 0 },
      "no-retained-events": { sessions: 1, errors: 0 },
    });
    // Repaired from its own retained session_start.
    expect(sessionState("a-down-bg")).toEqual({ lastStatus: "ok", lastEvent: "session_start" });
    // A genuine crash, and a row with nothing left to read: both keep their stored state.
    expect(sessionState("a-down-real")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
    expect(sessionState("a-down-pruned")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
  });

  it("counts the stale statuses it would repair when --repair-status is off", () => {
    const result = recomputeSessionErrorCounts(db.handle, { now: NOW });

    expect(result.status.candidates).toBe(3);
    expect(result.status.refused).toEqual({
      "repair-status-not-enabled": { sessions: 3, errors: 0 },
    });
  });

  it("never touches a session that is still active", () => {
    insertSession("a-live", {
      startedAt: ago(30 * MINUTE),
      isActive: true,
      lastEvent: "app_error",
      lastStatus: "down",
    });
    db.insertEvents([startEvent("a-live", 30 * MINUTE), ...loop("a-live", 1, 20 * MINUTE)]);

    const result = recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairStatus: true,
      now: NOW,
    });

    expect(result.status.refused["session-still-active"]).toEqual({ sessions: 1, errors: 0 });
    expect(sessionState("a-live")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
  });

  it("never lowers the floor below the 90-day retention cutoff", () => {
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(400 * DAY), metrics: {} }]);

    const result = recomputeSessionErrorCounts(db.handle, { now: NOW });

    expect(result.retentionFloor).toBe(ago(90 * DAY));
    // The floor is reporting only: coverage is decided by the retained session_start, so the
    // classification does not move with it.
    expect(result.sessionsProven).toBe(7);
    expect(result.counts.changed).toBe(3);
  });
});

describe("recompute-session-error-counts, a background-only retained window", () => {
  beforeEach(() => {
    db = createTelemetryTestDb();
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);

    // Every retained app_error in this database is a background fault and there is plenty of it:
    // that was the "premise" the previous revision used to clear rows whose own history is gone.
    insertSession("b-pruned-1", {
      startedAt: ago(200 * DAY),
      errorCount: 8,
      appVersion: "1.4.1.4",
    });
    insertSession("b-pruned-2", { startedAt: ago(150 * DAY), errorCount: 300 });
    insertSession("b-pruned-status", {
      startedAt: ago(150 * DAY),
      errorCount: 5,
      endedAt: ago(149 * DAY),
      lastEvent: "app_error",
      lastStatus: "down",
    });
    insertSession("b-live", { startedAt: ago(1 * DAY), errorCount: 40 });
    db.insertEvents([startEvent("b-live", 1 * DAY), ...loop("b-live", 40, 1 * DAY - MINUTE)]);
  });

  it("clears nothing on a deployment-wide or version-wide premise", () => {
    const result = recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairStatus: true,
      now: NOW,
    });

    // Only the row whose own start is retained is written; the premise buys nothing.
    expect(result.counts.changed).toBe(1);
    expect(result.counts.refused).toEqual({
      "no-retained-events": { sessions: 3, errors: 313 },
    });
    expect(result.counts.sumBefore).toBe(353);
    expect(result.counts.sumAfter).toBe(313);
    expect(errorCounts()).toEqual({
      "b-live": 0,
      "b-pruned-1": 8,
      "b-pruned-2": 300,
      "b-pruned-status": 5,
    });
    expect(result.status.changed).toBe(0);
    expect(result.status.refused).toEqual({
      "no-retained-events": { sessions: 1, errors: 0 },
    });
    expect(sessionState("b-pruned-status")).toEqual({
      lastStatus: "down",
      lastEvent: "app_error",
    });
  });

  it("has no flag that re-enables a premise-based write", () => {
    expect(() => parseArgs(["--repair-legacy-counts"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--force"])).toThrow(/unknown argument/);
    expect(parseArgs(["--repair-status", "--apply"])).toEqual({
      apply: true,
      repairStatus: true,
      dbPath: null,
      batchSize: 200,
      help: false,
    });
  });
});

describe("recompute-session-error-counts CLI", () => {
  beforeEach(() => {
    db = createTelemetryTestDb();
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);
    insertSession("s-proven-bg", {
      startedAt: ago(2 * DAY),
      errorCount: 267,
      updatedAt: ago(1 * DAY),
    });
    db.insertEvents([
      startEvent("s-proven-bg", 2 * DAY),
      ...loop("s-proven-bg", 267, 2 * DAY - MINUTE),
    ]);
    insertSession("s-forward-start", { startedAt: ago(2 * DAY), errorCount: 40 });
    db.insertEvents(loop("s-forward-start", 2, 1 * DAY));
    insertSession("s-down", {
      startedAt: ago(2 * DAY),
      endedAt: ago(1 * DAY),
      lastEvent: "app_error",
      lastStatus: "down",
    });
    db.insertEvents([startEvent("s-down", 2 * DAY), ...loop("s-down", 1, 1 * DAY)]);
  });

  it("opens the database read-only and prints the dry-run report", () => {
    const lines: string[] = [];

    const result = main(["--db", "/data/db/rr.sqlite"], {
      log: (line) => lines.push(line),
      now: NOW,
      openDatabase: (_path, options) => {
        expect(options.readonly).toBe(true);
        return db.handle;
      },
    });

    expect(result?.counts.changed).toBe(1);
    expect(lines[0]).toBe("recompute-session-error-counts (dry run, nothing written)");
    expect(lines).toContain("  database:            /data/db/rr.sqlite");
    expect(lines).toContain(
      "  coverage proof:      the session's own session_start event must still be retained",
    );
    expect(lines).toContain("  PROVEN  — history fully retained, safe to rewrite: 2 sessions");
    expect(lines).toContain("  UNKNOWN HISTORY — evidence pruned, NOTHING written: 1 session");
    expect(lines).toContain(
      "      no-retained-session-start: 1 session, 40 error_count left standing",
    );
    expect(lines).toContain("  error_count sum, all sessions:    307 -> 40");
    // Written for the report: the exact output on this test database.
    console.log(lines.join("\n"));
  });

  it("opens the database writable for --apply and repairs the status it can prove", () => {
    const lines: string[] = [];

    const result = main(["--apply", "--repair-status", "--db", "/data/db/rr.sqlite"], {
      log: (line) => lines.push(line),
      now: NOW,
      openDatabase: (_path, options) => {
        expect(options.readonly).toBe(false);
        return db.handle;
      },
    });

    expect(result?.dryRun).toBe(false);
    expect(result?.counts.sumAfter).toBe(40);
    expect(result?.status.changed).toBe(1);
    expect(lines[0]).toBe("recompute-session-error-counts");
    expect(lines).toContain("  status repair:       on (from retained non-background events only)");
    expect(sessionState("s-down")).toEqual({ lastStatus: "ok", lastEvent: "session_start" });
    expect(errorCounts()["s-forward-start"]).toBe(40);
    console.log(lines.join("\n"));
  });

  it("prints usage for --help and rejects an unknown argument and a missing database", () => {
    const lines: string[] = [];
    expect(main(["--help"], { log: (line) => lines.push(line) })).toBeNull();
    expect(lines[0]).toContain("usage: node recompute-session-error-counts.mjs");
    expect(lines.join("\n")).toContain("session_start event is still retained");
    expect(() => main(["--nope"], { log: () => {} })).toThrow(/unknown argument: --nope/);
    expect(() => main([], { log: () => {}, env: {} })).toThrow(/no database/);
  });
});
