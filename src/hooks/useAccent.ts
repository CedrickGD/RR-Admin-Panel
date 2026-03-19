import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "rr-accent-hue";
const DEFAULT_HUE = 217;

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
  document.documentElement.style.setProperty("--ah", String(hue));
  // Reapply body background so radial gradient matches new hue
  document.body.style.background = `
    radial-gradient(ellipse 90% 45% at 50% -8%,  hsl(${hue} 55% 18% / 0.65), transparent),
    radial-gradient(ellipse 55% 35% at 90% 110%, hsl(200 60% 12% / 0.35), transparent),
    radial-gradient(ellipse 50% 30% at 5% 80%,   hsl(${hue} 40% 10% / 0.25), transparent),
    #05050c
  `;
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

  // Apply on mount and whenever hue changes
  useEffect(() => {
    applyHue(hue);
  }, [hue]);

  const setHue = useCallback((newHue: number) => {
    const clamped = Math.max(0, Math.min(360, Math.round(newHue)));
    setHueState(clamped);
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);

  const activePreset = ACCENT_PRESETS.find((p) => p.hue === hue) ?? null;

  return { hue, setHue, activePreset, presets: ACCENT_PRESETS } as const;
}
