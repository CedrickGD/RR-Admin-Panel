import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * A raw <button> skips everything ds/Button owns: the permission gate
 * (usePanelPermission), the variant contract (primary / ghost / accent /
 * danger — never a stray "btn-secondary"), the icon sizing and the focus ring.
 * Pages therefore build their controls from ds/Button, ds/IconButton or
 * ds/RecordLink; src/components/ds and GlassDropdown hold the elements
 * themselves and are exempt by definition.
 *
 * ALLOWED is the remaining justified exceptions plus the number of raw buttons
 * each file may still contain. The count is a ratchet: it may go down (then
 * lower it here, or drop the entry), never up.
 */
const ALLOWED: Array<{ file: string; count: number; why: string }> = [
  {
    file: "src/pages/ErrorsPage.tsx",
    count: 3,
    why: "two whole-row disclosures (.person-cell, .error-group-row) plus one hand-written .btn-ghost",
  },
  {
    file: "src/pages/LivePage.tsx",
    count: 1,
    why: "the .person-cell row disclosure: avatar, name and state in one control",
  },
  {
    file: "src/pages/OverviewPage.tsx",
    count: 1,
    why: ".feed-dismiss on a feed item — an IconButton once the feed styles allow it",
  },
  {
    file: "src/pages/SettingsPage.tsx",
    count: 3,
    why: "appearance swatches (theme, accent hue, background) — pickers, not buttons",
  },
  {
    file: "src/pages/WorkersPage.tsx",
    count: 1,
    why: "the .person-cell row disclosure: avatar, name and state in one control",
  },
  {
    file: "src/components/Customer360Overlay.tsx",
    count: 1,
    why: "the workspace tab strip — migrate to ds/Tabs",
  },
  {
    file: "src/components/Navbar.tsx",
    count: 3,
    why: "sidebar brand and .sb-item nav rows: navigation chrome with its own rail styling",
  },
  {
    file: "src/components/UserActivityPanel.tsx",
    count: 1,
    why: "a timeline segment — a positioned band in a chart, not a control surface",
  },
  {
    file: "src/components/charts/WorldHeatmap.tsx",
    count: 14,
    why: "map overlay controls (zoom, legend, region chips, floating card) — the map paints its own chrome; migrate the two .btn ones to ds/Button next",
  },
];

const root = fileURLToPath(new URL("../", import.meta.url));

function read(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

function rawButtons(file: string): number {
  return (read(file).match(/<button/g) ?? []).length;
}

/**
 * Every file the rule covers: src/pages/** plus src/components/**.
 *
 * The components pass used to read only the TOP LEVEL of src/components, which
 * hid src/components/charts entirely — the largest concentration of raw buttons
 * in the app, reported green.
 *
 * src/components/ds owns the primitives themselves; GlassDropdown is the menu
 * implementation ds/Select wraps. Those two are the only exemptions.
 */
function sources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (`${dir}/${entry.name}` !== "src/components/ds") walk(`${dir}/${entry.name}`);
      } else if (entry.name.endsWith(".tsx") && entry.name !== "GlassDropdown.tsx") {
        files.push(`${dir}/${entry.name}`);
      }
    }
  };
  walk("src/pages");
  walk("src/components");
  return files;
}

describe("controls go through the design system", () => {
  it("has no raw <button> in pages and app components outside the allowlist", () => {
    const allowed = new Set(ALLOWED.map((entry) => entry.file));
    const offenders = sources()
      .filter((file) => !allowed.has(file))
      .filter((file) => rawButtons(file) > 0);
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist a ratchet: no file grows a new raw <button>", () => {
    for (const entry of ALLOWED) {
      expect(rawButtons(entry.file), `${entry.file}: ${entry.why}`).toBeLessThanOrEqual(
        entry.count,
      );
    }
  });

  it("has no stale allowlist entries", () => {
    expect(ALLOWED.filter((entry) => rawButtons(entry.file) === 0).map((e) => e.file)).toEqual([]);
  });

  it("keeps the exempt files exempt on purpose", () => {
    // ds/Button and ds/TableFrame are where the real <button> elements live.
    expect(read("src/components/ds/Button.tsx")).toContain("usePanelPermission(permission)");
    expect(read("src/components/ds/TableFrame.tsx")).toContain("export function RecordLink");
    expect(read("src/components/GlassDropdown.tsx")).toContain("gdrop-trigger");
  });
});
