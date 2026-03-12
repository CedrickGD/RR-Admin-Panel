import { AlertTriangle, Clock3, DoorOpen, Radio, TimerReset, UserCheck } from "lucide-react";
import { StatCard } from "../components/StatCard";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { formatDate, formatDuration, formatNumber, timeAgo } from "../utils/format";

interface OverviewPageProps {
  summary: SummaryPayload;
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function liveDuration(session: AppSessionRecord): string {
  if (!session.isActive) {
    return formatDuration(session.durationSeconds);
  }

  const startedAt = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAt)) {
    return "open";
  }

  return formatDuration(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
}

export function OverviewPage({ summary }: OverviewPageProps) {
  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Overview</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Session-first dashboard with the data that actually matters
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Last ingest
          </p>
          <p className="text-sm font-medium">{formatDate(summary.stats.lastIngestAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 mb-6">
        <StatCard
          label="Active Users"
          value={formatNumber(summary.stats.activeUsers)}
          sub={`${summary.activeSessions.length} live session rows`}
          icon={<Radio className="w-5 h-5" />}
          tone="primary"
        />
        <StatCard
          label="Sessions Today"
          value={formatNumber(summary.stats.sessionsStartedToday)}
          sub={`${formatNumber(summary.stats.totalSessions)} total sessions`}
          icon={<DoorOpen className="w-5 h-5" />}
          tone="accent"
        />
        <StatCard
          label="Sessions Closed"
          value={formatNumber(summary.stats.sessionsEndedToday)}
          sub="Closed since UTC midnight"
          icon={<UserCheck className="w-5 h-5" />}
          tone="amber"
        />
        <StatCard
          label="Average Session"
          value={formatDuration(summary.stats.averageSessionDurationSeconds)}
          sub="Completed sessions only"
          icon={<TimerReset className="w-5 h-5" />}
          tone="rose"
        />
        <StatCard
          label="Errors 24h"
          value={formatNumber(summary.stats.errorsLast24Hours)}
          sub={`${summary.recentErrors.length} visible in recent log`}
          icon={<AlertTriangle className="w-5 h-5" />}
          tone="rose"
        />
        <StatCard
          label="Total Events"
          value={formatNumber(summary.stats.totalEvents)}
          sub={timeAgo(summary.stats.lastIngestAt)}
          icon={<Clock3 className="w-5 h-5" />}
          tone="primary"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Active Right Now</h3>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                Open sessions with IP and open time
              </p>
            </div>
            <span className="text-xs font-[JetBrains_Mono,monospace]">
              {summary.activeSessions.length}
            </span>
          </div>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">User</th>
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">IP</th>
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Opened</th>
                  <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">Live For</th>
                </tr>
              </thead>
              <tbody>
                {summary.activeSessions.slice(0, 8).map((session) => (
                  <tr key={session.id} className="border-b border-[hsl(var(--border)/0.5)] last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{displayUser(session)}</td>
                    <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace]">{session.clientIp ?? "unknown"}</td>
                    <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))]">{formatDate(session.startedAt)}</td>
                    <td className="py-2.5 text-right font-[JetBrains_Mono,monospace]">{liveDuration(session)}</td>
                  </tr>
                ))}
                {summary.activeSessions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-[hsl(var(--muted-foreground))]">
                      No active sessions at the moment
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Recent Session Activity</h3>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                Latest opens and closes
              </p>
            </div>
            <span className="text-xs font-[JetBrains_Mono,monospace]">
              {summary.recentSessions.length}
            </span>
          </div>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">User</th>
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Opened</th>
                  <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Closed</th>
                  <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">Duration</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentSessions.slice(0, 8).map((session) => (
                  <tr key={session.id} className="border-b border-[hsl(var(--border)/0.5)] last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{displayUser(session)}</td>
                    <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))]">{formatDate(session.startedAt)}</td>
                    <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))]">
                      {session.endedAt ? formatDate(session.endedAt) : "still open"}
                    </td>
                    <td className="py-2.5 text-right font-[JetBrains_Mono,monospace]">
                      {liveDuration(session)}
                    </td>
                  </tr>
                ))}
                {summary.recentSessions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-[hsl(var(--muted-foreground))]">
                      No recorded sessions yet
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
