import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const page = source("../src/pages/CustomersPage.tsx");
const nav = source("../src/components/Navbar.tsx");
const telemetry = source("../src/types/telemetry.ts");
const app = source("../src/App.tsx");

describe("Customers CRM page", () => {
  it("is a dedicated Users navigation destination backed by the all-time rollup", () => {
    expect(telemetry).toContain('| "customers"');
    expect(nav).toMatch(/\["customers",\s*"Customer directory"\]/);
    expect(app).toContain('import("./pages/CustomersPage")');
    expect(app).toContain('"workers", "customers", "heatmap", "access"');
    expect(app).toContain('page === "customers"');
    expect(app).toContain("<CustomersPage users={users} filterBar={refreshButton} />");
    expect(page).toContain('title="Customer Directory"');
    expect(page).toContain("filterAndSortUsers(users");
    expect(page).toContain("all-time customer records");
  });

  it("provides support-focused search, filters, and summaries", () => {
    expect(page).toContain('placeholder="Search customer, PC, Discord or HWID…"');
    for (const label of ["All-time customers", "Online now", "Premium", "Needs attention"]) {
      expect(page).toContain(`label="${label}"`);
    }
    for (const scope of ["premium", "free", "online", "attention"]) {
      expect(page).toContain(`"${scope}"`);
    }
  });

  it("opens the full Customer 360 workspace through a stable user identity", () => {
    expect(page).toContain('selector: hwid ? "hwid" : "install_id"');
    expect(page).toContain("<Customer360Overlay");
    expect(page).toContain("anchor={selectedAnchor}");
    expect(page).toContain("Open 360");
  });
});
