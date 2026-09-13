// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomersPage } from "../src/pages/CustomersPage";
import type { UserRollupRecord } from "../src/types/telemetry";

const permissions = vi.hoisted(() => ({ access: true }));

vi.mock("../src/hooks/usePanelPermission", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/hooks/usePanelPermission")>();
  return {
    ...original,
    usePanelPermission: (permission?: string) => permission !== "access.read" || permissions.access,
  };
});
vi.mock("../src/hooks/useWorkspaceSearch", () => ({ useWorkspaceSearch: () => ["", () => {}] }));
vi.mock("../src/components/Customer360Overlay", () => ({ Customer360Overlay: () => null }));
vi.mock("../src/components/CustomerAccessDialog", () => ({ CustomerAccessDialog: () => null }));

function customer(overrides: Partial<UserRollupRecord> = {}): UserRollupRecord {
  return {
    identity: "ins_customer_01",
    userLabel: "Alex Morgan",
    firstSeen: "2025-11-04T12:00:00Z",
    lastSeen: "2026-09-13T15:42:00Z",
    sessions: 146,
    totalDurationSeconds: 296040,
    errors: 0,
    isActive: true,
    licenseTier: "premium",
    hwid: "hw_customer_01",
    appVersion: "1.5.2",
    displayVersion: "1.5.2",
    platform: "Windows",
    osVersion: "Windows 11",
    deviceModel: "Desktop PC",
    country: "DE",
    city: "Berlin",
    timezone: "Europe/Berlin",
    rpcEnabled: null,
    discordUser: "alexm",
    latitude: null,
    longitude: null,
    lastStatus: null,
    lastEvent: null,
    features: {},
    recentErrors: [],
    ...overrides,
  };
}

function renderCustomer(overrides: Partial<UserRollupRecord> = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<CustomersPage users={[customer(overrides)]} />);
  return host;
}

beforeEach(() => {
  permissions.access = true;
  window.history.replaceState(null, "", "/");
});

describe("Customer directory record presentation", () => {
  it("keeps premium license, presence and unknown app access distinct", () => {
    const host = renderCustomer();
    expect(host.querySelector(".customer-directory-tier")?.textContent).toBe("License: Premium");
    expect(host.querySelector(".customer-directory-presence")?.textContent).toBe(
      "Presence: Online",
    );
    expect(host.querySelector(".customer-directory-access")?.textContent).toBe("Not reported");
    expect(host.querySelector(".customer-directory-access")?.textContent).not.toContain("Allowed");
  });

  it("reports absence of a restriction without claiming the whole app is allowed", () => {
    const host = renderCustomer({ suspension: null, isActive: false });
    expect(host.querySelector(".customer-directory-access")?.textContent).toBe(
      "No restriction reported",
    );
    expect(host.querySelector(".customer-directory-presence")?.textContent).toBe(
      "Presence: Not active",
    );
  });

  it("separates an access ban from support errors", () => {
    const host = renderCustomer({
      errors: 2,
      suspension: { mode: "ban", bannedUntil: null } as UserRollupRecord["suspension"],
    });
    expect(host.querySelector(".customer-directory-access")?.textContent).toBe("Banned");
    expect(host.querySelector(".customer-directory-support")?.textContent).toBe("2 errors");
    expect(host.querySelector(".customer-directory-tier")?.textContent).toBe("License: Premium");
  });

  it("retains secondary facts in a closed native mobile disclosure", () => {
    const host = renderCustomer();
    const details = host.querySelector("details.customer-directory-mobile-details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("App & device details");
    for (const value of [
      "Desktop PC",
      "Windows 11",
      "Berlin",
      "146",
      "ins_customer_01",
      "hw_customer_01",
    ]) {
      expect(details?.textContent).toContain(value);
    }
  });

  it("keeps app-access actions permission-gated while retaining Customer 360", () => {
    permissions.access = false;
    const host = renderCustomer();
    expect(host.querySelector('[aria-label="Manage app access for Alex Morgan"]')).toBeNull();
    expect(host.querySelector('[aria-label="Open Customer 360 for Alex Morgan"]')).not.toBeNull();
  });

  it("defaults the shared density control to comfortable in the only filter toolbar", () => {
    const host = renderCustomer();
    expect(host.querySelectorAll('[aria-label="Customer filters"]')).toHaveLength(1);
    const density = host.querySelector('[aria-label="Customer row density"]');
    expect(density?.getAttribute("role")).toBe("radiogroup");
    expect(density?.querySelector('[aria-checked="true"]')?.textContent).toBe("Comfortable");
    expect(host.querySelector(".customer-directory-section")?.getAttribute("data-density")).toBe(
      "comfortable",
    );
  });
});
