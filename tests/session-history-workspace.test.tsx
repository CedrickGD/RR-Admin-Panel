import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { utils, writeFile } from "xlsx";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { WorkersPage } from "../src/pages/WorkersPage";
import type { AuthUser, SummaryPayload, UserRollupRecord } from "../src/types/telemetry";
import { openCustomerWorkspace } from "../src/utils/customerNavigation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/hooks/useWorkspaceSearch", () => ({
  useWorkspaceSearch: () => useState(""),
}));
vi.mock("../src/utils/monitoringDirectory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/monitoringDirectory")>();
  return {
    ...actual,
    // Freshness and session reconciliation have dedicated directory tests.
    // These tests exercise presentation and controls using resolved customer data.
    buildMonitoringDirectory: (users: UserRollupRecord[]) => users,
  };
});
vi.mock("../src/components/UserActivityPanel", () => ({
  UserActivityPanel: ({ identity }: { identity: string }) => (
    <div data-testid="activity-timeline">Activity for {identity}</div>
  ),
}));
vi.mock("../src/components/InstallsPanel", () => ({
  InstallsPanel: () => <div>Installation records</div>,
}));
vi.mock("../src/utils/customerNavigation", () => ({
  openCustomerWorkspace: vi.fn(),
}));
vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet: vi.fn(() => ({})),
    book_new: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

const ADMIN: AuthUser = {
  email: "admin@example.test",
  role: "admin",
  permissions: ["monitoring.read", "customers.read", "exports.read"],
};
const MONITOR: AuthUser = {
  email: "monitor@example.test",
  role: "viewer",
  permissions: ["monitoring.read"],
};
const SUMMARY: SummaryPayload = {
  generatedAt: "2026-09-14T12:00:00.000Z",
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
};

function customer(overrides: Partial<UserRollupRecord> = {}): UserRollupRecord {
  return {
    identity: "customer-avery",
    userLabel: "Avery",
    firstSeen: "2026-09-01T12:00:00.000Z",
    lastSeen: "2026-09-14T11:59:00.000Z",
    sessions: 5,
    totalDurationSeconds: 900,
    errors: 2,
    isActive: true,
    hwid: "HW-PRIVATE-AVERY",
    appVersion: "2.9.0",
    displayVersion: null,
    platform: "Windows",
    osVersion: "11",
    deviceModel: "Desktop",
    country: "DE",
    city: "Berlin",
    timezone: "Europe/Berlin",
    rpcEnabled: true,
    discordUser: "avery",
    latitude: null,
    longitude: null,
    lastStatus: null,
    lastEvent: null,
    features: {},
    recentErrors: [],
    ...overrides,
  };
}

const CUSTOMERS = [
  customer(),
  customer({
    identity: "customer-mara",
    userLabel: "Mara",
    hwid: "HW-PRIVATE-MARA",
    discordUser: "mara",
    sessions: 3,
    totalDurationSeconds: 600,
    errors: 0,
    isActive: false,
    lastSeen: "2026-09-12T12:00:00.000Z",
    country: "US",
    city: "Austin",
    lastIp: "198.51.100.7",
    ipCount: 2,
    appVersion: "2.8.0",
    rpcEnabled: null,
  }),
  customer({
    identity: "customer-noah",
    userLabel: "Noah",
    hwid: "HW-PRIVATE-NOAH",
    discordUser: null,
    sessions: 9,
    totalDurationSeconds: 1800,
    errors: 1,
    isActive: false,
    lastSeen: "2026-09-13T12:00:00.000Z",
    city: "Hamburg",
    rpcEnabled: false,
  }),
];

let container: HTMLDivElement;
let root: Root;
let openMapSession: ReturnType<typeof vi.fn>;
let openMapUser: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
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
  openMapSession = vi.fn();
  openMapUser = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(users: UserRollupRecord[] | null = CUSTOMERS, user = ADMIN) {
  await act(async () => {
    root.render(
      <PanelIdentity.Provider value={user}>
        <WorkersPage
          summary={SUMMARY}
          stats={null}
          users={users}
          onOpenMapSession={openMapSession}
          onOpenMapUser={openMapUser}
        />
      </PanelIdentity.Provider>,
    );
  });
}

function button(name: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (element) => (element.getAttribute("aria-label") || element.textContent?.trim()) === name,
  );
}

async function click(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("Expected a visible action");
  await act(async () => element.click());
}

function names() {
  return Array.from(container.querySelectorAll(".session-history-record")).map((element) =>
    element.getAttribute("aria-label")?.replace("Session history for ", ""),
  );
}

function record(name: string) {
  const element = container.querySelector(`[aria-label="Session history for ${name}"]`);
  if (!element) throw new Error(`Missing customer ${name}`);
  return element;
}

