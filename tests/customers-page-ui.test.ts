import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const page = source("../src/pages/CustomersPage.tsx");
const nav = source("../src/components/Navbar.tsx");
const pageMeta = source("../src/pageMeta.ts");
const telemetry = source("../src/types/telemetry.ts");
const app = source("../src/App.tsx");

describe("Customers CRM page", () => {
  it("is a dedicated Users navigation destination backed by the all-time rollup", () => {
    expect(telemetry).toContain('| "customers"');
    // The sidebar carries structure only; the visible name lives in PAGE_META,
    // which the rail, the breadcrumb and the page H1 all read.
    expect(nav).toMatch(/\["customers",\s*<UsersRound \/>\]/);
    // The label must not repeat the group name, or the rail renders "Customers > Customers".
    expect(pageMeta).toMatch(
      /customers:\s*\{\s*group:\s*"Customers",\s*label:\s*"Customer directory"\s*\}/,
    );
    expect(app).toContain('import("./pages/CustomersPage")');
    expect(app).toContain('"workers", "customers", "heatmap"');
    expect(app).toContain('page === "customers"');
    expect(app).toContain("<CustomersPage users={users} />");
    expect(page).toContain('page="customers"');
    // Still the shared directory helper over the rollup — `source` is that
    // rollup plus the restrictions that have no rollup row (see below).
    expect(page).toContain("filterAndSortUsers(source");
    expect(page).toContain("all-time customer records");
  });

  it("lists restrictions the telemetry rollup cannot see, with reason, issuer and first seen", () => {
    // The rollup comes from app_sessions, so a customer banned before they ever
    // launched the app has no row in it; the restricted scope loads the
    // enforcement records themselves and folds the orphans in.
    expect(page).toContain('usePanelPermission("access.read")');
    expect(page).toContain("fetchAdminSuspensions");
    expect(page).toContain("restrictionAsDirectoryRow");
    expect(page).toContain('const restrictedScope = scope === "restricted"');
    // Reason and "who issued it" are a column, not a tooltip; it is mounted
    // only with the scope that selects restricted customers.
    expect(page).toContain('{showRestrictions ? <th scope="col">Restriction</th> : null}');
    expect(page).toContain("restriction.created_by");
    // First seen: the sort key existed in userDirectory, the header did not.
    expect(page).toContain('label="First seen"');
    expect(page).toContain('sortKey="firstSeen"');
  });

  it("provides support-focused search, filters, and summaries", () => {
    // The search sits in the page's own toolbar; the navbar has none any more.
    expect(page).toContain('placeholder="Search customer, PC, Discord or HWID…"');
    expect(nav).not.toContain('type="search"');
    expect(page).toContain('useWorkspaceSearch("customers")');
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
    expect(page).toContain("Open Customer 360 for");
  });
});
