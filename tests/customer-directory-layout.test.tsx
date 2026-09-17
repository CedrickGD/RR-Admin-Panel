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

  it("lists the last IP as a muted mono column whose IPv6 breaks once, after the fourth group", () => {
    const ip = "2001:db8:85a3:8d3:1319:8a2e:370:7348";
    const host = renderCustomer({ lastIp: ip, ipCount: 3 });
    const header = [...host.querySelectorAll("thead th")].find((th) =>
      th.textContent?.includes("Last IP"),
    );
    // Same tier treatment as the other secondary columns: it bows out with col-lg.
    expect(header?.className).toContain("col-lg");
    const cell = host.querySelector("td.customer-directory-ip-cell");
    for (const className of ["muted", "mono", "col-lg", "customer-directory-secondary-cell"]) {
      expect(cell?.classList.contains(className)).toBe(true);
    }
    expect(cell?.getAttribute("data-label")).toBe("Last IP");
    const address = cell?.querySelector(".customer-directory-ip");
    expect(address?.textContent).toBe(ip);
    // The one break opportunity sits at the /64 boundary: both halves stay under 20 characters.
    expect(address?.innerHTML).toBe("2001:db8:85a3:8d3:<wbr>1319:8a2e:370:7348");
    // How many addresses the customer was seen from lives in the tooltip.
    expect(cell?.getAttribute("title")).toBe("3 addresses seen");
    // The head and the skeleton agree on the column count.
    expect(host.querySelectorAll("thead th")).toHaveLength(12);
    // The phone card carries the whole address as a labelled line.
    const details = host.querySelector("details.customer-directory-mobile-details");
    const term = [...(details?.querySelectorAll("dt") ?? [])].find(
      (dt) => dt.textContent === "Last IP",
    );
    expect(term?.nextElementSibling?.textContent).toBe(ip);
    expect(term?.nextElementSibling?.classList.contains("mono")).toBe(true);
  });

  it("keeps an IPv4 on one line and says no more than a dash without an address", () => {
    const host = renderCustomer({ lastIp: null, ipCount: 0 });
    const cell = host.querySelector("td.customer-directory-ip-cell");
    expect(cell?.textContent).toBe("—");
    expect(cell?.hasAttribute("title")).toBe(false);
    const details = host.querySelector("details.customer-directory-mobile-details");
    expect(details?.textContent).toContain("Not reported");
    const single = renderCustomer({ lastIp: "203.0.113.10", ipCount: 1 });
    const address = single.querySelector("td.customer-directory-ip-cell .customer-directory-ip");
    expect(address?.innerHTML).toBe("203.0.113.10");
    // One address seen: nothing to add in a tooltip.
    expect(single.querySelector("td.customer-directory-ip-cell")?.hasAttribute("title")).toBe(
      false,
    );
    // A compressed IPv6 short enough for one line is left alone.
    const short = renderCustomer({ lastIp: "::ffff:203.0.113.10", ipCount: 1 });
    expect(short.querySelector(".customer-directory-ip")?.innerHTML).toBe("::ffff:203.0.113.10");
  });

  it("opens Customer 360 from the whole card head without nesting controls", () => {
    const host = renderCustomer();
    const head = host.querySelector<HTMLElement>(".customer-directory-open");
    expect(head?.tagName).toBe("BUTTON");
    expect(head?.getAttribute("type")).toBe("button");
    expect(head?.getAttribute("aria-label")).toBe("Open Customer 360 for Alex Morgan");
    // Avatar, name and the facts under it are all inside the one control.
    expect(head?.querySelector(".person-avatar")).not.toBeNull();
    expect(head?.querySelector(".record-link")?.textContent).toBe("Alex Morgan");
    expect(head?.textContent).toContain("License: Premium");
    // The name is a span now: a button in a button is invalid markup.
    expect(head?.querySelector(".record-link")?.tagName).toBe("SPAN");
    expect(head?.querySelectorAll("button, a, summary, input, select, details")).toHaveLength(0);
    // The footer keeps its own controls, outside the head.
    const footer = host.querySelector('[aria-label="Manage app access for Alex Morgan"]');
    expect(footer).not.toBeNull();
    expect(head?.contains(footer)).toBe(false);
    expect(host.querySelectorAll('[aria-label="Open Customer 360 for Alex Morgan"]')).toHaveLength(
      2,
    );
  });

  it("nests no control inside another anywhere on the page", () => {
    const host = renderCustomer();
    const nested = [...host.querySelectorAll("button, a, summary")].filter((control) =>
      control.parentElement?.closest("button, a, summary"),
    );
    expect(nested).toEqual([]);
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
