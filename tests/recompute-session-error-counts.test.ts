import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  main,
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

const loop = (sessionId: string, count: number, startMsAgo: number) =>
  Array.from({ length: count }, (_, index) =>
    backgroundFault(ago(startMsAgo - index * 1000), {
      base_exception_type: "System.NullReferenceException",
      session_id: sessionId,
    }),
  );

afterEach(() => {
  db.close();
});

describe("recompute-session-error-counts, a history that still holds real errors", () => {
  beforeEach(() => {
    db = createTelemetryTestDb();
    // Retained history starts 3 days ago: that is the retention floor.
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);

    // Only background faults, counted by the old ingest.
    insertSession("s-bg", { startedAt: ago(2 * DAY), errorCount: 267, updatedAt: ago(1 * DAY) });
    db.insertEvents(loop("s-bg", 267, 2 * DAY - MINUTE));
    // Two real errors plus three background faults.
    insertSession("s-mixed", { startedAt: ago(2 * DAY), errorCount: 5, updatedAt: ago(1 * DAY) });
    db.insertEvents([
      realError(ago(2 * DAY - 10 * MINUTE), { session_id: "s-mixed" }),
      realError(ago(2 * DAY - 20 * MINUTE), { session_id: " s-mixed " }),
      ...loop("s-mixed", 3, 2 * DAY - 30 * MINUTE),
    ]);
    // Already right.
    insertSession("s-ok", { startedAt: ago(1 * DAY), errorCount: 1 });
    db.insertEvents([realError(ago(1 * DAY - MINUTE), { session_id: "s-ok" })]);
    // Started before the retained history: its events are gone, the stored count stays.
    insertSession("s-old", { startedAt: ago(200 * DAY), errorCount: 40 });
    // Pre-floor, and real errors of its own are retained: the stored count is the larger record.
    insertSession("s-old-real", { startedAt: ago(100 * DAY), errorCount: 9 });
    db.insertEvents([
      realError(ago(2 * DAY), { session_id: "s-old-real" }),
      realError(ago(2 * DAY - MINUTE), { session_id: "s-old-real" }),
    ]);
    // Updated after the run started (a new event arrived): skipped, not overwritten.
    insertSession("s-busy", {
      startedAt: ago(1 * DAY),
      errorCount: 10,
      updatedAt: new Date(NOW.getTime() + MINUTE).toISOString(),
    });
    db.insertEvents(loop("s-busy", 10, 1 * DAY - MINUTE));
    // No errors at all.
    insertSession("s-none", { startedAt: ago(60 * MINUTE) });
    // Legacy pseudo-session: one row for the whole life of an install, so started_at says nothing
    // about when its counted errors happened, even though it sits inside the retention window.
    insertSession("install:abc", { startedAt: ago(1 * DAY), errorCount: 12 });
    db.insertEvents(loop("install:abc", 4, 1 * DAY - MINUTE));
    // started_at was rewritten forward by a later session_start: retained evidence predates it.
    insertSession("s-rewritten", { startedAt: ago(1 * DAY), errorCount: 7 });
    db.insertEvents(loop("s-rewritten", 2, 2 * DAY));
    // Ended on a real error: "down" is genuine.
    insertSession("a-down-real", {
      startedAt: ago(1 * DAY),
      errorCount: 1,
      endedAt: ago(1 * DAY - 2 * MINUTE),
      lastEvent: "app_error",
      lastStatus: "down",
    });
    db.insertEvents([realError(ago(1 * DAY - MINUTE), { session_id: "a-down-real" })]);
    // Ended "down", nothing of it retained: unprovable while real errors exist in the window.
    insertSession("a-down-pruned", {
      startedAt: ago(100 * DAY),
      endedAt: ago(100 * DAY - MINUTE),
      lastEvent: "app_error",
      lastStatus: "down",
    });
  });

  it("defaults to a dry run: reports the changes and sums without writing", () => {
    const before = errorCounts();

    const result = recomputeSessionErrorCounts(db.handle, { now: NOW });

    expect(result.dryRun).toBe(true);
    expect(result.retentionFloor).toBe(ago(3 * DAY));
    expect(result.sessionsTotal).toBe(11);
    expect(result.sessionsScanned).toBe(11);
    expect(result.sessionsOutsideRetention).toBe(3);
    expect(result.premise).toEqual({
      retainedAppErrors: 292,
      retainedRealErrors: 6,
      proven: false,
      provenVersions: 0,
    });
    expect(result.counts.changed).toBe(2);
    expect(result.counts.changedFromRetainedHistory).toBe(2);
    expect(result.counts.sumBefore).toBe(352);
    expect(result.counts.sumAfter).toBe(82);
    expect(errorCounts()).toEqual(before);
  });

  it("recomputes only what the retained history proves, and is idempotent", () => {
    const first = recomputeSessionErrorCounts(db.handle, { apply: true, now: NOW, batchSize: 2 });

    expect(first.counts.changed).toBe(2);
    expect(first.counts.refused).toEqual({
      "started-before-retention-floor": { sessions: 2, errors: 49 },
      "legacy-install-id": { sessions: 1, errors: 12 },
      "started-at-rewritten-forward": { sessions: 1, errors: 7 },
      "updated-during-the-run": { sessions: 1, errors: 10 },
    });
    expect(errorCounts()).toEqual({
      "a-down-pruned": 0,
      "a-down-real": 1,
      "install:abc": 12,
      "s-bg": 0,
      "s-busy": 10,
      "s-mixed": 2,
      "s-none": 0,
      "s-ok": 1,
      "s-old": 40,
      "s-old-real": 9,
      "s-rewritten": 7,
    });

    const second = recomputeSessionErrorCounts(db.handle, { apply: true, now: NOW, batchSize: 1 });
    expect(second.counts.changed).toBe(0);
    expect(second.counts.sumBefore).toBe(second.counts.sumAfter);
    expect(errorCounts()["s-mixed"]).toBe(2);
  });

  it("refuses every legacy repair while the retained window holds a real error", () => {
    const result = recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairLegacyCounts: true,
      repairStatus: true,
      now: NOW,
    });

    expect(result.premise.proven).toBe(false);
    expect(result.counts.changedFromVersionPremise).toBe(0);
    expect(result.counts.changedFromDeploymentPremise).toBe(0);
    expect(result.counts.refused).toEqual({
      // s-old-real keeps its larger count: only part of its errors is still retained.
      "retained-real-errors": { sessions: 1, errors: 9 },
      "retained-history-has-real-errors": { sessions: 3, errors: 59 },
      "updated-during-the-run": { sessions: 1, errors: 10 },
    });
    expect(result.status.changed).toBe(0);
    expect(result.status.refused).toEqual({
      "newest-retained-event-is-not-a-background-fault": { sessions: 1, errors: 0 },
      "retained-history-has-real-errors": { sessions: 1, errors: 0 },
    });
    expect(sessionState("a-down-real")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
    expect(sessionState("a-down-pruned")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
    expect(errorCounts()["s-old"]).toBe(40);
    expect(errorCounts()["install:abc"]).toBe(12);
  });

  it("counts the stale statuses it would repair when --repair-status is off", () => {
    const result = recomputeSessionErrorCounts(db.handle, { now: NOW });

    expect(result.status.candidates).toBe(2);
    expect(result.status.refused).toEqual({
      "repair-status-not-enabled": { sessions: 2, errors: 0 },
    });
  });
});

