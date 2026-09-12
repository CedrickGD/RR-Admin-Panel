import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * Handoff 2026-09-12 §2.4: `.stat-card` used to be declared in six files at
 * once and the winner was workspace.css's `min-height: 108px; padding: 20px
 * 22px`, three layers away from the DS file that was supposed to own the tile.
 * Every earlier attempt to make the tile flatter edited a losing rule.
 *
 * This is the ratchet for the fix: the tile's geometry and type scale live in
 * theme/css/components.css and nowhere else. Colour may still come from the
 * theme layers (the translucent fill under an animated background), so the
 * check is on the properties, not on the selector appearing at all.
 */
function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const SPEC_FILE = "../src/theme/css/components.css";
/** Everything else in the cascade — src/index.css plus the four theme layers. */
const OTHER_LAYERS = [
  "../src/index.css",
  "../src/theme/app-glue.css",
  "../src/theme/workspace.css",
  "../src/theme/operations.css",
  "../src/theme/consistency.css",
];
/** Properties that decide how big the tile and its text are. */
const GEOMETRY =
  /(min-height|max-height|padding|font-size|line-height|flex-direction|width|height|gap|margin)\s*:/;

/** Rule blocks whose selector mentions the tile or one of its parts. */
function tileRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!selector || selector.startsWith("@")) continue;
    if (
      !/\.(stat-card|stat-label|stat-value|stat-sub|tile-main|tile-side|tile-icon|tile-spark|tile-line)\b/.test(
        selector,
      )
    )
      continue;
    rules.push({ selector, body: match[2] });
  }
  return rules;
}

describe("KPI tile is specified once", () => {
  it("keeps the tile's geometry and type scale in theme/css/components.css", () => {
    const spec = source(SPEC_FILE);
    // The numbers the handoff asked for: ~64px tall, 10/14 padding, 20px value.
    expect(spec).toContain("min-height: 64px");
    expect(spec).toContain("padding: 10px 14px");
    expect(spec).toMatch(/\.stat-value\s*\{[^}]*font-size:\s*var\(--fs-figure\)/);
    expect(spec).toMatch(/\.stat-label\s*\{[^}]*font-size:\s*var\(--fs-tiny\)/);
    expect(spec).toMatch(/\.stat-sub\s*\{[^}]*font-size:\s*var\(--fs-micro\)/);
    // The icon well is 28px and sits on the left of the text.
    expect(spec).toMatch(/\.tile-icon\s*\{[^}]*width:\s*28px/);
    // No sparkline well unless the call site opts in (KpiStatCard showSpark).
    expect(spec).toContain(".tile-spark { display: none; }");
  });

  it("leaves no sizing rule for the tile in any other layer", () => {
    for (const file of OTHER_LAYERS) {
      const offenders = tileRules(source(file))
        .filter((rule) => GEOMETRY.test(rule.body))
        .map((rule) => `${file}: ${rule.selector}`);
      expect(offenders).toEqual([]);
    }
  });

  it("no longer carries the dead `.stat-card .sparkline` rule", () => {
    // The element is `.tile-spark`; `.sparkline` never existed in the markup.
    for (const file of [SPEC_FILE, ...OTHER_LAYERS]) {
      expect(source(file)).not.toContain(".stat-card .sparkline");
    }
  });
});

describe("PageToolbar is the one filter place on Customers", () => {
  const page = source("../src/pages/CustomersPage.tsx");

  it("puts search and all four filters in the toolbar, not in the panel head", () => {
    expect(page).toContain("<PageToolbar");
    expect(page).toContain('aria-label="Customer filters"');
    // ds/Select only — GlassDropdown is an internal detail of ds/Select now.
    expect(page).not.toContain("GlassDropdown");
    for (const placeholder of [
      "All customers",
      "All versions",
      "All continents",
      "All countries",
    ]) {
      expect(page).toContain(`<option value="">${placeholder}</option>`);
    }
    // The panel head no longer carries a filter row.
    expect(page).not.toContain("customer-directory-controls");
  });

  it("reuses the navbar's search state so both fields stay in step", () => {
    expect(page).toContain('useWorkspaceSearch("customers")');
    expect(page).toContain("<SearchInput");
  });

  it("offers Reset only while a filter differs from its default", () => {
    expect(page).toContain("canReset={hasFilters}");
    expect(page).toContain("onReset={clearFilters}");
    const toolbar = source("../src/components/ds/PageToolbar.tsx");
    expect(toolbar).toContain("{onReset && canReset ?");
  });
});
