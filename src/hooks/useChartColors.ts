import { useEffect, useMemo } from "react";
import { useAppearance } from "./useAppearance";
export interface ChartColorPreset {
  label: string;
  users: string;
  sessions: string;
  errors: string;
}
/** All chart series follow the workspace accent; brightness distinguishes series. */
export function useChartColors() {
  const { appearance } = useAppearance();
  const override = useMemo<ChartColorPreset>(
    () => ({
      label: "Workspace",
      users: `hsl(${appearance.hue} 70% ${appearance.theme === "dark" ? 68 : 42}%)`,
      /* 0.55, not 0.25: the bar series is drawn through a 1 → 0.35 gradient, so a
         quarter-alpha base left short bars indistinguishable from the grid. The
         light theme darkens the base as well — 55% lightness at that alpha
         composites to ~2.3:1 on a white panel, under the 3:1 WCAG 1.4.11 asks
         of a graphical object. */
      sessions: `hsl(${appearance.hue} 65% ${appearance.theme === "dark" ? 55 : 40}% / 0.55)`,
      errors: `hsl(${appearance.hue} 15% ${appearance.theme === "dark" ? 85 : 24}%)`,
    }),
    [appearance.hue, appearance.theme],
  );
  useEffect(() => {
    for (const [key, value] of Object.entries({
      users: override.users,
      sessions: override.sessions,
      errors: override.errors,
    }))
      document.documentElement.style.setProperty(`--chart-${key}`, value);
  }, [override]);
  return { override } as const;
}
