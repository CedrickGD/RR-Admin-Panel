import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The All licenses table at laptop widths. A 1440px window leaves the frame
 * 1110px next to the expanded rail, and the table used to be floored at 1180px
 * with a Linked session column that could not wrap: the pinned action column
 * sat over "Linked session" and its Device details at every real width.
 *
 * The fit is three measured layouts (app-glue.css, license-workspace.css):
 * every column at 1502px; Duration and Usage bowed out below that — both read
 * back in each row's Device details — at 1351px; and below that long text cells
 * capped and the actions two by two, at 1093px, which is also the frame's floor.
 * This pins the numbers to each other and to the 1110px they exist for, so a
 * re-measure edits all three together or fails here.
 */
function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

/** Every `@container tablefit (max-width: Npx) { … }` block in a stylesheet, with its balanced body. */
function tiers(css: string): Array<{ maxWidth: number; body: string }> {
  const out: Array<{ maxWidth: number; body: string }> = [];
  const re = /@container\s+tablefit\s*\(max-width:\s*(\d+)px\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    let depth = 1;
    let index = re.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    out.push({ maxWidth: Number(match[1]), body: css.slice(re.lastIndex, index - 1) });
  }
  return out;
}

const glue = source("../src/theme/app-glue.css");
const workspace = source("../src/theme/license-workspace.css");
const page = source("../src/pages/LicensesPage.tsx");

/** The frame's width in a 1440px window with the rail expanded (measured). */
const FRAME_AT_1440 = 1110;

const floor = Number(page.match(/export const LICENSE_TABLE_FLOOR = (\d+);/)?.[1]);
const columnTier = tiers(glue).find((tier) => /\.license-table \.col-md/.test(tier.body));
const wrapTier = tiers(workspace).find((tier) => /license-row-actions/.test(tier.body));

describe("All licenses fits a 1440px window", () => {
  it("floors the frame at the narrow layout's own width, under what 1440px leaves", () => {
    expect(floor).toBe(1093);
    expect(floor).toBeLessThanOrEqual(FRAME_AT_1440);
    expect(page).toContain("minWidth={LICENSE_TABLE_FLOOR}");
    expect(page).not.toContain("minWidth={1180}");
  });

  it("bows Duration and Usage out below the full table's measured width", () => {
    expect(columnTier?.maxWidth).toBe(1501);
    expect(columnTier?.body.replace(/\s+/g, " ")).toContain(
      ".license-table .col-md { display: none; }",
    );
    // Nothing else on this table is tiered: the other columns have no second home on the row.
    expect((glue.match(/\.license-table \.col-(xl|lg|md)/g) ?? []).length).toBe(1);
  });

  it("caps the long text cells and sets the actions two by two below the six-column width", () => {
    expect(wrapTier?.maxWidth).toBe(1350);
    const body = wrapTier!.body.replace(/\s+/g, " ");
    expect(body).toContain(".license-customer-cell .record-cell { max-width: 180px; }");
    expect(body).toContain(".license-order-cell .record-cell { max-width: 160px; }");
    expect(body).toContain(".license-session-context { max-width: 160px; }");
    expect(body).toContain("grid-template-columns: repeat(2, 30px)");
    // Desktop only: the stacked card below 900px keeps its own full-width action grid.
    const at = workspace.indexOf("@container tablefit (max-width: 1350px)");
    const media = workspace.lastIndexOf("@media (min-width: 901px)", at);
    expect(media).toBeGreaterThan(-1);
    expect(workspace.slice(media, at)).not.toContain("}");
  });

  it("orders the thresholds: narrow layout < six columns < full table", () => {
    expect(floor).toBeLessThan(wrapTier!.maxWidth);
    expect(wrapTier!.maxWidth).toBeLessThan(columnTier!.maxWidth);
  });

  it("lets the bound device's label wrap so it can never widen the column", () => {
    const rule = workspace.match(/\.license-session-context \{([^}]*)\}/)?.[1].replace(/\s+/g, " ");
    expect(rule).toContain("white-space: normal;");
    expect(rule).toContain("overflow-wrap: anywhere;");
    expect(workspace.replace(/\s+/g, " ")).toContain(
      ".license-row-secondary .license-session-context { max-width: 180px; }",
    );
  });
});
