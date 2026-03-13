import { Radio } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { formatDate, formatDuration, formatNumber, timeAgo } from "../utils/format";

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
    <div className="page-content page-content-wide page-stack">
      <section className="page-header">
        <div>
          <p className="page-kicker">Live Telemetry</p>
          <h1 className="page-title">Live</h1>
          <p className="page-subtitle">Current open sessions with IP, version, and last seen time.</p>
        </div>
        <div className="page-meta">
          <span>Active now</span>
          <strong>{formatNumber(activeSessions.length)}</strong>
        </div>
      </section>

      <div className="stats-grid stats-grid-3">
        <Stat label="Active Users" value={formatNumber(activeSessions.length)} />
        <Stat label="Last Ingest" value={summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "waiting"} />
        <Stat label="Sessions Today" value={formatNumber(summary.stats.sessionsStartedToday)} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Open Sessions</h2>
            <p className="panel-subtitle">Rows stay here only while the app is considered active.</p>
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
                  <th>IP</th>
                  <th>Country</th>
                  <th>Opened</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th className="text-right">Live for</th>
                  <th className="text-right">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {activeSessions.map((session) => (
                  <tr key={session.id}>
                    <td>
                      <div className="font-semibold">{displayUser(session)}</div>
                      <div className="table-subline">{session.installId}</div>
                    </td>
                    <td className="font-[JetBrains_Mono,monospace]">{session.clientIp ?? "unknown"}</td>
                    <td>{session.clientCountry ?? "unknown"}</td>
                    <td>
                      <div>{formatDate(session.startedAt)}</div>
                      <div className="table-subline">{timeAgo(session.startedAt)}</div>
                    </td>
                    <td>
                      <div>{session.appVersion ?? "unknown"}</div>
                      <div className="table-subline">{session.platform ?? "unknown"}</div>
                    </td>
                    <td>
                      <StatusBadge status={session.lastStatus} />
                    </td>
                    <td className="text-right font-[JetBrains_Mono,monospace]">{liveDuration(session)}</td>
                    <td className="text-right">
                      <div>{formatDate(session.lastSeenAt)}</div>
                      <div className="table-subline">{timeAgo(session.lastSeenAt)}</div>
                    </td>
                  </tr>
                ))}

                {activeSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
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
