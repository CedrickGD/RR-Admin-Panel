import { Select } from "../components/ds/Select";
import {
  Activity,
  AlertTriangle,
  Clock,
  Download,
  Globe2,
  Minus,
  Plus,
  RotateCcw,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { versionLabel } from "../utils/versionLabel";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartLegend } from "../components/charts/ChartLegend";
import { CHART_MARGIN } from "../components/charts/chartMargin";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { RelativeTime } from "../components/ds/RelativeTime";
import { KpiStatCard, type KpiDrilldown } from "../components/KpiStatCard";
import { useChartZoom } from "../hooks/useChartZoom";
import { usePanelPermission } from "../hooks/usePanelPermission";
import type { DayPoint, StatsPayload, SummaryPayload, ThemeMode } from "../types/telemetry";
import { buildRegionBreakdown, buildTrafficTimeline } from "../utils/dashboardInsights";
import { formatDuration, formatNumber } from "../utils/format";
import { isOverviewErrorInWindow } from "../utils/overviewErrors";
import { topVersionsByUsers } from "../utils/versionBreakdown";

interface OverviewPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  theme: ThemeMode;
  accentHue?: number;
}

const TIME_WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "3h", hours: 3 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Series identity for the header legend — same colors the plot is drawn with. */
const ACTIVITY_LEGEND = [
  { label: "Active customers", color: "var(--chart-users)" },
  { label: "New sessions", color: "var(--chart-sessions)" },
  { label: "Errors", color: "var(--chart-errors)" },
];

/**
 * Bars keep their rounded caps only once they are tall enough to show them.
 * A 6px radius on a 1-unit bar renders as a dot, which made the session series
 * read as decoration rather than data.
 */
function sessionBarShape(props: unknown) {
  const bar = props as ComponentProps<typeof Rectangle>;
  const height = typeof bar.height === "number" ? bar.height : 0;
  return <Rectangle {...bar} radius={height >= 10 ? [3, 3, 0, 0] : 0} />;
}

/** Floor of 2px so a 1-session hour stays visible — but a zero hour paints nothing. */
function sessionBarMinSize(value: number | undefined | null): number {
  return value ? 2 : 0;
}

function utcDayString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Sum sessions over the last `days` UTC days of a per-day series (inclusive of today). */
function sumSessionsSince(series: DayPoint[], days: number): number {
  const cutoff = utcDayString(Date.now() - (days - 1) * DAY_MS);
  return series.reduce((acc, p) => (p.day >= cutoff ? acc + p.sessions : acc), 0);
}

