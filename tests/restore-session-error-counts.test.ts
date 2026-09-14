import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
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
const DAY = 24 * 60 * MINUTE;
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
  lastEvent?: string;
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
      row.lastEvent ?? "session_end",
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

function sessionState(sessionId: string): { lastStatus: string; lastEvent: string } {
  const row = live.handle
    .prepare(`SELECT last_status, last_event FROM app_sessions WHERE session_id = ?`)
    .get(sessionId) as { last_status: string; last_event: string };
  return { lastStatus: row.last_status, lastEvent: row.last_event };
}

const startEvent = (sessionId: string, msAgo: number) => ({
  service: "session_start",
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

  // --- rows the restore must not touch ------------------------------------------------------
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
    { lastEvent: "session_end", lastStatus: "ok" },
  );
  // A repair subject the earlier run left alone.
  insertPair(
    "st-untouched",
    { lastEvent: "app_error", lastStatus: "down", startedAt: ago(150 * DAY) },
    { lastEvent: "app_error", lastStatus: "down", startedAt: ago(150 * DAY) },
  );
});

describe("restore-session-error-counts", () => {
  it("restores only what the strict rule cannot prove, and says which is which", () => {
    const result = run({ apply: true, batchSize: 3 });

    expect(result.sessionsLive).toBe(13);
    expect(result.sessionsInBackup).toBe(12);
    expect(result.sessionsScanned).toBe(13);

    expect(result.counts.restored).toBe(3);
    expect(result.counts.errorsRestored).toBe(352);
    expect(result.counts.provenKept).toBe(2);
    expect(result.counts.errorsProvenDropped).toBe(507);
    expect(result.counts.refused).toEqual({
      "count-grew-since-the-backup": { sessions: 1, errors: 9 },
      "count-unchanged-since-the-backup": { sessions: 5, errors: 3 },
      "count-not-attributable-to-the-recompute-run": { sessions: 1, errors: 2 },
      "not-in-the-backup": { sessions: 1, errors: 5 },
    });
    expect(result.counts.sumBefore).toBe(21);
    expect(result.counts.sumAfter).toBe(373);

    expect(errorCounts()).toEqual({
      "install:abc": 12,
      "n-grew": 9,
      "n-new": 5,
      "n-odd": 2,
      "n-same": 3,
      "p-proven": 0,
      "p-proven-real": 2,
      "st-churn": 0,
      "st-proven": 0,
      "st-untouched": 0,
      "st-unproven": 0,
      "u-forward": 300,
      "u-pruned": 40,
    });
  });

  it("restores a status only where no retained event proves the new one", () => {
    const result = run({ apply: true });

    expect(result.status.subjects).toBe(3);
    expect(result.status.restored).toBe(1);
    expect(result.status.provenKept).toBe(1);
    expect(result.status.refused).toEqual({
      "status-unchanged-since-the-backup": { sessions: 1, errors: 0 },
      "status-not-a-recompute-subject-in-the-backup": { sessions: 1, errors: 0 },
    });
    expect(sessionState("st-unproven")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
    expect(sessionState("st-proven")).toEqual({ lastStatus: "ok", lastEvent: "session_start" });
    // Ingest moved this one on after the backup: a stale 'session_active' must not come back.
    expect(sessionState("st-churn")).toEqual({ lastStatus: "ok", lastEvent: "session_end" });
    expect(sessionState("st-untouched")).toEqual({ lastStatus: "down", lastEvent: "app_error" });
  });

  it("writes nothing without apply", () => {
    const before = errorCounts();

    const result = run();

    expect(result.dryRun).toBe(true);
    expect(result.counts.restored).toBe(3);
    expect(result.counts.sumAfter).toBe(373);
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
    expect(second.counts.sumBefore).toBe(373);
    expect(second.counts.sumAfter).toBe(373);
    expect(second.counts.refused["count-unchanged-since-the-backup"]).toEqual({
      sessions: 8,
      errors: 355,
    });
    expect(second.status.refused["status-unchanged-since-the-backup"]).toEqual({
      sessions: 2,
      errors: 0,
    });
  });

  it("leaves a row alone when ingest writes it while the run is going", () => {
    live.handle
      .prepare(`UPDATE app_sessions SET updated_at = ? WHERE session_id = 'u-forward'`)
      .run(new Date(NOW.getTime() + MINUTE).toISOString());

    const result = run({ apply: true });

    expect(result.counts.restored).toBe(2);
    expect(result.counts.refused["updated-during-the-run"]).toEqual({ sessions: 1, errors: 0 });
    expect(errorCounts()["u-forward"]).toBe(0);
  });

  it("rejects a batch size that is not a positive integer", () => {
    expect(() => run({ batchSize: 0 })).toThrow(/positive integer/);
    expect(() => run({ batchSize: 1.5 })).toThrow(/positive integer/);
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

    expect(result?.counts.restored).toBe(3);
    expect(lines[0]).toBe("restore-session-error-counts (dry run, nothing written)");
    expect(lines).toContain("  live database:       /data/db/rr.sqlite");
    expect(lines).toContain("  backup (read-only):  /backups/pre-run.sqlite");
    expect(lines).toContain(
      "  RESTORED — the strict rule CANNOT prove these rows, so the pre-run value goes back",
    );
    expect(lines).toContain(
      "    error_count would restore:            3 sessions, +352 error_count",
    );
    expect(lines).toContain(
      "    error_count would keep:            2 sessions, 507 error_count stays dropped",
    );
    expect(lines).toContain("  error_count sum, all sessions:    21 -> 373");
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
