import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "rr-appearance";

export interface AppearanceSettings {
  panelBrightness: number;    // 0.4–2.0, multiplier for glass layers
  glowIntensity: number;      // 0–2.0, accent glow strength
  borderVisibility: number;   // 0–2.0, border opacity multiplier
  textContrast: number;       // 0.6–1.0, primary text opacity
  navbarBlur: number;         // 0–40, backdrop blur px
  panelRadius: number;        // 0–24, border-radius px
  statCardGlow: boolean;      // top glow line on stat cards
}

const DEFAULTS: AppearanceSettings = {
  panelBrightness: 1,
  glowIntensity: 1,
  borderVisibility: 1,
  textContrast: 0.93,
  navbarBlur: 20,
  panelRadius: 14,
  statCardGlow: true,
};

function apply(s: AppearanceSettings) {
  const el = document.documentElement;

  // Panel brightness — scales glass layer opacity
  const pb = Math.max(0.4, Math.min(2, s.panelBrightness));
  el.style.setProperty("--glass-1", `rgba(255,255,255,${(0.03 * pb).toFixed(4)})`);
  el.style.setProperty("--glass-2", `rgba(255,255,255,${(0.055 * pb).toFixed(4)})`);
  el.style.setProperty("--glass-3", `rgba(255,255,255,${(0.085 * pb).toFixed(4)})`);

  // Glow intensity
  const gi = Math.max(0, Math.min(2, s.glowIntensity));
  el.style.setProperty("--accent-glow", `hsl(var(--ah) var(--as) var(--al) / ${(0.32 * gi).toFixed(3)})`);
  el.style.setProperty("--accent-subtle", `hsl(var(--ah) var(--as) var(--al) / ${(0.12 * gi).toFixed(3)})`);

  // Border visibility
  const bv = Math.max(0, Math.min(2, s.borderVisibility));
  el.style.setProperty("--glass-border", `rgba(255,255,255,${(0.072 * bv).toFixed(4)})`);
  el.style.setProperty("--glass-border2", `rgba(255,255,255,${(0.14 * bv).toFixed(4)})`);

  // Text contrast
  const tc = Math.max(0.6, Math.min(1, s.textContrast));
  el.style.setProperty("--text-1", `rgba(255,255,255,${tc.toFixed(2)})`);

  // Navbar blur
  const nb = Math.max(0, Math.min(40, s.navbarBlur));
  el.style.setProperty("--glass-blur", `blur(${nb}px) saturate(180%)`);

  // Panel radius
  const pr = Math.max(0, Math.min(24, s.panelRadius));
  el.style.setProperty("--panel-radius", `${pr}px`);
}

function load(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function save(s: AppearanceSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function useAppearance() {
  const [settings, setSettingsState] = useState(load);

  useEffect(() => {
    apply(settings);
  }, [settings]);

  const update = useCallback(<K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => {
    setSettingsState((prev) => {
      const next = { ...prev, [key]: value };
      save(next);
      apply(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettingsState(DEFAULTS);
    save(DEFAULTS);
    apply(DEFAULTS);
  }, []);

  return { settings, update, reset, defaults: DEFAULTS };
}
