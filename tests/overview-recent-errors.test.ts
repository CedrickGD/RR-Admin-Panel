import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadStats, parseStatsFilters } from "../functions/_lib/stats";
import { loadSummary } from "../functions/_lib/storage";
import { isOverviewErrorInWindow } from "../src/utils/errorEvents";
import {
  backgroundFault,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "./helpers/telemetry-db";

const HOUR = 3600e3;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let db: TelemetryTestDb;

beforeEach(() => {
  db = createTelemetryTestDb();
  db.insertEvents([
    // Oldest ids first: the real error has the lowest id of the recent rows.
    realError(ago(3 * HOUR), { hwid: "HW-REAL", session_id: "s-real" }),
    realError(ago(30 * HOUR), { hwid: "HW-OLDER", session_id: "s-older" }),
    // A client looping on RR-E1003: far more rows than the feed's window of 50, all newer.
    ...Array.from({ length: 120 }, (_, index) =>
      backgroundFault(ago((index + 1) * 1000), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-LOOP",
        session_id: "s-loop",
      }),
    ),
  ]);
});

afterEach(() => {
  db.close();
});

describe("Overview: errors exclude background faults", () => {
  it("keeps a real error in the recent-errors feed behind a newer background loop", async () => {
    const summary = await loadSummary(db.env);

    expect(summary.recentErrors.map((event) => event.metrics.hwid)).toEqual(["HW-REAL"]);
    expect(summary.stats.errorsLast24Hours).toBe(1);
    // What the Overview then shows: its own 24 h window agrees with the server.
    expect(
      summary.recentErrors.filter((event) => isOverviewErrorInWindow(event, NOW - 24 * HOUR)),
    ).toHaveLength(1);
  });

  it("counts real errors only in the Errors tile and its daily series", async () => {
    const stats = await loadStats(
      db.env,
      parseStatsFilters(new URL("http://panel.test/?range=7d")),
    );

    expect(stats.totals.errorsInRange).toBe(2);
    expect(stats.series.errorsPerDay.reduce((sum, day) => sum + day.errors, 0)).toBe(2);
  });
});
