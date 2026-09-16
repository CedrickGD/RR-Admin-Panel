import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewPage } from "../src/pages/OverviewPage";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import type { AuthUser, SummaryPayload, TelemetryEvent } from "../src/types/telemetry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Keep the page and real zoom hook interactive without requiring an SVG layout engine.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: () => <div data-testid="activity-chart" />,
  Area: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  Rectangle: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
const OWNER: AuthUser = {
  email: "monitor@example.test",
  role: "admin",
  permissions: ["overview.read", "monitoring.read", "support.read"],
};
const NOW = Date.parse("2026-09-14T12:00:00Z");
function event(id: string, overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    id,
    source: "desktop",
    service: "app_error",
    timestamp: new Date(NOW - 60000).toISOString(),
    receivedAt: new Date(NOW - 50000).toISOString(),
    status: "down",
    metrics: { exception_type: "Application error" },
    message: `Recorded error ${id}`,
    ...overrides,
  };
}
function summary(errors: TelemetryEvent[] = [], count = errors.length): SummaryPayload {
  return {
    generatedAt: new Date(NOW).toISOString(),
    storage: "d1",
    activeSessions: [],
    recentSessions: [],
    recentEvents: [],
    recentErrors: errors,
    stats: {
      totalEvents: 20,
      totalSessions: 10,
      activeUsers: 0,
      lifetimeUsers: 3,
      sessionsStartedToday: 2,
      sessionsEndedToday: 2,
      averageSessionDurationSeconds: 300,
      errorsLast24Hours: count,
      lastIngestAt: null,
    },
  };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function mount(data: SummaryPayload, identity = OWNER) {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={identity}>
        <OverviewPage summary={data} stats={null} theme="dark" />
      </PanelIdentity.Provider>,
    ),
  );
}
async function click(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === name,
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  await act(async () => button.click());
}
describe("monitoring overview workspace", () => {
  it("puts errors and real monitoring routes before the activity chart", async () => {
    await mount(summary([event("one")]));
    const errors = host.querySelector(".overview-errors");
    const chart = host.querySelector(".overview-activity");
    expect(errors).not.toBeNull();
    expect(chart).not.toBeNull();
    expect(errors!.compareDocumentPosition(chart!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector('a[href="#/live"]')?.textContent).toContain("Live sessions");
    expect(host.querySelector('a[href="#/workers"]')?.textContent).toContain("Session history");
    expect(host.querySelector('a[href="#/errors"]')?.textContent).toContain("Open error log");
  });
  it("preserves the true aggregate when the feed only contains a limited sample", async () => {
    await mount(summary([event("one")], 125));
    expect(host.querySelector(".overview-errors .badge")?.textContent).toBe("125 in 24h");
    expect(host.querySelectorAll(".overview-error")).toHaveLength(1);
  });
  it("distinguishes missing details from a zero-error summary", async () => {
    await mount(summary([], 12));
    expect(host.textContent).toContain("No error details available");
    expect(host.textContent).not.toContain("No recent errors");
    expect(host.querySelector(".empty-ring")).toBeNull();
  });
  it("shows a genuinely clear state only when both feed and counter are empty", async () => {
    await mount(summary());
    expect(host.textContent).toContain("No recent errors");
    expect(host.querySelector(".empty-ring")).not.toBeNull();
    expect(host.textContent).not.toContain("Restore hidden");
  });
  it("keeps locally hidden errors counted and restores them without a backend write", async () => {
    const data = summary([event("one")], 25);
    await mount(data);
    await click("Hide error one for this visit");
    expect(host.textContent).toContain("Errors hidden for this visit");
    expect(host.textContent).not.toContain("No recent errors");
    expect(host.querySelector(".overview-errors .badge")?.textContent).toBe("25 in 24h");
    expect(data.recentErrors).toHaveLength(1);
    await click("Restore hidden");
    expect(host.querySelectorAll(".overview-error")).toHaveLength(1);
  });
  it("fills the visible six slots with subsequent events after dismissal", async () => {
    await mount(summary(Array.from({ length: 8 }, (_, index) => event(String(index)))));
    expect(host.querySelectorAll(".overview-error")).toHaveLength(6);
    await click("Hide error 0 for this visit");
    expect(host.querySelectorAll(".overview-error")).toHaveLength(6);
    expect(host.querySelector(".overview-error-list")?.textContent).toContain("Recorded error 6");
    expect(host.querySelector(".overview-error-list")?.textContent).not.toContain(
      "Recorded error 0",
    );
  });
  it("retains 24-hour and background-fault exclusions even in a broader fallback feed", async () => {
    await mount(
      summary(
        [
          event("current"),
          event("old", { timestamp: new Date(NOW - 25 * 3600000).toISOString() }),
          event("background", { metrics: { error_kind: "background" } }),
        ],
        1,
      ),
    );
    expect(host.querySelectorAll(".overview-error")).toHaveLength(1);
    expect(host.querySelector(".overview-error-list")?.textContent).toContain(
      "Recorded error current",
    );
  });
  it("keeps technical details collapsed and missing measurements explicitly unknown", async () => {
    await mount(summary([event("one")]));
    expect(host.querySelector(".overview-snapshot")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector(".overview-error-context")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector(".overview-snapshot")?.textContent).toContain("Not available");
    expect(host.querySelector(".overview-snapshot")?.textContent).toContain("Not recorded");
  });
  it("does not expose support routes or details to monitoring-only identities", async () => {
    await mount(summary([event("secret")]), {
      ...OWNER,
      permissions: ["overview.read", "monitoring.read"],
    });
    expect(host.querySelector(".overview-errors")).toBeNull();
    expect(host.querySelector('a[href="#/errors"]')).toBeNull();
    expect(host.querySelector(".overview-activity")).not.toBeNull();
    expect(host.textContent).not.toContain("Recorded error secret");
  });
  it("does not expose monitoring routes or charts to support-only identities", async () => {
    await mount(summary([event("one")]), {
      ...OWNER,
      permissions: ["overview.read", "support.read"],
    });
    expect(host.querySelector('a[href="#/live"]')).toBeNull();
    expect(host.querySelector('a[href="#/workers"]')).toBeNull();
    expect(host.querySelector(".overview-activity")).toBeNull();
    expect(host.querySelector(".overview-errors")).not.toBeNull();
  });
  it("retains real keyboard-accessible zoom and reset controls", async () => {
    await mount(summary());
    expect(host.textContent).toContain("Activity · 24 hours");
    await click("Zoom in");
    expect(host.textContent).toContain("Activity · 19 hours");
    await click("Reset");
    expect(host.textContent).toContain("Activity · 24 hours");
    const plot = host.querySelector('[aria-label="Activity chart"]');
    expect(plot?.getAttribute("tabindex")).toBe("0");
    expect(plot?.getAttribute("aria-describedby")).toBeTruthy();
  });
});
