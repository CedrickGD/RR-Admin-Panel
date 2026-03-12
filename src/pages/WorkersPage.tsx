import { History, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { formatDate, formatDuration, timeAgo } from "../utils/format";

interface WorkersPageProps {
  summary: SummaryPayload;
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

export function WorkersPage({ summary }: WorkersPageProps) {
  const [query, setQuery] = useState("");

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return summary.recentSessions;
    }

    return summary.recentSessions.filter((session) => {
      const haystack = [
        displayUser(session),
        session.installId,
        session.clientIp ?? "",
        session.clientCountry ?? "",
        session.appVersion ?? "",
        session.platform ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [query, summary.recentSessions]);

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold">Session History</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Open timestamp, close timestamp, duration, IP and session outcome
          </p>
        </div>
        <div className="input-group w-full sm:w-[280px]">
          <Search className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            className="input"
            placeholder="Search session history..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[hsl(var(--primary))]" />
            <h3 className="text-sm font-semibold">Recent Sessions</h3>
          </div>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {sessions.length} rows
          </span>
        </div>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[hsl(var(--border))]">
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">User</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">IP</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Opened</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Closed</th>
                <th className="text-left py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Status</th>
                <th className="text-right py-2 pr-4 font-medium text-[hsl(var(--muted-foreground))]">Duration</th>
                <th className="text-right py-2 font-medium text-[hsl(var(--muted-foreground))]">Errors</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-b border-[hsl(var(--border)/0.5)] last:border-0">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium">{displayUser(session)}</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))] font-[JetBrains_Mono,monospace]">
                      {session.installId}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 font-[JetBrains_Mono,monospace]">{session.clientIp ?? "unknown"}</td>
                  <td className="py-2.5 pr-4">
                    <div>{formatDate(session.startedAt)}</div>
                    <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{timeAgo(session.startedAt)}</div>
                  </td>
                  <td className="py-2.5 pr-4">
                    {session.endedAt ? (
                      <>
                        <div>{formatDate(session.endedAt)}</div>
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">{timeAgo(session.endedAt)}</div>
                      </>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]">still open</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <StatusBadge status={session.lastStatus} />
                  </td>
                  <td className="py-2.5 pr-4 text-right font-[JetBrains_Mono,monospace]">
                    {session.isActive ? "open" : formatDuration(session.durationSeconds)}
                  </td>
                  <td className="py-2.5 text-right font-[JetBrains_Mono,monospace]">{session.errorCount}</td>
                </tr>
              ))}

              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[hsl(var(--muted-foreground))]">
                    No sessions match the current filter
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
