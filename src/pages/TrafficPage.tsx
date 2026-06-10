import { Activity, Clock, Layers, Radio, TrendingUp, Users, Zap } from "lucide-react";
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
import { KpiStatCard, type KpiDrilldown } from "../components/KpiStatCard";
import { useChartColors } from "../hooks/useChartColors";
import type { StatsPayload, SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildDailyUserTimeline,
  buildTimezoneActivity,
} from "../utils/dashboardInsights";
import { formatDuration, formatEventName, formatNumber, timeAgo } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette, TIMEZONE_PANELS } from "./dashboardShared";

interface TrafficPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  theme: ThemeMode;
  accentHue?: number;
}

interface DailySeriesPoint {
  label: string;
  shortLabel: string;
  users: number;
  isoDate: string;
}

/** "YYYY-MM-DD" -> "Mar 12" (UTC, matches buildDailyUserTimeline labels). */
function dayToLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return day;
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

/* Simple linear-regression prediction: extends the daily user curve
   forward by `forecastDays` using the last `lookbackDays` of data. */
function buildPrediction(
  data: DailySeriesPoint[],
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

export function TrafficPage({ summary, stats, theme, accentHue = 217 }: TrafficPageProps) {
  const [insightView, setInsightView] = useState<"daily" | "timezones">("daily");

  // Daily series: prefer server-side aggregates over the FULL history (follows
  // the global FilterBar range); fall back to the 200-row window ONLY while stats
  // are still loading — an empty filtered series must stay empty.
  const dailyUsers = useMemo<DailySeriesPoint[]>(() => {
    if (stats) {
      return stats.series.sessionsPerDay.map((p) => {
        const label = dayToLabel(p.day);
        return { isoDate: p.day, label, shortLabel: label, users: p.users };
      });
    }
    return buildDailyUserTimeline(summary, 30);
  }, [stats, summary]);

  const tzCharts    = useMemo(() => TIMEZONE_PANELS.map((p) => ({ ...p, data: buildTimezoneActivity(summary, p.timeZone) })), [summary]);
  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);

  // Forecast days scale with the span of real data: ≤7d→3d, ≤14d→5d, ≤31d→7d, longer→14d
  const forecastDays = dailyUsers.length <= 7 ? 3 : dailyUsers.length <= 14 ? 5 : dailyUsers.length <= 31 ? 7 : 14;

  const chartData = useMemo(() => {
    const prediction = buildPrediction(dailyUsers, forecastDays, Math.min(30, dailyUsers.length));
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
  }, [dailyUsers, forecastDays]);

  /* ----- KPI values + drill-downs ----- */

  const lifetimeUsers = stats?.totals.lifetimeUsers ?? summary.stats.lifetimeUsers;
  // True lifetime event counter (~230k); summary.stats.totalEvents is just the retained window.
  const lifetimeEvents = stats?.totals.lifetimeEvents ?? summary.stats.lifetimeEvents ?? summary.stats.totalEvents;

  const lifetimeUsersDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    const totalUsers = Math.max(1, stats.totals.lifetimeUsers);
    const countries = [...stats.breakdowns.countries].sort((a, b) => b.users - a.users).slice(0, 6);
    return {
      timespans: [
        { label: "In range", value: formatNumber(stats.totals.usersInRange) },
        { label: "New in range", value: formatNumber(stats.totals.newUsersInRange) },
        { label: "Lifetime", value: formatNumber(stats.totals.lifetimeUsers), hint: "unique HWIDs" },
      ],
      series: stats.series.newUsersPerDay.map((p) => ({ day: p.day, value: p.users })),
      seriesName: "New users",
      breakdown: countries.map((c) => ({
        label: c.key || "Unknown",
        value: formatNumber(c.users),
        share: c.users / totalUsers,
      })),
      breakdownTitle: "Top countries",
    };
  }, [stats]);

  const totalEventsDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    const rows = [...stats.breakdowns.eventsLifetime].sort((a, b) => b.count - a.count);
    const total = Math.max(1, rows.reduce((acc, r) => acc + r.count, 0));
    return {
      breakdown: rows.map((r) => ({
        label: formatEventName(r.service),
        value: formatNumber(r.count),
        share: r.count / total,
      })),
      breakdownTitle: "Lifetime events by type",
      note: "Lifetime per-type counters, tracked server-side. Heartbeats are no longer stored as event rows — only counted.",
    };
  }, [stats]);

  const totalSessionsDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    return {
      timespans: [
        { label: "In range", value: formatNumber(stats.totals.sessionsInRange) },
        { label: "Lifetime", value: formatNumber(stats.totals.lifetimeSessions) },
      ],
      series: stats.series.sessionsPerDay.map((p) => ({ day: p.day, value: p.sessions })),
      seriesName: "Sessions",
    };
  }, [stats]);

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Traffic
            <span className="kicker">Analytics</span>
          </h1>
          <p className="page-subtitle">
            Daily user trends, forecasts, and timezone-level activity breakdowns.
          </p>
        </div>
      </section>

      {/* Stat cards — pinned at top */}
      <div className="stat-grid">
        <KpiStatCard
          label="Lifetime Users"
          value={formatNumber(lifetimeUsers)}
          sub="All-time unique (HWID)"
          icon={<Users className="h-4 w-4" />}
          tone="accent"
          drilldown={lifetimeUsersDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Total Events"
          value={formatNumber(lifetimeEvents)}
          sub={`true lifetime · ${formatNumber(summary.stats.totalEvents)} retained`}
          icon={<Zap className="h-4 w-4" />}
          tone="primary"
          drilldown={totalEventsDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Total Sessions"
          value={formatNumber(stats?.totals.lifetimeSessions ?? summary.stats.totalSessions)}
          sub={stats ? "All time" : "Last 200 loaded"}
          icon={<Layers className="h-4 w-4" />}
          tone="primary"
          drilldown={totalSessionsDrilldown}
          chartColor={chartPalette.sessionsLine}
        />
        <KpiStatCard
          label="Active Right Now"
          value={formatNumber(stats?.totals.activeNow ?? summary.stats.activeUsers)}
          sub="Live sessions"
          icon={<Radio className="h-4 w-4" />}
          tone="primary"
        />
        <KpiStatCard
          label="Avg Duration"
          value={formatDuration(stats?.totals.averageSessionDurationSeconds ?? summary.stats.averageSessionDurationSeconds)}
          sub={stats ? "Per session · legacy excluded" : "Per session"}
          icon={<Clock className="h-4 w-4" />}
          tone="primary"
        />
        <KpiStatCard
          label="Started Today"
          value={formatNumber(summary.stats.sessionsStartedToday)}
          sub="Since midnight UTC"
          icon={<TrendingUp className="h-4 w-4" />}
          tone="primary"
        />
        <KpiStatCard
          label="Last Ingest"
          value={timeAgo(summary.stats.lastIngestAt ?? null)}
          sub="Most recent event"
          icon={<Activity className="h-4 w-4" />}
          tone="primary"
        />
      </div>

      {/* Daily / Timezone toggle — the main chart */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Trends</p>
            <h2 className="section-title">Insight View</h2>
            <p className="section-sub">
              {insightView === "daily"
                ? stats
                  ? `Daily unique users (full history, follows the global range filter) with ${forecastDays}-day forecast (dashed).`
                  : `Daily unique users with ${forecastDays}-day forecast (dashed).`
                : "Timezone-local activity breakdowns."}
            </p>
          </div>
          <div className="panel-head-right" style={{ gap: 12 }}>
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
                      <stop offset="0%"   stopColor={chartPalette.sessionsLine} stopOpacity={0.22} />
                      <stop offset="55%"  stopColor={chartPalette.sessionsLine} stopOpacity={0.07} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={chartPalette.sessionsLine} stopOpacity={0.08} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartPalette.grid} vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="shortLabel" tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                  <YAxis tickLine={false} axisLine={false} width={32} tick={{ fill: chartPalette.axisSoft, fontSize: 10.5 }} allowDecimals={false} tickFormatter={(v: number) => formatNumber(Number(v))} />
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
                    activeDot={{
                      r: 4.5,
                      strokeWidth: 2,
                      stroke: "rgba(0,0,0,0.3)",
                      fill: chartPalette.sessionsLine,
                      style: { filter: `drop-shadow(0 0 4px ${chartPalette.sessionsLine})` },
                    }}
                    connectNulls={false}
                    animationDuration={600}
                    animationEasing="ease-out"
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
                    animationDuration={600}
                    animationEasing="ease-out"
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
