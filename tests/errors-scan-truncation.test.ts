import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadErrorsByUser, parseErrorsRange } from "../functions/_lib/errors";
import {
  backgroundFault,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "./helpers/telemetry-db";

// Mirrors EVENT_SCAN_LIMIT in functions/_lib/errors.ts.
const SCAN_LIMIT = 4000;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const range24h = parseErrorsRange(new URL("http://panel.test/?range=24h"));

let db: TelemetryTestDb;

beforeEach(() => {
  db = createTelemetryTestDb();
});

afterEach(() => {
  db.close();
});

function realErrors(count: number, spacingMs: number) {
  return Array.from({ length: count }, (_, index) =>
    realError(ago((index + 1) * spacingMs), {
      hwid: `HW-${index % 10}`,
      session_id: `s-${index % 10}`,
    }),
  );
}

function backgroundLoop(count: number, spacingMs: number) {
  return Array.from({ length: count }, (_, index) =>
    backgroundFault(ago((index + 1) * spacingMs), {
      base_exception_type: "System.NullReferenceException",
      hwid: "HW-LOOP",
      session_id: "s-loop",
      app_version: "1.4.8.11",
    }),
  );
}

describe("errors payload: real-error scan limit", () => {
  it("flags scanTruncated once the range holds more real errors than one scan reads", async () => {
    db.insertEvents(realErrors(SCAN_LIMIT + 1, 10_000));

    const payload = await loadErrorsByUser(db.env, range24h);

    expect(payload.scanTruncated).toBe(true);
    expect(payload.totals.errors).toBe(SCAN_LIMIT);
    expect(payload.users.reduce((sum, user) => sum + user.errorCount, 0)).toBe(SCAN_LIMIT);
  }, 30_000);

  it("does not let newer background faults fill the scan window", async () => {
    // 6000 background rows, all newer than most of the 4000 real ones: with background in the
    // scan, the newest 4000 rows would have been nearly all background and scanTruncated true.
    db.insertEvents([...realErrors(SCAN_LIMIT, 10_000), ...backgroundLoop(6000, 1_000)]);

    const payload = await loadErrorsByUser(db.env, range24h);

    expect(payload.scanTruncated).toBe(false);
    expect(payload.totals.errors).toBe(SCAN_LIMIT);
    // The aggregate is not subject to the scan limit.
    expect(payload.totals.backgroundErrors).toBe(6000);
    expect(payload.backgroundFaults).toHaveLength(1);
    expect(payload.backgroundFaults[0].events).toBe(6000);
  }, 30_000);

  it("still finds a real error that is older than thousands of background faults", async () => {
    db.insertEvents([
      realError(ago(5 * 60 * 60 * 1000), { hwid: "HW-REAL", session_id: "s-real" }),
      ...backgroundLoop(4500, 500),
    ]);

    const payload = await loadErrorsByUser(db.env, range24h);

    expect(payload.scanTruncated).toBe(false);
    expect(payload.users.map((user) => user.identity)).toEqual(["HW-REAL"]);
    expect(payload.totals.errors).toBe(1);
  }, 30_000);
});
