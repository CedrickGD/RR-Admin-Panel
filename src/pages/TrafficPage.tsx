import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { TimezoneUsageChart } from "../components/charts/TimezoneUsageChart";
import { useChartColors } from "../hooks/useChartColors";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildDailyUserTimeline,
  buildTimezoneActivity,
} from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette, TIMEZONE_PANELS } from "./dashboardShared";

interface TrafficPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
  accentHue?: number;
}

const RANGE_OPTIONS = [
  { value: 7,  label: "7D" },
  { value: 14, label: "14D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
] as const;

/* Simple linear-regression prediction: extends the daily user curve
   forward by `forecastDays` using the last `lookbackDays` of data. */
function buildPrediction(
  data: { label: string; shortLabel: string; users: number; isoDate: string }[],
  forecastDays: number,
  lookbackDays: number,
) {
  const slice = data.slice(-Math.min(lookbackDays, data.length));
  if (slice.length < 2) return [];

  // Linear regression on the slice
  const n = slice.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += slice[i].users;
    sumXY += i * slice[i].users;
    sumXX += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Project forward from end of real data
  const lastDate = new Date(data[data.length - 1].isoDate);
  const startIdx = n; // continue from end of lookback window

  const forecast: { label: string; shortLabel: string; predicted: number }[] = [];
  for (let i = 0; i < forecastDays; i++) {
    const d = new Date(lastDate);
    d.setUTCDate(d.getUTCDate() + i + 1);
    const val = Math.max(0, Math.round(intercept + slope * (startIdx + i)));
    const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
    const day = d.getUTCDate();
    forecast.push({
      label: `${month} ${day}`,
      shortLabel: `${month} ${day}`,
      predicted: val,
    });
  }
  return forecast;
}

export function TrafficPage({ summary, theme, accentHue = 217 }: TrafficPageProps) {
  const [insightView, setInsightView] = useState<"daily" | "timezones">("daily");
  const [rangeDays, setRangeDays] = useState<number>(30);

  const dailyUsers  = useMemo(() => buildDailyUserTimeline(summary, rangeDays), [summary, rangeDays]);
  const tzCharts    = useMemo(() => TIMEZONE_PANELS.map((p) => ({ ...p, data: buildTimezoneActivity(summary, p.timeZone) })), [summary]);
  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);

  // Forecast days scale with range: 7D→3d, 14D→5d, 30D→7d, 90D→14d
  const forecastDays = rangeDays <= 7 ? 3 : rangeDays <= 14 ? 5 : rangeDays <= 30 ? 7 : 14;

  const chartData = useMemo(() => {
    const prediction = buildPrediction(dailyUsers, forecastDays, Math.min(rangeDays, dailyUsers.length));
    // Merge: real data has `users`, forecast has `predicted`
    const merged: { label: string; shortLabel: string; users?: number; predicted?: number }[] = [
      ...dailyUsers.map((d) => ({ label: d.label, shortLabel: d.shortLabel, users: d.users, predicted: undefined as number | undefined })),
    ];
    // Bridge: last real point starts the prediction line
    if (dailyUsers.length > 0 && prediction.length > 0) {
      const last = dailyUsers[dailyUsers.length - 1];
      merged[merged.length - 1] = { ...merged[merged.length - 1], predicted: last.users };
    }
    for (const p of prediction) {
      merged.push({ label: p.label, shortLabel: p.shortLabel, users: undefined, predicted: p.predicted });
    }
    return merged;
  }, [dailyUsers, forecastDays, rangeDays]);

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <p className="kicker">Analytics</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Traffic</h1>
          <p className="page-subtitle">
            Daily user trends, forecasts, and timezone-level activity breakdowns.
          </p>
        </div>
      </section>

      {/* Stat cards — pinned at top */}
      <div className="stat-grid">
        {[
          { label: "Total Events",     value: formatNumber(summary.stats.totalEvents),   sub: "All time in storage" },
          { label: "Total Sessions",   value: formatNumber(summary.stats.totalSessions), sub: "Loaded in this view" },
          { label: "Active Right Now", value: formatNumber(summary.stats.activeUsers),   sub: "Within session window" },
          { label: "Avg Duration",     value: formatDuration(summary.stats.averageSessionDurationSeconds), sub: "Per session" },
          { label: "Started Today",    value: formatNumber(summary.stats.sessionsStartedToday), sub: "Since midnight UTC" },
          { label: "Last Ingest",      value: timeAgo(summary.stats.lastIngestAt ?? null), sub: "Most recent event" },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <span className="stat-label">{s.label}</span>
            <strong className="stat-value" style={{ fontSize: "1.5rem" }}>{s.value}</strong>
            <p className="stat-sub">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Daily / Timezone toggle — the main chart */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Trends</p>
            <h2 className="section-title">Insight View</h2>
            <p className="section-sub">
              {insightView === "daily"
                ? `Daily unique users with ${forecastDays}-day forecast (dashed).`
                : "Timezone-local activity breakdowns."}
            </p>
          </div>
          <div className="panel-head-right" style={{ gap: 12 }}>
            {insightView === "daily" ? (
              <div className="seg-control">
                {RANGE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`seg-btn${rangeDays === o.value ? " active" : ""}`}
                    onClick={() => setRangeDays(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="seg-control">
              <button type="button" className={`seg-btn${insightView === "daily" ? " active" : ""}`} onClick={() => setInsightView("daily")}>Daily Users</button>
              <button type="button" className={`seg-btn${insightView === "timezones" ? " active" : ""}`} onClick={() => setInsightView("timezones")}>Timezones</button>
            </div>
          </div>
        </div>

        {insightView === "daily" ? (
          <div className="panel-body">
            <div className="chart-wrap chart-wrap-tall">
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={chartPalette.sessionsLine} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={chartPalette.sessionsLine} stopOpacity={0.08} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                  <XAxis dataKey="shortLabel" tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                  <YAxis tickLine={false} axisLine={false} width={32} tick={{ fill: chartPalette.axisSoft, fontSize: 10.5 }} allowDecimals={false} />
                  <Tooltip cursor={false} content={({ active, payload, label }) => (
                    <TelemetryChartTooltip active={active} label={label} payload={payload?.filter((e) => e.value != null && e.value !== 0).map((e) => ({ name: String(e.name ?? ""), value: typeof e.value === "number" ? e.value : Number(e.value ?? 0), color: e.color })) ?? []} />
                  )} />
                  {/* Actual data */}
                  <Area
                    type="monotone"
                    dataKey="users"
                    name="Unique users"
                    stroke={chartPalette.sessionsLine}
                    strokeWidth={2.2}
                    fill="url(#dailyFill)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.sessionsLine }}
                    connectNulls={false}
                  />
                  {/* Prediction */}
                  <Area
                    type="monotone"
                    dataKey="predicted"
                    name="Forecast"
                    stroke={chartPalette.sessionsLine}
                    strokeWidth={1.8}
                    strokeDasharray="6 4"
                    strokeOpacity={0.6}
                    fill="url(#forecastFill)"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0, fill: chartPalette.sessionsLine, opacity: 0.6 }}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="panel-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%),1fr))", gap: 20 }}>
              {tzCharts.map((tz) => (
                <div key={tz.timeZone} className="glass-flat" style={{ borderRadius: 12, padding: "14px 16px" }}>
                  <p className="kicker" style={{ marginBottom: 4 }}>{tz.timeZone}</p>
                  <h3 style={{ fontSize: "0.875rem", fontFamily: "Space Grotesk, sans-serif", marginBottom: 10 }}>{tz.title}</h3>
                  <TimezoneUsageChart title={tz.title} subtitle={tz.subtitle} accentColor={tz.accent} theme={theme} data={tz.data} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
