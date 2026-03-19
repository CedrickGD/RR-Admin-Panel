import { Activity, AlertTriangle, Clock, Globe2, RotateCcw, TrendingUp, Users, X } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
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
import { useChartColors } from "../hooks/useChartColors";
import { useChartZoom } from "../hooks/useChartZoom";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import { buildRegionBreakdown, buildTrafficTimeline } from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette } from "./dashboardShared";

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

const TIME_WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "3h", hours: 3 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
] as const;

export function OverviewPage({ summary, theme, accentHue = 217 }: OverviewPageProps) {
  const traffic = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const regions = useMemo(() => buildRegionBreakdown(summary), [summary]);
  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartColors = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);

  const [activeWindow, setActiveWindow] = useState(24);
  const [dismissedErrors, setDismissedErrors] = useState<Set<string>>(new Set());

  const zoom = useChartZoom(traffic.length);
  const visibleTraffic = useMemo(() => traffic.slice(zoom.visibleStart, zoom.visibleEnd), [traffic, zoom.visibleStart, zoom.visibleEnd]);

  const totals = useMemo(
    () => traffic.reduce((acc, p) => ({ activity: acc.activity + p.activity, started: acc.started + p.started, errors: acc.errors + p.errors, peakUsers: Math.max(acc.peakUsers, p.users) }), { activity: 0, started: 0, errors: 0, peakUsers: 0 }),
    [traffic],
  );

  const sessionsWithErrors = summary.recentSessions.filter((s) => s.errorCount > 0).length;
  const liveWithErrors = summary.activeSessions.filter((s) => s.errorCount > 0).length;
  const topRegion = regions[0]?.label ?? "Unknown";
  const latestError = summary.recentErrors[0];
  const recentSignals = summary.recentErrors.slice(0, 6).filter((e) => !dismissedErrors.has(e.id));
  const windowHours = zoom.visibleEnd - zoom.visibleStart;

  const handleTimeWindow = useCallback((hours: number) => {
    setActiveWindow(hours);
    if (hours >= 24) {
      zoom.resetZoom();
    } else {
      zoom.setWindow(hours);
    }
  }, [zoom]);

  const dismissError = useCallback((id: string) => {
    setDismissedErrors((prev) => new Set(prev).add(id));
  }, []);

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
      {/* Everything in a single main-side grid so right column starts at the very top */}
      <div className="main-side main-side-stretch">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Page header — inside left column */}
          <div>
            <p className="kicker">Production Operations</p>
            <h1 className="page-title" style={{ marginTop: 6 }}>Overview</h1>
          </div>

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

          {/* Traffic chart */}
          <section className="panel">
            <div className="panel-head">
              <div className="panel-head-left">
                <p className="kicker">Traffic</p>
                <h2 className="section-title">Last 24 Hours</h2>
                <p className="section-sub">
                  {zoom.isZoomed
                    ? `Viewing ${windowHours}h window — scroll to adjust`
                    : "Scroll inside chart to zoom in"}
                </p>
              </div>
              <div className="panel-head-right" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              </div>
            </div>

            {/* Time window buttons */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 4px", gap: 8 }}>
              <div className="seg-control">
                {TIME_WINDOWS.map((tw) => (
                  <button
                    key={tw.label}
                    type="button"
                    className={`seg-btn${activeWindow === tw.hours ? " active" : ""}`}
                    onClick={() => handleTimeWindow(tw.hours)}
                  >
                    {tw.label}
                  </button>
                ))}
              </div>
              {zoom.isZoomed && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { zoom.resetZoom(); setActiveWindow(24); }} title="Reset zoom" style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px" }}>
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              )}
            </div>

            <div className="panel-body">
              <div className="chart-wrap chart-wrap-tall" ref={zoom.containerRef} style={{ cursor: "ns-resize" }}>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={visibleTraffic} margin={{ top: 16, right: 8, left: -14, bottom: 0 }}>
                    <defs>
                      <linearGradient id="usersFillOverview" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={chartColors.sessionsLine} stopOpacity={0.22} />
                        <stop offset="50%"  stopColor={chartColors.sessionsLine} stopOpacity={0.08} />
                        <stop offset="100%" stopColor={chartColors.sessionsLine} stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="errorsFillOverview" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={chartColors.errorsLine} stopOpacity={0.15} />
                        <stop offset="100%" stopColor={chartColors.errorsLine} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={chartColors.grid} vertical={false} strokeDasharray="3 6" />
                    <XAxis
                      dataKey="shortLabel"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={20}
                      tick={{ fill: chartColors.axis, fontSize: 10.5 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      allowDecimals={false}
                      tick={{ fill: chartColors.axisSoft, fontSize: 10.5 }}
                    />
                    <Tooltip
                      cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
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
                    <Area
                      type="natural"
                      dataKey="users"
                      name="Active users"
                      stroke={chartColors.sessionsLine}
                      strokeWidth={2.4}
                      fill="url(#usersFillOverview)"
                      dot={false}
                      activeDot={{
                        r: 5,
                        strokeWidth: 2,
                        stroke: "rgba(0,0,0,0.3)",
                        fill: chartColors.sessionsLine,
                        style: { filter: `drop-shadow(0 0 4px ${chartColors.sessionsLine})` },
                      }}
                      animationDuration={600}
                      animationEasing="ease-out"
                    />
                    <Bar
                      dataKey="started"
                      name="New sessions"
                      fill={chartColors.activityBar}
                      radius={[6, 6, 0, 0]}
                      barSize={zoom.isZoomed ? 18 : 10}
                      animationDuration={600}
                      animationEasing="ease-out"
                    />
                    <Area
                      type="natural"
                      dataKey="errors"
                      name="Errors"
                      stroke={chartColors.errorsLine}
                      strokeWidth={1.8}
                      fill="url(#errorsFillOverview)"
                      dot={false}
                      activeDot={{
                        r: 4,
                        strokeWidth: 2,
                        stroke: "rgba(0,0,0,0.3)",
                        fill: chartColors.errorsLine,
                        style: { filter: `drop-shadow(0 0 4px ${chartColors.errorsLine})` },
                      }}
                      animationDuration={600}
                      animationEasing="ease-out"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        </div>

        {/* Side panels — stretch to match left column height */}
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
          <section className="panel" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
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
            <div className="panel-body-tight" style={{ flex: 1 }}>
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
                      <button
                        type="button"
                        onClick={() => dismissError(error.id)}
                        title="Dismiss"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "rgba(255,255,255,0.25)",
                          padding: 2,
                          marginLeft: 4,
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          transition: "color 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.25)"; }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
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
