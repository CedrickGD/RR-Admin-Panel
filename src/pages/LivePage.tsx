import { Radio } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { formatDate, formatDuration, timeAgo } from "../utils/format";

interface LivePageProps {
  summary: SummaryPayload;
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function liveDuration(session: AppSessionRecord): string {
  const startedAt = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAt)) {
    return "open";
  }

  return formatDuration(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
}

export function LivePage({ summary }: LivePageProps) {
  const activeSessions = summary.activeSessions;

  return (
    <div className="page-content">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Live Sessions</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Open sessions, IPs, open timestamps, and current duration
        </p>
      </div>

      <div className="card p-8 mb-6">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]">
            <Radio className="h-6 w-6" />
          </div>
          <p className="text-xs uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Active Users Now
          </p>
          <p className="mt-2 text-5xl font-extrabold font-[JetBrains_Mono,monospace] leading-none">
            {activeSessions.length}
          </p>
          <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
            Last ingest: {timeAgo(summary.stats.lastIngestAt)} ({formatDate(summary.stats.lastIngestAt)})
          </p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Open Sessions</h3>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {activeSessions.length} active
          </span>
        </div>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">User</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">IP</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Country</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Opened</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Version</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Status</th>
                <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Live For</th>
                <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.map((session) => (
                <tr key={session.id} className="border-b border-[hsl(var(--border)/0.5)] last:border-0">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium">{displayUser(session)}</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] font-[JetBrains_Mono,monospace]">
                      {session.installId}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace]">{session.clientIp ?? "unknown"}</td>
                  <td className="py-2.5 pr-4">{session.clientCountry ?? "unknown"}</td>
                  <td className="py-2.5 pr-4 text-[hsl(var(--muted-foreground))]">{formatDate(session.startedAt)}</td>
                  <td className="py-2.5 pr-4">
                    <div>{session.appVersion ?? "unknown"}</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{session.platform ?? "unknown"}</div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusBadge status={session.lastStatus} />
                  </td>
                  <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">{liveDuration(session)}</td>
                  <td className="py-2.5 text-right text-[hsl(var(--muted-foreground))]">{timeAgo(session.lastSeenAt)}</td>
                </tr>
              ))}

              {activeSessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[hsl(var(--muted-foreground))]">
                    No active sessions right now
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
