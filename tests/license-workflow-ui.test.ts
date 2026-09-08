import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const page = source("../src/pages/LicensesPage.tsx");
const api = source("../src/utils/api.ts");

describe("customer order license workflow", () => {
  it("searches exact orders or partial customer identity through the admin API", () => {
    expect(api).toContain('apiUrl("/api/admin/licenses/search")');
    expect(page).toContain('<option value="order_id">Exact order ID</option>');
    expect(page).toContain('<option value="customer">Customer name, email or Discord</option>');
    expect(page).toContain("searchAdminLicenses(mode, query)");
  });

  it("offers the audited issue flow from the page header and from an unfulfilled lookup", () => {
    // The primary action sits in the header on every tab; the empty lookup keeps
    // its own call to action, pre-filled from the search that just failed.
    expect(page).toMatch(/<PageHeader[\s\S]*?onClick=\{openIssue\}[\s\S]*?\/>/);
    expect(page).toContain("lookupResults.length === 0 ? (");
    expect(page).toContain("Issue purchased license");
    expect(page).not.toContain("Issue another license");
    // The generator is the batch path and says so. (The tab also carries a
    // panelId now, so match the key/label pair rather than the whole literal.)
    expect(page).toContain('{ key: "generate", label: "Bulk generate"');
  });

  it("makes issue, activate and bind operations replay-safe", () => {
    expect(api).toContain('apiUrl("/api/admin/licenses/issue")');
    expect(api).toContain('"Idempotency-Key": input.idempotency_key');
    expect(api).toContain('action: "activate" | "bind"');
    expect(page).toContain("idempotency_key: issueOperationKey");
    expect(page).toContain("idempotency_key: actionOperationKey");
  });

  it("matches backend integer limits before issuing", () => {
    expect(page).toContain("Number.isInteger(issueForm.duration_days)");
    expect(page).toContain("issueForm.duration_days > 3650");
    expect(page).toContain("Number.isInteger(issueForm.max_uses)");
    expect(page).toContain("issueForm.max_uses > 1000");
    expect(page).not.toContain('step="any"');
  });

  it("masks keys in lookup cards until an admin reveals one", () => {
    expect(page).toContain("maskLicenseKey(license.license_key)");
    expect(page).toContain("Reveal license key");
    expect(page).toContain("Hide license key");
  });
});
