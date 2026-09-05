import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const overlay = source("../src/components/Customer360Overlay.tsx");
const modal = source("../src/components/ds/Modal.tsx");

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

  it("uses an accessible viewport dialog with intentional close behavior", () => {
    expect(overlay).toContain('size="viewport"');
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("event.target === event.currentTarget");
    expect(modal).toContain('event.key === "Escape"');
    expect(modal).toContain('event.key !== "Tab"');
    expect(modal).toContain('document.body.style.overflow = "hidden"');
    expect(modal).toContain("target?.isConnected");
  });

  it("does not expose full license keys in collapsed Customer 360 rows", () => {
    expect(overlay).toContain("maskLicenseKey(row.license_key)");
    expect(overlay).toContain("<RecordDetails record={raw} />");
  });
});
