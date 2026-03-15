import { AlertTriangle, Clock3, Globe2, Radio, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatCard } from "../components/StatCard";
import { GeoDonutChart } from "../components/charts/GeoDonutChart";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { TimezoneUsageChart } from "../components/charts/TimezoneUsageChart";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildCountryBreakdown,
  buildRegionBreakdown,
  buildTimezoneActivity,
  buildTrafficTimeline,
  buildVersionBreakdown,
} from "../utils/dashboardInsights";
import { getRegionColor } from "../utils/geography";
import { formatNumber, timeAgo } from "../utils/format";

interface OverviewPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
}

const COUNTRY_COLORS = ["#38bdf8", "#a78bfa", "#f59e0b", "#2dd4bf", "#fb7185", "#f97316"];
const TIMEZONE_PANELS = [
  { title: "UTC", subtitle: "Universal reference clock", timeZone: "UTC", accent: "#38bdf8" },
  { title: "New York", subtitle: "America/New_York", timeZone: "America/New_York", accent: "#a78bfa" },
  { title: "London", subtitle: "Europe/London", timeZone: "Europe/London", accent: "#f59e0b" },
  { title: "Tokyo", subtitle: "Asia/Tokyo", timeZone: "Asia/Tokyo", accent: "#2dd4bf" },
];

