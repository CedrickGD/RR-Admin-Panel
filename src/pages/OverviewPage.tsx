import { Activity, AlertTriangle, Clock, Globe2, RotateCcw, TrendingUp, Users, X } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { KpiStatCard, type KpiDrilldown } from "../components/KpiStatCard";
import { useChartColors } from "../hooks/useChartColors";
import { useChartZoom } from "../hooks/useChartZoom";
import type { DayPoint, StatsPayload, SummaryPayload, ThemeMode } from "../types/telemetry";
import { buildRegionBreakdown, buildTrafficTimeline } from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette } from "./dashboardShared";

interface OverviewPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  theme: ThemeMode;
  accentHue?: number;
  filterBar?: ReactNode;
}

const TIME_WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "3h", hours: 3 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function versionLabel(version: string): string {
  return version === "legacy" ? "Legacy (pre-1.4)" : version;
}

function utcDayString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Sum sessions over the last `days` UTC days of a per-day series (inclusive of today). */
function sumSessionsSince(series: DayPoint[], days: number): number {
  const cutoff = utcDayString(Date.now() - (days - 1) * DAY_MS);
  return series.reduce((acc, p) => (p.day >= cutoff ? acc + p.sessions : acc), 0);
}

export function OverviewPage({ summary, stats, theme, accentHue = 217, filterBar }: OverviewPageProps) {
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

  const topRegion = regions[0]?.label ?? "Unknown";
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentErrors24h = summary.recentErrors.filter((e) => Date.parse(e.timestamp) >= twentyFourHoursAgo);
  const latestError = recentErrors24h[0];
  const recentSignals = recentErrors24h.slice(0, 6).filter((e) => !dismissedErrors.has(e.id));
  const windowHours = zoom.visibleEnd - zoom.visibleStart;

  // True lifetime event counter; summary.stats.totalEvents is only the retained window.
  const lifetimeEvents = summary.stats.lifetimeEvents ?? summary.stats.totalEvents;

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

  /* ----- KPI drill-downs (only when server-side stats have loaded) ----- */

  const activeUsersDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    const totalUsers = Math.max(1, stats.totals.lifetimeUsers);
    const topVersions = [...stats.breakdowns.versionsCurrent]
      .sort((a, b) => b.users - a.users)
      .slice(0, 5);
    return {
      breakdown: topVersions.map((v) => ({
        label: versionLabel(v.version),
        value: formatNumber(v.users),
        share: v.users / totalUsers,
      })),
      breakdownTitle: "Users by current version",
      note: `${formatNumber(stats.totals.rpcLiveNow)} live with Discord RPC · RPC status reported by ${formatNumber(stats.totals.rpcKnownUsers)} of ${formatNumber(stats.totals.lifetimeUsers)} users`,
    };
  }, [stats]);

  const sessionsDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    const rangeDays = stats.filters.rangeDays;
    const limited = (days: number) => (rangeDays !== null && rangeDays < days ? `limited to ${rangeDays}d range` : undefined);
    const platforms = [...stats.breakdowns.platforms].sort((a, b) => b.sessions - a.sessions);
    const platformTotal = Math.max(1, platforms.reduce((acc, p) => acc + p.sessions, 0));
    return {
      timespans: [
        { label: "Today", value: formatNumber(sumSessionsSince(stats.series.sessionsPerDay, 1)) },
        { label: "7 d", value: formatNumber(sumSessionsSince(stats.series.sessionsPerDay, 7)), hint: limited(7) },
        { label: "30 d", value: formatNumber(sumSessionsSince(stats.series.sessionsPerDay, 30)), hint: limited(30) },
        { label: "Lifetime", value: formatNumber(stats.totals.lifetimeSessions) },
      ],
      series: stats.series.sessionsPerDay.map((p) => ({ day: p.day, value: p.sessions })),
      seriesName: "Sessions",
      breakdown: platforms.slice(0, 5).map((p) => ({
        label: p.key || "Unknown",
        value: formatNumber(p.sessions),
        share: p.sessions / platformTotal,
      })),
      breakdownTitle: "Sessions by platform",
    };
  }, [stats]);

  const avgSessionDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    return {
      timespans: [
        { label: "Avg duration", value: formatDuration(stats.totals.averageSessionDurationSeconds), hint: "selected range" },
        { label: "Sessions in range", value: formatNumber(stats.totals.sessionsInRange) },
        { label: "Lifetime events", value: formatNumber(lifetimeEvents), hint: `${formatNumber(summary.stats.totalEvents)} retained in window` },
      ],
      note: "Computed server-side over the full session history. Legacy install-scoped pseudo-sessions (install:*) are excluded from the average.",
    };
  }, [stats, lifetimeEvents, summary.stats.totalEvents]);

  const errorsDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    return {
      series: stats.series.errorsPerDay.map((p) => ({ day: p.day, value: p.errors })),
      seriesName: "Errors",
      note: "Errors recorded per day within the selected range and filters.",
    };
  }, [stats]);

  const regionDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    const totalUsers = Math.max(1, stats.totals.lifetimeUsers);
    const countries = [...stats.breakdowns.countries].sort((a, b) => b.users - a.users).slice(0, 6);
    if (countries.length === 0) return null;
    return {
      breakdown: countries.map((c) => ({
        label: c.key || "Unknown",
        value: formatNumber(c.users),
        share: c.users / totalUsers,
      })),
      breakdownTitle: "Users by country",
    };
  }, [stats]);

  const activeUsersValue = stats ? stats.totals.activeNow : summary.stats.activeUsers;
  const sessionsValue = stats ? stats.totals.sessionsInRange : summary.stats.totalSessions;
  const errorsValue = stats ? stats.totals.errorsInRange : summary.stats.errorsLast24Hours;
  const avgDurationSeconds = stats ? stats.totals.averageSessionDurationSeconds : summary.stats.averageSessionDurationSeconds;

  const directives: Array<{ key: string; val: string; tag?: "default" | "accent" }> = [
    { key: "Traffic Clock",    val: "UTC fixed", tag: "default" },
    { key: "Geography Source", val: summary.activeSessions.length > 0 ? "Active-first" : "Recent sessions", tag: "accent" },
    { key: "Storage Backend",  val: summary.storage.toUpperCase(), tag: "default" },
    { key: "Last Ingest",      val: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
    { key: "Generated",        val: timeAgo(summary.generatedAt) },
  ];

  return (
    <div className="page-content page-stack-lg">
      {/* Page header — title left, global filters right */}
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Overview
            <span className="kicker">Production Operations</span>
          </h1>
        </div>
        {filterBar ? <div className="page-header-right">{filterBar}</div> : null}
      </section>

      {/* Two-column grid: left (stats + chart), right (side panels) */}
      <div className="main-side main-side-stretch">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* KPI grid */}
          <div className="stat-grid stat-grid-6">
            <KpiStatCard
              label="Active Users"
              value={formatNumber(activeUsersValue)}
              sub={`${formatNumber(summary.activeSessions.length)} sessions open`}
              icon={<Users className="h-4 w-4" />}
              tone={activeUsersValue > 0 ? "accent" : "primary"}
              drilldown={activeUsersDrilldown}
              chartColor={chartColors.sessionsLine}
            />
            <KpiStatCard
              label="Sessions"
              value={formatNumber(sessionsValue)}
              sub={stats
                ? `In range · ${formatNumber(stats.totals.lifetimeSessions)} all-time`
                : `${formatNumber(summary.stats.sessionsStartedToday)} started today`}
              icon={<TrendingUp className="h-4 w-4" />}
              tone="primary"
              drilldown={sessionsDrilldown}
              chartColor={chartColors.sessionsLine}
            />
            <KpiStatCard
              label="Avg Session"
              value={formatDuration(avgDurationSeconds)}
              sub={stats ? "In range · legacy excluded" : `${formatNumber(lifetimeEvents)} all-time events`}
              icon={<Clock className="h-4 w-4" />}
              tone="primary"
              drilldown={avgSessionDrilldown}
              chartColor={chartColors.sessionsLine}
            />
            <KpiStatCard
              label="Errors"
              value={formatNumber(errorsValue)}
              sub={stats ? "In range" : "Last 24 hours"}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={errorsValue > 0 ? "rose" : "primary"}
              drilldown={errorsDrilldown}
              chartColor={chartColors.errorsLine}
            />
            <KpiStatCard
              label="Primary Region"
              value={topRegion}
              sub={regions[0] ? `${formatNumber(regions[0].value)} sessions` : "No geo data"}
              icon={<Globe2 className="h-4 w-4" />}
              tone="primary"
              drilldown={regionDrilldown}
              chartColor={chartColors.sessionsLine}
            />
            <KpiStatCard
              label="Latest Error"
              value={latestError ? timeAgo(latestError.timestamp) : "Clear"}
              sub={latestError ? String(latestError.metrics["exception_type"] ?? latestError.service) : "No recent failures"}
              icon={<Activity className="h-4 w-4" />}
              tone={latestError ? "rose" : "primary"}
            />
          </div>

          {/* Traffic chart */}
          <CollapsiblePanel
            kicker="Traffic"
            title="Last 24 Hours"
            sub={zoom.isZoomed
              ? `Viewing ${windowHours}h window — scroll to adjust`
              : "Scroll inside chart to zoom in"}
            right={
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
            }
          >
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
                      <linearGradient id="startedFillOverview" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={chartColors.activityBar} stopOpacity={1} />
                        <stop offset="100%" stopColor={chartColors.activityBar} stopOpacity={0.35} />
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
                      tickFormatter={(v: number) => formatNumber(Number(v))}
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
                    isAnimationActive={false}
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
                    isAnimationActive={false}
                      dataKey="started"
                      name="New sessions"
                      fill="url(#startedFillOverview)"
                      radius={[6, 6, 0, 0]}
                      barSize={zoom.isZoomed ? 18 : 10}
                      animationDuration={600}
                      animationEasing="ease-out"
                    />
                    <Area
                    isAnimationActive={false}
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
          </CollapsiblePanel>
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
                    {d.tag ? (
                      <span className={`kv-tag${d.tag === "accent" ? " kv-tag-accent" : ""}`}>{d.val}</span>
                    ) : (
                      <span className="kv-val">{d.val}</span>
                    )}
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
                <div className="empty-state" style={{ padding: "26px 16px 28px", textAlign: "center" }}>
                  <div className="empty-ring">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                  <p className="empty-title">All clear</p>
                  <p style={{ fontSize: "0.71875rem", color: "var(--text-3)", maxWidth: 240, margin: "4px auto 0", lineHeight: 1.5 }}>
                    No failures in the selected range. New errors surface here within seconds of ingest.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
