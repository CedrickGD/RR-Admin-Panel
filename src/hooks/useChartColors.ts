import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "rr-chart-color-preset";

export interface ChartColorPreset {
  label: string;
  users: string;
  sessions: string;
  errors: string;
}

export const CHART_COLOR_PRESETS: ChartColorPreset[] = [
  { label: "Default", users: "#6b8de3", sessions: "rgba(107,141,227,0.25)", errors: "#e06b6b" },
  { label: "Emerald", users: "#34d399", sessions: "rgba(52,211,153,0.25)", errors: "#f87171" },
  { label: "Amber", users: "#fbbf24", sessions: "rgba(251,191,36,0.25)", errors: "#ef4444" },
  { label: "Rose", users: "#fb7185", sessions: "rgba(251,113,133,0.25)", errors: "#a78bfa" },
  { label: "Cyan", users: "#22d3ee", sessions: "rgba(34,211,238,0.25)", errors: "#f472b6" },
  { label: "Violet", users: "#a78bfa", sessions: "rgba(167,139,250,0.25)", errors: "#fb923c" },
];

/**
 * Mirror the active preset into the DS chart tokens (tokens/colors.css) so
 * CSS-driven surfaces follow the user preset too. The old --chart-N alias
 * names are kept in lockstep for back-compat during the DS port. When no
 * preset is active the properties are removed and the DS defaults apply.
 */
function applyPresetTokens(preset: ChartColorPreset | null) {
  const root = document.documentElement.style;
  const tokens: Array<[string, string | undefined]> = [
    ["--chart-users", preset?.users],
    ["--chart-sessions", preset?.sessions],
    ["--chart-errors", preset?.errors],
    ["--chart-1", preset?.users],
    ["--chart-2", preset?.sessions],
    ["--chart-3", preset?.errors],
  ];
  for (const [name, value] of tokens) {
    if (value) root.setProperty(name, value);
    else root.removeProperty(name);
  }
}

// Simple in-memory store that syncs to localStorage and notifies all subscribers
let currentPreset: ChartColorPreset | null = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored || stored === "Default") return null;
    return CHART_COLOR_PRESETS.find((p) => p.label === stored) ?? null;
  } catch {
    return null;
  }
})();

applyPresetTokens(currentPreset);

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

function getSnapshot(): ChartColorPreset | null {
  return currentPreset;
}

function setPresetInternal(preset: ChartColorPreset | null) {
  currentPreset = preset;
  applyPresetTokens(preset);
  try {
    localStorage.setItem(STORAGE_KEY, preset?.label ?? "Default");
  } catch { /* ignore */ }
  for (const listener of listeners) listener();
}

export function useChartColors() {
  const override = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setPreset = useCallback((preset: ChartColorPreset | null) => {
    setPresetInternal(preset);
  }, []);

  const activeLabel = override?.label ?? "Default";

  return { override, setPreset, activeLabel, presets: CHART_COLOR_PRESETS } as const;
}
