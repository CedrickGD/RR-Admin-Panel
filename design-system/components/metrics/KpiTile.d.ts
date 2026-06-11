/**
 * @startingPoint section="Metrics" subtitle="KPI stat tile with sparkline, delta and click-to-drill-down modal" viewport="700x130"
 */
export interface KpiTileProps {
  /** Uppercase micro-label, e.g. "Active Users" */
  label: string;
  /** Display value (Space Grotesk). Keep formatted: "1,284", "12m 30s", "Clear" */
  value: string;
  /** One line, always truncated, e.g. "3 sessions open" — state the window honestly ("In range", "Last 24 hours") */
  sub: string;
  /** Lucide icon for the right well when no spark is given. Default "activity". */
  icon?: string;
  /** Recolors the left edge tick. danger when errors > 0; success for healthy checks. */
  tone?: "primary" | "success" | "warning" | "danger";
  /** Percent change vs previous window; renders +/− colored suffix */
  delta?: string | number | null;
  /** Mini trend series for the tile's right side (replaces the icon) */
  spark?: number[];
  sparkColor?: string;
  /** Makes the tile clickable → drill-down modal */
  drilldown?: {
    timespans?: Array<{ label: string; value: string; hint?: string }>;
    breakdown?: Array<{ label: string; value: string; share?: number }>;
    breakdownTitle?: string;
    note?: string;
  } | null;
}
