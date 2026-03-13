import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";
import { downloadSessionExport } from "../utils/api";
import { formatDate, formatDuration, formatNumber, timeAgo } from "../utils/format";

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
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [query, summary.recentSessions]);

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
          <h1 className="page-title">Sessions</h1>
          <p className="page-subtitle">Searchable session history and TXT export.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-ghost" onClick={() => void handleExport()} disabled={exporting}>
            <Download className="h-4 w-4" />
            {exporting ? "Preparing TXT..." : "Download TXT"}
          </button>
        </div>
      </section>

      <div className="stats-grid stats-grid-3">
        <Stat label="Visible Rows" value={formatNumber(sessions.length)} />
        <Stat label="Total Sessions" value={formatNumber(summary.stats.totalSessions)} />
        <Stat label="Ended Today" value={formatNumber(summary.stats.sessionsEndedToday)} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Session History</h2>
            <p className="panel-subtitle">One row per session.</p>
          </div>
          <div className="input-group search-small">
            <Search className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              className="input"
              placeholder="Search user, IP, country..."
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
                    <th>IP</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th>Status</th>
                    <th className="text-right">Duration</th>
                    <th className="text-right">Errors</th>
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
                        <div className="font-[JetBrains_Mono,monospace]">{session.clientIp ?? "unknown"}</div>
                        <div className="table-subline">{session.clientCountry ?? "unknown"}</div>
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
                      <td className="text-right font-[JetBrains_Mono,monospace]">
                        {session.isActive ? "open" : formatDuration(session.durationSeconds)}
                      </td>
                      <td className="text-right font-[JetBrains_Mono,monospace]">{session.errorCount}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="simple-stat">
      <p className="simple-stat-label">{label}</p>
      <p className="simple-stat-value">{value}</p>
    </div>
  );
}
