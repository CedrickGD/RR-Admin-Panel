import { ChevronRight, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TelemetryChartTooltip } from "./charts/TelemetryChartTooltip";

type Tone = "primary" | "accent" | "amber" | "rose";

const TONE_MAP: Record<Tone, { icon: string; card: string }> = {
  primary: {
    icon: "bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]",
    card: "stat-card-primary",
  },
  accent: {
    icon: "bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]",
    card: "stat-card-accent",
  },
  amber: {
    icon: "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]",
    card: "stat-card-amber",
  },
  rose: {
    icon: "bg-[hsl(var(--danger)/0.16)] text-[hsl(var(--danger))]",
    card: "stat-card-rose",
  },
};

export interface KpiDrilldown {
  /** Side-by-side values across timespans, e.g. Today / 7 d / 30 d / Lifetime. */
  timespans?: Array<{ label: string; value: string; hint?: string }>;
  /** Daily trend rendered as a small area chart. */
  series?: Array<{ day: string; value: number }>;
  seriesName?: string;
  /** Ranked breakdown rows with share bars, e.g. per-version or per-country. */
  breakdown?: Array<{ label: string; value: string; share?: number }>;
  breakdownTitle?: string;
  note?: string;
}

interface KpiStatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone?: Tone;
  delta?: string | null;
  /** When provided the card becomes clickable and opens a detail view. */
  drilldown?: KpiDrilldown | null;
  chartColor?: string;
}

/** StatCard with an optional click-to-expand drill-down modal. */
export function KpiStatCard({ label, value, sub, icon, tone = "primary", delta, drilldown, chartColor }: KpiStatCardProps) {
  const [open, setOpen] = useState(false);
  const tones = TONE_MAP[tone];
  // The series block only renders with 2+ points, so a 1-point series alone must not
  // make the card clickable (it would open an empty modal).
  const expandable = Boolean(
    drilldown && ((drilldown.timespans?.length ?? 0) > 0 || (drilldown.series?.length ?? 0) > 1 || (drilldown.breakdown?.length ?? 0) > 0)
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <article
        className={`stat-card ${tones.card}${expandable ? " kpi-card-clickable" : ""}`}
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
        <div className="stat-card-top">
          <p className="stat-card-label">{label}</p>
          <div className={`stat-card-icon ${tones.icon}`}>{icon}</div>
        </div>
        <div className="stat-card-body">
          <div className="stat-card-value-row">
            <p className="stat-card-value">{value}</p>
            {delta !== undefined && delta !== null ? (
              <span
                className={`stat-card-delta ${Number(delta) >= 0 ? "stat-card-delta-positive" : "stat-card-delta-negative"}`}
              >
                {Number(delta) >= 0 ? "+" : ""}
                {delta}%
              </span>
            ) : null}
          </div>
          <p className="stat-card-sub">
            {sub}
            {expandable ? <ChevronRight className="h-3 w-3 kpi-card-chevron" /> : null}
          </p>
        </div>
      </article>

      {open && drilldown ? (
        <div className="kpi-overlay" onClick={() => setOpen(false)}>
          <div className="kpi-modal panel" onClick={(event) => event.stopPropagation()}>
            <div className="kpi-modal-head">
              <div>
                <p className="kicker">{label}</p>
                <h2 className="section-title">{value}</h2>
                <p className="section-sub">{sub}</p>
              </div>
              <button type="button" className="btn-icon" title="Close" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {drilldown.timespans && drilldown.timespans.length > 0 ? (
              <div className="kpi-timespan-grid">
                {drilldown.timespans.map((span) => (
                  <div className="kpi-timespan-cell" key={span.label}>
                    <span className="kpi-timespan-label">{span.label}</span>
                    <strong className="kpi-timespan-value">{span.value}</strong>
                    {span.hint ? <span className="kpi-timespan-hint">{span.hint}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {drilldown.series && drilldown.series.length > 1 ? (
              <div className="kpi-modal-chart">
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={drilldown.series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="kpiDrillFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColor ?? "hsl(var(--accent))"} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={chartColor ?? "hsl(var(--accent))"} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
                      tickFormatter={(day: string) => day.slice(5)}
                      minTickGap={28}
                    />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} />
                    <Tooltip
                      cursor={{ stroke: "rgba(255,255,255,0.18)", strokeDasharray: "3 3" }}
                      content={({ active, payload, label: tipLabel }) => (
                        <TelemetryChartTooltip
                          active={active}
                          label={tipLabel}
                          payload={
                            payload?.map((entry) => ({
                              name: String(entry.name ?? ""),
                              value: typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0),
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
                      stroke={chartColor ?? "hsl(var(--accent))"}
                      strokeWidth={2}
                      fill="url(#kpiDrillFill)"
                      dot={false}
                      activeDot={{ r: 3.5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            {drilldown.breakdown && drilldown.breakdown.length > 0 ? (
              <div className="kpi-breakdown">
                {drilldown.breakdownTitle ? <p className="kicker">{drilldown.breakdownTitle}</p> : null}
                {drilldown.breakdown.map((row) => (
                  <div className="kpi-breakdown-row" key={row.label}>
                    <span className="kpi-breakdown-label">{row.label}</span>
                    {typeof row.share === "number" ? (
                      <span className="kpi-breakdown-track">
                        <span className="kpi-breakdown-fill" style={{ width: `${Math.min(100, Math.max(2, Math.round(row.share * 100)))}%` }} />
                      </span>
                    ) : null}
                    <strong className="kpi-breakdown-value">{row.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}

            {drilldown.note ? <p className="kpi-modal-note">{drilldown.note}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
