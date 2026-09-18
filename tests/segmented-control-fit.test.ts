import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * ds/SegmentedControl inside a ds/PageToolbar, at phone width.
 *
 * Measured on Feedback at 390x844 before this contract existed: the toolbar
 * locks every control it holds to --control-h (34px), the page had given its
 * pills a 44px touch target, and the control's height stayed 34px — so the
 * segments hung 14px out of their own rounded border, with the bottom one at
 * 308 against a card top of 305.7. The layout never knew, because the height
 * was locked. `flex: 1` on the segments made it worse in a second way: a 0
 * basis means every segment's hypothetical size is 0, the line always "fits",
 * and the row overflows on min-content instead of wrapping. What did not fit
 * scrolled sideways inside .page-toolbar-left with no affordance at all.
 *
 * The rules below live in the primitive (css/components.css) so every page
 * gets them: Feedback, Customers, Errors, Releases, Versions, Workers, Live,
 * Traffic, Heatmap and the Restrictions control alike. After the fix, measured
 * at 390: the control is 358px wide inside a 358px card, 52px tall, 12px clear
 * of the card, nothing hidden; with 3-digit counts it wraps to two rows (98px)
 * and still fits, instead of hiding its last segment.
 */
function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Flat rule blocks (selector + body), nested at-rule wrappers ignored. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) out.push({ selector: match[1].trim(), body: match[2] });
  return out;
}

const components = source("../src/theme/css/components.css");
const phoneStart = components.indexOf(
  "@media (max-width: 768px)",
  components.indexOf(".page-toolbar {"),
);
const phoneEnd = components.indexOf("/* ═", phoneStart);
const phone = stripComments(components.slice(phoneStart, phoneEnd));
const desktop = stripComments(components.slice(0, phoneStart));

const THEME_DIR = fileURLToPath(new URL("../src/theme/", import.meta.url));
function themeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
      else if (entry.name.endsWith(".css")) out.push(`${dir}${entry.name}`);
    }
  };
  walk(THEME_DIR);
  return out;
}

const body = (css: string, selector: string): string | undefined =>
  rules(css).find((rule) => rule.selector === selector)?.body;

describe("segmented control in a page toolbar, at phone width", () => {
  it("finds the toolbar's phone section", () => {
    expect(phoneStart).toBeGreaterThan(0);
    expect(phoneEnd).toBeGreaterThan(phoneStart);
    expect(phone).toContain("@media (max-width: 768px)");
  });

  it("declares the touch control height once, as a token", () => {
    const spacing = source("../src/theme/tokens/spacing.css");
    const declarations = [...spacing.matchAll(/--control-h-touch:\s*([^;]+);/g)].map((m) =>
      m[1].trim(),
    );
    expect(declarations).toEqual(["44px"]);
  });

  it("lets the control grow instead of locking it to --control-h", () => {
    // The desktop lock is still there — that is what a filter row lines up to.
    expect(desktop).toMatch(
      /\.page-toolbar :is\(\.btn, \.gdrop-trigger, \.glass-input, \.ds-seg\) \{\s*height: var\(--control-h\);/,
    );
    const seg = body(phone, ".page-toolbar .ds-seg");
    expect(seg, "the phone section must re-declare .page-toolbar .ds-seg").toBeDefined();
    expect(seg).toContain("height: auto;");
    expect(seg).toContain("min-height: var(--control-h-touch);");
    expect(seg).toContain("width: 100%;");
    expect(seg).toContain("flex-wrap: wrap;");
    // Source order is what wins here: both selectors are (0,2,0).
    expect(components.indexOf(".page-toolbar .ds-seg {")).toBeLessThan(phoneStart);
  });

  it("gives the segments a real flex basis, so the row can wrap", () => {
    const btn = body(phone, ".page-toolbar .ds-seg-btn");
    expect(btn).toBeDefined();
    expect(btn).toMatch(/flex: 1 1 auto;/);
    expect(btn).toContain("min-height: var(--control-h-touch);");
    expect(btn).toContain("height: auto;");
  });

  it("never gives a segment a zero flex basis, in any layer", () => {
    for (const file of themeFiles()) {
      for (const rule of rules(stripComments(readFileSync(file, "utf8")))) {
        if (!/\.ds-seg-btn(?![-\w])/.test(rule.selector)) continue;
        const flex = rule.body.match(/(?:^|[;\s])flex:\s*([^;]+);/);
        if (!flex) continue;
        // `flex: 1` and `flex: 1 1 0` both resolve to a 0 basis: the segments
        // then always "fit" one line and overflow on min-content instead.
        expect(flex[1].trim(), `${file}: ${rule.selector}`).not.toMatch(/^\d+(\s+\d+)?(\s+0%?)?$/);
      }
    }
  });

  it("does not hide the overflow behind a sideways scroll", () => {
    const left = body(phone, ".page-toolbar-left");
    expect(left).toBeDefined();
    expect(left).toContain("overflow: visible;");
    // Nowhere in the theme may the scope slot scroll sideways again: that is
    // what clipped "Archived" with no affordance in the first place.
    for (const file of themeFiles()) {
      for (const rule of rules(stripComments(readFileSync(file, "utf8")))) {
        if (!/\.page-toolbar-left(?![-\w])/.test(rule.selector)) continue;
        expect(rule.body, `${file}: ${rule.selector}`).not.toMatch(
          /overflow(-x)?:\s*(auto|scroll)/,
        );
      }
    }
  });

  it("keeps the fix in the primitive, not on the page that found it", () => {
    // Feedback carried its own copy of all of this — including the `flex: 1`
    // that stopped the row wrapping. The primitive owns it now.
    const support = stripComments(source("../src/theme/support-workspace.css"));
    for (const rule of rules(support)) {
      expect(
        rule.selector,
        "support-workspace.css must not restyle the segmented control",
      ).not.toMatch(/\.ds-seg(-btn)?(?![-\w])/);
    }
  });
});