describe("recompute-session-error-counts, a background-only history", () => {
  beforeEach(() => {
    db = createTelemetryTestDb();
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);

    // Pre-floor, on a version without retained app_error evidence of its own.
    insertSession("b-pre-1", {
      startedAt: ago(200 * DAY),
      errorCount: 8,
      appVersion: "1.4.1.4",
    });
    // Pre-floor, on a version whose own retained history is background-only.
    insertSession("b-pre-2", { startedAt: ago(150 * DAY), errorCount: 300 });
    // Legacy pseudo-session inside the window.
    insertSession("install:xyz", { startedAt: ago(1 * DAY), errorCount: 12 });
    db.insertEvents(loop("install:xyz", 3, 1 * DAY - MINUTE));
    // Fully retained.
    insertSession("b-live", { startedAt: ago(1 * DAY), errorCount: 40 });
    db.insertEvents(loop("b-live", 40, 1 * DAY - MINUTE));
    // Ended on a background fault, with its earlier events still retained.
    insertSession("b-down", {
      startedAt: ago(2 * DAY),
      errorCount: 2,
      endedAt: ago(1 * DAY),
      lastEvent: "app_error",
      lastStatus: "down",
    });
    db.insertEvents([
      {
        service: "session_start",
        status: "ok",
        ts: ago(2 * DAY),
        metrics: { session_id: "b-down" },
      },
      ...loop("b-down", 2, 1 * DAY),
    ]);
    // Ended on a background fault whose evidence is long gone.
    insertSession("b-down-pruned", {
      startedAt: ago(150 * DAY),
      errorCount: 5,
      endedAt: ago(149 * DAY),
      appVersion: "1.4.1.4",
      lastEvent: "app_error",
      lastStatus: "down",
    });
    // Still running: ingest itself will set its next status.
    insertSession("b-down-active", {
      startedAt: ago(30 * MINUTE),
      isActive: true,
      lastEvent: "app_error",
      lastStatus: "down",
    });
    db.insertEvents(loop("b-down-active", 1, 20 * MINUTE));
  });

  it("clears legacy counts and stale statuses under the proofs it prints", () => {
    const result = recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairLegacyCounts: true,
      repairStatus: true,
      now: NOW,
      batchSize: 3,
    });

    expect(result.premise).toEqual({
      retainedAppErrors: 46,
      retainedRealErrors: 0,
      proven: true,
      provenVersions: 1,
    });
    expect(result.counts.changed).toBe(6);
    expect(result.counts.changedFromRetainedHistory).toBe(2);
    expect(result.counts.changedFromVersionPremise).toBe(2);
    expect(result.counts.changedFromDeploymentPremise).toBe(2);
    expect(result.counts.refused).toEqual({});
    expect(result.counts.sumBefore).toBe(367);
    expect(result.counts.sumAfter).toBe(0);
    expect(errorCounts()).toEqual({
      "b-down": 0,
      "b-down-active": 0,
      "b-down-pruned": 0,
      "b-live": 0,
      "b-pre-1": 0,
      "b-pre-2": 0,
      "install:xyz": 0,
    });

    expect(result.status.candidates).toBe(3);
    expect(result.status.changed).toBe(2);
    expect(result.status.changedFromRetainedEvent).toBe(1);
    expect(result.status.changedFromPremise).toBe(1);
    expect(result.status.refused).toEqual({
      "session-still-active": { sessions: 1, errors: 0 },
    });
    expect(sessionState("b-down")).toEqual({ lastStatus: "ok", lastEvent: "session_start" });
    expect(sessionState("b-down-pruned")).toEqual({ lastStatus: "ok", lastEvent: "session_end" });
    expect(sessionState("b-down-active")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
  });

  it("writes nothing without apply, and nothing more on a second run", () => {
    const before = errorCounts();
    const dry = recomputeSessionErrorCounts(db.handle, {
      repairLegacyCounts: true,
      repairStatus: true,
      now: NOW,
    });

    expect(dry.counts.changed).toBe(6);
    expect(dry.status.changed).toBe(2);
    expect(errorCounts()).toEqual(before);
    expect(sessionState("b-down")).toEqual({ lastStatus: "down", lastEvent: "app_error" });

    recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairLegacyCounts: true,
      repairStatus: true,
      now: NOW,
    });
    const second = recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairLegacyCounts: true,
      repairStatus: true,
      now: NOW,
    });

    expect(second.counts.changed).toBe(0);
    expect(second.status.changed).toBe(0);
    expect(second.status.candidates).toBe(1);
    expect(second.counts.sumAfter).toBe(0);
  });

  it("never lowers the floor below the 90-day retention cutoff", () => {
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(400 * DAY), metrics: {} }]);

    const result = recomputeSessionErrorCounts(db.handle, { now: NOW });

    expect(result.retentionFloor).toBe(ago(90 * DAY));
    expect(result.sessionsOutsideRetention).toBe(3);
  });
});

