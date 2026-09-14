import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { FeedbackPage } from "../src/pages/FeedbackPage";
import { LivePage } from "../src/pages/LivePage";
import { WorkersPage } from "../src/pages/WorkersPage";
import type {
  AppSessionRecord,
  AuthUser,
  SummaryPayload,
  UserRollupRecord,
} from "../src/types/telemetry";
import { fetchApi } from "../src/utils/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DistributionProps {
  title: string;
  description?: string;
  data: readonly { label: string; value: number }[];
  variant?: "bars" | "donut";
  unavailable?: boolean;
  emptyMessage?: string;
}
const capture = vi.hoisted(() => new Map<string, DistributionProps>());

vi.mock("../src/components/charts/DistributionChart", () => ({
  DistributionChart: (props: DistributionProps) => {
    capture.set(props.title, props);
    return (
      <section aria-label={props.title}>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
        {props.unavailable ? (
          <p>Chart data unavailable</p>
        ) : (
          <pre>{JSON.stringify(props.data)}</pre>
        )}
      </section>
    );
  },
}));
vi.mock("../src/hooks/useWorkspaceSearch", () => ({
  useWorkspaceSearch: () => useState(""),
}));
vi.mock("../src/utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/api")>();
  return { ...actual, fetchApi: vi.fn() };
});
vi.mock("../src/components/UserActivityPanel", () => ({
  UserActivityPanel: () => <div>Session timeline</div>,
}));
vi.mock("../src/components/InstallsPanel", () => ({
  InstallsPanel: () => <div>Installation records</div>,
}));

const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const USER: AuthUser = {
  email: "admin@example.test",
  role: "admin",
  permissions: [
    "support.read",
    "support.write",
    "monitoring.read",
    "customers.read",
    "exports.read",
  ],
};
const api = vi.mocked(fetchApi);

function summary(sessions: AppSessionRecord[] = []): SummaryPayload {
  return {
    generatedAt: new Date(NOW).toISOString(),
    storage: "d1",
    activeSessions: sessions,
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
  };
}

function session(overrides: Partial<AppSessionRecord> = {}): AppSessionRecord {
  return {
    id: "session-avery",
    installId: "install-avery",
    hwid: "hardware-avery",
    source: "razorreaper",
    userLabel: "Avery",
    startedAt: "2026-09-14T10:00:00.000Z",
    lastSeenAt: new Date(NOW - 60000).toISOString(),
    endedAt: null,
    isActive: true,
    durationSeconds: 7140,
    errorCount: 0,
    appVersion: "1.4.2",
    displayVersion: null,
    clientIp: null,
    clientCountry: null,
    platform: null,
    lastEvent: "session_active",
    lastStatus: "ok",
    rpcEnabled: true,
    ...overrides,
  };
}

function customer(overrides: Partial<UserRollupRecord> = {}): UserRollupRecord {
  return {
    identity: "customer-avery",
    userLabel: "Avery",
    firstSeen: "2026-09-01T12:00:00.000Z",
    lastSeen: "2026-09-14T11:59:00.000Z",
    sessions: 4,
    totalDurationSeconds: 900,
    errors: 0,
    isActive: false,
    hwid: "hardware-avery",
    appVersion: "1.4.2",
    displayVersion: null,
    platform: "Windows",
    osVersion: "11",
    deviceModel: "Desktop",
    country: "DE",
    city: "Berlin",
    timezone: "Europe/Berlin",
    rpcEnabled: null,
    discordUser: null,
    latitude: null,
    longitude: null,
    lastStatus: null,
    lastEvent: null,
    features: {},
    recentErrors: [],
    ...overrides,
  };
}

function report(id: number, status: "new" | "read" | "archived", created_at: string) {
  return {
    id,
    status,
    created_at,
    message: `needle-${id}`,
    contact: `author-${id}@example.test`,
    hwid: null,
    install_id: null,
    license_key: null,
    machine_name: `Author ${id}`,
    app_version: null,
    platform: null,
  };
}

const REPORTS = [
  report(1, "new", new Date(NOW - 2 * 3600000).toISOString()),
  report(2, "read", new Date(NOW - 3 * 86400000).toISOString()),
  report(3, "archived", new Date(NOW - 10 * 86400000).toISOString()),
  report(4, "new", new Date(NOW - 40 * 86400000).toISOString()),
  report(5, "new", "invalid-date"),
  report(6, "read", new Date(NOW + 3600000).toISOString()),
];

let container: HTMLDivElement;
let root: Root;
const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");

