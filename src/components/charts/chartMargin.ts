/**
 * Shared recharts margin for the page-level telemetry charts (Overview, Traffic).
 * `top: 16` keeps the topmost y-axis tick label fully inside the SVG; 8 clips it.
 */
export const CHART_MARGIN = { top: 16, right: 8, left: 0, bottom: 0 } as const;
