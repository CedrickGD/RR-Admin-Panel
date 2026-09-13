import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const overlay = source("../src/components/Customer360Overlay.tsx");
const modal = source("../src/components/ds/Modal.tsx");
const router = source("../src/components/CustomerWorkspaceRouter.tsx");
const app = source("../src/App.tsx");
const navbar = source("../src/components/Navbar.tsx");

describe("Customer 360 workspace", () => {
  it("offers the complete support workspace as internal tabs", () => {
    for (const label of [
      "Overview",

      "Support & history",
      "Licenses & orders",

      "Devices & sessions",
    ]) {
      expect(overlay).toContain(`label: "${label}"`);
    }
    expect(overlay).toContain('session ? "session_id" : (anchor?.selector ?? null)');
    expect(overlay).toContain("fetchCustomer360(selector, value)");
    expect(overlay).toContain("customer.section_errors[name]");
  });

  it("supports customer-directory anchors without changing the session lookup", () => {
    expect(overlay).toContain("export interface Customer360Anchor");
    expect(overlay).toContain('const value = session?.id ?? anchor?.value?.trim() ?? ""');
    expect(overlay).toContain("selector: Customer360Selector");
  });

  it("uses the accessible dialog with intentional close behavior", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("event.target === event.currentTarget");
    expect(modal).toContain('event.key === "Escape"');
    expect(modal).toContain('event.key !== "Tab"');
    expect(modal).toContain('document.documentElement.style.overflow = "hidden"');
    expect(modal).toContain("useHistoryLayer(open && Boolean(onClose), requestClose)");
    expect(modal).toContain("target?.isConnected");
  });

  it("keeps one history entry for the workspace, so Back from Licenses returns to it", () => {
    expect(router).toContain("useHistoryLayer(");
    expect(router).toContain('key: "customer"');
    // The layer hook owns the entry; the router never pushes one by hand.
    expect(router).not.toContain("history.pushState");
    // Licenses is pushed on top of the workspace entry, not after closing it.
    expect(overlay).toContain("navigateCustomerUrl(customerActionUrl(here, activeTab))");
    expect(overlay).not.toMatch(/onClose\(\);\s*navigateCustomerUrl/);
    // Back between entries whose query differs fires popstate only.
    expect(app).toContain('window.addEventListener("popstate", onHashChange)');
  });

  it("gives phones a back arrow in the workspace bar while a layer is open", () => {
    expect(navbar).toContain("useTopHistoryLayer()");
    expect(navbar).toContain('className="workspace-layer-back"');
    expect(navbar).toContain("onClick={() => history.back()}");
  });

  it("renders no viewport-sized dialog: Customer 360 is only the inline workspace", () => {
    const root = fileURLToPath(new URL("../src/", import.meta.url));
    const offenders = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => readFileSync(join(root, file), "utf8").includes('size="viewport"'));
    expect(offenders).toEqual([]);
    expect(modal).not.toContain('"viewport"');
    expect(overlay).not.toContain("<Modal\n      open={open}");
    expect(overlay).not.toContain("embedded");
    const css = source("../src/theme/css/components.css");
    expect(css).not.toContain(".dialog-viewport");
    expect(css).not.toContain(".customer-360-modal");
  });

  it("lays the workspace out as identity + figures beside the tabbed record", () => {
    expect(overlay).toContain('className="customer360-layout"');
    expect(overlay).toContain('className="customer360-side"');
    expect(overlay).toContain("<KeyFigures customer={customer} />");
    // The complete record sits behind a button, not in an always-rendered dump.
    expect(overlay).toContain("Raw data");
    expect(overlay).toContain('className="customer360-raw-dialog"');
    expect(overlay).not.toContain("Advanced · technical record");
    // Tab icons are rendered and no longer hidden again by CSS; the anchor line is shown.
    expect(overlay).toContain("{tab.icon}");
    const workspace = source("../src/theme/workspace.css");
    expect(workspace).not.toMatch(/\.customer360-tabs svg \{\s*display: none;/);
    expect(workspace).not.toMatch(/\.customer360-anchor \{\s*display: none;/);
    expect(workspace).toMatch(/\.customer360-card \{\s*padding: 16px;/);
    // A license key the workspace was opened by is masked like every other one.
    expect(overlay).toContain("maskLicenseKey(anchor.requested_value)");
  });

  it("keeps the workspace bar opaque and flush in both states (nothing shows through)", () => {
    const layer = source("../src/theme/consistency.css");
    const bar = layer.match(/\.customer-workspace-bar \{[^}]*\}/)?.[0] ?? "";
    expect(bar).toContain("background: var(--workspace-solid)");
    expect(bar).toContain("border-bottom: 1px solid var(--line)");
    expect(bar).toContain("top: calc(var(--workspace-pad-top) * -1)");
    expect(bar).not.toContain("transparent");
    // The page behind "Manage licenses" is loaded before the swap.
    expect(overlay).toContain('import("../pages/LicensesPage")');
  });

  it("does not expose full license keys in collapsed Customer 360 rows", () => {
    expect(overlay).toContain("maskLicenseKey(row.license_key)");
    expect(overlay).toContain("<RecordDetails record={raw} />");
  });
});
