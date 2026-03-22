import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "rr-status-color-preset";

export interface StatusColorPreset {
  label: string;
  success: string;
  warning: string;
  danger: string;
}

export const STATUS_COLOR_PRESETS: StatusColorPreset[] = [
  { label: "Default",  success: "hsl(142 71% 45%)", warning: "hsl(37 91% 55%)",  danger: "hsl(4 86% 58%)" },
  { label: "Neon",     success: "hsl(160 95% 50%)", warning: "hsl(48 100% 55%)", danger: "hsl(340 90% 55%)" },
  { label: "Pastel",   success: "hsl(152 55% 55%)", warning: "hsl(40 75% 60%)",  danger: "hsl(10 70% 62%)" },
  { label: "Vivid",    success: "hsl(145 85% 40%)", warning: "hsl(30 100% 50%)", danger: "hsl(0 100% 55%)" },
  { label: "Cool",     success: "hsl(170 65% 45%)", warning: "hsl(210 60% 60%)", danger: "hsl(280 70% 60%)" },
  { label: "Warm",     success: "hsl(90 60% 48%)",  warning: "hsl(25 95% 55%)",  danger: "hsl(355 85% 55%)" },
];

function applyPreset(preset: StatusColorPreset) {
  const el = document.documentElement;
  el.style.setProperty("--success", preset.success);
  el.style.setProperty("--success-sub", preset.success.replace(")", " / 0.14)").replace("hsl(", "hsl("));
  el.style.setProperty("--warning", preset.warning);
  el.style.setProperty("--warning-sub", preset.warning.replace(")", " / 0.14)").replace("hsl(", "hsl("));
  el.style.setProperty("--danger", preset.danger);
  el.style.setProperty("--danger-sub", preset.danger.replace(")", " / 0.14)").replace("hsl(", "hsl("));
}

function loadStored(): StatusColorPreset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw !== "Default") {
      const found = STATUS_COLOR_PRESETS.find((p) => p.label === raw);
      if (found) return found;
    }
  } catch { /* ignore */ }
  return STATUS_COLOR_PRESETS[0];
}

export function useStatusColors() {
  const [active, setActiveState] = useState(loadStored);

  useEffect(() => {
    if (active.label !== "Default") applyPreset(active);
  }, [active]);

  const setPreset = useCallback((preset: StatusColorPreset | null) => {
    const resolved = preset ?? STATUS_COLOR_PRESETS[0];
    setActiveState(resolved);
    try { localStorage.setItem(STORAGE_KEY, resolved.label); } catch { /* ignore */ }
    if (resolved.label === "Default") {
      // Reset to CSS defaults
      const el = document.documentElement;
      el.style.removeProperty("--success");
      el.style.removeProperty("--success-sub");
      el.style.removeProperty("--warning");
      el.style.removeProperty("--warning-sub");
      el.style.removeProperty("--danger");
      el.style.removeProperty("--danger-sub");
    } else {
      applyPreset(resolved);
    }
  }, []);

  return { active, setPreset, presets: STATUS_COLOR_PRESETS };
}
