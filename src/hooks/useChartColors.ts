import { useCallback, useState } from "react";

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

function loadPreset(): ChartColorPreset | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored || stored === "Default") return null;
    return CHART_COLOR_PRESETS.find((p) => p.label === stored) ?? null;
  } catch {
    return null;
  }
}

export function useChartColors() {
  const [override, setOverrideState] = useState<ChartColorPreset | null>(loadPreset);

  const setPreset = useCallback((preset: ChartColorPreset | null) => {
    setOverrideState(preset);
    try {
      localStorage.setItem(STORAGE_KEY, preset?.label ?? "Default");
    } catch { /* ignore */ }
  }, []);

  const activeLabel = override?.label ?? "Default";

  return { override, setPreset, activeLabel, presets: CHART_COLOR_PRESETS } as const;
}
