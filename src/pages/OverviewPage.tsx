import { AlertTriangle, Clock3, DoorOpen, Globe2, Radio } from "lucide-react";
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
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent, ThemeMode } from "../types/telemetry";
import {
  buildCountryBreakdown,
  buildDurationBreakdown,
  buildTrafficTimeline,
} from "../utils/dashboardInsights";
import { formatDate, formatDuration, formatNumber, timeAgo } from "../utils/format";

interface OverviewPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function sessionDuration(session: AppSessionRecord): string {
  if (!session.isActive) {
    return formatDuration(session.durationSeconds);
  }

  const startedAt = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAt)) {
    return "open";
  }

  return formatDuration(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
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

function ErrorItem({ event }: { event: TelemetryEvent }) {
  return (
    <div className="signal-row">
      <div className="signal-copy">
        <p className="signal-title">{event.message ?? "Unhandled application error"}</p>
        <p className="signal-meta">
          {event.source} · {String(event.metrics["exception_type"] ?? event.service)}
        </p>
      </div>
      <div className="signal-side">
        <StatusBadge status={event.status} showDot={false} />
        <span className="signal-time">{timeAgo(event.timestamp)}</span>
      </div>
    </div>
  );
}

export function OverviewPage({ summary, theme }: OverviewPageProps) {
  const traffic = useMemo(() => buildTrafficTimeline(summary), [summary]);
  const countries = useMemo(() => buildCountryBreakdown(summary), [summary]);
  const durations = useMemo(() => buildDurationBreakdown(summary.recentSessions), [summary.recentSessions]);
  const liveRows = summary.activeSessions.slice(0, 5);
  const recentRows = summary.recentSessions.slice(0, 8);
  const errorRows = summary.recentErrors.slice(0, 5);

  const chartPalette = useMemo(
    () =>
      theme === "dark"
        ? {
            grid: "rgba(255,255,255,0.08)",
            axis: "rgba(255,255,255,0.58)",
            axisSoft: "rgba(255,255,255,0.46)",
            primaryLine: "#ffffff",
            primaryFillStart: "rgba(255,255,255,0.34)",
            primaryFillEnd: "rgba(255,255,255,0)",
            secondaryLine: "rgba(167,139,250,0.88)",
            errorBar: "rgba(168,85,247,0.28)",
            countryBar: "rgba(255,255,255,0.84)",
            durationBar: "rgba(168,85,247,0.58)",
            tooltipCursor: false as const,
          }
        : {
            grid: "rgba(15,23,42,0.1)",
            axis: "rgba(15,23,42,0.66)",
            axisSoft: "rgba(15,23,42,0.5)",
            primaryLine: "rgba(91,33,182,0.92)",
            primaryFillStart: "rgba(91,33,182,0.14)",
            primaryFillEnd: "rgba(15,23,42,0)",
            secondaryLine: "rgba(15,23,42,0.72)",
            errorBar: "rgba(124,58,237,0.18)",
            countryBar: "rgba(31,41,55,0.9)",
            durationBar: "rgba(124,58,237,0.58)",
            tooltipCursor: false as const,
          },
    [theme],
  );

  const totals = useMemo(
    () =>
      traffic.reduce(
        (accumulator, point) => {
          accumulator.started += point.started;
          accumulator.ended += point.ended;
          accumulator.errors += point.errors;
          return accumulator;
        },
        { started: 0, ended: 0, errors: 0 },
      ),
    [traffic],
  );

  return (
    <div className="page-content page-content-wide overview-page">
      <section className="page-header overview-header">
        <div>
          <h1 className="page-title">Operations Overview</h1>
          <p className="page-subtitle">
            Sessions, errors, geography, and runtime behavior for the current telemetry window.
          </p>
        </div>

        <div className="page-meta-stack">
          <div className="page-meta">
            <span>Last ingest</span>
            <strong>{summary.stats.lastIngestAt ? formatDate(summary.stats.lastIngestAt) : "Waiting"}</strong>
          </div>
          <div className="page-meta">
            <span>Total sessions</span>
            <strong>{formatNumber(summary.stats.totalSessions)}</strong>
          </div>
        </div>
      </section>

      <div className="overview-stat-grid">
        <StatCard
          label="Active Users"
          value={formatNumber(summary.stats.activeUsers)}
          sub={`${summary.activeSessions.length} currently open`}
          icon={<Radio className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="Started Today"
          value={formatNumber(summary.stats.sessionsStartedToday)}
          sub={`${formatNumber(summary.stats.sessionsEndedToday)} closed today`}
          icon={<DoorOpen className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Average Session"
          value={formatDuration(summary.stats.averageSessionDurationSeconds)}
          sub="Across completed sessions"
          icon={<Clock3 className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="Errors 24h"
          value={formatNumber(summary.stats.errorsLast24Hours)}
          sub={`${summary.recentErrors.length} rows loaded`}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="rose"
        />
      </div>

      <div className="overview-primary-grid">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Traffic</h2>
              <p className="panel-subtitle">Open and close activity with error spikes over the last 24 hours.</p>
            </div>
            <div className="panel-inline-metrics">
              <div>
                <span>Opened</span>
                <strong>{formatNumber(totals.started)}</strong>
              </div>
              <div>
                <span>Closed</span>
                <strong>{formatNumber(totals.ended)}</strong>
              </div>
              <div>
                <span>Errors</span>
                <strong>{formatNumber(totals.errors)}</strong>
              </div>
            </div>
          </div>

          <div className="chart-shell chart-shell-professional chart-shell-tall">
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={traffic} margin={{ top: 16, right: 8, left: -10, bottom: 8 }}>
                <defs>
                  <linearGradient id={`traffic-open-${theme}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartPalette.primaryFillStart} />
                    <stop offset="100%" stopColor={chartPalette.primaryFillEnd} />
                  </linearGradient>
                </defs>
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
                <Bar
                  dataKey="errors"
                  name="Errors"
                  fill={chartPalette.errorBar}
                  radius={[4, 4, 0, 0]}
                  barSize={10}
                />
                <Area
                  type="monotone"
                  dataKey="started"
                  name="Opened"
                  stroke={chartPalette.primaryLine}
                  strokeWidth={2}
                  fill={`url(#traffic-open-${theme})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: chartPalette.primaryLine }}
                />
                <Area
                  type="monotone"
                  dataKey="ended"
                  name="Closed"
                  stroke={chartPalette.secondaryLine}
                  strokeWidth={1.6}
                  fill="rgba(255,255,255,0)"
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 0, fill: chartPalette.secondaryLine }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="overview-side-stack">
          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Active Sessions</h2>
                <p className="panel-subtitle">Latest users currently inside the app.</p>
              </div>
              <span className="panel-count">{liveRows.length}</span>
            </div>

            <div className="signal-list">
              {liveRows.map((session) => (
                <div key={session.id} className="signal-row">
                  <div className="signal-copy">
                    <p className="signal-title">{displayUser(session)}</p>
                    <p className="signal-meta">
                      {session.clientIp ?? "unknown"} · {session.clientCountry ?? "Unknown"} · {session.appVersion ?? "unknown"}
                    </p>
                  </div>
                  <div className="signal-side">
                    <StatusBadge status={session.lastStatus} />
                    <span className="signal-time">{sessionDuration(session)}</span>
                  </div>
                </div>
              ))}

              {liveRows.length === 0 ? <div className="empty-panel small">No active sessions.</div> : null}
            </div>
          </section>

          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Geography</h2>
                <p className="panel-subtitle">Country distribution across the current loaded sessions.</p>
              </div>
              <Globe2 className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            </div>

            <div className="chart-shell chart-shell-professional chart-shell-compact">
              <ResponsiveContainer width="100%" height={250}>
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
                  <Bar dataKey="value" name="Sessions" fill={chartPalette.countryBar} radius={[0, 6, 6, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      </div>

      <div className="overview-secondary-grid">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Session Tape</h2>
              <p className="panel-subtitle">Recent session opens, closes, addresses, and runtime.</p>
            </div>
            <span className="panel-count">{recentRows.length}</span>
          </div>

          <div className="table-shell table-shell-dense">
            <div className="table-scroller">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>IP</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th>Status</th>
                    <th className="text-right">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <div className="font-semibold">{displayUser(session)}</div>
                        <div className="table-subline">{session.installId}</div>
                      </td>
                      <td>
                        <div className="font-[JetBrains_Mono,monospace]">{session.clientIp ?? "unknown"}</div>
                        <div className="table-subline">{session.clientCountry ?? "Unknown"}</div>
                      </td>
                      <td>
                        <div>{formatDate(session.startedAt)}</div>
                        <div className="table-subline">{timeAgo(session.startedAt)}</div>
                      </td>
                      <td>
                        {session.endedAt ? (
                          <>
                            <div>{formatDate(session.endedAt)}</div>
                            <div className="table-subline">{timeAgo(session.endedAt)}</div>
                          </>
                        ) : (
                          <span className="table-subline">Still open</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={session.lastStatus} />
                      </td>
                      <td className="text-right font-[JetBrains_Mono,monospace]">{sessionDuration(session)}</td>
                    </tr>
                  ))}

                  {recentRows.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-panel small">No recorded sessions yet.</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="overview-side-stack">
          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Session Duration</h2>
                <p className="panel-subtitle">Completed sessions grouped by runtime band.</p>
              </div>
            </div>

            <div className="chart-shell chart-shell-professional chart-shell-compact">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={durations} margin={{ top: 6, right: 6, left: -10, bottom: 6 }}>
                  <CartesianGrid stroke={chartPalette.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: chartPalette.axis, fontSize: 11 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={30}
                    tick={{ fill: chartPalette.axisSoft, fontSize: 11 }}
                  />
                  <Tooltip cursor={chartPalette.tooltipCursor} content={<ChartTooltip />} />
                  <Bar dataKey="value" name="Sessions" fill={chartPalette.durationBar} radius={[6, 6, 0, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Error Feed</h2>
                <p className="panel-subtitle">Most recent application failures in the loaded range.</p>
              </div>
              <span className="panel-count">{errorRows.length}</span>
            </div>

            <div className="signal-list">
              {errorRows.map((event) => (
                <ErrorItem key={event.id} event={event} />
              ))}

              {errorRows.length === 0 ? <div className="empty-panel small">No recent errors.</div> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
