/* ═══════════════════════════════════════════════════════════════
   HUE-AWARE ACCENT CONTRAST
   The accent hue is user-tunable 0–360°, but --on-accent (#fff) and
   --accent-text were fixed formulas, so a cyan/green/gold accent dropped
   primary-button text to ~1.5:1 and light-theme accent labels to ~2.8:1.
   These helpers derive the hue-dependent values from the hue itself:
     • the accent lightness (--al) that is actually painted,
     • the ink laid on top of it (--on-accent),
     • the accent-coloured text on the page ground (--accent-text),
     • the primary button's hover fill and its ink (--accent-hover,
       --on-accent-hover) — a hover that repaints the fill has to re-verify
       the ink on it, or the button only passes while nobody is pointing at it,
   each verified against WCAG AA (4.5:1) before it is handed out.
   Pure functions, no DOM — useAppearance is the one writer of the result as
   inline custom properties on <html>. The static formulas in
   theme/tokens/accent.css and theme/workspace.css stay as the
   pre-hydration fallback and are tuned to the same numbers.
   ═══════════════════════════════════════════════════════════════ */

export type AccentTheme = "dark" | "light";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** WCAG 2.1 AA for body text and UI labels. */
export const AA_CONTRAST = 4.5;

/** --as; the accent saturation never moves, only the lightness does. */
export const ACCENT_SATURATION = 83;

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/* The dark ink is tinted with the accent hue so a yellow button reads as a
   dark yellow-brown rather than as flat black on colour. */
const INK_SATURATION = 60;
const INK_LIGHTNESS = 10;

/* --accent-text is rarely painted on the bare surface: .btn-accent-ghost,
   .tile-icon and .ds-seg-btn.is-active all sit on --accent-subtle, the accent at
   12% over the surface. Measuring against that tint is the harder case in both
   themes (it lifts a dark ground and darkens a light one), so it is the one the
   search uses — a value that clears it also clears the bare surface. */
const ACCENT_SUBTLE_ALPHA = 0.12;

interface ThemeAccent {
  /** --al from theme/workspace.css. */
  baseLightness: number;
  /** How far --al may travel when neither ink clears AA at the base. */
  minLightness: number;
  maxLightness: number;
  /** --surface-1 for this theme; the ground --accent-subtle is composited over. */
  surface: Rgb;
  textSaturation: number;
  /** Preferred --accent-text lightness; the search starts here. */
  textLightness: number;
  textLimit: number;
}

const THEMES: Record<AccentTheme, ThemeAccent> = {
  dark: {
    baseLightness: 58,
    /* Dark can move either way: white wins by going darker, the ink by going
       brighter, so the search takes whichever is closer to the token. */
    minLightness: 42,
    maxLightness: 72,
    /* --surface-1 (#09090b) is the panel the accent text sits on; the page
       --bg (#050505) is darker and only adds contrast. */
    surface: { r: 9, g: 9, b: 11 },
    textSaturation: 85,
    textLightness: 80,
    textLimit: 96,
  },
  light: {
    baseLightness: 47,
    /* Light only ever darkens — a brighter accent on white is the failure we
       are fixing, never the fix. */
    minLightness: 30,
    maxLightness: 47,
    surface: WHITE,
    textSaturation: 66,
    textLightness: 32,
    textLimit: 18,
  },
};

export function normalizeHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  return Math.round(((hue % 360) + 360) % 360);
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lum = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lum - c / 2;
  const segment = Math.floor(hue / 60) % 6;
  const rgb =
    segment === 0
      ? [c, x, 0]
      : segment === 1
        ? [x, c, 0]
        : segment === 2
          ? [0, c, x]
          : segment === 3
            ? [0, x, c]
            : segment === 4
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = Math.min(255, Math.max(0, value)) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Flatten a translucent colour onto an opaque ground (sRGB, the way the browser paints it). */
export function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  const a = Math.min(1, Math.max(0, alpha));
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
  };
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* Fallback lightnesses for the hues where neither ink clears AA at the token
   value, ordered by distance from it so the accent moves as little as possible;
   darker first on a tie, because keeping white ink is the smaller visual change.
   The base itself is not in the list — the caller has already tried it. */
function lightnessCandidates(cfg: ThemeAccent): number[] {
  const out: number[] = [];
  for (let step = 1; step <= cfg.maxLightness - cfg.minLightness; step++) {
    const down = cfg.baseLightness - step;
    const up = cfg.baseLightness + step;
    if (down >= cfg.minLightness) out.push(down);
    if (up <= cfg.maxLightness) out.push(up);
  }
  return out;
}

function textCandidates(cfg: ThemeAccent): number[] {
  const out: number[] = [];
  const step = cfg.textLimit >= cfg.textLightness ? 1 : -1;
  for (let l = cfg.textLightness; step > 0 ? l <= cfg.textLimit : l >= cfg.textLimit; l += step)
    out.push(l);
  return out;
}

export interface AccentInk {
  /** Ready-to-write CSS colour for --on-accent. */
  color: string;
  ratio: number;
  /** True for white, false for the hue-tinted dark ink. */
  white: boolean;
}

/** White or a hue-tinted dark ink on hsl(hue ACCENT_SATURATION lightness) — whichever reads better. */
export function pickOnAccent(hue: number, lightness: number): AccentInk {
  const accent = hslToRgb(hue, ACCENT_SATURATION, lightness);
  const white = contrastRatio(accent, WHITE);
  const ink = contrastRatio(accent, hslToRgb(hue, INK_SATURATION, INK_LIGHTNESS));
  return white >= ink
    ? { color: "#fff", ratio: white, white: true }
    : {
        color: `hsl(${normalizeHue(hue)} ${INK_SATURATION}% ${INK_LIGHTNESS}%)`,
        ratio: ink,
        white: false,
      };
}

