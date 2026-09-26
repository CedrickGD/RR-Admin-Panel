// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LICENSE_TABLE_FLOOR, LicenseInventoryRow, LicensesPage } from "../src/pages/LicensesPage";

const permissions = vi.hoisted(() => ({ write: true }));
vi.mock("../src/hooks/usePanelPermission", () => ({
  usePanelPermission: (permission?: string) => permission !== "licenses.write" || permissions.write,
}));
vi.mock("../src/hooks/useWorkspaceSearch", () => ({ useWorkspaceSearch: () => ["", () => {}] }));
vi.mock("../src/components/CustomerReturnLink", () => ({
  CustomerReturnLink: () => <a href="#customers">Back to customer</a>,
}));

type RowProps = ComponentProps<typeof LicenseInventoryRow>;
function license(overrides: Partial<RowProps["license"]> = {}): RowProps["license"] {
  return {
    id: 42,
    license_key: "RR-TEST-1234-5678",
    type: "lifetime",
    duration_days: null,
    hwid: "hw_alex",
    status: "active",
    custom_options: "{}",
    created_at: "2026-09-01T10:00:00Z",
    activated_at: "2026-09-01T11:00:00Z",
    expires_at: null,
    usage_count: 1,
    max_uses: 2,
    customer_name: "Alex Morgan",
    customer_email: "alex@example.test",
    customer_discord: "store-alex",
    verified_discord: "verified-alex",
    order_id: "ORD-1042",
    order_source: "store",
    order_note: "Customer supplied order reference",
    user_label: "Alex PC",
    session_id: "ses_alex",
    app_version: "1.5.2",
    ...overrides,
  };
}
function renderRow(overrides: Partial<RowProps["license"]> = {}, props: Partial<RowProps> = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <table>
      <tbody>
        <LicenseInventoryRow
          license={license(overrides)}
          isLive={false}
          copiedValue={null}
          onCopy={() => {}}
          onOpenSession={() => {}}
          onOpenWorker={() => {}}
          onActivate={() => {}}
          onBind={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          {...props}
        />
      </tbody>
    </table>,
  );
  return host;
}
beforeEach(() => {
  permissions.write = true;
});

describe("License workspace presentation", () => {
  it("puts customer identity first without merging order and license state", () => {
    const host = renderRow();
    const cells = host.querySelectorAll("tbody > tr > td");
    expect(cells).toHaveLength(8);
    expect(cells[0].getAttribute("data-label")).toBe("Customer");
    expect(cells[0].textContent).toContain("Alex Morgan");
    expect(cells[0].textContent).toContain("alex@example.test");
    expect(cells[1].textContent).toContain("RR-TEST-1234-5678");
    expect(host.querySelector(".license-status-cell")?.textContent).toContain("Active");
    expect(host.querySelector(".license-status-cell")?.textContent).not.toContain("Online");
    expect(host.querySelector(".license-session-state")?.textContent).toBe("Session history");
  });

  it("keeps store attribution distinct from verified Discord and payment confirmation", () => {
    const host = renderRow();
    const details = host.querySelector(".license-order-details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("Buyer Discord@store-alex");
    expect(details?.textContent).toContain("Verified Discord@verified-alex");
    expect(details?.textContent).toContain("not payment confirmation");
    expect(details?.querySelector("input, textarea")).toBeNull();
  });

  it("retains order, device and real session navigation inside the mobile disclosure", () => {
    const host = renderRow();
    const details = host.querySelector("details.license-mobile-context");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Order & device details");
    for (const fact of ["ORD-1042", "hw_alex", "ses_alex", "1.5.2", "Seats used", "Lifetime"]) {
      expect(details?.textContent).toContain(fact);
    }
    expect(details?.querySelector('button[title="View customer sessions"]')).not.toBeNull();
    expect(details?.querySelector('a[href*="customer360"]')).toBeNull();
  });

  it("keeps all four existing actions permission-gated without hiding read-only context", () => {
    permissions.write = false;
    const host = renderRow();
    expect(host.querySelectorAll(".license-row-actions button")).toHaveLength(0);
    expect(host.querySelector(".license-mobile-context")).not.toBeNull();
    expect(host.querySelector('[aria-label="Copy license key RR-TEST-1234-5678"]')).not.toBeNull();
  });

  it("disables activation and binding for revoked keys while retaining edit and explicit delete", () => {
    const host = renderRow({ status: "revoked" });
    expect(host.querySelector<HTMLButtonElement>('[aria-label^="Activate "]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label^="Bind "]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label^="Manage "]')?.disabled).toBe(
      false,
    );
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label^="Permanently delete"]')?.disabled,
    ).toBe(false);
    expect(
      [...host.querySelectorAll(".license-action-label")].map((node) => node.textContent),
    ).toEqual(["Activate", "Bind device", "Manage", "Delete"]);
  });

  it("preserves unlimited master seats and shows real live-session presence separately", () => {
    const host = renderRow({ max_uses: -1, custom_options: '{"master":true}' }, { isLive: true });
    expect(host.querySelector(".license-inventory-key")?.textContent).toContain("Master license");
    expect(host.querySelector(".license-usage-cell")?.textContent).toContain("Unlimited");
    expect(host.querySelector(".license-session-state")?.textContent).toBe("Live session");
    expect(host.querySelector('button[title="View live session"]')).not.toBeNull();
  });

  it("tiers Duration and Usage, which read back in the row's Device details", () => {
    const host = renderRow();
    const cells = [...host.querySelectorAll("tbody > tr > td")];
    expect(cells.map((cell) => cell.classList.contains("col-md"))).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(cells[3].getAttribute("data-label")).toBe("Duration");
    expect(cells[4].getAttribute("data-label")).toBe("Usage");
    expect(cells[2].classList.contains("license-order-cell")).toBe(true);
    // The tier is only allowed because both facts stay on the row, one disclosure away.
    const device = host.querySelector(".license-technical-details");
    expect(device?.querySelector("summary")?.textContent).toBe("Device details");
    const facts = [...(device?.querySelectorAll("dt") ?? [])].map((dt) => dt.textContent);
    expect(facts).toContain("Duration");
    expect(facts).toContain("Seats used");
    expect(device?.textContent).toContain("Lifetime");
    expect(device?.textContent).toContain("1 / 2");
  });

  it("keeps the head, the loading skeleton and the frame's floor in step with the tier", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<LicensesPage />);
    const heads = [...host.querySelectorAll(".license-table thead th")];
    expect(heads.map((th) => th.textContent?.trim())).toEqual([
      "Customer",
      "License key",
      "Order",
      "Duration",
      "Usage",
      "License status",
      "Linked session",
      "",
    ]);
    const tiered = [false, false, false, true, true, false, false, false];
    expect(heads.map((th) => th.classList.contains("col-md"))).toEqual(tiered);
    const skeleton = host.querySelector(".license-table tbody tr.skeleton-row");
    expect([...skeleton!.children].map((td) => td.classList.contains("col-md"))).toEqual(tiered);
    expect(host.querySelector(".license-table")?.getAttribute("style")).toContain(
      `--table-min-w:${LICENSE_TABLE_FLOOR}px`,
    );
  });

  it("retains one inventory filter home and the real return link", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<LicensesPage />);
    expect(host.querySelectorAll('[aria-label="License filters"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Search licenses"]')).not.toBeNull();
    expect(host.querySelector('a[href="#customers"]')?.textContent).toBe("Back to customer");
    expect(host.querySelector(".license-inventory-count")?.textContent).toBe(
      "Loading inventory...",
    );
    expect(host.textContent).toContain("Issue license");
  });
});