export function OverviewPage({ summary, theme }: OverviewPageProps) {
  const traffic = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const regions = useMemo(() => buildRegionBreakdown(summary), [summary]);
  const countries = useMemo(() => buildCountryBreakdown(summary, 5, true), [summary]);
  const versions = useMemo(() => buildVersionBreakdown(summary), [summary]);
  const timezoneCharts = useMemo(
    () =>
      TIMEZONE_PANELS.map((panel) => ({
        ...panel,
        data: buildTimezoneActivity(summary, panel.timeZone),
      })),
    [summary],
  );
  const latestError = summary.recentErrors[0];
  const recentSignals = summary.recentErrors.slice(0, 4);
  const chartPalette = useMemo(
    () =>
      theme === "dark"
        ? {
            grid: "rgba(255,255,255,0.08)",
            axis: "rgba(255,255,255,0.58)",
            axisSoft: "rgba(255,255,255,0.46)",
            activityBar: "rgba(45,212,191,0.26)",
            sessionsLine: "rgba(196,181,253,0.96)",
            errorsLine: "rgba(251,113,133,0.9)",
          }
        : {
            grid: "rgba(19,37,57,0.12)",
            axis: "rgba(19,37,57,0.72)",
            axisSoft: "rgba(19,37,57,0.54)",
            activityBar: "rgba(20,184,166,0.22)",
            sessionsLine: "rgba(139,92,246,0.86)",
            errorsLine: "rgba(225,29,72,0.88)",
          },
    [theme],
  );
  const totals = useMemo(
    () =>
      traffic.reduce(
        (accumulator, point) => {
          accumulator.activity += point.activity;
          accumulator.started += point.started;
          accumulator.errors += point.errors;
          return accumulator;
        },
        { activity: 0, started: 0, errors: 0 },
      ),
    [traffic],
  );
  const sessionsWithErrors = summary.recentSessions.filter((session) => session.errorCount > 0).length;
  const liveWithErrors = summary.activeSessions.filter((session) => session.errorCount > 0).length;
  const topRegion = regions[0]?.label ?? "Unknown";
  const geographyMode = summary.activeSessions.length > 0 ? "Active-first session view" : "Recent session view";
  const regionDonutData = useMemo(
    () =>
      regions.map((region) => ({
        label: region.label,
        value: region.value,
        share: region.share,
        color: getRegionColor(region.label),
        note: `${formatNumber(region.value)} sessions`,
      })),
    [regions],
  );
  const countryDonutData = useMemo(
    () =>
      countries.map((country, index) => ({
        label: country.label,
        value: country.value,
        share: country.share,
        color: COUNTRY_COLORS[index % COUNTRY_COLORS.length],
        note: country.region,
        flag: country.flag,
      })),
    [countries],
  );

  return (
    <div className="page-content page-content-wide overview-page">
      <section className="page-header">
        <div>
          <p className="page-kicker">Operator View</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">
            Fixed-zone telemetry view for production operations. Usage charts are rendered in UTC, New York, London, and Tokyo, while the live heatmap stays isolated on its own page.
          </p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack">
            <div className="page-meta">
              <span>Last ingest</span>
              <strong>{summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting"}</strong>
            </div>
            <div className="page-meta">
              <span>Active now</span>
              <strong>{formatNumber(summary.stats.activeUsers)}</strong>
            </div>
            <div className="page-meta">
              <span>Errors 24h</span>
              <strong>{formatNumber(summary.stats.errorsLast24Hours)}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="overview-stat-grid">
        <StatCard
          label="Active Users"
          value={formatNumber(summary.stats.activeUsers)}
          sub="Live geography now has its own page"
          icon={<Radio className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="Sessions With Errors"
          value={formatNumber(sessionsWithErrors)}
          sub={`${formatNumber(liveWithErrors)} are active right now`}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone="rose"
        />
        <StatCard
          label="Top Region"
          value={topRegion}
          sub={regions[0] ? `${formatNumber(regions[0].value)} sessions in focus` : "No geographic data"}
          icon={<Globe2 className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Latest Error"
          value={latestError ? timeAgo(latestError.timestamp) : "None"}
          sub={latestError ? String(latestError.metrics["exception_type"] ?? latestError.service) : "No recent failures"}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      <div className="overview-primary-grid">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Traffic</p>
              <h2 className="panel-title">Recent activity (UTC)</h2>
              <p className="panel-subtitle">
                All telemetry events, new sessions, and errors over the last 24 hours, labeled against a fixed UTC clock for production consistency.
              </p>
            </div>
            <div className="panel-inline-metrics">
              <div>
                <span>Events</span>
                <strong>{formatNumber(totals.activity)}</strong>
              </div>
              <div>
                <span>New sessions</span>
                <strong>{formatNumber(totals.started)}</strong>
              </div>
              <div>
                <span>Errors</span>
                <strong>{formatNumber(totals.errors)}</strong>
              </div>
            </div>
          </div>

          <div className="chart-shell chart-shell-professional chart-shell-tall">
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={traffic} margin={{ top: 16, right: 8, left: -10, bottom: 8 }}>
                <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
                  tick={{ fill: chartPalette.axis, fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  tick={{ fill: chartPalette.axisSoft, fontSize: 11 }}
                />
                <Tooltip
                  cursor={false}
                  content={({ active, payload, label }) => (
                    <TelemetryChartTooltip
                      active={active}
                      label={label}
                      payload={
                        payload?.map((entry) => ({
                          name: String(entry.name ?? "Value"),
                          value: typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0),
                          color: entry.color,
                        })) ?? []
                      }
                    />
                  )}
                />
                <Bar dataKey="activity" name="Events" fill={chartPalette.activityBar} radius={[6, 6, 0, 0]} barSize={14} />
                <Area
                  type="monotone"
                  dataKey="started"
                  name="New sessions"
                  stroke={chartPalette.sessionsLine}
                  strokeWidth={2.2}
                  fill="rgba(255,255,255,0)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.sessionsLine }}
                />
                <Area
                  type="monotone"
                  dataKey="errors"
                  name="Errors"
                  stroke={chartPalette.errorsLine}
                  strokeWidth={2}
                  fill="rgba(255,255,255,0)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.errorsLine }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Quick Checks</p>
              <h2 className="panel-title">Operating context</h2>
              <p className="panel-subtitle">The high-signal checks that matter before you drill into live sessions or the heatmap.</p>
            </div>
          </div>

          <div className="info-list">
            <div className="info-row">
              <span className="info-label">Traffic clock</span>
              <span className="info-value">UTC fixed</span>
            </div>
            <div className="info-row">
              <span className="info-label">Timezone overlays</span>
              <span className="info-value">UTC / New York / London / Tokyo</span>
            </div>
            <div className="info-row">
              <span className="info-label">Geography source</span>
              <span className="info-value">{geographyMode}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Storage backend</span>
              <span className="info-value">{summary.storage.toUpperCase()}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Latest error source</span>
              <span className="info-value">{latestError ? latestError.source : "No recent failures"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Heatmap mode</span>
              <span className="info-value">Active users only</span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel panel-dense">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Timezones</p>
            <h2 className="panel-title">Usage by fixed timezone</h2>
            <p className="panel-subtitle">
              The same 24-hour event frame rendered against fixed production clocks so operators can scan usage without relying on browser locale.
            </p>
          </div>
          <span className="panel-count">
            <Clock3 className="mr-1 inline h-4 w-4" />
            4 zones
          </span>
        </div>

        <div className="timezone-grid">
          {timezoneCharts.map((panel) => (
            <TimezoneUsageChart
              key={panel.timeZone}
              title={panel.title}
              subtitle={panel.subtitle}
              data={panel.data}
              accentColor={panel.accent}
              theme={theme}
            />
          ))}
        </div>
      </section>

      <div className="content-grid">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Regions</p>
              <h2 className="panel-title">Geography split</h2>
              <p className="panel-subtitle">
                Donut views for macro-regions and top countries, with hover-locked labels so you can inspect the active mix quickly.
              </p>
            </div>
          </div>

          <div className="donut-grid">
            <GeoDonutChart data={regionDonutData} totalLabel="Regional share" metricLabel="Sessions" />
            <GeoDonutChart data={countryDonutData} totalLabel="Top countries" metricLabel="Sessions" />
          </div>
        </section>

        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Versions</p>
              <h2 className="panel-title">Version spread and recent failures</h2>
              <p className="panel-subtitle">
                Client version concentration stays visible here, with the latest error stream beneath it for a quick production read.
              </p>
            </div>
          </div>

          <div className="panel-stack">
            <div className="chart-shell chart-shell-professional chart-shell-compact">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={versions} layout="vertical" margin={{ top: 8, right: 6, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    width={96}
                    tick={{ fill: chartPalette.axis, fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload, label }) => (
                      <TelemetryChartTooltip
                        active={active}
                        label={label}
                        payload={
                          payload?.map((entry) => ({
                            name: String(entry.name ?? "Value"),
                            value: typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0),
                            color: entry.color,
                          })) ?? []
                        }
                      />
                    )}
                  />
                  <Bar dataKey="value" name="Sessions" fill={chartPalette.sessionsLine} radius={[0, 6, 6, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="signal-list">
              {recentSignals.length > 0 ? (
                recentSignals.map((error) => (
                  <div key={error.id} className="signal-row">
                    <div className="signal-copy">
                      <p className="signal-title">
                        {String(error.metrics["exception_type"] ?? error.service)}
                      </p>
                      <p className="signal-meta">
                        {error.source} · {error.message ?? "No message provided"}
                      </p>
                    </div>
                    <div className="signal-side">
                      <strong className="signal-time">{timeAgo(error.timestamp)}</strong>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-panel small">No recent failures to highlight.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
