import { ChevronDown, ChevronUp, Download, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent } from "../types/telemetry";
import { downloadSessionExport } from "../utils/api";
import { formatDate, formatDuration, formatEventName, formatNumber, timeAgo } from "../utils/format";

interface WorkersPageProps {
  summary: SummaryPayload;
}

interface SessionTimelineMarker {
  id: string;
  label: string;
  timestamp: string;
  position: number;
}

interface SessionTimelineData {
  trackedEventCount: number;
  visibleErrorCount: number;
  hiddenErrorCount: number;
  markers: SessionTimelineMarker[];
}

const APP_ERROR = "app_error";
const MAX_TIMELINE_MARKERS = 6;

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function userIdentity(session: AppSessionRecord): string {
  const userLabel = session.userLabel?.trim().toLowerCase();
  if (userLabel) {
    return `user:${userLabel}`;
  }

  return `install:${session.installId.trim().toLowerCase()}`;
}

function resolveSessionEnd(session: AppSessionRecord): string {
  return session.endedAt ?? session.lastSeenAt;
}

function parseTimestamp(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function resolveSessionDuration(session: AppSessionRecord): string {
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds)) {
    return formatDuration(session.durationSeconds);
  }

  const startedAt = Date.parse(session.startedAt);
  const endedAt = Date.parse(resolveSessionEnd(session));

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return "open";
  }

  return formatDuration((endedAt - startedAt) / 1000);
}

function buildLocationLabel(session: AppSessionRecord): string {
  return [session.clientCity, session.clientRegion, session.clientCountry]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(", ");
}

