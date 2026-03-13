import { Radio } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { formatDate, formatNumber, timeAgo } from "../utils/format";

interface LivePageProps {
  summary: SummaryPayload;
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

export function LivePage({ summary }: LivePageProps) {
  const activeSessions = summary.activeSessions;
  const liveErrors = activeSessions.filter((session) => session.errorCount > 0).length;

  return (
    <div className="page-content page-content-wide page-stack">
      <section className="page-header">
        <div>
          <p className="page-kicker">Live Telemetry</p>
          <h1 className="page-title">Live</h1>
          <p className="page-subtitle">Who is active right now, what build they run, and whether their session is clean.</p>
        </div>
        <div className="page-meta">
          <span>Active now</span>
          <strong>{formatNumber(activeSessions.length)}</strong>
        </div>
      </section>

      <div className="stats-grid stats-grid-3">
        <Stat label="Active Users" value={formatNumber(activeSessions.length)} />
        <Stat label="Live Errors" value={formatNumber(liveErrors)} />
        <Stat label="Last Ingest" value={summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "waiting"} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Open Sessions</h2>
            <p className="panel-subtitle">Only sessions that are currently active stay in this table.</p>
          </div>
          <span className="panel-count">
            <Radio className="mr-1 inline h-4 w-4" />
            {activeSessions.length}
          </span>
        </div>

        <div className="table-shell">
          <div className="table-scroller">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Location</th>
                  <th>Version</th>
                  <th>Started</th>
                  <th>Last seen</th>
                  <th className="text-right">Errors</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activeSessions.map((session) => (
                  <tr key={session.id}>
                    <td>
                      <div className="font-semibold">{displayUser(session)}</div>
                      <div className="table-subline">{session.installId}</div>
                    </td>
                    <td>
                      <div>{session.clientCountry ?? "unknown"}</div>
                      <div className="table-subline font-[IBM_Plex_Mono,monospace]">{session.clientIp ?? "unknown"}</div>
                    </td>
                    <td>
                      <div>{session.appVersion ?? "unknown"}</div>
                      <div className="table-subline">{session.platform ?? "unknown"}</div>
                    </td>
                    <td>
                      <div>{formatDate(session.startedAt)}</div>
                      <div className="table-subline">{timeAgo(session.startedAt)}</div>
                    </td>
                    <td>
                      <div>{formatDate(session.lastSeenAt)}</div>
                      <div className="table-subline">{timeAgo(session.lastSeenAt)}</div>
                    </td>
                    <td className="text-right font-[IBM_Plex_Mono,monospace]">{session.errorCount}</td>
                    <td>
                      <StatusBadge status={session.lastStatus} />
                    </td>
                  </tr>
                ))}

                {activeSessions.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty-panel small">No active sessions right now.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="simple-stat">
      <p className="simple-stat-label">{label}</p>
      <p className="simple-stat-value">{value}</p>
    </div>
  );
}
