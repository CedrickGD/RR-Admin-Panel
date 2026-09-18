import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * ds/SegmentedControl inside a ds/PageToolbar, at touch and phone width.
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
 *
 * The primitive is split across two breakpoints, and which half sits where is
 * the contract:
 *
 * - 900px, the HEIGHT. Four workspaces had each raised their own segments to
 *   44px at 900 (Live and Session history as `[role="radio"]`, Versions and
 *   Customers as `.ds-seg-btn` — the same button either way), and only two of
 *   them also unlocked the control, so the 390px spill was still live one band
 *   up. Measured at 800 before this: Session history's segment bottom 362
 *   against a control bottom of 357, Customers → Restrictions 313.3 against
 *   308.3. With the unlock in the primitive all nine pages are one 52px
 *   control with 44px segments at 800, every segment 4px inside its own
 *   border, and the copies come out.
 * - 768px, the LAYOUT (full width, wrapping row, `flex: 1 1 auto`). It stays
 *   with the rest of the stacked phone toolbar because above 768 nothing
 *   stretches .page-toolbar-left: moving `width: 100%` up to 900 measures as
 *   the same box on every page, so it would only mislead the next reader.
 *
 * What the primitive owns is therefore the CONTROL's height — that is the half
 * of the pairing pages kept forgetting, and no layer outside the ds sheets may
 * set it again. A page may still sweep `[role="radio"]` up to 44px alongside
 * its own buttons; that is redundant now, but it cannot spill, because the
 * control is no longer locked and grows to hold whatever it is given.
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
const TOUCH_QUERY = "@media (max-width: 900px)";
const PHONE_QUERY = "@media (max-width: 768px)";
const toolbarStart = components.indexOf(".page-toolbar {");
const touchStart = components.indexOf(TOUCH_QUERY, toolbarStart);
const phoneStart = components.indexOf(PHONE_QUERY, toolbarStart);
const phoneEnd = components.indexOf("/* ═", phoneStart);
const touch = stripComments(components.slice(touchStart, phoneStart));
const phone = stripComments(components.slice(phoneStart, phoneEnd));
const desktop = stripComments(components.slice(0, touchStart));

// Forward slashes even on Windows: the paths below are matched on, not opened
// by anything but readFileSync, which takes either.
const THEME_DIR = fileURLToPath(new URL("../src/theme/", import.meta.url)).replace(/\\/g, "/");
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

/** The workspace sheets — everything in the theme except the ds layer itself. */
const workspaceFiles = (): string[] => themeFiles().filter((f) => !f.includes("/css/"));

const body = (css: string, selector: string): string | undefined =>
  rules(css).find((rule) => rule.selector === selector)?.body;

