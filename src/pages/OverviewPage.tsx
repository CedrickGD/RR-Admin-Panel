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
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent, ThemeMode } from "../types/telemetry";
import { buildCountryBreakdown, buildTrafficTimeline, buildVersionBreakdown } from "../utils/dashboardInsights";
import { formatDate, formatEventName, formatNumber, timeAgo } from "../utils/format";

interface OverviewPageProps {
  summary: SummaryPayload;
  theme: ThemeMode;
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
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
  const versions = useMemo(() => buildVersionBreakdown(summary), [summary]);
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
  const latestEvent = summary.recentEvents[0];

  return (
    <div className="page-content page-content-wide overview-page">
      <section className="page-header">
        <div>
          <p className="page-kicker">Operator View</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">
            Keep the main screen focused on who is active, which version they run, and whether errors are climbing.
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
          sub={`${liveRows.length} visible in live list`}
          icon={<Radio className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="Sessions With Errors"
          value={formatNumber(sessionsWithErrors)}
          sub={`${formatNumber(liveWithErrors)} of them still active`}
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
          label="Latest Event"
          value={formatEventName(latestEvent?.service ?? null)}
          sub={latestEvent ? timeAgo(latestEvent.timestamp) : "No recent activity"}
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

        <div className="overview-side-stack">
          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Need Attention</p>
                <h2 className="panel-title">Quick checks</h2>
                <p className="panel-subtitle">Operator-facing facts that help decide whether anything needs action.</p>
              </div>
            </div>

            <div className="info-list">
              <div className="info-row">
                <span className="info-label">Last ingest</span>
                <span className="info-value">{summary.stats.lastIngestAt ? formatDate(summary.stats.lastIngestAt) : "Waiting"}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Sessions with errors</span>
                <span className="info-value">{formatNumber(sessionsWithErrors)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Most used version</span>
                <span className="info-value">{mostUsedVersion}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Storage backend</span>
                <span className="info-value">{summary.storage.toUpperCase()}</span>
              </div>
            </div>
          </section>

          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Live</p>
                <h2 className="panel-title">Active sessions</h2>
                <p className="panel-subtitle">Users currently active, ordered by recent visibility.</p>
              </div>
              <span className="panel-count">{liveRows.length}</span>
            </div>

            <div className="signal-list">
              {liveRows.map((session) => (
                <div key={session.id} className="signal-row">
                  <div className="signal-copy">
                    <p className="signal-title">{displayUser(session)}</p>
                    <p className="signal-meta">
                      {session.clientCountry ?? "Unknown"} · {session.appVersion ?? "unknown"} · last seen{" "}
                      {timeAgo(session.lastSeenAt)}
                    </p>
                  </div>
                  <div className="signal-side">
                    <StatusBadge status={session.lastStatus} />
                    <span className="signal-time">{session.errorCount} errors</span>
                  </div>
                </div>
              ))}

              {liveRows.length === 0 ? <div className="empty-panel small">No active sessions.</div> : null}
            </div>
          </section>
        </div>
      </div>

      <div className="overview-secondary-grid">
        <section className="panel panel-dense">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Sessions</p>
              <h2 className="panel-title">Latest session activity</h2>
              <p className="panel-subtitle">Focus on who was seen last, what version they run, and whether errors are attached.</p>
            </div>
            <span className="panel-count">{recentRows.length}</span>
          </div>

          <div className="table-shell table-shell-dense">
            <div className="table-scroller">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Location</th>
                    <th>Version</th>
                    <th>Last seen</th>
                    <th>Last event</th>
                    <th className="text-right">Errors</th>
                    <th>Status</th>
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
                        <div>{session.clientCountry ?? "Unknown"}</div>
                        <div className="table-subline font-[IBM_Plex_Mono,monospace]">{session.clientIp ?? "unknown"}</div>
                      </td>
                      <td>
                        <div>{session.appVersion ?? "unknown"}</div>
                        <div className="table-subline">{session.platform ?? "unknown"}</div>
                      </td>
                      <td>
                        <div>{formatDate(session.lastSeenAt)}</div>
                        <div className="table-subline">{timeAgo(session.lastSeenAt)}</div>
                      </td>
                      <td>{formatEventName(session.lastEvent)}</td>
                      <td className="text-right font-[IBM_Plex_Mono,monospace]">{session.errorCount}</td>
                      <td>
                        <StatusBadge status={session.lastStatus} />
                      </td>
                    </tr>
                  ))}

                  {recentRows.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
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
                <p className="panel-kicker">Versions</p>
                <h2 className="panel-title">Version spread</h2>
                <p className="panel-subtitle">See which client versions dominate the currently loaded sessions.</p>
              </div>
            </div>

            <div className="chart-shell chart-shell-professional chart-shell-compact">
              <ResponsiveContainer width="100%" height={220}>
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
              <ResponsiveContainer width="100%" height={220}>
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

          <section className="panel panel-dense">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Incidents</p>
                <h2 className="panel-title">Error feed</h2>
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
