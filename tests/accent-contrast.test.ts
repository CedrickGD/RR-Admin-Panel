import { describe, expect, it } from "vitest";
import {
  AA_CONTRAST,
  ACCENT_SATURATION,
  accentCustomProperties,
  composite,
  contrastRatio,
  hslToRgb,
  normalizeHue,
  resolveAccentContrast,
  type AccentTheme,
} from "../src/utils/accentContrast";

/* The accent hue is user-tunable 0–360°, so every derived shade has to be
   verified per hue rather than per brand colour. 60 = gold, 186 = cyan (both
   used to burn white-on-accent down to ~1.5:1), 262 = the violet default,
   330 = pink (3.7:1 with the old fixed #fff). */
const HUES = [60, 186, 262, 330];
const THEMES: AccentTheme[] = ["dark", "light"];

/* --surface-1 per theme. --accent-text is judged on --accent-subtle (the accent at
   12%) over it, because that is what .btn-accent-ghost / .tile-icon paint it on. */
const SURFACE = {
  dark: { r: 9, g: 9, b: 11 },
  light: { r: 255, g: 255, b: 255 },
} as const;

function accentTextGround(hue: number, theme: AccentTheme) {
  const { lightness } = resolveAccentContrast(hue, theme);
  return composite(hslToRgb(hue, ACCENT_SATURATION, lightness), SURFACE[theme], 0.12);
}

function parseHsl(value: string) {
  const match = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(value);
  if (!match) throw new Error(`Not an hsl() colour: ${value}`);
  return hslToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseColor(value: string) {
  return value === "#fff" ? { r: 255, g: 255, b: 255 } : parseHsl(value);
}

describe("contrast primitives", () => {
  it("matches the known WCAG anchors", () => {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 is the canonical "smallest grey that passes AA on white".
    expect(contrastRatio(white, { r: 118, g: 118, b: 118 })).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("converts hsl the way the browser does", () => {
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb(120, 100, 50)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(240, 100, 50)).toEqual({ r: 0, g: 0, b: 255 });
    expect(hslToRgb(0, 0, 100)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("normalises hues onto 0–359", () => {
    expect(normalizeHue(-30)).toBe(330);
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(421.4)).toBe(61);
    expect(normalizeHue(Number.NaN)).toBe(0);
  });
});

describe("resolveAccentContrast", () => {
  for (const theme of THEMES) {
    for (const hue of HUES) {
      it(`gives hue ${hue} an AA on-accent ink in the ${theme} theme`, () => {
        const resolved = resolveAccentContrast(hue, theme);
        const accent = hslToRgb(hue, ACCENT_SATURATION, resolved.lightness);
        const measured = contrastRatio(accent, parseColor(resolved.onAccent));
        expect(measured).toBeGreaterThanOrEqual(AA_CONTRAST);
        expect(resolved.onAccentRatio).toBeCloseTo(measured, 6);
        expect(resolved.al).toBe(`${resolved.lightness}%`);
      });

      it(`gives hue ${hue} AA accent text in the ${theme} theme`, () => {
        const resolved = resolveAccentContrast(hue, theme);
        const text = parseHsl(resolved.accentText);
        const measured = contrastRatio(text, accentTextGround(hue, theme));
        expect(measured).toBeGreaterThanOrEqual(AA_CONTRAST);
        expect(resolved.accentTextRatio).toBeCloseTo(measured, 6);
        expect(resolved.meetsAA).toBe(true);
        // Clearing the tinted ground has to imply clearing the bare surface.
        expect(contrastRatio(text, SURFACE[theme])).toBeGreaterThanOrEqual(AA_CONTRAST);
      });
    }
  }

  it("keeps white on the violet default and does not move its lightness", () => {
    expect(resolveAccentContrast(262, "dark")).toMatchObject({ onAccent: "#fff", lightness: 58 });
    expect(resolveAccentContrast(262, "light")).toMatchObject({ onAccent: "#fff", lightness: 47 });
  });

  it("switches to a hue-tinted dark ink where white used to fail", () => {
    // White on hsl(60|186 83% 58%) measured ~1.5:1 before this existed.
    expect(resolveAccentContrast(60, "dark").onAccent).toBe("hsl(60 60% 10%)");
    expect(resolveAccentContrast(186, "dark").onAccent).toBe("hsl(186 60% 10%)");
    expect(resolveAccentContrast(330, "dark").onAccent).toBe("hsl(330 60% 10%)");
  });

  it("never brightens the accent in the light theme", () => {
    for (let hue = 0; hue < 360; hue += 1)
      expect(resolveAccentContrast(hue, "light").lightness).toBeLessThanOrEqual(47);
  });

  it("clears AA for every hue on the slider, in both themes", () => {
    for (const theme of THEMES)
      for (let hue = 0; hue < 360; hue += 1) {
        const resolved = resolveAccentContrast(hue, theme);
        expect(resolved.onAccentRatio).toBeGreaterThanOrEqual(AA_CONTRAST);
        expect(resolved.accentTextRatio).toBeGreaterThanOrEqual(AA_CONTRAST);
      }
  });

  it("is stable across equivalent hues", () => {
    expect(resolveAccentContrast(-174, "dark")).toEqual(resolveAccentContrast(186, "dark"));
  });
});

describe("accentCustomProperties", () => {
  it("writes exactly the hue-dependent custom properties", () => {
    const props = accentCustomProperties(186, "light");
    expect(Object.keys(props).sort()).toEqual([
      "--accent-hover",
      "--accent-text",
      "--al",
      "--on-accent",
      "--on-accent-hover",
    ]);
    const resolved = resolveAccentContrast(186, "light");
    expect(props["--al"]).toBe(resolved.al);
    expect(props["--on-accent"]).toBe(resolved.onAccent);
    expect(props["--accent-text"]).toBe(resolved.accentText);
    expect(props["--accent-hover"]).toBe(resolved.accentHover);
    expect(props["--on-accent-hover"]).toBe(resolved.onAccentHover);
  });
});

/* .btn-primary repaints its fill on hover, so the ink has to clear AA on the
   hover fill as well — the state the pointer is actually in. */
describe("primary hover fill", () => {
  it("clears AA on the hover fill for every hue, in both themes", () => {
    for (const theme of THEMES)
      for (let hue = 0; hue < 360; hue += 1) {
        const resolved = resolveAccentContrast(hue, theme);
        const hoverFill = parseHsl(resolved.accentHover);
        const measured = contrastRatio(hoverFill, parseColor(resolved.onAccentHover));
        expect(measured).toBeGreaterThanOrEqual(AA_CONTRAST);
        expect(resolved.onAccentHoverRatio).toBeCloseTo(measured, 6);
        // Moving away from the ink can never make it lose to the other one.
        expect(resolved.onAccentHover).toBe(resolved.onAccent);
        expect(resolved.onAccentHoverRatio).toBeGreaterThanOrEqual(resolved.onAccentRatio);
      }
  });
});