beforeEach(() => {
  capture.clear();
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: vi.fn(() => []),
  });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  api.mockReset();
  api.mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost:3000");
    if (url.pathname !== "/api/admin/feedback")
      throw new Error(`Unexpected request ${url.pathname}`);
    return new Response(JSON.stringify({ ok: true, feedback: REPORTS }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalGetAnimations)
    Object.defineProperty(Element.prototype, "getAnimations", originalGetAnimations);
  else Reflect.deleteProperty(Element.prototype, "getAnimations");
});

async function render(page: React.ReactNode) {
  await act(async () =>
    root.render(<PanelIdentity.Provider value={USER}>{page}</PanelIdentity.Provider>),
  );
}

function chart(title: string) {
  const props = capture.get(title);
  if (!props) throw new Error(`Missing ${title} chart`);
  return props;
}

function counts(title: string) {
  return Object.fromEntries(chart(title).data.map((entry) => [entry.label, entry.value]));
}

function total(title: string) {
  return chart(title).data.reduce((sum, entry) => sum + entry.value, 0);
}

function button(name: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (element) => (element.getAttribute("aria-label") || element.textContent?.trim()) === name,
  );
}

function statusFilter(label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (element) =>
      element.querySelector(".ds-seg-label")?.textContent?.trim() === label ||
      element.textContent?.trim().replace(/\d+$/, "") === label,
  );
}

async function click(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("Expected a workspace action");
  await act(async () => element.click());
}

