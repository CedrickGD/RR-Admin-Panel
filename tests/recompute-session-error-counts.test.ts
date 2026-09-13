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

function insertSession(
  sessionId: string,
  startedAt: string,
  errorCount: number,
  updatedAt: string,
) {
  db.handle
    .prepare(
      `INSERT INTO app_sessions (session_id, install_id, hwid, source, started_at, last_seen_at, is_active, last_status, error_count, updated_at)
       VALUES (?, ?, ?, 'desktop-app', ?, ?, 0, 'ok', ?, ?)`,
    )
    .run(
      sessionId,
      `inst-${sessionId}`,
      `HW-${sessionId}`,
      startedAt,
      updatedAt,
      errorCount,
      updatedAt,
    );
}

function errorCounts(): Record<string, number> {
  const rows = db.handle
    .prepare(`SELECT session_id, error_count FROM app_sessions ORDER BY session_id`)
    .all() as Array<{ session_id: string; error_count: number }>;
  return Object.fromEntries(rows.map((row) => [row.session_id, row.error_count]));
}

const loop = (sessionId: string, count: number, startMsAgo: number) =>
  Array.from({ length: count }, (_, index) =>
    backgroundFault(ago(startMsAgo - index * 1000), {
      base_exception_type: "System.NullReferenceException",
      session_id: sessionId,
    }),
  );

beforeEach(() => {
  db = createTelemetryTestDb();
  // Retained history starts 3 days ago.
  db.insertEvents([{ service: "session_start", status: "ok", ts: ago(3 * DAY), metrics: {} }]);

  // Only background faults, counted by the old ingest.
  insertSession("s-bg", ago(2 * DAY), 267, ago(1 * DAY));
  db.insertEvents(loop("s-bg", 267, 2 * DAY - MINUTE));
  // Two real errors plus three background faults.
  insertSession("s-mixed", ago(2 * DAY), 5, ago(1 * DAY));
  db.insertEvents([
    realError(ago(2 * DAY - 10 * MINUTE), { session_id: "s-mixed" }),
    realError(ago(2 * DAY - 20 * MINUTE), { session_id: " s-mixed " }),
    ...loop("s-mixed", 3, 2 * DAY - 30 * MINUTE),
  ]);
  // Already right.
  insertSession("s-ok", ago(1 * DAY), 1, ago(1 * DAY));
  db.insertEvents([realError(ago(1 * DAY - MINUTE), { session_id: "s-ok" })]);
  // Started before the retained history: its events are gone, the stored count stays.
  insertSession("s-old", ago(200 * DAY), 40, ago(199 * DAY));
  // Updated after the run started (a new event arrived): skipped, not overwritten.
  insertSession("s-busy", ago(1 * DAY), 10, new Date(NOW.getTime() + MINUTE).toISOString());
  db.insertEvents(loop("s-busy", 10, 1 * DAY - MINUTE));
  // No errors at all.
  insertSession("s-none", ago(60 * MINUTE), 0, ago(50 * MINUTE));
});

afterEach(() => {
  db.close();
});

describe("recompute-session-error-counts", () => {
  it("dry run reports the changes and sums without writing", () => {
    const before = errorCounts();

    const result = recomputeSessionErrorCounts(db.handle, { dryRun: true, now: NOW });

    expect(result).toEqual({
      dryRun: true,
      runStartedAt: NOW.toISOString(),
      retentionFloor: ago(3 * DAY),
      sessionsTotal: 6,
      sessionsRecomputed: 5,
      sessionsOutsideRetention: 1,
      sessionsChanged: 2,
      sessionsSkippedUpdatedDuringRun: 1,
      errorSumRecomputedBefore: 283,
      errorSumRecomputedAfter: 13,
      errorSumAllBefore: 323,
      errorSumAllAfter: 53,
    });
    expect(errorCounts()).toEqual(before);
  });

  it("sets real-error counts, leaves old and busy sessions alone, and is idempotent", () => {
    const first = recomputeSessionErrorCounts(db.handle, { now: NOW, batchSize: 2 });

    expect(first.sessionsChanged).toBe(2);
    expect(first.sessionsSkippedUpdatedDuringRun).toBe(1);
    expect(errorCounts()).toEqual({
      "s-bg": 0,
      "s-busy": 10,
      "s-mixed": 2,
      "s-none": 0,
      "s-ok": 1,
      "s-old": 40,
    });

    const second = recomputeSessionErrorCounts(db.handle, { now: NOW, batchSize: 1 });
    expect(second.sessionsChanged).toBe(0);
    expect(second.errorSumAllBefore).toBe(second.errorSumAllAfter);
    expect(errorCounts()["s-mixed"]).toBe(2);
  });

  it("never lowers the floor below the 90-day retention cutoff", () => {
    db.insertEvents([{ service: "session_start", status: "ok", ts: ago(400 * DAY), metrics: {} }]);

    const result = recomputeSessionErrorCounts(db.handle, { dryRun: true, now: NOW });

    expect(result.retentionFloor).toBe(ago(90 * DAY));
    expect(result.sessionsOutsideRetention).toBe(1);
  });

  it("prints the dry-run report through the CLI entry", () => {
    const lines: string[] = [];

    const result = main(["--dry-run", "--db", "/data/db/rr.sqlite"], {
      log: (line) => lines.push(line),
      now: NOW,
      openDatabase: (_path, options) => {
        expect(options.readonly).toBe(true);
        return db.handle;
      },
    });

    expect(result?.sessionsChanged).toBe(2);
    expect(lines[0]).toBe("recompute-session-error-counts (dry run, nothing written)");
    expect(lines).toContain("  database:            /data/db/rr.sqlite");
    expect(lines).toContain("  sessions would change: 2");
    expect(lines).toContain("  skipped, updated during the run: 1");
    expect(lines.some((line) => line.startsWith("  error_count sum, recomputed sessions: "))).toBe(
      true,
    );
    // Written for the report: the exact output on this test database.
    console.log(lines.join("\n"));
  });

  it("rejects an unknown argument and a missing database", () => {
    expect(() => main(["--apply"], { log: () => {} })).toThrow("unknown argument: --apply");
    expect(() => main([], { log: () => {}, env: {} })).toThrow("no database");
  });
});
