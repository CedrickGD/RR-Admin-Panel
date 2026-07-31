import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "rr-accent-hue";
const DEFAULT_HUE = 262; // DS default: violet (existing users keep their stored hue)

export interface AccentPreset {
  label: string;
  hue: number;
  color: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { label: "Purple",  hue: 262, color: "hsl(262 83% 62%)" },
  { label: "Blue",    hue: 221, color: "hsl(221 83% 62%)" },
  { label: "Cyan",    hue: 186, color: "hsl(186 83% 50%)" },
  { label: "Teal",    hue: 160, color: "hsl(160 70% 45%)" },
  { label: "Green",   hue: 142, color: "hsl(142 71% 45%)" },
  { label: "Orange",  hue: 25,  color: "hsl(25 91% 58%)" },
  { label: "Pink",    hue: 330, color: "hsl(330 80% 62%)" },
  { label: "Red",     hue: 4,   color: "hsl(4 80% 60%)" },
  { label: "Indigo",  hue: 240, color: "hsl(240 70% 62%)" },
  { label: "Gold",    hue: 45,  color: "hsl(45 90% 55%)" },
];

function applyHue(hue: number) {
  // The aurora (theme/css/base.css) owns the ground — only the accent hue moves.
  document.documentElement.style.setProperty("--ah", String(hue));
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
