import { describe, expect, it } from "vitest";
import { systemChecks } from "../src/utils/systemStatus";
import type { HealthPayload } from "../src/types/telemetry";

const now = Date.parse("2026-09-05T12:00:00Z");
const health: HealthPayload = {
  ok: true,
  api: "alive",
  storage: { backend: "d1", available: true },
  lastIngestAt: new Date(now - 1_000).toISOString(),
  count: 10,
  build: { commit: "test" },
};

describe("backend health reporting", () => {
  it("only reports a verified database read and recent ingest as healthy", () => {
    expect(systemChecks(health, false, now, now).map((check) => check.tone)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
    expect(systemChecks({ ...health, storage: { backend: "d1" } }, false, now, now)[1].state).toBe(
      "Unknown",
    );
  });
  it("does not present a previously healthy database as current during an outage", () => {
    const checks = systemChecks(health, true, now - 15_000, now);
    expect(checks[0].state).toBe("Unreachable");
    expect(checks[1].state).toBe("Unknown");
  });
  it("expires old health results and does not confuse inactivity with an outage", () => {
    expect(systemChecks(health, false, now - 60_000, now)[0].state).toBe("Check overdue");
    const idle = systemChecks({ ...health, lastIngestAt: null }, false, now, now);
    expect(idle[0].state).toBe("Reachable");
    expect(idle[2].state).toBe("No recent events");
  });
});
