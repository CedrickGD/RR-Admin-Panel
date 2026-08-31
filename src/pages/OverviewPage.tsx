import { Activity, AlertTriangle, Clock, Download, Globe2, RotateCcw, TrendingUp, Users, X } from "lucide-react";
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
import { Badge } from "../components/ds/Badge";
import { EmptyState } from "../components/ds/EmptyState";
import { KvList, type KvListItem } from "../components/ds/KvList";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { KpiStatCard, type KpiDrilldown } from "../components/KpiStatCard";
import { useChartZoom } from "../hooks/useChartZoom";
import type { DayPoint, StatsPayload, SummaryPayload, ThemeMode } from "../types/telemetry";
import { buildRegionBreakdown, buildTrafficTimeline } from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";

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

export function OverviewPage({ summary, stats, filterBar }: OverviewPageProps) {
  const traffic = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const regions = useMemo(() => buildRegionBreakdown(summary), [summary]);

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

  const directives: KvListItem[] = [
    { k: "Traffic Clock",    v: "UTC fixed", tag: "default" },
    { k: "Geography Source", v: summary.activeSessions.length > 0 ? "Active-first" : "Recent sessions", tag: "accent" },
    { k: "Storage Backend",  v: summary.storage.toUpperCase(), tag: "default" },
    { k: "Last Ingest",      v: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
    { k: "Generated",        v: timeAgo(summary.generatedAt) },
  ];

  return (
    <div className="page-content page-stack-lg">
      {/* Page header — kicker + title left, global filters right */}
      <PageHeader kicker="Production Operations" title="Overview" right={filterBar} />

      {/* Two-column grid: left (stats + chart), right (side panels) */}
      <div className="main-side main-side-stretch">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* KPI grid */}
          <div className="stat-grid stat-grid-7">
            <KpiStatCard
              label="Active Users"
              value={formatNumber(activeUsersValue)}
              sub={`${formatNumber(summary.activeSessions.length)} sessions open`}
              icon={<Users size={14} />}
              tone={activeUsersValue > 0 ? "accent" : "primary"}
              drilldown={activeUsersDrilldown}
            />
            <KpiStatCard
              label="Sessions"
              value={formatNumber(sessionsValue)}
              sub={stats
                ? `In range · ${formatNumber(stats.totals.lifetimeSessions)} all-time`
                : `${formatNumber(summary.stats.sessionsStartedToday)} started today`}
              icon={<TrendingUp size={14} />}
              tone="primary"
              drilldown={sessionsDrilldown}
              chartColor="var(--chart-users)"
              spark={stats?.series.sessionsPerDay.map((p) => p.sessions)}
            />
            <KpiStatCard
              label="Free Downloads"
              value={stats ? formatNumber(stats.totals.freeDownloads) : "—"}
              sub="Successful public installer redirects"
              icon={<Download size={14} />}
              tone="success"
            />
            <KpiStatCard
              label="Avg Session"
              value={formatDuration(avgDurationSeconds)}
              sub={stats ? "In range · legacy excluded" : `${formatNumber(lifetimeEvents)} all-time events`}
              icon={<Clock size={14} />}
              tone="primary"
              drilldown={avgSessionDrilldown}
            />
            <KpiStatCard
              label="Errors"
              value={formatNumber(errorsValue)}
              sub={stats ? "In range" : "Last 24 hours"}
              icon={<AlertTriangle size={14} />}
              tone={errorsValue > 0 ? "danger" : "primary"}
              drilldown={errorsDrilldown}
              chartColor="var(--chart-errors)"
              spark={stats?.series.errorsPerDay.map((p) => p.errors)}
            />
            <KpiStatCard
              label="Primary Region"
              value={topRegion}
              sub={regions[0] ? `${formatNumber(regions[0].value)} sessions` : "No geo data"}
              icon={<Globe2 size={14} />}
              tone="primary"
              drilldown={regionDrilldown}
            />
            <KpiStatCard
              label="Latest Error"
              value={latestError ? timeAgo(latestError.timestamp) : "Clear"}
              sub={latestError ? String(latestError.metrics["exception_type"] ?? latestError.service) : "No recent failures"}
              icon={<Activity size={14} />}
              tone={latestError ? "danger" : "primary"}
            />
          </div>

          {/* Traffic chart */}
          <CollapsiblePanel
            kicker="Traffic"
            title="Last 24 Hours"
            sub={zoom.isZoomed
              ? `Viewing ${windowHours}h window — scroll to adjust`
              : "Scroll inside chart to zoom in"}
            padding="body"
            right={
              <MetaRow
                items={[
                  { label: "Peak Users/h", value: formatNumber(totals.peakUsers) },
                  { label: "Sessions", value: formatNumber(totals.started) },
                  { label: "Errors", value: formatNumber(totals.errors) },
                ]}
              />
            }
          >
            {/* Time window buttons */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingBottom: 6 }}>
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
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>

            <div className="chart-wrap chart-wrap-tall" ref={zoom.containerRef} style={{ cursor: "ns-resize" }}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={visibleTraffic} margin={{ top: 16, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    {/* Series colors come from the user-preset chart tokens — never the accent. */}
                    <linearGradient id="usersFillOverview" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="var(--chart-users)" stopOpacity={0.22} />
                      <stop offset="50%"  stopColor="var(--chart-users)" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="var(--chart-users)" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="errorsFillOverview" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="var(--chart-errors)" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="var(--chart-errors)" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="startedFillOverview" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="var(--chart-sessions)" stopOpacity={1} />
                      <stop offset="100%" stopColor="var(--chart-sessions)" stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="shortLabel"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={20}
                    tick={{ fill: "var(--chart-axis)", fontSize: 10.5 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    allowDecimals={false}
                    tick={{ fill: "var(--chart-axis-soft)", fontSize: 10.5 }}
                    tickFormatter={(v: number) => formatNumber(Number(v))}
                  />
                  <Tooltip
                    isAnimationActive={false}
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
                    stroke="var(--chart-users)"
                    strokeWidth={2.4}
                    fill="url(#usersFillOverview)"
                    dot={false}
                    activeDot={{
                      r: 5,
                      strokeWidth: 2,
                      stroke: "rgba(0,0,0,0.3)",
                      fill: "var(--chart-users)",
                      style: { filter: "drop-shadow(0 0 4px var(--chart-users))" },
                    }}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="started"
                    name="New sessions"
                    fill="url(#startedFillOverview)"
                    radius={[6, 6, 0, 0]}
                    barSize={zoom.isZoomed ? 18 : 10}
                  />
                  <Area
                    isAnimationActive={false}
                    type="natural"
                    dataKey="errors"
                    name="Errors"
                    stroke="var(--chart-errors)"
                    strokeWidth={1.8}
                    fill="url(#errorsFillOverview)"
                    dot={false}
                    activeDot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: "rgba(0,0,0,0.3)",
                      fill: "var(--chart-errors)",
                      style: { filter: "drop-shadow(0 0 4px var(--chart-errors))" },
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CollapsiblePanel>
        </div>

        {/* Side panels — stretch to match left column height */}
        <div className="side-stack">
          {/* System context */}
          <CollapsiblePanel kicker="System" title="Context" collapsible={false} padding="tight">
            <KvList items={directives} />
          </CollapsiblePanel>

          {/* Recent failures */}
          <CollapsiblePanel
            kicker="Failures"
            title="Recent Errors"
            collapsible={false}
            padding="tight"
            style={{ flex: 1 }}
            right={recentSignals.length > 0
              ? <Badge tone="danger">{recentSignals.length}</Badge>
              : <Badge tone="success">Clear</Badge>}
          >
            {recentSignals.length > 0 ? (
              /* DS feed rows, hand-composed: each row keeps the app's per-error
                 dismiss action, which the DS Feed component has no slot for. */
              <div className="feed" style={{ padding: "8px 0 4px" }}>
                {recentSignals.map((error) => (
                  <div className="feed-row" key={error.id}>
                    <span className="feed-dot bad" />
                    <div className="feed-body">
                      <p className="feed-title">{String(error.metrics["exception_type"] ?? error.service)}</p>
                      <p className="feed-meta">{error.source} · {error.message ?? "No message"}</p>
                    </div>
                    <span className="feed-time">{timeAgo(error.timestamp)}</span>
                    <button type="button" className="feed-dismiss" title="Dismiss" onClick={() => dismissError(error.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState allClear title="All clear">
                No failures in the selected range. New errors surface here within seconds of ingest.
              </EmptyState>
            )}
          </CollapsiblePanel>
        </div>
      </div>
    </div>
  );
}
