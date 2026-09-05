import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkersPage } from "../src/pages/WorkersPage";
import type { SummaryPayload, UserRollupRecord } from "../src/types/telemetry";
const users = Array.from(
  { length: 75 },
  (_, i) =>
    ({
      identity: `device-${i}`,
      hwid: `device-${i}`,
      userLabel: `Person ${i}`,
      firstSeen: "2026-01-01",
      lastSeen: "2026-09-01",
      sessions: 10,
      totalDurationSeconds: 600,
      errors: 0,
      isActive: false,
      appVersion: null,
      displayVersion: null,
      platform: null,
      osVersion: null,
      deviceModel: null,
      country: null,
      city: null,
      timezone: null,
      rpcEnabled: null,
      discordUser: null,
      latitude: null,
      longitude: null,
      lastStatus: null,
      lastEvent: null,
      features: {},
      recentErrors: [],
    }) as UserRollupRecord,
);
const summary = { recentSessions: [], activeSessions: [] } as unknown as SummaryPayload;
function render(rows: UserRollupRecord[] | null) {
  return renderToStaticMarkup(
    createElement(WorkersPage, {
      summary,
      stats: null,
      users: rows,
      onOpenMapSession: () => {},
      onOpenMapUser: () => {},
    }),
  );
}
describe("unified session history", () => {
  it("shows one paginated directory containing user identity and session totals", () => {
    const html = render(users);
    expect(html).toContain("Session history");
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain("Sessions");
    expect(html).toContain("Time in app");
    expect(html.match(/aria-label="Show session history for /g)).toHaveLength(50);
    expect(html).toContain("of 75 people");
  });
  it("gives each person a keyboard-accessible expansion action", () => {
    const html = render(users.slice(0, 1));
    expect(html).toContain('aria-label="Expand history for Person 0"');
    expect(html).toContain('aria-expanded="false"');
  });
  it("distinguishes an unloaded directory from an empty result", () => {
    expect(render(null)).toContain("Loading the complete history");
    expect(render([])).toContain("No matching activity");
  });
});