async function search(value: string) {
  const input = container.querySelector('[aria-label="Search session history"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing history search");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Missing native input setter");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for history UI");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

describe("Session history workspace", () => {
  it("keeps one filter area beside the directory and renders real customer states", async () => {
    await render();
    const surface = container.querySelector('[aria-label="Customers and session history"]');
    expect(surface?.querySelectorAll('[aria-label="Session history filters"]').length).toBe(1);
    expect(surface?.querySelector('[aria-label="Search session history"]')).not.toBeNull();
    expect(surface?.querySelector('[aria-label="App version"]')).not.toBeNull();
    expect(surface?.querySelector('[aria-label="Country"]')).not.toBeNull();
    expect(container.querySelectorAll("thead th").length).toBe(8);
    expect(record("Avery").textContent).toContain("Online");
    expect(record("Avery").textContent).toContain("2 errors recorded");
    expect(record("Mara").textContent).toContain("Offline");
    expect(record("Mara").textContent).not.toContain("errors recorded");
    expect(record("Noah").textContent).toContain("1 error recorded");
    expect(record("Avery").textContent).toContain("@avery");
    expect(names()).toEqual(["Avery", "Noah", "Mara"]);
  });

  it("filters online, offline and error customers and resets to all customers", async () => {
    await render();
    await click(button("Online"));
    expect(names()).toEqual(["Avery"]);
    await click(button("Offline"));
    expect(names()).toEqual(["Noah", "Mara"]);
    await click(button("With errors"));
    expect(names()).toEqual(["Avery", "Noah"]);
    await click(button("Reset"));
    expect(names()).toEqual(["Avery", "Noah", "Mara"]);
    expect(button("Reset")).toBeUndefined();
  });

  it("combines search with scope, explains no matches and retains reset", async () => {
    await render();
    await search("mara");
    expect(names()).toEqual(["Mara"]);
    await click(button("Online"));
    expect(names()).toEqual([]);
    expect(container.textContent).toContain("No customers match");
    expect(button("Reset")).toBeDefined();
    await click(button("Reset"));
    expect(names()).toHaveLength(3);
  });

  it("preserves sortable session totals and accessible sort direction", async () => {
    await render();
    const heading = Array.from(container.querySelectorAll("thead th")).find(
      (element) => element.textContent?.trim() === "Sessions",
    );
    await click(heading?.querySelector("button"));
    expect(names()).toEqual(["Noah", "Avery", "Mara"]);
    expect(heading?.getAttribute("aria-sort")).toBe("descending");
    await click(heading?.querySelector("button"));
    expect(names()).toEqual(["Mara", "Avery", "Noah"]);
    expect(heading?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("opens a customer timeline without exposing technical details by default", async () => {
    await render();
    expect(container.textContent).not.toContain("HW-PRIVATE-AVERY");
    expect(button("Show session history for Avery")?.getAttribute("aria-expanded")).toBe("false");
    await click(button("Show session history for Avery"));
    await waitFor(() => container.querySelector('[data-testid="activity-timeline"]') !== null);
    const timeline = container.querySelector('[aria-label="Session timeline for Avery"]');
    const details = timeline?.querySelector("details");
    if (!(details instanceof HTMLDetailsElement)) throw new Error("Missing device disclosure");
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("Device & installation details");
    expect(details.textContent).toContain("HW-PRIVATE-AVERY");
    expect(details.textContent).toContain("Discord RPC");
    expect(details.textContent).toContain("Enabled");
    expect(button("Hide session history for Avery")?.getAttribute("aria-controls")).toBe(
      timeline?.id,
    );
    await click(button("Map"));
    expect(openMapUser).toHaveBeenCalledWith("customer-avery");
    expect(openMapSession).not.toHaveBeenCalled();
    await click(button("Customer workspace"));
    expect(openCustomerWorkspace).toHaveBeenCalledWith({
      selector: "hwid",
      value: "HW-PRIVATE-AVERY",
    });
    await click(button("Hide session history for Avery"));
    expect(container.querySelector('[aria-label="Session timeline for Avery"]')).toBeNull();
  });

  it("honors export and customer permissions while keeping monitoring usable", async () => {
    await render(CUSTOMERS, MONITOR);
    expect(button("Export")).toBeUndefined();
    await click(button("Show session history for Avery"));
    expect(button("Customer workspace")).toBeUndefined();
    expect(button("Map")).toBeDefined();
    expect(openCustomerWorkspace).not.toHaveBeenCalled();
  });

  it("exports only matching rows and keeps the directory after export failure", async () => {
    await render();
    await search("mara");
    await click(button("Export"));
    await waitFor(() => vi.mocked(writeFile).mock.calls.length === 1);
    expect(utils.json_to_sheet).toHaveBeenLastCalledWith([
      expect.objectContaining({
        Customer: "Mara",
        Status: "Offline",
        Sessions: 3,
        "Client IP": "198.51.100.7",
      }),
    ]);
    vi.mocked(writeFile).mockImplementationOnce(() => {
      throw new Error("Download failed");
    });
    await click(button("Export"));
    await waitFor(() => container.querySelector('[role="alert"]') !== null);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Export failed");
    expect(names()).toEqual(["Mara"]);
    expect(button("Export")?.disabled).toBe(false);
  });

  it("paginates the directory and closes the previous customer timeline", async () => {
    const users = Array.from({ length: 51 }, (_, index) =>
      customer({
        identity: `customer-${index}`,
        hwid: `hardware-${index}`,
        userLabel: `Person ${String(index).padStart(2, "0")}`,
        lastSeen: new Date(Date.UTC(2026, 8, 14, 12, 0, 0) - index * 1000).toISOString(),
      }),
    );
    await render(users);
    expect(names()).toHaveLength(50);
    await click(button("Show session history for Person 00"));
    await click(button("Next page"));
    expect(names()).toEqual(["Person 50"]);
    expect(container.querySelector(".session-history-timeline")).toBeNull();
    await search("Person 00");
    expect(names()).toEqual(["Person 00"]);
  });

  it("distinguishes loading from an empty history without allowing an empty export", async () => {
    await render(null);
    expect(container.querySelector(".skeleton-row")).not.toBeNull();
    expect(container.textContent).not.toContain("No customers match");
    expect(button("Export")?.disabled).toBe(true);
    await render([]);
    expect(container.querySelector(".skeleton-row")).toBeNull();
    expect(container.textContent).toContain("No customer session history has been recorded yet.");
    expect(button("Export")?.disabled).toBe(true);
  });
});