/* How far the `.btn-primary` hover fill travels along the accent's lightness
   axis. It always moves AWAY from the ink — darker under white, lighter under
   the dark ink — so hovering deepens the ink's contrast instead of eroding it,
   and the same lightness search that cleared AA for the rest state clears it
   for the hover state too. The old `color-mix(accent 86%, --text-1)` moved
   toward the page text in both themes: in dark that brightened a white-inked
   button from 5.67:1 to 4.50:1 at hue 262 and to 3.50:1 at hue 221, i.e. the
   ink was only ever verified against the fill the button is NOT wearing while
   the pointer is on it. 6 points matches that mix's visual weight (≈5 points
   of lightness) so the hover reads as strongly as it did. */
export const HOVER_LIGHTNESS_STEP = 6;

/** Lightness of the hover fill for an accent painted at `lightness` with `ink`. */
export function hoverLightness(lightness: number, ink: AccentInk): number {
  const step = ink.white ? -HOVER_LIGHTNESS_STEP : HOVER_LIGHTNESS_STEP;
  return Math.min(100, Math.max(0, lightness + step));
}

export interface AccentContrast {
  /** Accent lightness that clears AA for this hue, e.g. 58. */
  lightness: number;
  /** The same value as a CSS length for --al, e.g. "58%". */
  al: string;
  /** --on-accent: "#fff" or "hsl(<hue> 60% 10%)". */
  onAccent: string;
  onAccentRatio: number;
  /** --accent-text: "hsl(<hue> <sat>% <l>%)". */
  accentText: string;
  /** Measured against --accent-subtle over --surface-1 — the worst ground it lands on. */
  accentTextRatio: number;
  /** hsl() of the accent as painted — the honest swatch colour. */
  accent: string;
  /** --accent-hover: the `.btn-primary` hover fill, an hsl() of the same hue. */
  accentHover: string;
  /** --on-accent-hover: the ink re-picked on that fill. Same family as `onAccent`. */
  onAccentHover: string;
  /** Never below `onAccentRatio` — the hover fill only moves away from the ink. */
  onAccentHoverRatio: number;
  /** False when no candidate reached 4.5:1 and the best available was kept. */
  meetsAA: boolean;
}

/**
 * Derive --al / --on-accent / --accent-text for one hue and theme.
 * Deterministic and side-effect free; the callers only write the strings.
 */
export function resolveAccentContrast(hue: number, theme: AccentTheme): AccentContrast {
  const h = normalizeHue(hue);
  const cfg = THEMES[theme] ?? THEMES.dark;

  let lightness = cfg.baseLightness;
  let ink = pickOnAccent(h, lightness);
  if (ink.ratio < AA_CONTRAST) {
    let best = { lightness, ink };
    for (const candidate of lightnessCandidates(cfg)) {
      const next = pickOnAccent(h, candidate);
      if (next.ratio >= AA_CONTRAST) {
        best = { lightness: candidate, ink: next };
        break;
      }
      if (next.ratio > best.ink.ratio) best = { lightness: candidate, ink: next };
    }
    lightness = best.lightness;
    ink = best.ink;
  }

  const textGround = composite(
    hslToRgb(h, ACCENT_SATURATION, lightness),
    cfg.surface,
    ACCENT_SUBTLE_ALPHA,
  );
  let textLightness = cfg.textLightness;
  let textRatio = 0;
  for (const candidate of textCandidates(cfg)) {
    const ratio = contrastRatio(hslToRgb(h, cfg.textSaturation, candidate), textGround);
    if (ratio > textRatio) {
      textLightness = candidate;
      textRatio = ratio;
    }
    if (ratio >= AA_CONTRAST) {
      textLightness = candidate;
      textRatio = ratio;
      break;
    }
  }

  /* The hover fill is derived here, not in CSS, so the ink is verified against
     both fills the button actually wears. Stepping away from the ink cannot
     change which ink wins, so the hover keeps the rest state's colour. */
  const hoverL = hoverLightness(lightness, ink);
  const hoverInk = pickOnAccent(h, hoverL);

  return {
    lightness,
    al: `${lightness}%`,
    onAccent: ink.color,
    onAccentRatio: ink.ratio,
    accentText: `hsl(${h} ${cfg.textSaturation}% ${textLightness}%)`,
    accentTextRatio: textRatio,
    accent: `hsl(${h} ${ACCENT_SATURATION}% ${lightness}%)`,
    accentHover: `hsl(${h} ${ACCENT_SATURATION}% ${hoverL}%)`,
    onAccentHover: hoverInk.color,
    onAccentHoverRatio: hoverInk.ratio,
    meetsAA: ink.ratio >= AA_CONTRAST && textRatio >= AA_CONTRAST,
  };
}

/** The accent exactly as the theme paints it — for swatches that must not lie. */
export function accentColor(hue: number, theme: AccentTheme): string {
  return resolveAccentContrast(hue, theme).accent;
}

/** The hue-dependent custom properties to write on <html>, keyed by property name. */
export function accentCustomProperties(hue: number, theme: AccentTheme): Record<string, string> {
  const resolved = resolveAccentContrast(hue, theme);
  return {
    "--al": resolved.al,
    "--on-accent": resolved.onAccent,
    "--accent-text": resolved.accentText,
    "--accent-hover": resolved.accentHover,
    "--on-accent-hover": resolved.onAccentHover,
  };
}
