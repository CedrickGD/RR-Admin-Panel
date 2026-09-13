import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("binds its search field to the page's stored search", () => {
    // The navbar search is gone; this field is the only one, and the stored
    // value (including the access redirect's carried-over query) lands here.
    expect(page).toContain('useWorkspaceSearch("customers")');
    expect(page).toContain("<SearchInput");
  });

  it("sits directly above the directory it filters, below the KPI tiles", () => {
    const tiles = page.indexOf('<div className="stat-grid');
    const toolbar = page.indexOf("<PageToolbar");
    const directory = page.indexOf('title="Directory"');
    expect(tiles).toBeGreaterThan(-1);
    expect(toolbar).toBeGreaterThan(tiles);
    expect(directory).toBeGreaterThan(toolbar);
  });

  it("offers Reset only while a filter differs from its default", () => {
    expect(page).toContain("canReset={hasFilters}");
    expect(page).toContain("onReset={clearFilters}");
    const toolbar = source("../src/components/ds/PageToolbar.tsx");
    expect(toolbar).toContain("{onReset && canReset ?");
  });
});

describe("tiles on a phone", () => {
  it("shows two KPI tiles per row at <=600px and lets an odd last tile span the row", () => {
    const layer = source("../src/theme/consistency.css");
    expect(layer).toMatch(
      /html\[data-theme\] \.stat-grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(layer).toContain(".stat-card:nth-of-type(odd):last-of-type");
  });

  /*
   * Regression guard for the desktop tile-height bug introduced by bcdf846:
   * the stacked, wrapping narrow-tile layout was gated on tile container
   * width alone (`@container tile (max-width: 200px)`), which also fires on
   * desktop for a fixed 5-up/6-up KPI row (TrafficPage, HeatmapPage) once
   * those columns get narrower than 200px — stretching every tile there from
   * 64px to 82px even at 1440px. The stacking rules (and the top-align fix
   * for it, see below) must sit inside the same `@media (max-width: 600px)`
   * that switches `.stat-grid` to two columns, so they can never fire above
   * that viewport width regardless of how narrow a desktop column gets.
   * `.tile-side` dropping (the icon well) is the one exception: it is meant
   * to fire on container width alone, at any viewport.
   */
  it("gates the stacked narrow-tile layout on the phone viewport, not container width alone", () => {
    const spec = source(SPEC_FILE);
    const phoneBlockMatch = spec.match(
      /@media \(max-width: 600px\) \{\s*@container tile \(max-width: 200px\) \{([\s\S]*?)\n {2}\}\n(?:[\s\S]*?)\n\}/,
    );
    expect(
      phoneBlockMatch,
      "expected a @media(<=600px) > @container(tile,<=200px) block",
    ).not.toBeNull();
    const [fullMatch, containerBody] = phoneBlockMatch!;

    // The stacking rules live inside the nested container query, so they are
    // reachable only when both the phone viewport and the narrow tile apply.
    for (const selector of [".tile-line", ".stat-label", ".stat-sub-text"]) {
      expect(containerBody, selector).toContain(selector);
    }

    // .stat-card is the query container itself (`container-name: tile`) — a
    // container query cannot restyle the element that queries it (CSS
    // Containment spec), so its top-align override must sit in the outer
    // @media block, not nested inside @container, or it silently never
    // applies. Assert it is present in the outer block but not inside the
    // inner @container body.
    expect(fullMatch).toMatch(/\.stat-card\s*\{\s*align-items:\s*flex-start;?\s*\}/);
    expect(containerBody).not.toContain(".stat-card {");

    // The icon well drop is the one rule meant to fire on container width
    // alone, at any viewport — it must NOT be inside the phone-only @media.
    const iconWellRule = spec.match(
      /@container tile \(max-width: 200px\) \{\s*\.tile-side \{ display: none; \}\s*\}/,
    );
    expect(
      iconWellRule,
      "expected an unconditional (non-@media-gated) icon-well rule",
    ).not.toBeNull();
  });
});

/*
 * Handoff 2026-09-12 §2.3, rolled out: one PageToolbar per page that filters
 * anything, directly above the list it filters; ds/SearchInput and ds/Select
 * as the only search and dropdown; no navbar search; no second filter row.
 */
describe("one filter place per page", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));

  function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir + "/" + entry.name;
      if (entry.isDirectory()) out.push(...tsxFiles(path));
      else if (entry.name.endsWith(".tsx")) out.push(path);
    }
    return out;
  }
  const read = (file: string) => readFileSync(join(root, file), "utf8");

  it("keeps GlassDropdown an internal detail of ds/Select", () => {
    const offenders = [...tsxFiles("src/pages"), ...tsxFiles("src/components")]
      .filter(
        (file) =>
          file !== "src/components/ds/Select.tsx" && file !== "src/components/GlassDropdown.tsx",
      )
      .filter((file) => /import[^;]*\bGlassDropdown\b[^;]*from/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("has no search field in the navbar", () => {
    const nav = read("src/components/Navbar.tsx");
    expect(nav).not.toContain("workspace-search");
    expect(nav).not.toContain("<input");
    expect(nav).not.toContain("useWorkspaceSearch");
  });

  it("retires the old filter homes and the empty filterBar slots", () => {
    for (const file of tsxFiles("src/pages")) {
      const text = read(file);
      expect(text, file).not.toMatch(
        /className="(filters|monitor-toolbar|monitor-filter-row|monitor-filter|user-directory-controls[^"]*)"/,
      );
      expect(text, file).not.toContain("filterBar");
    }
    expect(read("src/App.tsx")).not.toContain("filterBar");
  });

  it("gives every page that filters a PageToolbar, and no toolbar to the pages that do not", () => {
    for (const page of [
      "Customers",
      "Licenses",
      "Live",
      "Workers",
      "Errors",
      "Feedback",
      "Heatmap",
      "Traffic",
      "Versions",
    ]) {
      expect(read("src/pages/" + page + "Page.tsx"), page).toContain("<PageToolbar");
    }
    for (const page of ["Overview", "Announcements", "SystemStatus", "Settings", "Team"]) {
      expect(read("src/pages/" + page + "Page.tsx"), page).not.toContain("<PageToolbar");
    }
  });

  it("keeps SegmentedControl a radiogroup; page sections are ds/Tabs", () => {
    const segmented = read("src/components/ds/SegmentedControl.tsx");
    expect(segmented).not.toContain('"tablist"');
    expect(segmented).toContain('role="radiogroup"');
  });
});

/*
 * Regression guard: a broad deletion (5aa972c, removing the navbar search's
 * `.search-results*` CSS) took the adjacent `.chart-legend*` rules with it in
 * the same hunk. Colour is data encoding on a chart legend (Overview,
 * Traffic) — the swatch and the one-row layout must not go dark again.
 */
describe("chart legend keeps its swatches", () => {
  const spec = source(SPEC_FILE);

  it("lays the legend out as one inline row", () => {
    expect(spec).toMatch(/\.chart-legend\s*\{[^}]*display:\s*flex/);
    expect(spec).toMatch(/\.chart-legend\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it("gives each legend item a sized, coloured swatch", () => {
    expect(spec).toMatch(/\.chart-legend-swatch\s*\{[^}]*width:\s*10px/);
    expect(spec).toMatch(/\.chart-legend-swatch\s*\{[^}]*height:\s*10px/);
    // Background comes inline per-series (ChartLegend.tsx); the dashed
    // variant only needs to be reshaped into a line.
    expect(spec).toMatch(/\.chart-legend-swatch-dashed\s*\{[^}]*height:\s*3px/);
  });
});
