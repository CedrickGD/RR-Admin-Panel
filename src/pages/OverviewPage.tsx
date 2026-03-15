import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import { buildRegionBreakdown, buildTrafficTimeline } from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { buildDashboardChartPalette } from "./dashboardShared";

interface OverviewPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
}

type MetricTone = "primary" | "accent" | "warning" | "danger" | "neutral";

export function OverviewPage({ summary, theme }: OverviewPageProps) {
  const traffic = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const regions = useMemo(() => buildRegionBreakdown(summary), [summary]);
  const latestError = summary.recentErrors[0];
  const recentSignals = summary.recentErrors.slice(0, 5);
  const chartPalette = useMemo(() => buildDashboardChartPalette(theme), [theme]);
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
  const metrics: Array<{ label: string; value: string; note: string; tone: MetricTone }> = [
    {
      label: "Active users",
      value: formatNumber(summary.stats.activeUsers),
      note: `${formatNumber(summary.activeSessions.length)} sessions currently visible`,
      tone: "primary",
    },
    {
      label: "Started today",
      value: formatNumber(summary.stats.sessionsStartedToday),
      note: `${formatNumber(summary.stats.totalSessions)} total sessions loaded`,
      tone: "neutral",
    },
    {
      label: "Average session",
      value: formatDuration(summary.stats.averageSessionDurationSeconds),
      note: `${formatNumber(summary.stats.totalEvents)} events processed`,
      tone: "accent",
    },
    {
      label: "Sessions with errors",
      value: formatNumber(sessionsWithErrors),
      note: `${formatNumber(liveWithErrors)} of them are active now`,
      tone: "danger",
    },
    {
      label: "Primary region",
      value: topRegion,
      note: regions[0] ? `${formatNumber(regions[0].value)} sessions in focus` : "No geographic data",
      tone: "accent",
    },
    {
      label: "Latest error",
      value: latestError ? timeAgo(latestError.timestamp) : "Clear",
      note: latestError ? String(latestError.metrics["exception_type"] ?? latestError.service) : "No recent failures",
      tone: "warning",
    },
  ];
  const directives = [
    { label: "Traffic clock", value: "UTC fixed" },
    { label: "Geography source", value: geographyMode },
    { label: "Storage backend", value: summary.storage.toUpperCase() },
    { label: "Last ingest", value: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
    { label: "Generated", value: timeAgo(summary.generatedAt) },
    { label: "Route split", value: "Traffic / Signals / Heatmap / Live" },
  ];

  return (
    <div className="page-content page-content-wide overview-page page-stack">
      <section className="page-header">
        <div>
          <p className="page-kicker">Production Operations</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">
            The summary page only shows the operational posture, the current traffic curve, and the most recent failure
            pressure. Detailed traffic and deeper signal analysis now live on their own pages.
          </p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack page-meta-stack-live">
            <div className="page-meta">
              <span>Last ingest</span>
              <strong>{summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting"}</strong>
            </div>
            <div className="page-meta">
              <span>Generated</span>
              <strong>{timeAgo(summary.generatedAt)}</strong>
            </div>
            <div className="page-meta">
              <span>Errors 24h</span>
              <strong>{formatNumber(summary.stats.errorsLast24Hours)}</strong>
            </div>
            <div className="page-meta">
              <span>Storage</span>
              <strong>{summary.storage.toUpperCase()}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="command-slab">
        <div className="command-slab-head">
          <div>
            <p className="panel-kicker">Production posture</p>
            <h2 className="panel-title">Current operating signal</h2>
            <p className="panel-subtitle">
              This page is intentionally short. Use it for the headline read, then jump into the dedicated traffic or
              signals pages when you need detail.
            </p>
          </div>
        </div>

        <div className="command-strip">
          {metrics.map((metric) => (
            <article key={metric.label} className={`command-metric command-metric-${metric.tone}`}>
              <span className="command-metric-label">{metric.label}</span>
              <strong className="command-metric-value">{metric.value}</strong>
              <p className="command-metric-note">{metric.note}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="overview-primary-grid">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Traffic</p>
              <h2 className="panel-title">Last 24 hours</h2>
              <p className="panel-subtitle">
                The traffic curve stays on the overview. Timezone breakdowns moved out so this page stays readable at a
                glance.
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

          <div className="chart-shell chart-shell-tall">
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={traffic} margin={{ top: 16, right: 8, left: -10, bottom: 4 }}>
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
                  width={34}
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
                <Bar dataKey="activity" name="Events" fill={chartPalette.activityBar} radius={[8, 8, 0, 0]} barSize={14} />
                <Area
                  type="monotone"
                  dataKey="started"
                  name="New sessions"
                  stroke={chartPalette.sessionsLine}
                  strokeWidth={2.4}
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

        <div className="overview-side-stack">
          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Directives</p>
                <h2 className="panel-title">Navigation context</h2>
                <p className="panel-subtitle">
                  The summary page now routes operators into focused pages instead of forcing one long scan.
                </p>
              </div>
            </div>

            <div className="directive-list">
              {directives.map((directive) => (
                <div key={directive.label} className="directive-row">
                  <span className="directive-label">{directive.label}</span>
                  <strong className="directive-value">{directive.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Failures</p>
                <h2 className="panel-title">Latest pressure</h2>
                <p className="panel-subtitle">Recent application failures surfaced without leaving the summary view.</p>
              </div>
            </div>

            <div className="signal-list">
              {recentSignals.length > 0 ? (
                recentSignals.map((error) => (
                  <div key={error.id} className="signal-row">
                    <div className="signal-copy">
                      <p className="signal-title">{String(error.metrics["exception_type"] ?? error.service)}</p>
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
          </section>
        </div>
      </div>
    </div>
  );
}
