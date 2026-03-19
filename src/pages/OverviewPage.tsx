import { Activity, AlertTriangle, Clock, Globe2, Maximize2, Minimize2, TrendingUp, Users } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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
  accentHue?: number;
}

interface MetricCard {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone?: "success" | "warning" | "danger" | "default";
}

export function OverviewPage({ summary, theme, accentHue = 217 }: OverviewPageProps) {
  const [chartExpanded, setChartExpanded] = useState(false);
  const traffic = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const regions = useMemo(() => buildRegionBreakdown(summary), [summary]);
  const chartPalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);

  const totals = useMemo(
    () => traffic.reduce((acc, p) => ({ activity: acc.activity + p.activity, started: acc.started + p.started, errors: acc.errors + p.errors, peakUsers: Math.max(acc.peakUsers, p.users) }), { activity: 0, started: 0, errors: 0, peakUsers: 0 }),
    [traffic],
  );

  const sessionsWithErrors = summary.recentSessions.filter((s) => s.errorCount > 0).length;
  const liveWithErrors = summary.activeSessions.filter((s) => s.errorCount > 0).length;
  const topRegion = regions[0]?.label ?? "Unknown";
  const latestError = summary.recentErrors[0];
  const recentSignals = summary.recentErrors.slice(0, 6);

  const metrics: MetricCard[] = [
    {
      label: "Active Users",
      value: formatNumber(summary.stats.activeUsers),
      sub: `${formatNumber(summary.activeSessions.length)} sessions open`,
      icon: <Users className="h-[15px] w-[15px]" />,
      tone: summary.stats.activeUsers > 0 ? "success" : "default",
    },
    {
      label: "Started Today",
      value: formatNumber(summary.stats.sessionsStartedToday),
      sub: `${formatNumber(summary.stats.totalSessions)} total loaded`,
      icon: <TrendingUp className="h-[15px] w-[15px]" />,
    },
    {
      label: "Avg Session",
      value: formatDuration(summary.stats.averageSessionDurationSeconds),
      sub: `${formatNumber(summary.stats.totalEvents)} events total`,
      icon: <Clock className="h-[15px] w-[15px]" />,
    },
    {
      label: "Sessions w/ Errors",
      value: formatNumber(sessionsWithErrors),
      sub: `${formatNumber(liveWithErrors)} active now`,
      icon: <AlertTriangle className="h-[15px] w-[15px]" />,
      tone: sessionsWithErrors > 0 ? "warning" : "success",
    },
    {
      label: "Primary Region",
      value: topRegion,
      sub: regions[0] ? `${formatNumber(regions[0].value)} sessions` : "No geo data",
      icon: <Globe2 className="h-[15px] w-[15px]" />,
    },
    {
      label: "Latest Error",
      value: latestError ? timeAgo(latestError.timestamp) : "Clear",
      sub: latestError ? String(latestError.metrics["exception_type"] ?? latestError.service) : "No recent failures",
      icon: <Activity className="h-[15px] w-[15px]" />,
      tone: latestError ? "danger" : "success",
    },
  ];

  const directives = [
    { key: "Traffic Clock",    val: "UTC fixed" },
    { key: "Geography Source", val: summary.activeSessions.length > 0 ? "Active-first" : "Recent sessions" },
    { key: "Storage Backend",  val: summary.storage.toUpperCase() },
    { key: "Last Ingest",      val: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
    { key: "Generated",        val: timeAgo(summary.generatedAt) },
    { key: "Errors 24h",       val: formatNumber(summary.stats.errorsLast24Hours) },
  ];

  return (
    <div className="page-content page-stack-lg">
      {/* Page header */}
      <section className="page-header">
        <div>
          <p className="kicker">Production Operations</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Overview</h1>
          <p className="page-subtitle">
            Operational posture at a glance. Use the navbar to drill into Traffic, Signals, or Live sessions.
          </p>
        </div>
        <div className="page-header-right">
          <div className="meta-row">
            {[
              { label: "Active", val: formatNumber(summary.stats.activeUsers) },
              { label: "Errors 24h", val: formatNumber(summary.stats.errorsLast24Hours) },
              { label: "Storage", val: summary.storage.toUpperCase() },
            ].map((m) => (
              <div className="meta-item" key={m.label}>
                <span>{m.label}</span>
                <strong>{m.val}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stat grid */}
      <div className="stat-grid">
        {metrics.map((m) => (
          <div key={m.label} className={`stat-card${m.tone === "success" ? " tone-success" : m.tone === "warning" ? " tone-warning" : m.tone === "danger" ? " tone-danger" : ""}`}>
            <div className="stat-icon">{m.icon}</div>
            <span className="stat-label">{m.label}</span>
            <strong className="stat-value">{m.value}</strong>
            <p className="stat-sub">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Main + side */}
      <div className="main-side">
        {/* Traffic chart */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Traffic</p>
              <h2 className="section-title">Last 24 Hours</h2>
              <p className="section-sub">Active users, new sessions, and errors by hour.</p>
            </div>
            <div className="panel-head-right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="meta-row">
                {[
                  { label: "Peak Users/h", val: formatNumber(totals.peakUsers) },
                  { label: "Sessions", val: formatNumber(totals.started) },
                  { label: "Errors", val: formatNumber(totals.errors) },
                ].map((m) => (
                  <div className="meta-item" key={m.label}>
                    <span>{m.label}</span>
                    <strong>{m.val}</strong>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-icon" style={{ padding: 5 }} onClick={() => setChartExpanded((v) => !v)} title={chartExpanded ? "Collapse chart" : "Expand chart"}>
                {chartExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="chart-wrap" style={{ transition: "height 0.3s ease" }}>
              <ResponsiveContainer width="100%" height={chartExpanded ? 520 : 300}>
                <ComposedChart data={traffic} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="usersFillOverview" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={chartPalette.sessionsLine} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                  <XAxis
                    dataKey="shortLabel"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={20}
                    tick={{ fill: chartPalette.axis, fontSize: 10.5 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    allowDecimals={false}
                    tick={{ fill: chartPalette.axisSoft, fontSize: 10.5 }}
                  />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload, label }) => (
                      <TelemetryChartTooltip
                        active={active}
                        label={label}
                        payload={payload?.map((e) => ({
                          name: String(e.name ?? ""),
                          value: typeof e.value === "number" ? e.value : Number(e.value ?? 0),
                          color: e.color,
                        })) ?? []}
                      />
                    )}
                  />
                  <Area type="monotone" dataKey="users" name="Active users" stroke={chartPalette.sessionsLine} strokeWidth={2.2} fill="url(#usersFillOverview)" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.sessionsLine }} />
                  <Bar dataKey="started" name="New sessions" fill={chartPalette.activityBar} radius={[5, 5, 0, 0]} barSize={10} />
                  <Area type="monotone" dataKey="errors" name="Errors" stroke={chartPalette.errorsLine} strokeWidth={1.8} fill="none" dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.errorsLine }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Side panels */}
        <div className="side-stack">
          {/* System context */}
          <section className="panel">
            <div className="panel-head">
              <div className="panel-head-left">
                <p className="kicker">System</p>
                <h2 className="section-title">Context</h2>
              </div>
            </div>
            <div className="panel-body-tight">
              <div className="kv-list">
                {directives.map((d) => (
                  <div className="kv-row" key={d.key}>
                    <span className="kv-key">{d.key}</span>
                    <span className="kv-val">{d.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Recent failures */}
          <section className="panel">
            <div className="panel-head">
              <div className="panel-head-left">
                <p className="kicker">Failures</p>
                <h2 className="section-title">Recent Errors</h2>
              </div>
              {recentSignals.length > 0 ? (
                <span className="badge badge-danger">{recentSignals.length}</span>
              ) : (
                <span className="badge badge-success">Clear</span>
              )}
            </div>
            <div className="panel-body-tight">
              {recentSignals.length > 0 ? (
                <div className="signal-list">
                  {recentSignals.map((error) => (
                    <div key={error.id} className="signal-row">
                      <div className="signal-dot" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p className="signal-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {String(error.metrics["exception_type"] ?? error.service)}
                        </p>
                        <p className="signal-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {error.source} · {error.message ?? "No message"}
                        </p>
                      </div>
                      <span className="signal-time">{timeAgo(error.timestamp)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: "24px 16px" }}>
                  <p>No recent failures.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
