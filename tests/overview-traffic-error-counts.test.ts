// F4: the Overview activity chart and the Traffic timezone cards read
// summary.recentEvents, which is the unfiltered newest-N window. Before the
// shared predicate they counted every app_error row, so the chart showed a red
// spike while the KPI directly above it read 0.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSummary } from "../functions/_lib/storage";
import type { SummaryPayload } from "../src/types/telemetry";
import { buildTimezoneActivity, buildTrafficTimeline } from "../src/utils/dashboardInsights";
import { isRealErrorEvent } from "../src/utils/errorEvents";
import {
  backgroundFault,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "./helpers/telemetry-db";

/**
 * The panel receives exactly this JSON over the wire. The two declarations of
 * SummaryPayload differ only in optional license fields the charts never read,
 * so cross the boundary once here instead of hand-building a fixture.
 */
async function panelSummary(db: TelemetryTestDb): Promise<SummaryPayload> {
  return (await loadSummary(db.env)) as unknown as SummaryPayload;
}

const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let db: TelemetryTestDb;

beforeEach(() => {
  db = createTelemetryTestDb();
  db.insertEvents([
    realError(ago(90 * MINUTE), { hwid: "HW-REAL", session_id: "s-real" }),
    // The production RR-E1003 loop: enough rows to dominate the newest-200 window.
    ...Array.from({ length: 60 }, (_, index) =>
      backgroundFault(ago(index * MINUTE + 1000), {
        base_exception_type: "System.NullReferenceException",
        hwid: "HW-LOOP",
        session_id: "s-loop",
      }),
    ),
    { service: "session_start", ts: ago(2 * HOUR), status: "ok", metrics: { hwid: "HW-REAL" } },
  ]);
});

afterEach(() => {
  db.close();
});

const sumErrors = (points: ReadonlyArray<{ errors: number }>) =>
  points.reduce((total, point) => total + point.errors, 0);

describe("Overview chart and Traffic timezone cards count real errors only", () => {
  it("does not let a background-fault loop inflate the activity chart", async () => {
    const summary = await panelSummary(db);

    // The window really is dominated by background faults — otherwise this proves nothing.
    expect(summary.recentEvents.filter((e) => e.service === "app_error").length).toBe(60 + 1);

    const chartErrors = sumErrors(buildTrafficTimeline(summary, 24, "UTC"));

    expect(chartErrors).toBe(1);
    // The one number the chart must agree with: the KPI printed directly above it.
    expect(chartErrors).toBe(summary.stats.errorsLast24Hours);
  });

  it("does not let a background-fault loop inflate the timezone cards", async () => {
    const summary = await panelSummary(db);
    const cards = buildTimezoneActivity(summary, "UTC");

    expect(sumErrors(cards)).toBe(1);
    // Activity still counts every event: only the error tally is filtered.
    expect(cards.reduce((total, card) => total + card.activity, 0)).toBe(62);
  });

  it("routes both surfaces through the shared predicate", async () => {
    const summary = await panelSummary(db);
    const expected = summary.recentEvents.filter(isRealErrorEvent).length;

    expect(sumErrors(buildTrafficTimeline(summary, 24, "UTC"))).toBe(expected);
    expect(sumErrors(buildTimezoneActivity(summary, "UTC"))).toBe(expected);
  });
});
