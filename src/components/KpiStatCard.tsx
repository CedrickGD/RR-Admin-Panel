import { Activity, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelemetryChartTooltip } from "./charts/TelemetryChartTooltip";
import { BreakdownList, Modal, TimespanGrid } from "./ds/Modal";
import { Skeleton } from "./ds/Skeleton";
import { Sparkline } from "./widgets";

/** Legacy tone names (accent/amber/rose) kept for backward compatibility alongside the DS names. */
type Tone = "primary" | "accent" | "amber" | "rose" | "success" | "warning" | "danger";

export interface KpiDrilldown {
  /** Side-by-side values across timespans, e.g. Today / 7 d / 30 d / Lifetime. */
  timespans?: Array<{ label: string; value: string; hint?: string }>;
  /** Daily trend rendered as a small area chart (app extension to the DS modal). */
  series?: Array<{ day: string; value: number }>;
  seriesName?: string;
  /** Ranked breakdown rows with share bars, e.g. per-version or per-country. */
  breakdown?: Array<{ label: string; value: string; share?: number }>;
  breakdownTitle?: string;
  note?: string;
}

interface KpiStatCardProps {
  /** Sentence case, e.g. "Errors in range" — never Title Case (see docs/panel-workspace.md, Copy rules). */
  label: string;
  /**
   * Display value. ReactNode so a tile can show a live element — e.g.
   * <RelativeTime iso={…} /> — instead of a string frozen at render time.
   */
  value: ReactNode;
  /** One short, factual line. Sentence case, e.g. "Most recent event" — never Title Case (see docs/panel-workspace.md, Copy rules). */
  sub: string;
  /** Lucide icon for the right-side well when no spark is given. Default activity. */
  icon?: ReactNode;
  tone?: Tone;
  /** Percent change vs previous window; renders +/− colored suffix. */
  delta?: string | number | null;
  /** When provided the card becomes clickable and opens a detail view. */
  drilldown?: KpiDrilldown | null;
  /** Optional chart shade within the workspace accent palette. */
  chartColor?: string;
  /** Optional mini trend rendered on the tile's right side (replaces the icon well). */
  spark?: number[];
  /**
   * "default" is the KPI row on Overview/Customers/Heatmap; "compact" is the
   * denser monitoring row (Session history, Live) — same tile, less padding and
   * a smaller value, so those pages need no second tile component.
   */
  density?: "default" | "compact";
  /**
   * Data still in flight: value and sub render as skeletons instead of "—" or
   * a "…loading" sub line, and the tile is not clickable.
   */
  loading?: boolean;
}

/**
 * KPI stat tile (DS KpiTile): label / display value / one-line sub on the left,
 * sparkline or icon well on the right, accent tick on the left edge.
 * Pass `drilldown` to make it clickable with a detail modal.
 */
export function KpiStatCard({
  label,
  value,
  sub,
  icon,
  delta,
  drilldown,
  chartColor,
  spark,
  density = "default",
  loading = false,
}: KpiStatCardProps) {
  const [open, setOpen] = useState(false);
  // The pop animation replays by remounting on a changed value, which only a
  // scalar can key. Element values (e.g. <RelativeTime />) re-render themselves.
  const valueKey = typeof value === "string" || typeof value === "number" ? value : undefined;
  // The series block only renders with 2+ points, so a 1-point series alone must not
  // make the card clickable (it would open an empty modal).
  const expandable = Boolean(
    !loading &&
    drilldown &&
    ((drilldown.timespans?.length ?? 0) > 0 ||
      (drilldown.series?.length ?? 0) > 1 ||
      (drilldown.breakdown?.length ?? 0) > 0),
  );

  return (
    <>
      <article
        aria-busy={loading || undefined}
        className={`stat-card${spark && spark.length > 1 ? " has-spark" : " has-icon"}${density === "compact" ? " stat-card-compact" : ""}${expandable ? " kpi-card-clickable" : ""}`}
        onClick={expandable ? () => setOpen(true) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={
          expandable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpen(true);
                }
              }
            : undefined
        }
      >
        <div className="tile-main">
          <span className="stat-label">{label}</span>
          {loading ? (
            <>
              <strong className="stat-value">
                <Skeleton width={64} height={density === "compact" ? 15 : 19} />
              </strong>
              <p className="stat-sub">
                <Skeleton width={104} height={9} />
              </p>
            </>
          ) : (
            <>
              <strong className="stat-value tile-value-pop" key={valueKey}>
                {value}
                {delta !== undefined && delta !== null ? (
                  <span
                    className={`stat-card-delta ${Number(delta) >= 0 ? "stat-card-delta-positive" : "stat-card-delta-negative"}`}
                  >
                    {Number(delta) >= 0 ? "+" : ""}
                    {delta}%
                  </span>
                ) : null}
              </strong>
              <p className="stat-sub" title={sub}>
                {/* The text truncates, the chevron does not — it sits outside
                    the ellipsised span so it can never be the part cut off. */}
                <span className="stat-sub-text">{sub}</span>
                {expandable ? (
                  <span className="kpi-card-chevron">
                    <ChevronRight size={12} />
                  </span>
                ) : null}
              </p>
            </>
          )}
        </div>
        <div className="tile-side" aria-hidden="true">
          {spark && spark.length > 1 ? (
            <Sparkline values={spark} color={chartColor ?? "var(--accent)"} />
          ) : (
            <span className="tile-icon">{icon ?? <Activity size={14} />}</span>
          )}
        </div>
      </article>

      {expandable && drilldown ? (
        <Modal open={open} onClose={() => setOpen(false)} kicker={label} title={value} sub={sub}>
          {drilldown.timespans && drilldown.timespans.length > 0 ? (
            <TimespanGrid spans={drilldown.timespans} />
          ) : null}

          {drilldown.series && drilldown.series.length > 1 ? (
            <div className="kpi-drilldown-chart">
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart
                  data={drilldown.series}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="kpiDrillFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor={chartColor ?? "var(--chart-users)"}
                        stopOpacity={0.32}
                      />
                      <stop
                        offset="100%"
                        stopColor={chartColor ?? "var(--chart-users)"}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  {/* Tick size is an SVG attribute, so no var(): 11 is --fs-micro, the scale's 11px floor, up from 10. */}
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--chart-axis-soft)", fontSize: 11 }}
                    tickFormatter={(day: string) => day.slice(5)}
                    minTickGap={28}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--chart-axis-soft)", fontSize: 11 }}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ stroke: "var(--chart-axis-soft)", strokeDasharray: "3 3" }}
                    content={({ active, payload, label: tipLabel }) => (
                      <TelemetryChartTooltip
                        active={active}
                        label={tipLabel}
                        payload={
                          payload?.map((entry) => ({
                            name: String(entry.name ?? ""),
                            value:
                              typeof entry.value === "number"
                                ? entry.value
                                : Number(entry.value ?? 0),
                            color: entry.color,
                          })) ?? []
                        }
                      />
                    )}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name={drilldown.seriesName ?? label}
                    stroke={chartColor ?? "var(--chart-users)"}
                    strokeWidth={2}
                    fill="url(#kpiDrillFill)"
                    dot={false}
                    activeDot={{ r: 3.5 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {drilldown.breakdown && drilldown.breakdown.length > 0 ? (
            <BreakdownList title={drilldown.breakdownTitle} rows={drilldown.breakdown} />
          ) : null}

          {drilldown.note ? <p className="kpi-drilldown-note">{drilldown.note}</p> : null}
        </Modal>
      ) : null}
    </>
  );
}