async function search(label: string, value: string) {
  const input = container.querySelector(`[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Missing native input setter");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function waitFor(check: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Timed out waiting for chart data");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

describe("Support and session distribution charts", () => {
  it("uses report age in the filtered inbox, including read reports and unknown dates", async () => {
    await render(<FeedbackPage />);
    await waitFor(() => capture.has("Report age"));
    expect(chart("Report age").variant).toBe("donut");
    expect(chart("Report age").description).toMatch(/current view.*loaded reports/i);
    expect(chart("Report age").description).toContain("not response or resolution time");
    expect(counts("Report age")).toEqual({
      "Under 24 hours": 1,
      "1-7 days": 1,
      "7-30 days": 0,
      "30+ days": 1,
      "Unknown date": 2,
    });
    await search("Search feedback", "needle-2");
    expect(total("Report age")).toBe(1);
    expect(counts("Report age")["1-7 days"]).toBe(1);
    await click(button("Reset"));
    await click(statusFilter("Archived"));
    expect(total("Report age")).toBe(1);
    expect(counts("Report age")["7-30 days"]).toBe(1);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("interprets SQLite submission timestamps in UTC at age boundaries", async () => {
    api.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          feedback: [report(1, "new", "2026-09-13 13:00:00")],
        }),
        { status: 200 },
      ),
    );
    await render(<FeedbackPage />);
    await waitFor(() => capture.has("Report age"));
    expect(counts("Report age")["Under 24 hours"]).toBe(1);
    expect(counts("Report age")["1-7 days"]).toBe(0);
  });

  it("does not display initial loading or a failed request as a zero-report distribution", async () => {
    let respond: ((response: Response) => void) | undefined;
    api.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    await render(<FeedbackPage />);
    expect(capture.has("Report age")).toBe(false);
    if (!respond) throw new Error("Expected feedback loading to start");
    await act(async () => respond?.(new Response(JSON.stringify({ ok: false }), { status: 503 })));
    await waitFor(() => capture.has("Report age"));
    expect(chart("Report age").unavailable).toBe(true);
    expect(container.textContent).toContain("Feedback unavailable");
    expect(container.querySelector('[aria-label="Report age"]')?.textContent).not.toContain(
      '"value":0',
    );
  });

  it("distinguishes successfully loaded empty feedback from unavailable feedback", async () => {
    api.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, feedback: [] }), { status: 200 }),
    );
    await render(<FeedbackPage />);
    await waitFor(() => capture.has("Report age"));
    expect(chart("Report age").unavailable).toBe(false);
    expect(total("Report age")).toBe(0);
    expect(chart("Report age").emptyMessage).toBe("No reports in this view.");
  });

  it("uses only deduplicated live customers and keeps unknown RPC distinct from disabled", async () => {
    const sessions = [
      session(),
      session({
        id: "older-avery",
        lastSeenAt: new Date(NOW - 120000).toISOString(),
        appVersion: "1.3.0",
        rpcEnabled: false,
      }),
      session({
        id: "mara",
        installId: "install-mara",
        hwid: "hw-mara",
        userLabel: "Mara",
        appVersion: "1.4.1",
        rpcEnabled: false,
        errorCount: 1,
      }),
      session({
        id: "noah",
        installId: "install-noah",
        hwid: "hw-noah",
        userLabel: "Noah",
        appVersion: null,
        rpcEnabled: null,
      }),
      session({
        id: "stale",
        installId: "install-stale",
        hwid: "hw-stale",
        lastSeenAt: new Date(NOW - 7 * 60000).toISOString(),
        appVersion: "stale-version",
      }),
      session({
        id: "ended",
        installId: "install-ended",
        hwid: "hw-ended",
        isActive: false,
        endedAt: new Date(NOW - 1000).toISOString(),
        appVersion: "ended-version",
      }),
    ];
    await render(<LivePage summary={summary(sessions)} onOpenMapSession={vi.fn()} />);
    expect(counts("Live version mix")).toEqual({ "1.4.2": 1, "1.4.1": 1, Unknown: 1 });
    expect(counts("Live RPC reporting")).toEqual({ Enabled: 1, Disabled: 1, Unknown: 1 });
    expect(chart("Live version mix").description).toMatch(/current filters.*loaded.*6 minutes/i);
    expect(chart("Live RPC reporting").variant).toBe("donut");
    await search("Search live sessions", "Mara");
    expect(counts("Live version mix")).toEqual({ "1.4.1": 1 });
    expect(counts("Live RPC reporting")).toEqual({ Enabled: 0, Disabled: 1, Unknown: 0 });
    await click(button("Reset"));
    await click(button("With errors"));
    expect(total("Live version mix")).toBe(1);
    expect(counts("Live RPC reporting").Disabled).toBe(1);
    expect(api).not.toHaveBeenCalled();
  });

  it("keeps an empty live distribution neutral rather than inventing an unknown customer", async () => {
    await render(<LivePage summary={summary()} onOpenMapSession={vi.fn()} />);
    expect(chart("Live version mix").data).toEqual([]);
    expect(total("Live RPC reporting")).toBe(0);
    expect(chart("Live RPC reporting").emptyMessage).toBe("No live customers match this view.");
  });

  it("counts all filtered history customers before pagination and honors search", async () => {
    const users = Array.from({ length: 51 }, (_, index) =>
      customer({
        identity: `customer-${index}`,
        hwid: `hw-${index}`,
        userLabel: `Person ${String(index).padStart(2, "0")}`,
        sessions: index === 0 ? 0 : index === 1 ? 1 : index === 3 ? 25 : 4,
        lastSeen: new Date(NOW - index * 1000).toISOString(),
      }),
    );
    await render(
      <WorkersPage
        summary={summary()}
        stats={null}
        users={users}
        onOpenMapSession={vi.fn()}
        onOpenMapUser={vi.fn()}
      />,
    );
    expect(counts("Customer activity depth")).toEqual({
      "No recorded sessions": 1,
      "1 session": 1,
      "2-9 sessions": 48,
      "10+ sessions": 1,
      Unknown: 0,
    });
    expect(total("Customer activity depth")).toBe(51);
    expect(container.querySelectorAll(".session-history-record").length).toBe(50);
    await click(button("Next page"));
    expect(total("Customer activity depth")).toBe(51);
    expect(container.querySelectorAll(".session-history-record").length).toBe(1);
    await search("Search session history", "Person 50");
    expect(total("Customer activity depth")).toBe(1);
    expect(counts("Customer activity depth")["2-9 sessions"]).toBe(1);
    expect(chart("Customer activity depth").description).toMatch(
      /current filters.*before pagination/i,
    );
  });

  it("keeps invalid numeric session counters separate from a real zero", async () => {
    const missing = customer({ identity: "missing", hwid: "hw-missing", sessions: Number.NaN });
    const users = [
      customer({ identity: "zero", hwid: "hw-zero", sessions: 0 }),
      customer({ identity: "fractional", hwid: "hw-fractional", sessions: 1.5 }),
      customer({ identity: "negative", hwid: "hw-negative", sessions: -1 }),
      missing,
    ];
    await render(
      <WorkersPage
        summary={summary()}
        stats={null}
        users={users}
        onOpenMapSession={vi.fn()}
        onOpenMapUser={vi.fn()}
      />,
    );
    expect(counts("Customer activity depth")["No recorded sessions"]).toBe(1);
    expect(counts("Customer activity depth").Unknown).toBe(3);
    expect(total("Customer activity depth")).toBe(4);
  });

  it("distinguishes unavailable history from a loaded empty customer directory", async () => {
    await render(
      <WorkersPage
        summary={summary()}
        stats={null}
        users={null}
        onOpenMapSession={vi.fn()}
        onOpenMapUser={vi.fn()}
      />,
    );
    expect(chart("Customer activity depth").unavailable).toBe(true);
    await render(
      <WorkersPage
        summary={summary()}
        stats={null}
        users={[]}
        onOpenMapSession={vi.fn()}
        onOpenMapUser={vi.fn()}
      />,
    );
    expect(chart("Customer activity depth").unavailable).toBe(false);
    expect(total("Customer activity depth")).toBe(0);
  });
});