describe("segmented control in a page toolbar, at touch and phone width", () => {
  it("finds the toolbar's touch and phone sections, in that order", () => {
    expect(touchStart).toBeGreaterThan(toolbarStart);
    expect(phoneStart).toBeGreaterThan(touchStart);
    expect(phoneEnd).toBeGreaterThan(phoneStart);
    expect(touch).toContain(TOUCH_QUERY);
    expect(phone).toContain(PHONE_QUERY);
    // The wider query has to come first: the two declare the same properties
    // at equal specificity, so on a phone it is source order that lets the
    // narrower one win.
    expect(touchStart).toBeLessThan(phoneStart);
  });

  it("puts the touch height one breakpoint above the phone layout", () => {
    // 900, not 768: that is the band four workspaces had each already raised
    // their own segments in, and the band the 5px spill was measured in.
    expect(body(touch, ".page-toolbar .ds-seg")).toBeDefined();
    expect(body(touch, ".page-toolbar .ds-seg-btn")).toBeDefined();
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
    const seg = body(touch, ".page-toolbar .ds-seg");
    expect(seg, "the touch section must re-declare .page-toolbar .ds-seg").toBeDefined();
    expect(seg).toContain("height: auto;");
    expect(seg).toContain("min-height: var(--control-h-touch);");
    // Source order is what wins here: both selectors are (0,2,0).
    expect(components.indexOf(".page-toolbar .ds-seg {")).toBeLessThan(touchStart);
  });

  it("gives the segments the touch target the control was unlocked for", () => {
    const btn = body(touch, ".page-toolbar .ds-seg-btn");
    expect(btn).toBeDefined();
    expect(btn).toContain("min-height: var(--control-h-touch);");
    // `height: auto` and the min-height are one decision: a fixed height on a
    // segment is what Customers had, and what made it overflow the control.
    expect(btn).toContain("height: auto;");
  });

  it("keeps the full-width wrapping row on the phone breakpoint", () => {
    const seg = body(phone, ".page-toolbar .ds-seg");
    expect(seg, "the phone section must re-declare .page-toolbar .ds-seg").toBeDefined();
    expect(seg).toContain("width: 100%;");
    expect(seg).toContain("flex-wrap: wrap;");
    const btn = body(phone, ".page-toolbar .ds-seg-btn");
    expect(btn).toBeDefined();
    expect(btn).toMatch(/flex: 1 1 auto;/);
    expect(btn).toContain("justify-content: center;");
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

  it("leaves the control's own height to the primitive, in every workspace", () => {
    // This is the half of the pairing the pages kept forgetting, and it is the
    // whole reason a segment could hang outside its control: five workspaces
    // raised a 44px segment, three re-declared the box around it, and the two
    // that did not spilled. Nothing outside the ds sheets sets it again.
    for (const file of workspaceFiles()) {
      for (const rule of rules(stripComments(readFileSync(file, "utf8")))) {
        if (!/\.ds-seg(?![-\w])/.test(rule.selector)) continue;
        expect(rule.body, `${file}: ${rule.selector}`).not.toMatch(/(?:^|[;\s])(?:min-)?height:/);
      }
    }
  });

  it("never pins a segment to a height of its own, in any workspace", () => {
    // Customers had `height: 44px` on its segments while the toolbar still
    // locked the control to 34px — measured at 800 on Restrictions: segment
    // bottom 313.3 against a control bottom of 308.3. The ds layer's own
    // `calc(var(--control-h) - 8px)` is the desktop lock the touch section
    // above releases; a page reaching for a pixel height is the copy again.
    for (const file of workspaceFiles()) {
      for (const rule of rules(stripComments(readFileSync(file, "utf8")))) {
        if (!/(?:\.ds-seg-btn|\[role="radio"\])(?![-\w])/.test(rule.selector)) continue;
        expect(rule.body, `${file}: ${rule.selector}`).not.toMatch(/(?:^|[;\s])height:/);
      }
    }
  });

  it("names the two pages allowed to override the primitive's segment flex", () => {
    // Both have a reason the primitive cannot know:
    // - Session history keeps its four scope pills on one row rather than let
    //   the last wrap alone, which needs `flex: none`;
    // - Traffic takes the full-width stacked toolbar at its own 800, one band
    //   above the primitive's 768, so it has to divide that row itself.
    // Any third file here is a copy coming back.
    const overriding = workspaceFiles().filter((file) =>
      rules(stripComments(readFileSync(file, "utf8"))).some(
        (rule) =>
          /(?:\.ds-seg-btn|\[role="radio"\])(?![-\w])/.test(rule.selector) &&
          /(?:^|[;\s])flex:/.test(rule.body),
      ),
    );
    expect(overriding.map((f) => f.slice(f.lastIndexOf("/") + 1)).sort()).toEqual([
      "session-history-workspace.css",
      "traffic-workspace.css",
    ]);
    // And Session history says why, next to the rule.
    expect(source("../src/theme/session-history-workspace.css")).toMatch(
      /stay on one row[\s\S]{0,700}\[role="radio"\] \{\s*flex: none;/,
    );
  });
});
