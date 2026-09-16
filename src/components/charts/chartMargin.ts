/**
 * Shared recharts margin for the telemetry charts (Overview, Traffic and its timezone cards,
 * System health). `top: 16` keeps the topmost y-axis tick label fully inside the SVG; 8 clips
 * it. `left: 0` keeps the y-axis labels inside it too: the surface is overflow: hidden, so a
 * negative left margin cuts the first digit off every label (the timezone cards did, at -20).
 */
export const CHART_MARGIN = { top: 16, right: 8, left: 0, bottom: 0 } as const;
