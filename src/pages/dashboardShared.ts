import type { ThemeMode } from "../types/telemetry";

export const COUNTRY_COLORS = ["#5c79b9", "#3f8790", "#8e6bb0", "#9d7c4e", "#587189", "#7f5f69"];

export const TIMEZONE_PANELS = [
  { title: "UTC", subtitle: "Universal reference clock", timeZone: "UTC", accent: "#5c79b9" },
  { title: "New York", subtitle: "America/New_York", timeZone: "America/New_York", accent: "#6686cf" },
  { title: "London", subtitle: "Europe/London", timeZone: "Europe/London", accent: "#3f8790" },
  { title: "Tokyo", subtitle: "Asia/Tokyo", timeZone: "Asia/Tokyo", accent: "#8e6bb0" },
] as const;

export function buildDashboardChartPalette(theme: ThemeMode) {
  if (theme === "dark") {
    return {
      grid: "rgba(255,255,255,0.08)",
      axis: "rgba(255,255,255,0.58)",
      axisSoft: "rgba(255,255,255,0.4)",
      activityBar: "rgba(92,121,185,0.22)",
      sessionsLine: "rgba(145,170,226,0.94)",
      errorsLine: "rgba(214,113,113,0.88)",
    };
  }

  return {
    grid: "rgba(24,43,66,0.1)",
    axis: "rgba(24,43,66,0.66)",
    axisSoft: "rgba(24,43,66,0.5)",
    activityBar: "rgba(92,121,185,0.18)",
    sessionsLine: "rgba(96,118,156,0.82)",
    errorsLine: "rgba(181,93,84,0.8)",
  };
}
