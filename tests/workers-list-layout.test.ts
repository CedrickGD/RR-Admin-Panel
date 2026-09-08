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
    // Two disclosures per row — the name button and the chevron — and both
    // carry the same state-reflecting label.
    expect(html.match(/aria-label="Show session history for /g)).toHaveLength(100);
    expect(html).toContain("of 75 customers");
  });
  it("gives each person a keyboard-accessible expansion action", () => {
    const html = render(users.slice(0, 1));
    expect(html).toContain('aria-label="Show session history for Person 0"');
    expect(html).toContain('aria-expanded="false"');
  });
  it("distinguishes an unloaded directory from an empty result", () => {
    // Unloaded: skeleton rows keep the table's shape; empty: the search empty state.
    expect(render(null)).toContain('class="skeleton-row"');
    expect(render(null)).not.toContain("No customers match");
    expect(render([])).toContain("No customers match");
  });
});
