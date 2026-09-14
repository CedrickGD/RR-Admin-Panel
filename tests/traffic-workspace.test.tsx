import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { TrafficPage } from "../src/pages/TrafficPage";
import type {
  AppSessionRecord,
  AuthUser,
  StatsPayload,
  SummaryPayload,
} from "../src/types/telemetry";
import type { TimezoneActivityPoint } from "../src/utils/dashboardInsights";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ChartPoint {
  users: number | null;
  predicted?: number | null;
  [key: string]: unknown;
}
interface TooltipInput {
  active: boolean;
  label: string;
  payload: Array<{ name: string; value: number | null; color: string }>;
}
interface TimezoneProps {
  title: string;
  subtitle: string;
  data: TimezoneActivityPoint[];
}
const capture = vi.hoisted(() => ({
  data: [] as ChartPoint[],
  tooltip: undefined as ((props: TooltipInput) => ReactNode) | undefined,
  timezones: new Map<string, TimezoneProps>(),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ data, children }: { data: ChartPoint[]; children: ReactNode }) => {
    capture.data = data;
    return <svg data-testid="daily-chart">{children}</svg>;
  },
  Area: ({
    dataKey,
    name,
    strokeDasharray,
  }: {
    dataKey: string;
    name: string;
    strokeDasharray?: string;
  }) => (
    <g data-testid="chart-series" data-key={dataKey} data-name={name} data-dash={strokeDasharray} />
  ),
  Tooltip: ({ content }: { content: (props: TooltipInput) => ReactNode }) => {
    capture.tooltip = content;
    return null;
  },
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ReferenceLine: () => null,
  Line: () => null,
  Legend: () => null,
}));

vi.mock("../src/components/charts/TimezoneUsageChart", () => ({
  TimezoneUsageChart: (props: TimezoneProps) => {
    capture.timezones.set(props.title, props);
    return (
      <article data-testid="timezone-chart" aria-label={props.title}>
        <h3>{props.title}</h3>
        <p>{props.subtitle}</p>
      </article>
    );
  },
}));

// Match the existing GlassDropdown tests: jsdom has no native Popover API.
type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
const popovers = new WeakSet<Element>();
const nativeMatches = Element.prototype.matches;
const prototype = HTMLElement.prototype as PopoverElement;
const hadPopover = typeof prototype.showPopover === "function";

beforeAll(() => {
  if (hadPopover) return;
  prototype.showPopover = function (this: HTMLElement) {
    popovers.add(this);
  };
  prototype.hidePopover = function (this: HTMLElement) {
    popovers.delete(this);
  };
  Element.prototype.matches = function (this: Element, selector: string) {
    return selector === ":popover-open" ? popovers.has(this) : nativeMatches.call(this, selector);
  };
});

afterAll(() => {
  if (hadPopover) return;
  Reflect.deleteProperty(prototype, "showPopover");
  Reflect.deleteProperty(prototype, "hidePopover");
  Element.prototype.matches = nativeMatches;
});

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const ADMIN: AuthUser = {
  email: "monitor@example.test",
  role: "viewer",
  permissions: ["monitoring.read"],
};
const DAILY = [
  { day: "2026-09-12", users: 6, sessions: 8 },
  { day: "2026-09-13", users: 0, sessions: 0 },
  { day: "2026-09-14", users: 3, sessions: 4 },
];

function stats(daily = DAILY): StatsPayload {
  return {
    generatedAt: new Date(NOW).toISOString(),
    filters: { rangeDays: 30, version: null, platform: null, country: null },
    totals: {
      lifetimeUsers: 20,
      lifetimeSessions: 40,
      lifetimeEvents: 80,
      freeDownloads: 0,
      usersInRange: 9,
      sessionsInRange: 12,
      newUsersInRange: 2,
      activeNow: 1,
      rpcLiveNow: 0,
      rpcEnabledUsers: 0,
      rpcKnownUsers: 0,
      averageSessionDurationSeconds: 120,
      errorsInRange: 0,
    },
    series: { sessionsPerDay: daily, newUsersPerDay: [], errorsPerDay: [] },
    breakdowns: {
      versionsAllTime: [],
      versionsCurrent: [],
      platforms: [],
      countries: [],
      features: [],
      eventsLifetime: [],
    },
  };
}

// Populate the session fields consumed by Traffic's actual aggregation helpers.
const SESSION = {
  id: "session-avery",
  installId: "install-avery",
  hwid: "hardware-avery",
  source: "razorreaper",
  userLabel: "Avery",
  startedAt: "2026-09-14T10:00:00.000Z",
  lastSeenAt: "2026-09-14T11:59:00.000Z",
  endedAt: null,
  isActive: true,
  durationSeconds: 7140,
  errorCount: 0,
  appVersion: "1.4.2",
  clientIp: null,
  clientCountry: null,
  platform: null,
  lastEvent: "session_active",
  lastStatus: "ok",
} satisfies AppSessionRecord;

