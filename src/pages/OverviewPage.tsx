import { AlertTriangle, Globe2, Radio, ShieldAlert } from "lucide-react";
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
import type { SummaryPayload, ThemeMode } from "../types/telemetry";
import { buildCountryBreakdown, buildTrafficTimeline, buildVersionBreakdown } from "../utils/dashboardInsights";
import { formatDate, formatEventName, formatNumber, timeAgo } from "../utils/format";

interface OverviewPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      <div className="chart-tooltip-grid">
        {payload.map((entry) => (
          <div key={entry.name} className="chart-tooltip-row">
            <span className="chart-tooltip-key">
              <span
                className="chart-tooltip-dot"
                style={{ backgroundColor: entry.color ?? "rgba(255,255,255,0.72)" }}
              />
              {String(entry.name)}
            </span>
            <strong>{formatNumber(Number(entry.value ?? 0))}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewPage({ summary, theme }: OverviewPageProps) {
  const traffic = useMemo(() => buildTrafficTimeline(summary), [summary]);
  const countries = useMemo(() => buildCountryBreakdown(summary), [summary]);
  const versions = useMemo(() => buildVersionBreakdown(summary), [summary]);
  const latestError = summary.recentErrors[0];

  const chartPalette = useMemo(
    () =>
      theme === "dark"
        ? {
            grid: "rgba(255,255,255,0.08)",
            axis: "rgba(255,255,255,0.58)",
            axisSoft: "rgba(255,255,255,0.46)",
            activityBar: "rgba(251,191,36,0.54)",
            sessionsLine: "rgba(94,234,212,0.92)",
            errorsLine: "rgba(248,113,113,0.92)",
            tooltipCursor: false as const,
          }
        : {
            grid: "rgba(19,37,57,0.12)",
            axis: "rgba(19,37,57,0.72)",
            axisSoft: "rgba(19,37,57,0.54)",
            activityBar: "rgba(217,119,6,0.4)",
            sessionsLine: "rgba(15,118,110,0.88)",
            errorsLine: "rgba(220,38,38,0.86)",
            tooltipCursor: false as const,
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
  const mostUsedVersion = versions[0]?.label ?? "Unknown";

  return (
    <div className="page-content page-content-wide overview-page">
      <section className="page-header">
        <div>
          <p className="page-kicker">Operator View</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">
            Summary only. Live rows, session history, and full error lists stay on their own pages so this page stays clean.
          </p>
        </div>

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
      </section>

      <div className="overview-stat-grid">
        <StatCard
          label="Active Users"
          value={formatNumber(summary.stats.activeUsers)}
          sub="Full active table lives on the Live page"
          icon={<Radio className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="Sessions With Errors"
          value={formatNumber(sessionsWithErrors)}
          sub={`${formatNumber(liveWithErrors)} are currently active`}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone="rose"
        />
        <StatCard
          label="Top Version"
          value={mostUsedVersion}
          sub={`${versions[0]?.value ?? 0} sessions in loaded range`}
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
              <h2 className="panel-title">Recent activity</h2>
              <p className="panel-subtitle">All telemetry events, new sessions, and errors over the last 24 hours.</p>
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
                <Tooltip cursor={chartPalette.tooltipCursor} content={<ChartTooltip />} />
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
              <h2 className="panel-title">Current operating state</h2>
              <p className="panel-subtitle">High-signal checks only, without re-listing rows from the dedicated pages.</p>
            </div>
          </div>

          <div className="info-list">
            <div className="info-row">
              <span className="info-label">Last ingest</span>
              <span className="info-value">{summary.stats.lastIngestAt ? formatDate(summary.stats.lastIngestAt) : "Waiting"}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Started today</span>
              <span className="info-value">{formatNumber(summary.stats.sessionsStartedToday)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Active sessions with errors</span>
              <span className="info-value">{formatNumber(liveWithErrors)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Storage backend</span>
              <span className="info-value">{summary.storage.toUpperCase()}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Latest error source</span>
              <span className="info-value">{latestError ? latestError.source : "No recent failures"}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="content-grid">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Versions</p>
              <h2 className="panel-title">Version spread</h2>
              <p className="panel-subtitle">Which client versions dominate the currently loaded sessions.</p>
            </div>
          </div>

          <div className="chart-shell chart-shell-professional chart-shell-compact">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={versions} layout="vertical" margin={{ top: 8, right: 6, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={92}
                  tick={{ fill: chartPalette.axis, fontSize: 11 }}
                />
                <Tooltip cursor={chartPalette.tooltipCursor} content={<ChartTooltip />} />
                <Bar dataKey="value" name="Sessions" fill={chartPalette.sessionsLine} radius={[0, 6, 6, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Regions</p>
              <h2 className="panel-title">Geography</h2>
              <p className="panel-subtitle">Country distribution across active or recent sessions.</p>
            </div>
            <Globe2 className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          </div>

          <div className="chart-shell chart-shell-professional chart-shell-compact">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={countries} layout="vertical" margin={{ top: 8, right: 6, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={chartPalette.grid} horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tick={{ fill: chartPalette.axis, fontSize: 11 }}
                />
                <Tooltip cursor={chartPalette.tooltipCursor} content={<ChartTooltip />} />
                <Bar dataKey="value" name="Sessions" fill={chartPalette.activityBar} radius={[0, 6, 6, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}
