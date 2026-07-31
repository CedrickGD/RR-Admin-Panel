import { Activity, Clock, Gauge, Radio, TrendingUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { KpiStatCard } from "../components/KpiStatCard";
import type { StatsPayload, SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildDailyUserTimeline,
  buildTimezoneActivity,
  buildTrafficTimeline,
} from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { TIMEZONE_PANELS } from "./dashboardShared";

interface TrafficPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  theme: ThemeMode;
  accentHue?: number;
  filterBar?: ReactNode;
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

export function TrafficPage({ summary, stats, theme, filterBar }: TrafficPageProps) {
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

  const tzCharts = useMemo(() => TIMEZONE_PANELS.map((p) => ({ ...p, data: buildTimezoneActivity(summary, p.timeZone) })), [summary]);

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

  /* ----- KPI values ----- */

  // Unique users per hour over the loaded 24 h window — peak is the busiest hour.
  const hourlyUsers = useMemo(
    () => buildTrafficTimeline(summary, 24).map((p) => p.users),
    [summary],
  );
  const peakHourlyUsers = hourlyUsers.reduce((max, v) => Math.max(max, v), 0);

  /* ----- Panel meta (display aggregation only) ----- */

  const peakDailyUsers = dailyUsers.reduce((max, p) => Math.max(max, p.users), 0);
  const metaSessions = stats ? stats.totals.sessionsInRange : summary.stats.totalSessions;
  const metaErrors = stats ? stats.totals.errorsInRange : summary.stats.errorsLast24Hours;

  return (
    <div className="page-content page-stack-lg">
      {/* Header — kicker + title left, global filters right */}
      <PageHeader
        kicker="Telemetry"
        title="Traffic"
        sub="Daily trends, forecast, and timezone activity."
        right={filterBar}
      />

      {/* Stat cards — traffic-specific only (lifetime totals live on Overview) */}
      <div className="stat-grid stat-grid-5">
        <KpiStatCard
          label="Active Right Now"
          value={formatNumber(stats?.totals.activeNow ?? summary.stats.activeUsers)}
          sub="Live sessions"
          icon={<Radio size={14} />}
          tone="primary"
        />
        <KpiStatCard
          label="Started Today"
          value={formatNumber(summary.stats.sessionsStartedToday)}
          sub="Since midnight UTC"
          icon={<TrendingUp size={14} />}
          tone="primary"
        />
        <KpiStatCard
          label="Peak Users/h"
          value={formatNumber(peakHourlyUsers)}
          sub="Busiest hour · last 24 h"
          icon={<Gauge size={14} />}
          tone="primary"
          chartColor="var(--chart-users)"
          spark={hourlyUsers}
        />
        <KpiStatCard
          label="Avg Duration"
          value={formatDuration(stats?.totals.averageSessionDurationSeconds ?? summary.stats.averageSessionDurationSeconds)}
          sub={stats ? "In range · legacy excluded" : "Per session"}
          icon={<Clock size={14} />}
          tone="primary"
        />
        <KpiStatCard
          label="Last Ingest"
          value={timeAgo(summary.stats.lastIngestAt ?? null)}
          sub="Most recent event"
          icon={<Activity size={14} />}
          tone="primary"
        />
      </div>

      {/* Daily / Timezone toggle — the main chart */}
      <CollapsiblePanel
        kicker="Trends"
        title={insightView === "daily" ? "Daily Users" : "Timezone Activity"}
        sub={insightView === "daily"
          ? stats
            ? `Daily unique users in range · ${forecastDays} d forecast (dashed).`
            : `Daily unique users · ${forecastDays} d forecast (dashed).`
          : "Timezone-local activity from the loaded event window."}
        right={
          <MetaRow
            items={[
              { label: "Peak Users/d", value: formatNumber(peakDailyUsers) },
              { label: "Sessions", value: formatNumber(metaSessions) },
              { label: "Errors", value: formatNumber(metaErrors) },
            ]}
          />
        }
      >
        <div className="panel-body">
          {/* View switch — segmented control */}
          <div style={{ display: "flex", paddingBottom: 6 }}>
            <div className="seg-control">
              <button type="button" className={`seg-btn${insightView === "daily" ? " active" : ""}`} onClick={() => setInsightView("daily")}>Daily Users</button>
              <button type="button" className={`seg-btn${insightView === "timezones" ? " active" : ""}`} onClick={() => setInsightView("timezones")}>Timezones</button>
            </div>
          </div>

          {insightView === "daily" ? (
            <div className="chart-wrap chart-wrap-tall">
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="var(--chart-users)" stopOpacity={0.22} />
                      <stop offset="55%"  stopColor="var(--chart-users)" stopOpacity={0.07} />
                      <stop offset="100%" stopColor="var(--chart-users)" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="var(--chart-users)" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="var(--chart-users)" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 6" />
                  <XAxis dataKey="shortLabel" tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "var(--chart-axis)", fontSize: 10.5 }} />
                  <YAxis tickLine={false} axisLine={false} width={32} tick={{ fill: "var(--chart-axis-soft)", fontSize: 10.5 }} allowDecimals={false} tickFormatter={(v: number) => formatNumber(Number(v))} />
                  <Tooltip isAnimationActive={false} cursor={false} content={({ active, payload, label }) => (
                    <TelemetryChartTooltip active={active} label={label} payload={payload?.filter((e) => e.value != null && e.value !== 0).map((e) => ({ name: String(e.name ?? ""), value: typeof e.value === "number" ? e.value : Number(e.value ?? 0), color: e.color })) ?? []} />
                  )} />
                  {/* Actual data */}
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="users"
                    name="Unique users"
                    stroke="var(--chart-users)"
                    strokeWidth={2.2}
                    fill="url(#dailyFill)"
                    dot={false}
                    activeDot={{
                      r: 4.5,
                      strokeWidth: 2,
                      stroke: "rgba(0,0,0,0.3)",
                      fill: "var(--chart-users)",
                      style: { filter: "drop-shadow(0 0 4px var(--chart-users))" },
                    }}
                    connectNulls={false}
                  />
                  {/* Prediction */}
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="predicted"
                    name="Forecast"
                    stroke="var(--chart-users)"
                    strokeWidth={1.8}
                    strokeDasharray="6 4"
                    strokeOpacity={0.6}
                    fill="url(#forecastFill)"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0, fill: "var(--chart-users)", opacity: 0.6 }}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="tz-grid">
              {tzCharts.map((tz) => (
                <TimezoneUsageChart
                  key={tz.timeZone}
                  title={tz.title}
                  subtitle={tz.subtitle}
                  accentColor={tz.accent}
                  theme={theme}
                  data={tz.data}
                />
              ))}
            </div>
          )}
        </div>
      </CollapsiblePanel>
    </div>
  );
}