function summary(overrides: Partial<SummaryPayload> = {}): SummaryPayload {
  return {
    generatedAt: new Date(NOW).toISOString(),
    storage: "d1",
    activeSessions: [],
    recentSessions: [],
    recentErrors: [],
    recentEvents: [],
    stats: {
      totalEvents: 0,
      totalSessions: 0,
      activeUsers: 0,
      lifetimeUsers: 0,
      sessionsStartedToday: 0,
      sessionsEndedToday: 0,
      averageSessionDurationSeconds: 0,
      errorsLast24Hours: 0,
      lastIngestAt: null,
    },
    ...overrides,
  };
}

function event(service: string, hoursAgo: number, errorKind?: string) {
  return {
    timestamp: new Date(NOW - hoursAgo * 3600000).toISOString(),
    service,
    metrics: errorKind ? { error_kind: errorKind } : {},
  } as SummaryPayload["recentEvents"][number];
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  capture.data = [];
  capture.tooltip = undefined;
  capture.timezones.clear();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(data: StatsPayload | null = stats(), snapshot = summary()) {
  await act(async () => {
    root.render(
      <PanelIdentity.Provider value={ADMIN}>
        <TrafficPage summary={snapshot} stats={data} theme="dark" />
      </PanelIdentity.Provider>,
    );
  });
}

function button(name: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (element) => (element.getAttribute("aria-label") || element.textContent?.trim()) === name,
  );
}

async function click(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("Expected a Traffic control");
  await act(async () => element.click());
}

async function chooseEstimate(label: "Off" | "Show linear estimate") {
  await click(button("Trend estimate"));
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (element) => element.textContent?.trim() === label,
  );
  await click(option);
}

function dailyTable() {
  const caption = Array.from(container.querySelectorAll("caption")).find(
    (element) => element.textContent?.trim() === "Daily customer counts (UTC)",
  );
  const table = caption?.closest("table");
  if (!(table instanceof HTMLTableElement)) throw new Error("Missing daily values table");
  return table;
}

