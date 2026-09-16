import { Activity, ChevronDown, Clock, Gauge, Radio, TrendingUp } from "lucide-react";
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
import { ChartLegend } from "../components/charts/ChartLegend";
import { CHART_MARGIN } from "../components/charts/chartMargin";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { TimezoneUsageChart } from "../components/charts/TimezoneUsageChart";
import { Badge } from "../components/ds/Badge";
import { DataTable, type DataTableColumn } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { Select } from "../components/ds/Select";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { PageToolbar } from "../components/ds/PageToolbar";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SegmentedControl, type TabItem } from "../components/ds/SegmentedControl";
import { KpiStatCard } from "../components/KpiStatCard";
import type { StatsPayload, SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildDailyUserTimeline,
  buildTimezoneActivity,
  buildTrafficTimeline,
} from "../utils/dashboardInsights";
import { formatDuration, formatNumber } from "../utils/format";
import { TIMEZONE_PANELS } from "./dashboardShared";
import "../theme/traffic-workspace.css";

interface TrafficPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  theme: ThemeMode;
  accentHue?: number;
}

/** Matches the two <Area> series below: solid actuals, dashed projection. */
const DAILY_LEGEND = [{ label: "Unique customers", color: "var(--chart-users)" }];
const ESTIMATE_LEGEND = [
  ...DAILY_LEGEND,
  { label: "Linear estimate", color: "var(--chart-users)", dashed: true },
];

const INSIGHT_VIEWS: TabItem<"daily" | "timezones">[] = [
  { key: "daily", label: "Daily customers" },
  { key: "timezones", label: "Timezones" },
];

interface DailySeriesPoint {
  label: string;
  shortLabel: string;
  users: number;
  isoDate: string;
}

const DAILY_COLUMNS: Array<DataTableColumn<DailySeriesPoint>> = [
  {
    key: "date",
    header: "Date (UTC)",
    render: (row) => <time dateTime={row.isoDate}>{row.isoDate}</time>,
  },
  {
    key: "users",
    header: "Unique customers",
    numeric: true,
    render: (row) => formatNumber(row.users),
  },
];

/** "YYYY-MM-DD" -> "Mar 12" (UTC, matches buildDailyUserTimeline labels). */
function dayToLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return day;
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

/* Simple linear-regression prediction: extends the daily user curve
   forward by `forecastDays` using the last `lookbackDays` of data. */