describe("recompute-session-error-counts, a window without any app_error evidence", () => {
  beforeEach(() => {
    db = createTelemetryTestDb();
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);
    insertSession("c-pre", { startedAt: ago(120 * DAY), errorCount: 6 });
    insertSession("c-down", {
      startedAt: ago(120 * DAY),
      endedAt: ago(119 * DAY),
      lastEvent: "app_error",
      lastStatus: "down",
    });
  });

  it("refuses to repair anything it cannot prove, and says so", () => {
    const result = recomputeSessionErrorCounts(db.handle, {
      apply: true,
      repairLegacyCounts: true,
      repairStatus: true,
      now: NOW,
    });

    expect(result.premise.proven).toBe(false);
    expect(result.counts.changed).toBe(0);
    expect(result.counts.refused).toEqual({
      "no-retained-evidence": { sessions: 1, errors: 6 },
    });
    expect(result.status.changed).toBe(0);
    expect(result.status.refused).toEqual({
      "no-retained-evidence": { sessions: 1, errors: 0 },
    });
    expect(errorCounts()["c-pre"]).toBe(6);
    expect(sessionState("c-down")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
  });
});

describe("recompute-session-error-counts CLI", () => {
  beforeEach(() => {
    db = createTelemetryTestDb();
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);
    insertSession("s-bg", { startedAt: ago(2 * DAY), errorCount: 267, updatedAt: ago(1 * DAY) });
    db.insertEvents(loop("s-bg", 267, 2 * DAY - MINUTE));
    insertSession("s-old", { startedAt: ago(200 * DAY), errorCount: 40 });
    insertSession("s-down", {
      startedAt: ago(2 * DAY),
      endedAt: ago(1 * DAY),
      lastEvent: "app_error",
      lastStatus: "down",
    });
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
      "  repairs enabled:     none (error_count from retained evidence only)",
    );
    expect(lines).toContain(
      "    refused, started-before-retention-floor: 1 session, 40 error_count still standing",
    );
    expect(lines).toContain("  error_count sum, all sessions:        307 -> 40");
    // Written for the report: the exact output on this test database.
    console.log(lines.join("\n"));
  });

  it("opens the database writable for --apply and reports both repairs", () => {
    const lines: string[] = [];

    const result = main(
      ["--apply", "--repair-legacy-counts", "--repair-status", "--db", "/data/db/rr.sqlite"],
      {
        log: (line) => lines.push(line),
        now: NOW,
        openDatabase: (_path, options) => {
          expect(options.readonly).toBe(false);
          return db.handle;
        },
      },
    );

    expect(result?.dryRun).toBe(false);
    expect(result?.counts.sumAfter).toBe(0);
    expect(result?.status.changed).toBe(1);
    expect(lines[0]).toBe("recompute-session-error-counts");
    expect(lines).toContain("  repairs enabled:     legacy counts, last_status");
    expect(
      lines.some((line) => line.startsWith("  background-only premise: proven: 267 retained")),
    ).toBe(true);
    expect(sessionState("s-down")).toEqual({ lastStatus: "ok", lastEvent: "session_end" });
    console.log(lines.join("\n"));
  });

  it("prints usage for --help and rejects an unknown argument and a missing database", () => {
    const lines: string[] = [];
    expect(main(["--help"], { log: (line) => lines.push(line) })).toBeNull();
    expect(lines[0]).toContain("--apply");
    expect(() => main(["--write"], { log: () => {} })).toThrow("unknown argument: --write");
    expect(() => main([], { log: () => {}, env: {} })).toThrow("no database");
  });
});