function readMetricText(metrics: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metrics[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function eventMatchesSession(event: TelemetryEvent, session: AppSessionRecord): boolean {
  const sessionId = readMetricText(event.metrics, ["session_id"]);

  if (sessionId && sessionId === session.id) {
    return true;
  }

  const installId = readMetricText(event.metrics, ["install_id"]);
  return installId === session.installId;
}

function buildSessionTimeline(
  session: AppSessionRecord,
  recentEvents: TelemetryEvent[],
): SessionTimelineData {
  const startedAt = parseTimestamp(session.startedAt);
  const endedAt = parseTimestamp(resolveSessionEnd(session));
  const hasRange = Number.isFinite(startedAt) && Number.isFinite(endedAt);
  const rangeStart = hasRange ? Math.min(startedAt, endedAt) : Number.NEGATIVE_INFINITY;
  const rangeEnd = hasRange ? Math.max(startedAt, endedAt) : Number.POSITIVE_INFINITY;
  const relevantEvents = recentEvents
    .filter((event) => {
      if (!eventMatchesSession(event, session)) {
        return false;
      }

      const timestamp = parseTimestamp(event.timestamp);

      if (!Number.isFinite(timestamp)) {
        return false;
      }

      return timestamp >= rangeStart && timestamp <= rangeEnd;
    })
    .sort((left, right) => parseTimestamp(left.timestamp) - parseTimestamp(right.timestamp));
  const errorEvents = relevantEvents.filter((event) => event.service === APP_ERROR);
  const visibleErrors = errorEvents.slice(-MAX_TIMELINE_MARKERS);
  const duration = hasRange ? Math.max(1, rangeEnd - rangeStart) : 1;

  const markers = visibleErrors.map((event, index) => {
    const timestamp = parseTimestamp(event.timestamp);
    const rawPosition = hasRange ? ((timestamp - rangeStart) / duration) * 100 : 50;
    const position = Math.max(3, Math.min(97, rawPosition));

    return {
      id: `${event.id}-${index}`,
      label: String(event.metrics["exception_type"] ?? event.message ?? "Error"),
      timestamp: event.timestamp,
      position,
    };
  });

  return {
    trackedEventCount: relevantEvents.length,
    visibleErrorCount: markers.length,
    hiddenErrorCount: Math.max(0, session.errorCount - markers.length),
    markers,
  };
}

export function WorkersPage({ summary }: WorkersPageProps) {
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<string[]>([]);

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? summary.recentSessions
      : summary.recentSessions.filter((session) => {
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

    const seenUsers = new Set<string>();
    return [...filtered]
      .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
      .filter((session) => {
        const identity = userIdentity(session);
        if (seenUsers.has(identity)) {
          return false;
        }

        seenUsers.add(identity);
        return true;
      });
  }, [query, summary.recentSessions]);

  const activeInResults = sessions.filter((session) => session.isActive).length;
  const resultsWithErrors = sessions.filter((session) => session.errorCount > 0).length;
  const sessionTimelines = useMemo(() => {
    const timelines = new Map<string, SessionTimelineData>();

    for (const session of sessions) {
      timelines.set(userIdentity(session), buildSessionTimeline(session, summary.recentEvents));
    }

    return timelines;
  }, [sessions, summary.recentEvents]);

  function toggleExpanded(identity: string) {
    setExpandedUsers((current) =>
      current.includes(identity)
        ? current.filter((entry) => entry !== identity)
        : [...current, identity],
    );
  }

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
          <p className="page-subtitle">
            Searchable user directory built from the latest session snapshot for each unique user.
          </p>
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
              <span>Visible users</span>
              <strong>{formatNumber(sessions.length)}</strong>
            </div>
            <div className="page-meta">
              <span>Active users</span>
              <strong>{formatNumber(activeInResults)}</strong>
            </div>
            <div className="page-meta">
              <span>Users with errors</span>
              <strong>{formatNumber(resultsWithErrors)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Latest User Sessions</h2>
            <p className="panel-subtitle">
              One row per unique user, using the most recent session snapshot for location, version, visibility, and
              last event. Export still includes the full text report.
            </p>
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
                    <th className="text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const identity = userIdentity(session);
                    const expanded = expandedUsers.includes(identity);
                    const detailId = `session-detail-${identity.replace(/[^a-z0-9-_:]/gi, "-")}`;
                    const locationLabel = buildLocationLabel(session);
                    const sessionEnd = resolveSessionEnd(session);
                    const durationLabel = resolveSessionDuration(session);
                    const timeline = sessionTimelines.get(identity) ?? {
                      trackedEventCount: 0,
                      visibleErrorCount: 0,
                      hiddenErrorCount: 0,
                      markers: [],
                    };

                    return (
                      <Fragment key={identity}>
                        <tr className={expanded ? "session-directory-row session-directory-row-expanded" : "session-directory-row"}>
                          <td>
                            <div className="font-semibold">{displayUser(session)}</div>
                            <div className="table-subline">{session.installId}</div>
                          </td>
                          <td>
                            <div>{locationLabel || session.clientCountry || "unknown"}</div>
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
                          <td className="text-right">
                            <button
                              type="button"
                              className="btn-ghost session-expand-button"
                              onClick={() => toggleExpanded(identity)}
                              aria-expanded={expanded}
                              aria-controls={detailId}
                            >
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              {expanded ? "Hide" : "Expand"}
                            </button>
                          </td>
                        </tr>

                        {expanded ? (
                          <tr key={`${session.id}-details`} className="session-detail-row">
                            <td colSpan={8} className="session-detail-cell">
                              <div id={detailId} className="session-detail-shell">
                                <div className="session-timeline-panel">
                                  <div className="session-timeline-head">
                                    <div className="session-timeline-head-copy">
                                      <span className="session-timeline-label">Session timeline</span>
                                      <strong>{durationLabel}</strong>
                                    </div>
                                    <div className="session-timeline-head-stats">
                                      <span>{formatNumber(timeline.trackedEventCount)} events</span>
                                      <span>{formatNumber(session.errorCount)} errors</span>
                                    </div>
                                  </div>

                                  <div
                                    className="session-timeline-chart"
                                    role="img"
                                    aria-label={`${displayUser(session)} session timeline from ${formatDate(session.startedAt)} to ${formatDate(sessionEnd)}`}
                                  >
                                    <div className="session-timeline-elapsed-badge">
                                      <span>Time elapsed</span>
                                      <strong>{durationLabel}</strong>
                                    </div>

                                    <div className="session-timeline-track-shell">
                                      <div className="session-timeline-track" />
                                      <span className="session-timeline-point session-timeline-point-start" />
                                      {timeline.markers.map((marker) => (
                                        <span
                                          key={marker.id}
                                          className="session-timeline-point session-timeline-point-error"
                                          style={{ left: `${marker.position}%` }}
                                          title={`${marker.label} · ${formatDate(marker.timestamp)}`}
                                        >
                                          x
                                        </span>
                                      ))}
                                      <span className="session-timeline-point session-timeline-point-end" />
                                    </div>

                                    <div className="session-timeline-boundaries">
                                      <div className="session-timeline-boundary">
                                        <span className="session-timeline-label">Session start</span>
                                        <strong>{formatDate(session.startedAt)}</strong>
                                      </div>
                                      <div className="session-timeline-boundary session-timeline-boundary-end">
                                        <span className="session-timeline-label">
                                          {session.endedAt ? "Session end" : "Latest activity"}
                                        </span>
                                        <strong>{formatDate(sessionEnd)}</strong>
                                      </div>
                                    </div>

                                    <div className="session-timeline-note-strip">
                                      {timeline.markers.length > 0 ? (
                                        timeline.markers.map((marker) => (
                                          <div key={`${marker.id}-note`} className="session-timeline-note">
                                            <span className="session-timeline-note-icon">x</span>
                                            <span>{timeAgo(marker.timestamp)}</span>
                                          </div>
                                        ))
                                      ) : (
                                        <div className="session-timeline-note session-timeline-note-muted">
                                          <span>No recent error markers</span>
                                        </div>
                                      )}

                                      {timeline.hiddenErrorCount > 0 ? (
                                        <div className="session-timeline-note session-timeline-note-muted">
                                          <span>+{formatNumber(timeline.hiddenErrorCount)} older errors</span>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>

                                <div className="session-detail-grid">
                                  <div className="session-detail-item">
                                    <span>User</span>
                                    <strong>{displayUser(session)}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Install</span>
                                    <strong className="session-detail-mono">{session.installId}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Version</span>
                                    <strong>{session.appVersion ?? "unknown"}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Platform</span>
                                    <strong>{session.platform ?? "unknown"}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Location</span>
                                    <strong>{locationLabel || "unknown"}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>IP</span>
                                    <strong className="session-detail-mono">{session.clientIp ?? "unknown"}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Last event</span>
                                    <strong>{formatEventName(session.lastEvent)}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Status</span>
                                    <strong>{session.lastStatus}</strong>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}

                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty-panel small">No users match the current filter.</div>
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