function buildPrediction(data: DailySeriesPoint[], forecastDays: number, lookbackDays: number) {
  const slice = data.slice(-Math.min(lookbackDays, data.length));
  if (slice.length < 2) return [];

  // Linear regression on the slice
  const n = slice.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
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

export function TrafficPage({ summary, stats, theme }: TrafficPageProps) {
  const [insightView, setInsightView] = useState<"daily" | "timezones">("daily");
  const [showEstimate, setShowEstimate] = useState(false);

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

  const tzCharts = useMemo(() => {
    // Events retain every service; the error series excludes background faults,
    // matching the server's real-error counters without changing event volume.
    const errorSummary = {
      ...summary,
      recentEvents: summary.recentEvents.filter(
        (event) => event.service === "app_error" && event.metrics["error_kind"] !== "background",
      ),
    };
    return TIMEZONE_PANELS.map((panel) => {
      const data = buildTimezoneActivity(summary, panel.timeZone);
      const errors = buildTimezoneActivity(errorSummary, panel.timeZone);
      return {
        ...panel,
        data: data.map((point, index) => ({ ...point, errors: errors[index]?.errors ?? 0 })),
      };
    });
  }, [summary]);
  const timezoneTotals = tzCharts[0].data.reduce(
    (total, point) => ({
      events: total.events + point.activity,
      started: total.started + point.started,
      errors: total.errors + point.errors,
    }),
    { events: 0, started: 0, errors: 0 },
  );
  const hasDailyData = stats
    ? dailyUsers.length > 0
    : summary.activeSessions.length + summary.recentSessions.length > 0;
  const canEstimate = stats !== null && dailyUsers.length >= 2;
  const isEstimateVisible = showEstimate && canEstimate;

  // Forecast days scale with the span of real data: ≤7d→3d, ≤14d→5d, ≤31d→7d, longer→14d
  const forecastDays =
    dailyUsers.length <= 7 ? 3 : dailyUsers.length <= 14 ? 5 : dailyUsers.length <= 31 ? 7 : 14;

  const chartData = useMemo(() => {
    const prediction = isEstimateVisible
      ? buildPrediction(dailyUsers, forecastDays, Math.min(30, dailyUsers.length))
      : [];
    // Merge: real data has `users`, forecast has `predicted`
    const merged: { label: string; shortLabel: string; users?: number; predicted?: number }[] = [
      ...dailyUsers.map((d) => ({
        label: d.label,
        shortLabel: d.shortLabel,
        users: d.users,
        predicted: undefined as number | undefined,
      })),
    ];
    // Bridge: last real point starts the prediction line
    if (dailyUsers.length > 0 && prediction.length > 0) {
      const last = dailyUsers[dailyUsers.length - 1];
      merged[merged.length - 1] = { ...merged[merged.length - 1], predicted: last.users };
    }
    for (const p of prediction) {
      merged.push({
        label: p.label,
        shortLabel: p.shortLabel,
        users: undefined,
        predicted: p.predicted,
      });
    }
    return merged;
  }, [dailyUsers, forecastDays, isEstimateVisible]);

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

  const rangeLabel = stats
    ? stats.filters.rangeDays === null
      ? "Available daily history"
      : `Last ${stats.filters.rangeDays} days`
    : "30-day view of loaded sessions";
  const appliedFilters = stats
    ? [
        stats.filters.version ? `Version ${stats.filters.version}` : null,
        stats.filters.platform,
        stats.filters.country,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const dailyRows = dailyUsers.slice(-30).reverse();

  return (
    <div className="page-content page-stack-lg traffic-workspace">
      <PageHeader
        page="traffic"
        sub={
          <>
            Daily counts use UTC. Snapshot updated <RelativeTime iso={summary.generatedAt} />.
          </>
        }
      />

      <div className="stat-grid stat-grid-5">
        <KpiStatCard
          label="Active right now"
          value={formatNumber(stats?.totals.activeNow ?? summary.stats.activeUsers)}
          sub="Live sessions"
          icon={<Radio size={14} />}
          tone="primary"
        />
        <KpiStatCard
          label="Started today"
          value={formatNumber(summary.stats.sessionsStartedToday)}
          sub="Since midnight UTC"
          icon={<TrendingUp size={14} />}
          tone="primary"
        />
        <KpiStatCard
          label="Peak customers/h"
          value={formatNumber(peakHourlyUsers)}
          sub="Loaded sessions · last 24 h"
          icon={<Gauge size={14} />}
          tone="primary"
          chartColor="var(--chart-users)"
          spark={hourlyUsers}
        />
        <KpiStatCard
          label="Avg duration"
          value={formatDuration(
            stats?.totals.averageSessionDurationSeconds ??
              summary.stats.averageSessionDurationSeconds,
          )}
          sub={stats ? "In range · legacy excluded" : "Per session"}
          icon={<Clock size={14} />}
          tone="primary"
        />
        <KpiStatCard
          label="Last ingest"
          value={<RelativeTime iso={summary.stats.lastIngestAt ?? null} />}
          sub="Latest event or heartbeat"
          icon={<Activity size={14} />}
          tone="primary"
        />
      </div>

      <section className="panel traffic-insights" aria-labelledby="traffic-insights-title">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title" id="traffic-insights-title">
              {insightView === "daily" ? "Daily customers" : "Timezone activity"}
            </h2>
            <p className="section-sub">
              {insightView === "daily"
                ? `${rangeLabel} · UTC${appliedFilters ? ` · ${appliedFilters}` : ""}`
                : "The same recorded events, shown on four local clocks."}
            </p>
          </div>
          <Badge tone={insightView === "daily" && stats ? "muted" : "warning"}>
            {insightView === "daily"
              ? stats
                ? "Server aggregates"
                : "Limited session snapshot"
              : "Loaded events · last 24 hours"}
          </Badge>
        </div>
        <PageToolbar
          aria-label="Traffic view"
          left={
            <SegmentedControl
              aria-label="Traffic insight view"
              value={insightView}
              onChange={setInsightView}
              items={INSIGHT_VIEWS}
            />
          }
          filters={
            insightView === "daily" ? (
              <Select
                aria-label="Trend estimate"
                value={isEstimateVisible ? "on" : "off"}
                onValueChange={(value) => setShowEstimate(value === "on")}
                disabled={!canEstimate}
              >
                <option value="off">Off</option>
                <option value="on">Show linear estimate</option>
              </Select>
            ) : undefined
          }
          canReset={insightView !== "daily" || showEstimate}
          onReset={() => {
            setInsightView("daily");
            setShowEstimate(false);
          }}
        />
        <div className="traffic-chart-context">
          {insightView === "daily" ? (
            <>
              <ChartLegend items={isEstimateVisible ? ESTIMATE_LEGEND : DAILY_LEGEND} />
              <MetaRow
                items={[
                  {
                    label: "Peak customers/d",
                    value: hasDailyData ? formatNumber(peakDailyUsers) : "Not available",
                  },
                  {
                    label: stats ? "Sessions in range" : "Loaded sessions",
                    value: formatNumber(metaSessions),
                  },
                  {
                    label: stats ? "Errors in range" : "Errors in 24h",
                    value: formatNumber(metaErrors),
                  },
                ]}
              />
            </>
          ) : (
            <MetaRow
              items={[
                { label: "Loaded events", value: formatNumber(timezoneTotals.events) },
                { label: "Session starts", value: formatNumber(timezoneTotals.started) },
                { label: "Recorded errors", value: formatNumber(timezoneTotals.errors) },
              ]}
            />
          )}
        </div>
        {insightView === "daily" ? (
          <>
            {!stats && (
              <p className="traffic-coverage-note">
                Detailed aggregates are unavailable. This is a limited session snapshot, not the
                full customer history.
              </p>
            )}
            {isEstimateVisible && (
              <p className="traffic-coverage-note">
                Dashed line: {forecastDays}-day linear estimate, not measured activity.
              </p>
            )}
            {hasDailyData ? (
              <div className="traffic-plot-body">
                <div className="chart-wrap chart-wrap-tall">
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart data={chartData} margin={CHART_MARGIN}>
                      <defs>
                        <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-users)" stopOpacity={0.22} />
                          <stop offset="55%" stopColor="var(--chart-users)" stopOpacity={0.07} />
                          <stop offset="100%" stopColor="var(--chart-users)" stopOpacity={0.01} />
                        </linearGradient>
                        <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-users)" stopOpacity={0.08} />
                          <stop offset="100%" stopColor="var(--chart-users)" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="var(--chart-grid)"
                        vertical={false}
                        strokeDasharray="3 6"
                      />
                      {/* Tick size is an SVG attribute, so no var(): 11 is --fs-micro, the scale's 11px floor, up from 10.5. */}
                      <XAxis
                        dataKey="shortLabel"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={28}
                        tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={32}
                        tick={{ fill: "var(--chart-axis-soft)", fontSize: 11 }}
                        allowDecimals={false}
                        tickFormatter={(v: number) => formatNumber(Number(v))}
                      />
                      <Tooltip
                        isAnimationActive={false}
                        cursor={false}
                        content={({ active, payload, label }) => (
                          <TelemetryChartTooltip
                            active={active}
                            label={label}
                            payload={
                              payload
                                ?.filter((e) => e.value != null)
                                .map((e) => ({
                                  name: String(e.name ?? ""),
                                  value:
                                    typeof e.value === "number" ? e.value : Number(e.value ?? 0),
                                  color: e.color,
                                })) ?? []
                            }
                          />
                        )}
                      />
                      {/* Actual data */}
                      <Area
                        isAnimationActive={false}
                        type="monotone"
                        dataKey="users"
                        name="Unique customers"
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
                      {isEstimateVisible && (
                        <Area
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="predicted"
                          name="Linear estimate"
                          stroke="var(--chart-users)"
                          strokeWidth={1.8}
                          strokeDasharray="6 4"
                          strokeOpacity={0.6}
                          fill="url(#forecastFill)"
                          dot={false}
                          activeDot={{
                            r: 3,
                            strokeWidth: 0,
                            fill: "var(--chart-users)",
                            opacity: 0.6,
                          }}
                          connectNulls={false}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Activity />}
                title={stats ? "No daily activity data" : "No session data in this snapshot"}
              >
                {stats
                  ? "The server returned no daily records for this range."
                  : "The loaded snapshot cannot establish historical customer activity."}
              </EmptyState>
            )}
            {hasDailyData && (
              <details className="traffic-data-details">
                <summary>
                  Daily values <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <p className="traffic-detail-note">
                  Most recent 30 available days, newest first. UTC dates; estimates are not
                  included.
                </p>
                <DataTable
                  flush
                  mobileLayout="stack"
                  caption="Daily customer counts (UTC)"
                  columns={DAILY_COLUMNS}
                  rows={dailyRows}
                  rowKey={(row) => row.isoDate}
                />
              </details>
            )}
          </>
        ) : timezoneTotals.events > 0 ? (
          <>
            <p className="traffic-coverage-note">
              A bounded event snapshot, not complete daily totals. These clocks do not represent
              separate country audiences.
            </p>
            <div className="tz-grid traffic-timezones">
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
          </>
        ) : (
          <EmptyState icon={<Clock />} title="No events in this snapshot">
            Heartbeats can keep customers online without creating event entries.
          </EmptyState>
        )}
      </section>

      <details className="panel traffic-method">
        <summary>
          Data sources &amp; estimate method <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="traffic-method-body">
          <dl>
            <div>
              <dt>Daily customers</dt>
              <dd>
                Server aggregates count unique customers per UTC day. The same customer may appear
                on several days, so daily counts are not additive.
              </dd>
            </div>
            <div>
              <dt>Snapshot coverage</dt>
              <dd>
                Without detailed statistics, the daily view uses loaded sessions only. Hourly peaks
                and timezone charts always use a bounded snapshot. Missing records do not prove
                inactivity.
              </dd>
            </div>
            <div>
              <dt>Linear estimate</dt>
              <dd>
                Optional extrapolation of the last {Math.min(30, dailyUsers.length)} available daily
                points. It does not model seasonality or uncertainty and may include an incomplete
                current day. Estimates require at least two server-side daily records and never use
                the limited fallback.
              </dd>
            </div>
            <div>
              <dt>Timezones and errors</dt>
              <dd>
                The same events are grouped by local clock, not customer location. Background faults
                remain in event volume but are excluded from error counts. Server error totals
                follow the supplied time range, not version, platform or country filters.
              </dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  );
}
