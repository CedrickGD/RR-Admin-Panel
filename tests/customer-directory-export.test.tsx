// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { utils, writeFile } from "xlsx";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { CustomersPage } from "../src/pages/CustomersPage";
import type { AuthUser, UserRollupRecord } from "../src/types/telemetry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The directory's Export writes what the directory shows right now — the filtered list,
 * every page of it, in the table's order and with the table's columns — through the same
 * lazy xlsx chunk as the Session history export. The page is real; xlsx, the workspace
 * overlays and the suspensions fetch are stubbed.
 */
vi.mock("../src/hooks/useWorkspaceSearch", () => ({ useWorkspaceSearch: () => useState("") }));
vi.mock("../src/components/Customer360Overlay", () => ({ Customer360Overlay: () => null }));
vi.mock("../src/components/CustomerAccessDialog", () => ({ CustomerAccessDialog: () => null }));
vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchAdminSuspensions: vi.fn(async () => ({ ok: true, status: 200, suspensions: [] })),
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
  permissions: ["customers.read", "access.read", "exports.read"],
};
const SUPPORT: AuthUser = {
  email: "support@example.test",
  role: "viewer",
  permissions: ["customers.read"],
};

function customer(overrides: Partial<UserRollupRecord> = {}): UserRollupRecord {
  return {
    identity: "customer-avery",
    userLabel: "Avery",
    firstSeen: "2026-09-01T12:00:00.000Z",
    lastSeen: "2026-09-14T11:59:00.000Z",
    sessions: 5,
    totalDurationSeconds: 900,
    errors: 0,
    isActive: true,
    licenseTier: "premium",
    hwid: "HW-PRIVATE-AVERY",
    appVersion: "2.9.0",
    displayVersion: null,
    platform: "Windows",
    osVersion: "Windows 11",
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

const MARA = customer({
  identity: "customer-mara",
  userLabel: "Mara",
  hwid: "HW-PRIVATE-MARA",
  discordUser: "@mara",
  licenseTier: "free",
  isActive: false,
  appVersion: "2.8.0",
  displayVersion: "2.8.0",
  country: "US",
  city: "Austin",
  lastIp: "198.51.100.7",
  ipCount: 2,
  sessions: 3,
  totalDurationSeconds: 600,
  errors: 1,
  lastSeen: "2026-09-12T12:00:00.000Z",
  suspension: {
    mode: "ban",
    reason: null,
    bannedUntil: null,
    hadPaidLicense: false,
    createdAt: "2026-09-10T00:00:00.000Z",
  },
});

/** More than one page (PAGE_SIZE is 75) of customers a single search matches. */
const BATCH = Array.from({ length: 80 }, (_, index) =>
  customer({
    identity: `customer-batch-${index}`,
    userLabel: `Batch ${String(index).padStart(2, "0")}`,
    hwid: `HW-BATCH-${index}`,
    discordUser: "batch-crew",
    lastIp: `203.0.113.${index + 1}`,
    ipCount: 1,
    lastSeen: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
  }),
);

const CUSTOMERS = [customer(), MARA, ...BATCH];

let container: HTMLDivElement;
let root: Root;

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
  window.history.replaceState(null, "", "/");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(users: UserRollupRecord[] | null = CUSTOMERS, user = ADMIN) {
  await act(async () => {
    root.render(
      <PanelIdentity.Provider value={user}>
        <CustomersPage users={users} />
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

async function search(value: string) {
  const input = container.querySelector('[aria-label="Search customers"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing directory search");
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
    if (Date.now() > deadline) throw new Error("Timed out waiting for the directory UI");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

function rows() {
  return container.querySelectorAll("tbody tr.customer-directory-row").length;
}

function exportedRows(): Record<string, unknown>[] {
  const call = vi.mocked(utils.json_to_sheet).mock.calls.at(-1);
  if (!call) throw new Error("Nothing was exported");
  return call[0] as Record<string, unknown>[];
}

describe("Customer directory export", () => {
  it("writes the filtered directory with the table's columns, in the table's order", async () => {
    await render();
    await search("mara");
    await waitFor(() => rows() === 1);
    await click(button("Export"));
    await waitFor(() => vi.mocked(writeFile).mock.calls.length === 1);

    const [row] = exportedRows();
    expect(exportedRows()).toHaveLength(1);
    expect(Object.keys(row)).toEqual([
      "Customer",
      "Contact",
      "Plan",
      "Status",
      "Version",
      "Device",
      "OS",
      "Location",
      "Last IP",
      "Sessions",
      "Total time",
      "Errors",
      "First seen",
      "Last seen",
      "Restriction",
    ]);
    expect(row).toMatchObject({
      Customer: "Mara",
      Contact: "mara",
      Plan: "Free",
      Status: "Offline",
      Version: "2.8.0",
      Device: "Desktop",
      OS: "Windows 11",
      Location: expect.stringContaining("Austin"),
      "Last IP": "198.51.100.7",
      Sessions: 3,
      "Total time": "10m 0s",
      Errors: 1,
      "First seen": "2026-09-01T12:00:00.000Z",
      "Last seen": "2026-09-12T12:00:00.000Z",
      Restriction: "Banned",
    });
    expect(utils.book_append_sheet).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "Customers",
    );
    expect(vi.mocked(writeFile).mock.calls[0][1]).toMatch(/^rr-customers-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("exports every page of the current list, not just the visible one", async () => {
    await render();
    await search("batch-crew");
    await waitFor(() => rows() === 75);
    await click(button("Export"));
    await waitFor(() => vi.mocked(writeFile).mock.calls.length === 1);

    const exported = exportedRows();
    expect(exported).toHaveLength(80);
    // The table's order: last seen, newest first.
    const lastSeen = exported.map((row) => String(row["Last seen"]));
    expect(lastSeen).toEqual([...lastSeen].sort().reverse());
    // Blank facts export as blank cells, never as a placeholder dash.
    const unrestricted = exported.find((row) => row.Customer === "Batch 00");
    expect(unrestricted).toMatchObject({ Restriction: "", "Last IP": "203.0.113.1" });
  });

  it("keeps the directory in place after a failed export and hides Export without the permission", async () => {
    await render();
    await search("mara");
    await waitFor(() => rows() === 1);
    vi.mocked(writeFile).mockImplementationOnce(() => {
      throw new Error("Download failed");
    });
    await click(button("Export"));
    await waitFor(() => container.querySelector('[role="alert"]') !== null);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Export failed");
    expect(rows()).toBe(1);
    expect(button("Export")?.disabled).toBe(false);

    // Nothing to write: the button waits, it does not produce an empty sheet.
    await search("nobody-by-that-name");
    await waitFor(() => rows() === 0);
    expect(button("Export")?.disabled).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(CUSTOMERS, SUPPORT);
    expect(button("Export")).toBeUndefined();
  });
});