export function OverviewPage({ summary, stats }: OverviewPageProps) {
  const canMonitor = usePanelPermission("monitoring.read");
  const canReadSupport = usePanelPermission("support.read");
  const traffic = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const regions = useMemo(() => buildRegionBreakdown(summary), [summary]);

  const [dismissedErrors, setDismissedErrors] = useState<Set<string>>(new Set());

  const zoom = useChartZoom(traffic.length, "Activity chart");
  const activeWindow = zoom.visibleEnd - zoom.visibleStart;
  const visibleTraffic = useMemo(
    () => traffic.slice(zoom.visibleStart, zoom.visibleEnd),
    [traffic, zoom.visibleStart, zoom.visibleEnd],
  );

  const totals = useMemo(
    () =>
      visibleTraffic.reduce(
        (acc, p) => ({
          activity: acc.activity + p.activity,
          started: acc.started + p.started,
          errors: acc.errors + p.errors,
          peakUsers: Math.max(acc.peakUsers, p.users),
        }),
        { activity: 0, started: 0, errors: 0, peakUsers: 0 },
      ),
    [visibleTraffic],
  );

  const topRegion = regions[0]?.label ?? "Unknown";
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentErrors24h = summary.recentErrors.filter((e) =>
    isOverviewErrorInWindow(e, twentyFourHoursAgo),
  );
  const latestError = recentErrors24h[0];
  const recentSignals = recentErrors24h.slice(0, 6).filter((e) => !dismissedErrors.has(e.id));

  // True lifetime event counter; summary.stats.totalEvents is only the retained window.
  const lifetimeEvents = summary.stats.lifetimeEvents ?? summary.stats.totalEvents;

  const handleTimeWindow = useCallback(
    (hours: number) => {
      if (hours >= 24) {
        zoom.resetZoom();
      } else {
        zoom.setWindow(hours);
      }
    },
    [zoom],
  );

  const dismissError = useCallback((id: string) => {
    setDismissedErrors((prev) => new Set(prev).add(id));
  }, []);

  /* ----- KPI drill-downs (only when server-side stats have loaded) ----- */

  const activeUsersDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    const topVersions = topVersionsByUsers(stats.breakdowns.versionsCurrent, 5);
    return {
      breakdown: topVersions.map((v) => ({
        label: versionLabel(v.version),
        value: formatNumber(v.users),
        share: v.share,
      })),
      breakdownTitle: "Customers by current version",
      note: `${formatNumber(stats.totals.rpcLiveNow)} live with Discord RPC · RPC status reported by ${formatNumber(stats.totals.rpcKnownUsers)} of ${formatNumber(stats.totals.lifetimeUsers)} customers`,
    };
  }, [stats]);

  const sessionsDrilldown = useMemo<KpiDrilldown | null>(() => {
    if (!stats) return null;
    const rangeDays = stats.filters.rangeDays;
    const limited = (days: number) =>
      rangeDays !== null && rangeDays < days ? `limited to ${rangeDays}d range` : undefined;
    const platforms = [...stats.breakdowns.platforms].sort((a, b) => b.sessions - a.sessions);
    const platformTotal = Math.max(
      1,
      platforms.reduce((acc, p) => acc + p.sessions, 0),
    );
    return {
      timespans: [
        { label: "Today", value: formatNumber(sumSessionsSince(stats.series.sessionsPerDay, 1)) },
        {
          label: "7 d",
          value: formatNumber(sumSessionsSince(stats.series.sessionsPerDay, 7)),
          hint: limited(7),
        },
        {
          label: "30 d",
          value: formatNumber(sumSessionsSince(stats.series.sessionsPerDay, 30)),
          hint: limited(30),
        },
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
        {
          label: "Avg duration",
          value: formatDuration(stats.totals.averageSessionDurationSeconds),
          hint: "selected range",
        },
        { label: "Sessions in range", value: formatNumber(stats.totals.sessionsInRange) },
        {
          label: "Lifetime events",
          value: formatNumber(lifetimeEvents),
          hint: `${formatNumber(summary.stats.totalEvents)} retained in window`,
        },
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
      breakdownTitle: "Customers by country",
    };
  }, [stats]);

  const activeUsersValue = stats ? stats.totals.activeNow : summary.stats.activeUsers;
  const sessionsValue = stats ? stats.totals.sessionsInRange : summary.stats.totalSessions;
  const errorsValue = stats ? stats.totals.errorsInRange : summary.stats.errorsLast24Hours;
  const avgDurationSeconds = stats
    ? stats.totals.averageSessionDurationSeconds
    : summary.stats.averageSessionDurationSeconds;

  return (
    <div className="page-content page-stack-lg">
      {/* Page header — title from PAGE_META left, global filters right */}
      <PageHeader page="overview" />

      {/* Two-column grid: left (stats + chart), right (side panels) */}

      {/* KPI grid */}
      <div className="stat-grid stat-grid-4 overview-kpis">
        <KpiStatCard
          label="Active customers"
          value={formatNumber(activeUsersValue)}
          sub={
            canMonitor
              ? `${formatNumber(summary.activeSessions.length)} sessions open`
              : "Currently active"
          }
          icon={<Users size={14} />}
          tone={activeUsersValue > 0 ? "accent" : "primary"}
          drilldown={activeUsersDrilldown}
        />
        <KpiStatCard
          label="Sessions"
          value={formatNumber(sessionsValue)}
          sub={
            stats
              ? `Last 24 hours · ${formatNumber(stats.totals.lifetimeSessions)} all-time`
              : `${formatNumber(summary.stats.sessionsStartedToday)} started today`
          }
          icon={<TrendingUp size={14} />}
          tone="primary"
          drilldown={sessionsDrilldown}
          chartColor="var(--chart-users)"
          spark={stats?.series.sessionsPerDay.map((p) => p.sessions)}
        />
        <KpiStatCard
          label="Avg session"
          value={formatDuration(avgDurationSeconds)}
          sub={
            stats
              ? "Last 24 hours · legacy excluded"
              : `${formatNumber(lifetimeEvents)} all-time events`
          }
          icon={<Clock size={14} />}
          tone="primary"
          drilldown={avgSessionDrilldown}
        />
        <KpiStatCard
          label="Errors"
          value={formatNumber(errorsValue)}
          sub="Last 24 hours"
          icon={<AlertTriangle size={14} />}
          tone={errorsValue > 0 ? "danger" : "primary"}
          drilldown={errorsDrilldown}
          chartColor="var(--chart-errors)"
          spark={stats?.series.errorsPerDay.map((p) => p.errors)}
        />
      </div>

      <div className="main-side main-side-stretch overview-body">
        <div>
          {/* Traffic chart */}
          {canMonitor ? (
            <CollapsiblePanel
              kicker="Traffic"
              title={`Activity · ${activeWindow} ${activeWindow === 1 ? "hour" : "hours"}`}
              sub={zoom.hint}
              /* The plot describes itself with this line instead of reciting it
                 as its accessible name (useChartZoom). */
              subId={zoom.hintId}
              padding="body"
              right={
                /* Range and zoom controls live in the header, not over the plot. */
                <div className="chart-head-tools">
                  <ChartLegend items={ACTIVITY_LEGEND} />
                  <MetaRow
                    items={[
                      { label: "Peak customers/h", value: formatNumber(totals.peakUsers) },
                      { label: "Sessions", value: formatNumber(totals.started) },
                      { label: "Errors", value: formatNumber(totals.errors) },
                    ]}
                  />
                  <div className="chart-zoom-controls">
                    <Select
                      aria-label="Time window"
                      value={activeWindow}
                      onValueChange={(value) => handleTimeWindow(Number(value))}
                    >
                      {!TIME_WINDOWS.some((tw) => tw.hours === activeWindow) && (
                        /* One text child: Select reads the label with String(children). */
                        <option value={activeWindow}>{`${activeWindow} hours`}</option>
                      )}
                      {TIME_WINDOWS.map((tw) => (
                        <option key={tw.hours} value={tw.hours}>
                          {tw.label}
                        </option>
                      ))}
                    </Select>
                    <IconButton
                      icon={<Minus />}
                      aria-label="Zoom out"
                      title="Zoom out"
                      onClick={zoom.zoomOut}
                      disabled={!zoom.canZoomOut}
                    />
                    <IconButton
                      icon={<Plus />}
                      aria-label="Zoom in"
                      title="Zoom in"
                      onClick={zoom.zoomIn}
                      disabled={!zoom.canZoomIn}
                    />
                    {/* Always rendered so the row does not reflow when zooming. */}
                    <Button
                      size="sm"
                      icon={<RotateCcw />}
                      onClick={zoom.resetZoom}
                      disabled={!zoom.isZoomed}
                      title="Reset zoom"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              }
            >
              <div
                className="chart-wrap chart-wrap-tall chart-zoom"
                ref={zoom.containerRef}
                {...zoom.containerProps}
              >
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={visibleTraffic} margin={CHART_MARGIN}>
                    <defs>
                      {/* Series colors come from the user-preset chart tokens — never the accent. */}
                      <linearGradient id="usersFillOverview" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-users)" stopOpacity={0.22} />
                        <stop offset="50%" stopColor="var(--chart-users)" stopOpacity={0.08} />
                        <stop offset="100%" stopColor="var(--chart-users)" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="errorsFillOverview" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-errors)" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="var(--chart-errors)" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="startedFillOverview" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-sessions)" stopOpacity={1} />
                        <stop offset="100%" stopColor="var(--chart-sessions)" stopOpacity={0.35} />
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
                      minTickGap={20}
                      tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      allowDecimals={false}
                      tick={{ fill: "var(--chart-axis-soft)", fontSize: 11 }}
                      tickFormatter={(v: number) => formatNumber(Number(v))}
                    />
                    <Tooltip
                      isAnimationActive={false}
                      cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
                      content={({ active, payload, label }) => (
                        <TelemetryChartTooltip
                          active={active}
                          label={label}
                          payload={
                            payload?.map((e) => ({
                              name: String(e.name ?? ""),
                              value: typeof e.value === "number" ? e.value : Number(e.value ?? 0),
                              color: e.color,
                            })) ?? []
                          }
                        />
                      )}
                    />
                    <Area
                      isAnimationActive={false}
                      type="natural"
                      dataKey="users"
                      name="Active customers"
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
                      shape={sessionBarShape}
                      minPointSize={sessionBarMinSize}
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
          ) : (
            <section className="panel">
              <div className="panel-body">
                <h2 className="section-title">Session activity</h2>
                <p className="section-sub">Detailed charts require monitoring access.</p>
              </div>
            </section>
          )}
        </div>

        {/* Side panels — stretch to match left column height */}
        <div className="side-stack">
          {/* System context */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">At a glance</h2>
            </div>
            <div className="overview-glance">
              <div>
                <span>Free downloads</span>
                <strong>{stats ? formatNumber(stats.totals.freeDownloads) : "—"}</strong>
              </div>
              <div>
                <span>Leading region</span>
                <strong>{canMonitor ? topRegion : "Restricted"}</strong>
              </div>
              <div>
                <span>Last update</span>
                <strong>
                  <RelativeTime iso={summary.generatedAt} />
                </strong>
              </div>
            </div>
          </section>

          {/* Recent failures */}
          {canReadSupport && (
            <CollapsiblePanel
              kicker="Failures"
              title="Recent errors"
              collapsible={false}
              padding="tight"
              style={{ flex: 1 }}
              right={
                recentSignals.length > 0 ? (
                  <Badge tone="danger">{recentSignals.length}</Badge>
                ) : (
                  <Badge tone="success">Clear</Badge>
                )
              }
            >
              {recentSignals.length > 0 ? (
                /* DS feed rows, hand-composed: each row keeps the app's per-error
                 dismiss action, which the DS Feed component has no slot for. */
                <div className="feed" style={{ padding: "8px 0 4px" }}>
                  {recentSignals.map((error) => (
                    <div className="feed-row" key={error.id}>
                      <span className="feed-dot bad" />
                      <div className="feed-body">
                        <p className="feed-title">
                          {String(error.metrics["exception_type"] ?? error.service)}
                        </p>
                        <p className="feed-meta">
                          {error.source} · {error.message ?? "No message"}
                        </p>
                      </div>
                      <span className="feed-time">
                        <RelativeTime iso={error.timestamp} />
                      </span>
                      <button
                        type="button"
                        className="feed-dismiss"
                        title="Dismiss"
                        onClick={() => dismissError(error.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState allClear title="All clear">
                  No failures in the selected range. New errors surface here within seconds of
                  ingest.
                </EmptyState>
              )}
            </CollapsiblePanel>
          )}
        </div>
      </div>
    </div>
  );
}
