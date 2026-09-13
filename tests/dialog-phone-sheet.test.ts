import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * At <=600px ds/Modal is a full-screen sheet. On a real Android Chrome it used
 * to inherit the desktop card's entrance: the overlay faded 0 -> 1, the sheet
 * faded 0 -> 1 inside it (opacities multiply) and rose 12px. At rest the sheet
 * was fine, but for the whole open and close the page underneath showed
 * through a sheet that covers the entire screen, with a 12px strip of page
 * above it (device: t=0 opacity 0 / top 12px / bottom 12px past the viewport,
 * t=100ms opacity 0.95). Headless screenshots never saw it because the visual
 * harness disables transitions.
 *
 * The guard: inside the phone block neither layer ever fades, the sheet fills
 * the dynamic viewport with an opaque fill, and the desktop card keeps its
 * own fade + scale entrance.
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
  while ((match = re.exec(css))) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

const components = source("../src/theme/css/components.css");
const phoneStart = components.indexOf("/* ≤600px: the dialog is a full-screen sheet.");
const phoneEnd = components.indexOf("/* ── KPI drill-down contents");
const phone = stripComments(components.slice(phoneStart, phoneEnd));
const desktop = stripComments(components.slice(0, phoneStart));

describe("dialog sheet on a phone", () => {
  it("finds the <=600px sheet section", () => {
    expect(phoneStart).toBeGreaterThan(0);
    expect(phoneEnd).toBeGreaterThan(phoneStart);
    expect(phone).toContain("@media (max-width: 600px)");
  });

  it("never fades the sheet or its overlay", () => {
    // No state inside the phone section may take either layer below opacity 1.
    expect(phone).not.toMatch(/opacity:\s*0(?![.\d]*[1-9])/);
    for (const rule of rules(phone)) {
      if (!/\.dialog\b/.test(rule.selector)) continue;
      const transition = rule.body.match(/transition:\s*([^;]+);/);
      if (!transition) continue;
      if (/>\s*\.dialog\b/.test(rule.selector)) {
        // The sheet itself only ever moves.
        expect(transition[1], rule.selector).not.toContain("opacity");
        continue;
      }
      // The overlay may drop out in one delayed zero-length step, never a fade.
      for (const part of transition[1].split(",")) {
        if (part.includes("opacity")) {
          expect(part.trim(), rule.selector).toMatch(/^opacity 0s\b/);
        }
      }
    }
  });

  it("pins opacity 1 on the entrance from-frame and on the closed sheet", () => {
    expect(phone).toMatch(
      /@starting-style \{\s*\.dialog-overlay \{\s*opacity: 1;\s*\}\s*\.dialog-overlay > \.dialog \{\s*opacity: 1;\s*transform: none;\s*\}\s*\}/,
    );
    expect(phone).toMatch(
      /\.dialog-overlay\[data-state="closed"\] > \.dialog \{\s*opacity: 1;\s*transform: none;\s*\}/,
    );
    // The closed overlay only disappears after the sheet has slid out.
    expect(phone).toMatch(
      /\.dialog-overlay\[data-state="closed"\] \{\s*transition: opacity 0s linear 0\.2s;\s*\}/,
    );
  });

  it("moves the sheet by transform only, from the bottom edge", () => {
    expect(phone).toMatch(
      /@starting-style \{\s*\.dialog-overlay > \.dialog \{\s*transform: translateY\(100%\);\s*\}\s*\}/,
    );
    expect(phone).toMatch(
      /\.dialog-overlay > \.dialog \{\s*transition: transform 0\.2s var\(--ease-out\);\s*\}/,
    );
  });

  it("fills the dynamic viewport with an opaque fill", () => {
    const sheet = rules(phone).find(
      (rule) => rule.selector === ".dialog-overlay > .dialog" && rule.body.includes("height"),
    );
    expect(sheet).toBeDefined();
    const body = sheet!.body;
    expect(body).toMatch(/height: 100vh;\s*height: 100dvh;/);
    expect(body).toContain("max-height: none;");
    expect(body).toContain("background: var(--workspace-dialog);");
    expect(phone).toMatch(/\.dialog-overlay \{\s*padding: 0;\s*align-items: stretch;\s*\}/);

    // The token behind the fill has no alpha channel in either theme.
    const colors = source("../src/theme/tokens/colors.css");
    const dialogFills = [...colors.matchAll(/--workspace-dialog:\s*([^;]+);/g)].map((m) => m[1]);
    expect(dialogFills.length).toBeGreaterThan(0);
    for (const fill of dialogFills) expect(fill.trim()).toBe("var(--surface-float)");
    const floats = [...colors.matchAll(/--surface-float:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(floats.length).toBeGreaterThan(0);
    for (const value of floats) expect(value).toMatch(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
    expect(source("../src/theme/consistency.css")).toMatch(
      /html\[data-theme\] \.dialog \{\s*background: var\(--workspace-dialog\);\s*\}/,
    );
  });

  it("keeps the desktop card's fade and scale entrance", () => {
    expect(desktop).toMatch(
      /@starting-style \{\s*\.dialog-overlay \{\s*opacity: 0;\s*\}\s*\.dialog \{\s*opacity: 0;\s*transform: scale\(0\.97\);\s*\}\s*\}/,
    );
    expect(desktop).toMatch(
      /\.dialog-overlay\[data-state="closed"\] \.dialog \{\s*opacity: 0;\s*transform: scale\(0\.97\);\s*\}/,
    );
  });

  it("leaves the dialog's motion to components.css alone", () => {
    for (const layer of [
      "../src/index.css",
      "../src/theme/app-glue.css",
      "../src/theme/workspace.css",
      "../src/theme/operations.css",
      "../src/theme/consistency.css",
    ]) {
      for (const rule of rules(stripComments(source(layer)))) {
        if (!/\.dialog(?:-overlay)?(?![-\w])/.test(rule.selector)) continue;
        expect(rule.body, `${layer}: ${rule.selector}`).not.toMatch(
          /(^|[;\s])(opacity|transform|transition|animation)\s*:/,
        );
      }
    }
  });
});
