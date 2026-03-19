import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "rr-donut-color-preset";

export interface DonutColorPreset {
  label: string;
  colors: string[];
}

export const DONUT_COLOR_PRESETS: DonutColorPreset[] = [
  { label: "Default",  colors: ["#6b8de3", "#22d3ee", "#a78bfa", "#fbbf24", "#f472b6", "#34d399"] },
  { label: "Neon",     colors: ["#00f0ff", "#a855f7", "#22ff88", "#ff6bcb", "#ffdd00", "#ff7043"] },
  { label: "Ocean",    colors: ["#06b6d4", "#3b82f6", "#8b5cf6", "#0ea5e9", "#6366f1", "#14b8a6"] },
  { label: "Sunset",   colors: ["#f97316", "#ef4444", "#f472b6", "#fbbf24", "#fb923c", "#e11d48"] },
  { label: "Forest",   colors: ["#22c55e", "#10b981", "#14b8a6", "#84cc16", "#34d399", "#059669"] },
  { label: "Candy",    colors: ["#f472b6", "#c084fc", "#67e8f9", "#fde047", "#fb923c", "#a78bfa"] },
];

let currentPreset: DonutColorPreset | null = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored || stored === "Default") return null;
    return DONUT_COLOR_PRESETS.find((p) => p.label === stored) ?? null;
  } catch {
    return null;
  }
})();

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

function getSnapshot(): DonutColorPreset | null {
  return currentPreset;
}

function setPresetInternal(preset: DonutColorPreset | null) {
  currentPreset = preset;
  try {
    localStorage.setItem(STORAGE_KEY, preset?.label ?? "Default");
  } catch { /* ignore */ }
  for (const listener of listeners) listener();
}

export function useDonutColors() {
  const override = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setPreset = useCallback((preset: DonutColorPreset | null) => {
    setPresetInternal(preset);
  }, []);

  const activeLabel = override?.label ?? "Default";
  const colors = override?.colors ?? DONUT_COLOR_PRESETS[0].colors;

  return { override, setPreset, activeLabel, colors, presets: DONUT_COLOR_PRESETS } as const;
}
