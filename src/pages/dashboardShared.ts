import type { ChartColorPreset } from "../hooks/useChartColors";
import type { ThemeMode } from "../types/telemetry";

export const COUNTRY_COLORS = ["#6b8de3", "#22d3ee", "#a78bfa", "#fbbf24", "#f472b6", "#34d399"];

export const TIMEZONE_PANELS = [
  { title: "UTC", subtitle: "Universal reference clock", timeZone: "UTC", accent: "#5c79b9" },
  { title: "New York", subtitle: "America/New_York", timeZone: "America/New_York", accent: "#6686cf" },
  { title: "London", subtitle: "Europe/London", timeZone: "Europe/London", accent: "#3f8790" },
  { title: "Tokyo", subtitle: "Asia/Tokyo", timeZone: "Asia/Tokyo", accent: "#8e6bb0" },
] as const;

export function buildDashboardChartPalette(theme: ThemeMode, accentHue = 217) {
  const h = accentHue;
  if (theme === "dark") {
    return {
      grid: "rgba(255,255,255,0.08)",
      axis: "rgba(255,255,255,0.58)",
      axisSoft: "rgba(255,255,255,0.4)",
      activityBar: `hsl(${h} 45% 55% / 0.25)`,
      sessionsLine: `hsl(${h} 55% 72% / 0.94)`,
      errorsLine: "hsl(4 60% 64% / 0.88)",
    };
  }

  return {
    grid: "rgba(24,43,66,0.1)",
    axis: "rgba(24,43,66,0.66)",
    axisSoft: "rgba(24,43,66,0.5)",
    activityBar: `hsl(${h} 40% 45% / 0.18)`,
    sessionsLine: `hsl(${h} 40% 50% / 0.82)`,
    errorsLine: "hsl(4 50% 52% / 0.8)",
  };
}

export type ChartPalette = ReturnType<typeof buildDashboardChartPalette>;

/** Apply a user-chosen chart color preset on top of the base palette. */
export function applyChartColorOverride(base: ChartPalette, override: ChartColorPreset | null): ChartPalette {
  if (!override) return base;
  return {
    ...base,
    activityBar: override.sessions,
    sessionsLine: override.users,
    errorsLine: override.errors,
  };
}
