import { useCallback, useEffect, useRef, useState } from "react";
import { accentCustomProperties, type AccentTheme } from "../utils/accentContrast";

const STORAGE_KEY = "rr-accent-hue";
const DEFAULT_HUE = 262; // DS default: violet (existing users keep their stored hue)

export interface AccentPreset {
  label: string;
  hue: number;
}

/* Readability is no longer a reason to drop a hue: utils/accentContrast derives
   --al, --on-accent and --accent-text per hue, so gold, green, teal and cyan now
   clear WCAG AA (they get a hue-tinted dark ink on the accent instead of white).
   One band stays out of the presets — the custom slider still allows any hue:
   - semantics: ~355–15° is --danger's hue (hsl(4 86% 58%) dark / #cb3535 light) and
     ~15–45° is --warning's. An accent there makes primary buttons, links and focus
     rings indistinguishable from error and warning states, which no amount of
     contrast tuning fixes. Red and Orange are therefore deliberately absent. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { label: "Green",   hue: 142 },
  { label: "Teal",    hue: 160 },
  { label: "Cyan",    hue: 186 },
  { label: "Blue",    hue: 221 },
  { label: "Indigo",  hue: 240 },
  { label: "Purple",  hue: 262 },
  { label: "Pink",    hue: 330 },
];

function currentTheme(): AccentTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyHue(hue: number) {
  // The aurora (theme/css/base.css) owns the ground — only the accent hue moves.
  document.documentElement.style.setProperty("--ah", String(hue));
  // …and the three shades whose safe value depends on that hue (see useAppearance.apply).
  const accent = accentCustomProperties(hue, currentTheme());
  for (const name of Object.keys(accent))
    document.documentElement.style.setProperty(name, accent[name]);
}

/* Slider-driven persistence: the var writes stay per-frame (React effects), but
   localStorage only commits after 250ms of idle so a scrub is one write, not
   hundreds. Skipping the flush on unmount is fine — next boot re-reads the
   last persisted value. */
function debouncePersist(fn: () => void, ref: { t: number }) {
  window.clearTimeout(ref.t);
  ref.t = window.setTimeout(fn, 250);
}

/* ── Background position ─────────────────────────────────────────
   The liquid-aurora layers (app-glue.css html::before/after) leave a
   dark corner wherever the blobs happen not to reach. These offsets
   shift the whole painted background so the user can slide the color
   under the corner they care about. Applied inside the keyframes via
   calc(... + var(--bg-ox/--bg-oy)), persisted per browser and applied
   at module load so the choice holds from boot. */
const BG_OFFSET_KEY = "rr-bg-offset";
export const BG_OFFSET_RANGE = 18; // % — stays inside the layers' -18% overdraw

interface BgOffset {
  x: number;
  y: number;
}

function readBgOffset(): BgOffset {
  try {
    const raw = localStorage.getItem(BG_OFFSET_KEY);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as Partial<BgOffset>;
    const clamp = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(-BG_OFFSET_RANGE, Math.min(BG_OFFSET_RANGE, v)) : 0;
    return { x: clamp(parsed.x), y: clamp(parsed.y) };
  } catch {
    return { x: 0, y: 0 };
  }
}

function applyBgOffset(offset: BgOffset) {
  const root = document.documentElement.style;
  root.setProperty("--bg-ox", `${offset.x}%`);
  root.setProperty("--bg-oy", `${offset.y}%`);
}

applyBgOffset(readBgOffset());

export function useBackgroundOffset() {
  const [offset, setOffsetState] = useState<BgOffset>(readBgOffset);
  const persistTimer = useRef({ t: 0 });

  useEffect(() => {
    applyBgOffset(offset);
  }, [offset]);

  const setOffset = useCallback((next: Partial<BgOffset>) => {
    setOffsetState((prev) => {
      const merged = { ...prev, ...next };
      debouncePersist(() => {
        try { localStorage.setItem(BG_OFFSET_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      }, persistTimer.current);
      return merged;
    });
  }, []);

  return { offset, setOffset } as const;
}

export function useAccent() {
  const [hue, setHueState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? Number(stored) : Number.NaN;
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 360 ? parsed : DEFAULT_HUE;
    } catch {
      return DEFAULT_HUE;
    }
  });

  const persistTimer = useRef({ t: 0 });

  // Apply on mount and whenever hue changes
  useEffect(() => {
    applyHue(hue);
  }, [hue]);

  const setHue = useCallback((newHue: number) => {
    const clamped = Math.max(0, Math.min(360, Math.round(newHue)));
    setHueState(clamped);
    debouncePersist(() => {
      try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
    }, persistTimer.current);
  }, []);

  const activePreset = ACCENT_PRESETS.find((p) => p.hue === hue) ?? null;

  return { hue, setHue, activePreset, presets: ACCENT_PRESETS } as const;
}