describe("Traffic workspace", () => {
  it("prefers server aggregates over the session snapshot and retains real zero days", async () => {
    await render(stats(), summary({ activeSessions: [SESSION], recentSessions: [SESSION] }));
    expect(capture.data.map((point) => point.users)).toEqual([6, 0, 3]);
    expect(container.textContent).toContain("Server aggregates");
    expect(container.textContent).not.toContain("Limited session snapshot");
    expect(container.querySelector('[data-key="predicted"]')).toBeNull();
    expect(container.querySelectorAll('[aria-label="Traffic view"]').length).toBe(1);
    expect(container.querySelector('[aria-label="Traffic insight view"]')).not.toBeNull();
    for (const label of [
      "Active right now",
      "Started today",
      "Peak customers/h",
      "Avg duration",
      "Last ingest",
    ])
      expect(container.textContent).toContain(label);
  });

  it("keeps an explicitly empty server series empty instead of falling back to sessions", async () => {
    await render(stats([]), summary({ activeSessions: [SESSION] }));
    expect(container.textContent).toContain("No daily activity data");
    expect(container.querySelector('[data-testid="daily-chart"]')).toBeNull();
    expect(container.querySelector('[data-key="predicted"]')).toBeNull();
    expect(button("Trend estimate")?.disabled).toBe(true);
    expect(container.textContent).not.toContain("Limited session snapshot");
  });

  it("labels a stats-unavailable fallback as a limited session snapshot and disables estimates", async () => {
    await render(null, summary({ activeSessions: [SESSION], recentSessions: [SESSION] }));
    expect(container.textContent).toContain("Limited session snapshot");
    expect(container.querySelector('[data-testid="daily-chart"]')).not.toBeNull();
    expect(capture.data.some((point) => point.users === 1)).toBe(true);
    expect(capture.data.reduce((total, point) => total + (point.users ?? 0), 0)).toBe(1);
    expect(button("Trend estimate")?.disabled).toBe(true);
    expect(container.querySelector('[data-key="predicted"]')).toBeNull();
  });

  it("does not present thirty synthetic zero days as recorded activity in an empty snapshot", async () => {
    await render(null);
    expect(container.textContent).toContain("No session data in this snapshot");
    expect(container.querySelector('[data-testid="daily-chart"]')).toBeNull();
    expect(container.querySelector(".traffic-data-details table")).toBeNull();
    expect(button("Trend estimate")?.disabled).toBe(true);
  });

  it("requires two server days before offering a linear estimate", async () => {
    await render(stats([DAILY[0]]));
    expect(button("Trend estimate")?.disabled).toBe(true);
    expect(container.querySelector('[data-key="predicted"]')).toBeNull();
  });

  it("opts into a distinctly named dashed linear estimate without changing recorded values", async () => {
    await render();
    expect(button("Trend estimate")?.disabled).toBe(false);
    await chooseEstimate("Show linear estimate");
    const estimate = container.querySelector('[data-key="predicted"]');
    expect(estimate?.getAttribute("data-name")).toBe("Linear estimate");
    expect(estimate?.getAttribute("data-dash")).toBeTruthy();
    expect(capture.data.filter((point) => point.users != null).map((point) => point.users)).toEqual(
      [6, 0, 3],
    );
    expect(capture.data.some((point) => point.users == null && point.predicted != null)).toBe(true);
    expect(dailyTable().tBodies[0]?.rows.length).toBe(3);
    await chooseEstimate("Off");
    expect(container.querySelector('[data-key="predicted"]')).toBeNull();
    expect(capture.data.map((point) => point.users)).toEqual([6, 0, 3]);
  });

  it("retains a real zero in the tooltip while excluding a missing estimate", async () => {
    await render();
    const content = capture.tooltip;
    if (typeof content !== "function") throw new Error("Expected the daily tooltip renderer");
    await act(async () => {
      root.render(
        content({
          active: true,
          label: "A recorded zero day",
          payload: [
            { name: "Recorded customers", value: 0, color: "#ffffff" },
            { name: "Linear estimate", value: null, color: "#cccccc" },
          ],
        }),
      );
    });
    expect(container.textContent).toContain("Recorded customers");
    expect(container.textContent).toContain("0");
    expect(container.textContent).not.toContain("Linear estimate");
  });

  it("keeps methodology and the latest thirty recorded daily values in closed disclosures", async () => {
    const daily = Array.from({ length: 40 }, (_, index) => ({
      day: new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10),
      users: index + 1,
      sessions: index + 1,
    }));
    await render(stats(daily));
    const values = container.querySelector("details.traffic-data-details");
    const method = container.querySelector("details.traffic-method");
    if (!(values instanceof HTMLDetailsElement) || !(method instanceof HTMLDetailsElement))
      throw new Error("Missing native Traffic disclosures");
    expect(values.open).toBe(false);
    expect(method.open).toBe(false);
    expect(values.querySelector("summary")?.textContent?.trim()).toBe("Daily values");
    expect(method.querySelector("summary")?.textContent?.trim()).toBe(
      "Data sources & estimate method",
    );
    const rows = Array.from(dailyTable().tBodies[0]?.rows ?? []);
    expect(rows.length).toBe(30);
    const counts = rows.flatMap((row) =>
      Array.from(row.cells)
        .map((cell) => cell.textContent?.trim() ?? "")
        .filter((value) => /^\d+$/.test(value))
        .map(Number),
    );
    expect(counts.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 11),
    );
  });

  it("switches to actual timezone event data without treating background faults as errors", async () => {
    await render(
      stats(),
      summary({
        recentEvents: [
          event("session_start", 1),
          event("app_error", 1, "background"),
          event("app_error", 2, "crash"),
          event("session_start", 25),
        ],
      }),
    );
    await click(button("Timezones"));
    expect(container.querySelector('[data-testid="daily-chart"]')).toBeNull();
    expect(button("Trend estimate")).toBeUndefined();
    expect(container.textContent).toContain("Loaded events");
    expect(container.textContent).toContain("last 24 hours");
    expect(container.textContent).toMatch(/same (loaded )?events/i);
    expect(container.textContent).toMatch(
      /do not represent separate country audiences|not customer location/i,
    );
    expect(capture.timezones.size).toBeGreaterThan(0);
    for (const chart of capture.timezones.values()) {
      expect(chart.title).toBeTruthy();
      expect(chart.subtitle).toBeTruthy();
      expect(chart.data.length).toBe(24);
      expect(chart.data.reduce((sum, point) => sum + point.activity, 0)).toBe(3);
      expect(chart.data.reduce((sum, point) => sum + point.errors, 0)).toBe(1);
      expect(chart.data.reduce((sum, point) => sum + point.started, 0)).toBe(1);
    }
    await click(button("Daily customers"));
    expect(container.querySelector('[data-testid="daily-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="timezone-chart"]')).toBeNull();
    expect(capture.data.map((point) => point.users)).toEqual([6, 0, 3]);
  });

  it("shows an honest empty timezone state even when a heartbeat session remains online", async () => {
    await render(stats(), summary({ activeSessions: [SESSION] }));
    await click(button("Timezones"));
    expect(container.textContent).toContain("No events in this snapshot");
    expect(container.textContent).toMatch(/heartbeat/i);
    expect(container.querySelector('[data-testid="timezone-chart"]')).toBeNull();
    expect(container.textContent).not.toContain("Peak 00:00");
  });
});
