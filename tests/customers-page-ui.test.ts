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
const restrictions = source("../src/components/CustomerRestrictions.tsx");

describe("Customers CRM page", () => {
  it("is a dedicated Users navigation destination backed by the all-time rollup", () => {
    expect(telemetry).toContain('| "customers"');
    // The sidebar carries structure only; the visible name lives in PAGE_META,
    // which the rail, the breadcrumb and the page H1 all read.
    expect(nav).toMatch(/\["customers",\s*<UsersRound \/>\]/);
    // The rail label must not repeat the group name, or the rail renders "Customers > Customers".
    // The page's own name (H1, breadcrumb, tab title) covers both sections: "Customers".
    expect(pageMeta).toMatch(
      /customers:\s*\{\s*group:\s*"Customers",\s*label:\s*"Customer directory",\s*heading:\s*"Customers"\s*\}/,
    );
    expect(pageMeta).toContain("PAGE_META[page].heading ?? PAGE_META[page].label");
    expect(nav).toContain("meta.group === heading ? null");
    expect(app).toContain('import("./pages/CustomersPage")');
    expect(app).toContain('"workers", "customers", "heatmap"');
    expect(app).toContain('page === "customers"');
    expect(app).toContain("<CustomersPage users={users} />");
    expect(page).toContain('page="customers"');
    // Still the shared directory helper over the all-time rollup.
    expect(page).toContain("filterAndSortUsers(users");
    expect(page).toContain("all-time customer records");
  });

  it("splits the page into Directory and Restrictions sections", () => {
    // Page sections are ds/Tabs (a filter would be a SegmentedControl), and the
    // open section is deep-linkable as ?section=restrictions.
    expect(page).toContain("<Tabs");
    expect(page).toContain('aria-label="Customer sections"');
    expect(page).toContain('const SECTION_PARAM = "section"');
    expect(page).toContain('key: "restrictions"');
    expect(page).toContain("<CustomerRestrictions");
    // The section and its records need access.read; without it there is no tab row.
    expect(page).toContain('usePanelPermission("access.read")');
    expect(page).toContain('canReadAccess ? requestedSection : "directory"');
    expect(page).toContain("fetchAdminSuspensions");
    // The KPI tiles belong to the Directory section.
    expect(page.indexOf('label="All-time customers"')).toBeGreaterThan(
      page.indexOf('section === "restrictions" ?'),
    );
    // The tab label's count is neutral text, not a count pill.
    expect(page).toContain("`Restrictions · ${activeRestrictions}`");
  });

  it("no longer carries a restricted scope or a Restriction column in the directory", () => {
    expect(page).not.toContain('"restricted"');
    expect(page).not.toContain("restrictedScope");
    expect(page).not.toContain("Restriction</th>");
    expect(page).not.toContain("restrictionAsDirectoryRow");
    expect(page).not.toContain("customer-directory-restricted");
  });

  it("lists restrictions with the lift behind access.write and a confirmation", () => {
    expect(restrictions).toContain('usePanelPermission("access.write")');
    expect(restrictions).toContain('permission="access.write"');
    expect(restrictions).toContain("postLiftSuspension");
    // A lift re-pulls this list and the directory rows through the refresh bus.
    expect(restrictions).toContain("emitRefresh()");
    expect(restrictions).toContain('title="Lift restriction"');
    // Toolbar: status scope, search, type, Reset.
    expect(restrictions).toContain("<PageToolbar");
    expect(restrictions).toContain('aria-label="Restriction status"');
    expect(restrictions).toContain('aria-label="Restriction type"');
    // Stacked cards on a phone; every cell labelled by ds/DataTable.
    expect(restrictions).toContain("<DataTable");
    expect(restrictions).toContain('mobileLayout="stack"');
    // Customer 360 through the shared navigation helper.
    expect(restrictions).toContain("openCustomerWorkspace(");
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
    // The card head is the primary way in (ds/RecordOpen); the footer button stays as the labelled one.
    expect(page).toContain("<RecordOpen");
    expect(page).toContain("customer-directory-open");
    expect(page).not.toContain("<RecordLink");
  });

  it("names the destination once — Customer 360 — on the head, the row action and the overlay", () => {
    const overlay = source("../src/components/Customer360Overlay.tsx");
    expect(page).toContain('title="Open Customer 360"');
    expect(page).not.toContain("Open customer workspace");
    expect(overlay).toContain("<span>Customer 360</span>");
    expect(overlay).not.toContain("Customer record");
  });

  it("reads the directory's status at a glance and keeps the table inside its frame", () => {
    // One Status column, sorted by severity; the inline "App access" / "Support" labels are gone
    // from the cell and live on as the stacked phone card's lines and the cell title.
    expect(page).toContain('label="Status"');
    expect(page).toContain('sortKey="status"');
    expect(page).not.toContain('label="Support"');
    expect(page).not.toContain("customer-directory-status-label");
    expect(page).toContain("customer-directory-status-flags");
    expect(page).toContain("customer-directory-status-lines");
    expect(page).toContain("title={status.summary}");
    // The free-text cells ellipsise at the measured caps with the full value in their title.
    expect(page).toContain("const CONTACT_CELL_MAX = 150;");
    expect(page).toContain("const DEVICE_CELL_MAX = 210;");
    expect(page).toContain("const LOCATION_CELL_MAX = 190;");
    expect(page.match(/customer-directory-secondary-cell cell-truncate"/g)).toHaveLength(3);
    const css = source("../src/theme/customer-directory.css");
    expect(css.replace(/\s+/g, " ")).toContain(
      ".customer-directory-status-flags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; max-width: 196px; }",
    );
    // The status badges are the ds size, like the Version badge beside them: no per-cell font size.
    expect(css).not.toContain(".customer-directory-status-cell .badge");
  });

  it("aligns the card head's text from the left and paints the name as tappable on the stacked card", () => {
    const css = source("../src/theme/customer-directory.css");
    const head = css.match(/\.customer-directory-open \{([^}]*)\}/)?.[1].replace(/\s+/g, " ");
    // A <button> centres its text by default; the name span inherits, so the rule sits on the button.
    expect(head).toContain("text-align: left;");
    // Touch has no hover: below 900px the name rests in the record link's hover paint.
    const stackedAt = css.indexOf("@media (max-width: 900px)");
    expect(css.slice(stackedAt).replace(/\s+/g, " ")).toContain(
      ".customer-directory-open .record-link { color: var(--accent-text); text-decoration: underline;",
    );
    // On desktop the name keeps the rows' treatment: painted on hover only.
    const desktopRules = css
      .slice(0, stackedAt)
      .match(/\.customer-directory-open[^{]*\.record-link \{/g);
    expect(desktopRules).toHaveLength(1);
    expect(desktopRules?.[0]).toContain(":hover");
  });
});
