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
      sessions: `hsl(${appearance.hue} 65% 55% / 0.25)`,
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
