import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "rr-surface-brightness";
const DEFAULT = 1;

function applyBrightness(level: number) {
  const clamped = Math.max(0.4, Math.min(2, level));
  const base = 0.03 * clamped;
  const base2 = 0.055 * clamped;
  const base3 = 0.085 * clamped;
  const border = 0.072 * clamped;
  const border2 = 0.14 * clamped;
  const el = document.documentElement;
  el.style.setProperty("--glass-1", `rgba(255,255,255,${base.toFixed(4)})`);
  el.style.setProperty("--glass-2", `rgba(255,255,255,${base2.toFixed(4)})`);
  el.style.setProperty("--glass-3", `rgba(255,255,255,${base3.toFixed(4)})`);
  el.style.setProperty("--glass-border", `rgba(255,255,255,${border.toFixed(4)})`);
  el.style.setProperty("--glass-border2", `rgba(255,255,255,${border2.toFixed(4)})`);
}

function loadStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const val = Number(raw);
      if (Number.isFinite(val)) return val;
    }
  } catch { /* ignore */ }
  return DEFAULT;
}

export function useSurfaceBrightness() {
  const [level, setLevelState] = useState(loadStored);

  useEffect(() => {
    applyBrightness(level);
  }, [level]);

  const setLevel = useCallback((val: number) => {
    const clamped = Math.max(0.4, Math.min(2, val));
    setLevelState(clamped);
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
    applyBrightness(clamped);
  }, []);

  return { level, setLevel };
}
