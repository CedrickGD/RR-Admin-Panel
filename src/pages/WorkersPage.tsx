import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { downloadSessionExport } from "../utils/api";
import { formatDate, formatEventName, formatNumber, timeAgo } from "../utils/format";

interface WorkersPageProps {
  summary: SummaryPayload;
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

export function WorkersPage({ summary }: WorkersPageProps) {
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
        session.lastEvent ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [query, summary.recentSessions]);

  const activeInResults = sessions.filter((session) => session.isActive).length;
  const resultsWithErrors = sessions.filter((session) => session.errorCount > 0).length;

  async function handleExport() {
    if (exporting) {
      return;
    }

    setExporting(true);
    setExportError(null);

    try {
      await downloadSessionExport();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to download session export.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-content page-content-wide page-stack">
      <section className="page-header">
        <div>
          <p className="page-kicker">Session Archive</p>
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">Searchable session history with the fields that are useful when checking real user state.</p>
        </div>

        <div className="page-header-side">
          <div className="page-actions">
            <button type="button" className="btn-primary" onClick={() => void handleExport()} disabled={exporting}>
              <Download className="h-4 w-4" />
              {exporting ? "Preparing TXT..." : "Download TXT Report"}
            </button>
          </div>
          <div className="page-meta-stack">
            <div className="page-meta">
              <span>Visible rows</span>
              <strong>{formatNumber(sessions.length)}</strong>
            </div>
            <div className="page-meta">
              <span>Active in results</span>
              <strong>{formatNumber(activeInResults)}</strong>
            </div>
            <div className="page-meta">
              <span>Rows with errors</span>
              <strong>{formatNumber(resultsWithErrors)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Session History</h2>
            <p className="panel-subtitle">User, location, version, last visibility, last event, and error count. Export writes the same data in a readable text report.</p>
          </div>
          <div className="input-group search-small">
            <Search className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              className="input"
              placeholder="Search user, IP, version, event..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="panel-stack">
          {exportError ? <div className="inline-error">{exportError}</div> : null}

          <div className="table-shell">
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
                  {sessions.map((session) => (
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

                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty-panel small">No sessions match the current filter.</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
