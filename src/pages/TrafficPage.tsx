import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { TimezoneUsageChart } from "../components/charts/TimezoneUsageChart";
import { useChartColors } from "../hooks/useChartColors";
import { useChartZoom } from "../hooks/useChartZoom";
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import {
  buildDailyUserTimeline,
  buildTimezoneActivity,
  buildTrafficTimeline,
} from "../utils/dashboardInsights";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { applyChartColorOverride, buildDashboardChartPalette, TIMEZONE_PANELS } from "./dashboardShared";

interface TrafficPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
  accentHue?: number;
}

const RANGE_OPTIONS = [
  { value: 7,  label: "7D" },
  { value: 14, label: "14D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
] as const;

export function TrafficPage({ summary, theme, accentHue = 217 }: TrafficPageProps) {
  const [insightView, setInsightView] = useState<"daily" | "timezones">("daily");
  const [rangeDays, setRangeDays] = useState<number>(30);

  const traffic     = useMemo(() => buildTrafficTimeline(summary, 24, "UTC"), [summary]);
  const dailyUsers  = useMemo(() => buildDailyUserTimeline(summary, rangeDays), [summary, rangeDays]);
  const tzCharts    = useMemo(() => TIMEZONE_PANELS.map((p) => ({ ...p, data: buildTimezoneActivity(summary, p.timeZone) })), [summary]);
  const basePalette = useMemo(() => buildDashboardChartPalette(theme, accentHue), [theme, accentHue]);
  const { override: colorOverride } = useChartColors();
  const chartPalette = useMemo(() => applyChartColorOverride(basePalette, colorOverride), [basePalette, colorOverride]);

  const zoom = useChartZoom(traffic.length);
  const visibleTraffic = useMemo(() => traffic.slice(zoom.visibleStart, zoom.visibleEnd), [traffic, zoom.visibleStart, zoom.visibleEnd]);

  const totals = useMemo(
    () => traffic.reduce((acc, p) => ({ activity: acc.activity + p.activity, started: acc.started + p.started, errors: acc.errors + p.errors, peakUsers: Math.max(acc.peakUsers, p.users) }), { activity: 0, started: 0, errors: 0, peakUsers: 0 }),
    [traffic],
  );

  const windowHours = zoom.visibleEnd - zoom.visibleStart;

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <p className="kicker">Analytics</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Traffic</h1>
          <p className="page-subtitle">
            Hourly event curves, daily user trends, and timezone-level activity breakdowns.
          </p>
        </div>
        <div className="page-header-right">
          <div className="meta-row">
            {[
              { label: "Peak Users/h", val: formatNumber(totals.peakUsers) },
              { label: "Sessions 24h", val: formatNumber(totals.started) },
              { label: "Errors 24h",  val: formatNumber(totals.errors) },
            ].map((m) => (
              <div className="meta-item" key={m.label}>
                <span>{m.label}</span>
                <strong>{m.val}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 24h traffic curve */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Realtime</p>
            <h2 className="section-title">Last 24 Hours — Users &amp; Sessions</h2>
            <p className="section-sub">
              {zoom.isZoomed
                ? `Viewing ${windowHours}h window — scroll to zoom, `
                : "Scroll inside chart to zoom in — "}
              active users (area), new sessions (bars), errors.
            </p>
          </div>
          <div className="panel-head-right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="meta-row">
              {[
                { label: "Peak Users/h", val: formatNumber(totals.peakUsers) },
                { label: "Sessions",     val: formatNumber(totals.started) },
                { label: "Errors",       val: formatNumber(totals.errors) },
              ].map((m) => (
                <div className="meta-item" key={m.label}>
                  <span>{m.label}</span>
                  <strong>{m.val}</strong>
                </div>
              ))}
            </div>
            {zoom.isZoomed ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={zoom.resetZoom} title="Reset zoom">
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          <div className="chart-wrap chart-wrap-tall" ref={zoom.containerRef} style={{ cursor: "ns-resize" }}>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={visibleTraffic} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="usersFillTraffic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={chartPalette.sessionsLine} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                <XAxis dataKey="shortLabel" tickLine={false} axisLine={false} minTickGap={20} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={{ fill: chartPalette.axisSoft, fontSize: 10.5 }} />
                <Tooltip cursor={false} content={({ active, payload, label }) => (
                  <TelemetryChartTooltip active={active} label={label} payload={payload?.map((e) => ({ name: String(e.name ?? ""), value: typeof e.value === "number" ? e.value : Number(e.value ?? 0), color: e.color })) ?? []} />
                )} />
                <Area type="monotone" dataKey="users" name="Active users" stroke={chartPalette.sessionsLine} strokeWidth={2.2} fill="url(#usersFillTraffic)" dot={false} activeDot={{ r:4, strokeWidth:0, fill: chartPalette.sessionsLine }} />
                <Bar dataKey="started" name="New sessions" fill={chartPalette.activityBar} radius={[5,5,0,0]} barSize={zoom.isZoomed ? 18 : 10} />
                <Area type="monotone" dataKey="errors" name="Errors" stroke={chartPalette.errorsLine} strokeWidth={1.8} fill="none" dot={false} activeDot={{ r:4, strokeWidth:0, fill: chartPalette.errorsLine }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Daily / Timezone toggle */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Trends</p>
            <h2 className="section-title">Insight View</h2>
            <p className="section-sub">Daily unique user trend or timezone-local activity.</p>
          </div>
          <div className="panel-head-right" style={{ gap: 12 }}>
            {insightView === "daily" ? (
              <div className="seg-control">
                {RANGE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`seg-btn${rangeDays === o.value ? " active" : ""}`}
                    onClick={() => setRangeDays(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="seg-control">
              <button type="button" className={`seg-btn${insightView === "daily" ? " active" : ""}`} onClick={() => setInsightView("daily")}>Daily Users</button>
              <button type="button" className={`seg-btn${insightView === "timezones" ? " active" : ""}`} onClick={() => setInsightView("timezones")}>Timezones</button>
            </div>
          </div>
        </div>

        {insightView === "daily" ? (
          <div className="panel-body">
            <p className="section-sub" style={{ marginBottom: 16 }}>
              Daily unique users over the last {rangeDays} days.
            </p>
            <div className="chart-wrap chart-wrap-tall">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyUsers} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={chartPalette.sessionsLine} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={chartPalette.sessionsLine} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: chartPalette.axis, fontSize: 10.5 }} />
                  <YAxis tickLine={false} axisLine={false} width={32} tick={{ fill: chartPalette.axisSoft, fontSize: 10.5 }} allowDecimals={false} />
                  <Tooltip cursor={false} content={({ active, payload, label }) => (
                    <TelemetryChartTooltip active={active} label={label} payload={payload?.map((e) => ({ name: String(e.name ?? ""), value: typeof e.value === "number" ? e.value : Number(e.value ?? 0), color: e.color })) ?? []} />
                  )} />
                  <Area type="monotone" dataKey="users" name="Unique users" stroke={chartPalette.sessionsLine} strokeWidth={2.2} fill="url(#dailyFill)" dot={false} activeDot={{ r:4, strokeWidth:0, fill: chartPalette.sessionsLine }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="panel-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 20 }}>
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

      {/* Summary stats */}
      <div className="stat-grid">
        {[
          { label: "Total Events",    value: formatNumber(summary.stats.totalEvents),   sub: "All time in storage" },
          { label: "Total Sessions",  value: formatNumber(summary.stats.totalSessions), sub: "Loaded in this view" },
          { label: "Active Right Now", value: formatNumber(summary.stats.activeUsers),   sub: "Within session window" },
          { label: "Avg Duration",    value: formatDuration(summary.stats.averageSessionDurationSeconds), sub: "Per session" },
          { label: "Started Today",   value: formatNumber(summary.stats.sessionsStartedToday), sub: "Since midnight UTC" },
          { label: "Last Ingest",     value: timeAgo(summary.stats.lastIngestAt ?? null), sub: "Most recent event" },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <span className="stat-label">{s.label}</span>
            <strong className="stat-value" style={{ fontSize: "1.5rem" }}>{s.value}</strong>
            <p className="stat-sub">{s.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
