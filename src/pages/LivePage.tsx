import { Radio } from "lucide-react";
import { useMemo } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { formatDate, formatNumber, timeAgo } from "../utils/format";

interface LivePageProps {
  summary: SummaryPayload;
}

const LIVE_SESSION_MAX_AGE_MS = 6 * 60 * 1000;

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

export function LivePage({ summary }: LivePageProps) {
  const activeSessions = useMemo(
    () => {
      const now = Date.now();

      return [...summary.activeSessions]
        .filter((session) => {
          const lastSeenTs = Date.parse(session.lastSeenAt);
          return session.isActive && Number.isFinite(lastSeenTs) && now - lastSeenTs <= LIVE_SESSION_MAX_AGE_MS;
        })
        .sort((left, right) => {
          const nameComparison = displayUser(left).localeCompare(displayUser(right), undefined, { sensitivity: "base" });
          if (nameComparison !== 0) {
            return nameComparison;
          }

          const installComparison = left.installId.localeCompare(right.installId, undefined, { sensitivity: "base" });
          if (installComparison !== 0) {
            return installComparison;
          }

          return left.id.localeCompare(right.id, undefined, { sensitivity: "base" });
        });
    },
    [summary.activeSessions],
  );
  const liveErrors = activeSessions.filter((session) => session.errorCount > 0).length;

  return (
    <div className="page-content page-content-wide page-stack live-page">
      <section className="page-header">
        <div>
          <p className="page-kicker">Live Telemetry</p>
          <h1 className="page-title">Live</h1>
          <p className="page-subtitle">
            Only sessions seen within the last few minutes stay here. Rows keep a stable order so they do not jump while you copy data.
          </p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack">
            <div className="page-meta">
              <span>Active now</span>
              <strong>{formatNumber(activeSessions.length)}</strong>
            </div>
            <div className="page-meta">
              <span>Live errors</span>
              <strong>{formatNumber(liveErrors)}</strong>
            </div>
            <div className="page-meta">
              <span>Last ingest</span>
              <strong>{summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting"}</strong>
            </div>
          </div>
        </div>
      </section>

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
