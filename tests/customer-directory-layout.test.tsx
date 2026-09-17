// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomersPage } from "../src/pages/CustomersPage";
import type { UserRollupRecord } from "../src/types/telemetry";
import { formatDate, formatDay } from "../src/utils/format";

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

function statusCell(host: Element): HTMLElement {
  const cell = host.querySelector<HTMLElement>(".customer-directory-status-cell");
  if (!cell) throw new Error("no status cell");
  return cell;
}

/** The desktop badge row: [text, class] per badge. */
function badges(cell: Element): string[][] {
  return [...cell.querySelectorAll(".customer-directory-status-flags .badge")].map((badge) => [
    badge.textContent ?? "",
    badge.className,
  ]);
}

/** The two labelled lines the stacked phone card shows: [label, value] pairs. */
function statusLines(cell: Element): string[][] {
  return [...cell.querySelectorAll(".customer-directory-status-lines > div")].map((line) => [
    line.querySelector("dt")?.textContent ?? "",
    line.querySelector("dd")?.textContent ?? "",
  ]);
}

const UNTIL = "2026-10-01T00:00:00Z";

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
    // Nothing wrong: no badge and no inline label — a dash the reader skips, with the wording
    // behind it for the reader, the mouse (title) and the phone card; and no claim that the
    // whole app is allowed.
    const cell = statusCell(host);
    expect(badges(cell)).toEqual([]);
    const dash = cell.querySelector(".customer-directory-status-clear");
    expect(dash?.textContent?.trim()).toBe("—");
    expect(dash?.getAttribute("aria-hidden")).toBe("true");
    expect(cell.querySelector(".customer-directory-status-flags .sr-only")?.textContent).toBe(
      "Not reported. No errors reported.",
    );
    expect(cell.getAttribute("title")).toBe(
      "App access: Not reported\nSupport: No errors reported",
    );
    expect(statusLines(cell)).toEqual([
      ["App access", "Not reported"],
      ["Support", "No errors reported"],
    ]);
    expect(cell.textContent).not.toContain("Allowed");
  });

  it("reports absence of a restriction without claiming the whole app is allowed", () => {
    const host = renderCustomer({ suspension: null, isActive: false });
    const cell = statusCell(host);
    expect(badges(cell)).toEqual([]);
    expect(cell.getAttribute("title")).toBe(
      "App access: No restriction reported\nSupport: No errors reported",
    );
    expect(statusLines(cell)[0]).toEqual(["App access", "No restriction reported"]);
    expect(cell.textContent).not.toContain("Allowed");
    expect(host.querySelector(".customer-directory-presence")?.textContent).toBe(
      "Presence: Not active",
    );
  });

  it("badges an access ban and support errors side by side, and nothing else", () => {
    const host = renderCustomer({
      errors: 2,
      suspension: { mode: "ban", bannedUntil: null } as UserRollupRecord["suspension"],
    });
    const cell = statusCell(host);
    expect(badges(cell)).toEqual([
      ["Banned", "badge badge-danger"],
      ["2 errors", "badge badge-warning"],
    ]);
    // The inline "App access" / "Support" labels left the cell; the title and the phone card's
    // lines carry them.
    expect(cell.querySelector(".customer-directory-status-flags")?.textContent).toBe(
      "Banned2 errors",
    );
    expect(cell.getAttribute("title")).toBe("App access: Banned\nSupport: 2 errors");
    expect(statusLines(cell)).toEqual([
      ["App access", "Banned"],
      ["Support", "2 errors"],
    ]);
    expect(host.querySelector(".customer-directory-tier")?.textContent).toBe("License: Premium");
  });

  it("names the day a suspension lifts and keeps the clock time in the badge title", () => {
    const timed = statusCell(
      renderCustomer({
        suspension: { mode: "suspend", bannedUntil: UNTIL } as UserRollupRecord["suspension"],
      }),
    );
    expect(badges(timed)).toEqual([[`Suspended until ${formatDay(UNTIL)}`, "badge badge-warning"]]);
    expect(timed.querySelector(".badge")?.getAttribute("title")).toBe(
      `Lifts automatically on ${formatDate(UNTIL)}`,
    );
    const open = statusCell(
      renderCustomer({
        suspension: { mode: "suspend", bannedUntil: null } as UserRollupRecord["suspension"],
      }),
    );
    expect(badges(open)).toEqual([["Suspended", "badge badge-warning"]]);
    expect(open.querySelector(".badge")?.hasAttribute("title")).toBe(false);
  });

  it("shows one support badge: the error count first, the last status behind it", () => {
    const both = statusCell(renderCustomer({ errors: 1, lastStatus: "down" }));
    expect(badges(both)).toEqual([["1 error", "badge badge-warning"]]);
    expect(both.querySelector(".badge")?.getAttribute("title")).toBe("Last status down");
    expect(both.getAttribute("title")).toBe(
      "App access: Not reported\nSupport: 1 error, last status down",
    );
    expect(statusLines(both)[1]).toEqual(["Support", "1 errorLast status down"]);
    expect(badges(statusCell(renderCustomer({ lastStatus: "down" })))).toEqual([
      ["Down", "badge badge-danger"],
    ]);
    expect(badges(statusCell(renderCustomer({ lastStatus: "degraded" })))).toEqual([
      ["Degraded", "badge badge-warning"],
    ]);
  });

  it("heads the column Status, sortable, in place of Support", () => {
    const host = renderCustomer();
    const heads = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toContain("Status");
    expect(heads).not.toContain("Support");
    const status = [...host.querySelectorAll("thead th")].find((th) => th.textContent === "Status");
    expect(status?.querySelector("button.table-sort")).not.toBeNull();
  });

  it("caps the three free-text cells with the full value in the title", () => {
    const host = renderCustomer({
      discordUser: "longest_discord_handle_example_32",
      deviceModel: "12th Gen Intel(R) Core(TM) i7-12700KF",
      osVersion: "Windows 11 Pro 10.0.26100",
      city: "San Fernando del Valle de Catamarca",
      country: "AR",
    });
    const capped = [...host.querySelectorAll<HTMLElement>("td.cell-truncate")];
    expect(capped.map((td) => td.getAttribute("data-label"))).toEqual([
      "Contact",
      "Device / OS",
      "Location",
    ]);
    expect(capped.map((td) => td.getAttribute("style"))).toEqual([
      "--cell-max:150px",
      "--cell-max:210px",
      "--cell-max:190px",
    ]);
    expect(capped.map((td) => td.getAttribute("title"))).toEqual([
      "@longest_discord_handle_example_32",
      "12th Gen Intel(R) Core(TM) i7-12700KF · Windows 11 Pro 10.0.26100",
      "San Fernando del Valle de Catamarca, Argentina",
    ]);
    // The status row is not one of them: its width is a stylesheet cap on the badge row.
    expect(statusCell(host).classList.contains("cell-truncate")).toBe(false);
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
