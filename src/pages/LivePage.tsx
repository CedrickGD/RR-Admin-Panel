import { ChevronDown, ChevronUp, Globe2, Radio } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent } from "../types/telemetry";
import { formatDate, formatDuration, formatEventName, formatNumber, timeAgo } from "../utils/format";
import { resolveCountry } from "../utils/geography";

interface LivePageProps {
  summary: SummaryPayload;
  focusedSessionId?: string | null;
  focusedSessionToken?: number;
  onOpenMapSession: (sessionId: string) => void;
}

const LIVE_SESSION_MAX_AGE_MS = 6 * 60 * 1000;
const APP_ERROR = "app_error";
const MAX_LIVE_TIMELINE_MARKERS = 4;

interface LiveSessionTimelineMarker {
  id: string;
  label: string;
  timestamp: string;
  timeLabel: string;
  position: number;
}

interface LiveSessionTimelineData {
  trackedEventCount: number;
  hiddenErrorCount: number;
  markers: LiveSessionTimelineMarker[];
}

function displayUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function displayLocation(session: AppSessionRecord): string {
  const locationParts = [session.clientCity?.trim(), session.clientRegion?.trim()].filter(
    (value): value is string => Boolean(value),
  );

  if (locationParts.length > 0) {
    if (session.clientCountry?.trim()) {
      locationParts.push(session.clientCountry.trim());
    }

    return locationParts.join(", ");
  }

  return session.clientCountry ?? "unknown";
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

  const startedAt = parseTimestamp(session.startedAt);
  const endedAt = parseTimestamp(resolveSessionEnd(session));

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return "open";
  }

  return formatDuration((endedAt - startedAt) / 1000);
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

function buildLiveSessionTimeline(
  session: AppSessionRecord,
  recentEvents: TelemetryEvent[],
): LiveSessionTimelineData {
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
  const visibleErrors = errorEvents.slice(-MAX_LIVE_TIMELINE_MARKERS);
  const duration = hasRange ? Math.max(1, rangeEnd - rangeStart) : 1;
  const markers = visibleErrors.map((event, index) => {
    const timestamp = parseTimestamp(event.timestamp);
    const rawPosition = hasRange ? ((timestamp - rangeStart) / duration) * 100 : 50;
    const position = Math.max(6, Math.min(94, rawPosition));

    return {
      id: `${event.id}-${index}`,
      label: String(event.metrics["exception_type"] ?? event.message ?? "Error"),
      timestamp: event.timestamp,
      timeLabel: new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      position,
    };
  });

  return {
    trackedEventCount: relevantEvents.length,
    hiddenErrorCount: Math.max(0, session.errorCount - markers.length),
    markers,
  };
}

export function LivePage({
  summary,
  focusedSessionId = null,
  focusedSessionToken = 0,
  onOpenMapSession,
}: LivePageProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => window.clearInterval(id);
  }, []);

  const activeSessions = useMemo(
    () => {
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
    [now, summary.activeSessions],
  );
  const liveErrors = activeSessions.filter((session) => session.errorCount > 0).length;
  const focusedSession = activeSessions.find((session) => session.id === focusedSessionId) ?? null;
  const sessionTimelines = useMemo(() => {
    const timelines = new Map<string, LiveSessionTimelineData>();

    for (const session of activeSessions) {
      timelines.set(session.id, buildLiveSessionTimeline(session, summary.recentEvents));
    }

    return timelines;
  }, [activeSessions, summary.recentEvents]);

  useEffect(() => {
    if (!focusedSessionId || focusedSessionToken <= 0) {
      return;
    }

    const row = rowRefs.current.get(focusedSessionId);

    if (!row) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [focusedSessionId, focusedSessionToken]);

  function canFocusSessionOnMap(session: AppSessionRecord): boolean {
    return resolveCountry(session.clientCountry) !== null;
  }

  function toggleExpanded(sessionId: string) {
    setExpandedSessionIds((current) =>
      current.includes(sessionId)
        ? current.filter((entry) => entry !== sessionId)
        : [...current, sessionId],
    );
  }

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
          <div className="page-meta-stack page-meta-stack-live">
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
            <div className="page-meta">
              <span>Updated</span>
              <strong>{timeAgo(summary.generatedAt)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Open Sessions</h2>
            <p className="panel-subtitle">
              {focusedSession
                ? `Focused from map: ${displayUser(focusedSession)} is highlighted below.`
                : "Only sessions that are currently active stay in this table."}
            </p>
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
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeSessions.map((session) => {
                  const expanded = expandedSessionIds.includes(session.id);
                  const detailId = `live-session-detail-${session.id.replace(/[^a-z0-9-_:]/gi, "-")}`;
                  const sessionEnd = resolveSessionEnd(session);
                  const durationLabel = resolveSessionDuration(session);
                  const timeline = sessionTimelines.get(session.id) ?? {
                    trackedEventCount: 0,
                    hiddenErrorCount: 0,
                    markers: [],
                  };

                  return (
                    <Fragment key={session.id}>
                      <tr
                        ref={(node) => {
                          if (node) {
                            rowRefs.current.set(session.id, node);
                          } else {
                            rowRefs.current.delete(session.id);
                          }
                        }}
                        tabIndex={-1}
                        className={session.id === focusedSessionId ? "live-session-row live-session-row-focused" : "live-session-row"}
                        aria-current={session.id === focusedSessionId ? "true" : undefined}
                      >
                        <td>
                          <div className="font-semibold">{displayUser(session)}</div>
                          <div className="table-subline">{session.installId}</div>
                          {session.id === focusedSessionId ? (
                            <div className="live-session-focus-tag">Focused from map</div>
                          ) : null}
                        </td>
                        <td>
                          <div>{displayLocation(session)}</div>
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
                        <td className="text-right">
                          <div className="live-session-action-stack">
                            <button
                              type="button"
                              className="btn-ghost live-session-map-button"
                              onClick={() => onOpenMapSession(session.id)}
                              disabled={!canFocusSessionOnMap(session)}
                            >
                              <Globe2 className="h-4 w-4" />
                              Map
                            </button>
                            <button
                              type="button"
                              className="btn-ghost live-session-expand-button"
                              onClick={() => toggleExpanded(session.id)}
                              aria-expanded={expanded}
                              aria-controls={detailId}
                            >
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              {expanded ? "Hide" : "Expand"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expanded ? (
                        <tr className="live-session-detail-row">
                          <td colSpan={8} className="session-detail-cell">
                            <div id={detailId} className="session-detail-shell">
                              <div className="live-session-detail-top">
                                <div className="live-session-timeline-shell">
                                  <div className="live-session-timeline-head">
                                    <span className="session-timeline-label">Live session timeline</span>
                                    <div className="live-session-timeline-badges">
                                      <span>{formatNumber(timeline.trackedEventCount)} events</span>
                                      <span>{formatNumber(session.errorCount)} errors</span>
                                    </div>
                                  </div>

                                  <div
                                    className="live-session-timeline-chart"
                                    role="img"
                                    aria-label={`${displayUser(session)} live session timeline from ${formatDate(session.startedAt)} to ${formatDate(sessionEnd)}`}
                                  >
                                    <div className="live-session-timeline-duration">
                                      <span>Elapsed</span>
                                      <strong>{durationLabel}</strong>
                                    </div>

                                    <div className="live-session-track-shell">
                                      <div className="live-session-track" />
                                      <span className="live-session-track-point live-session-track-point-start" />
                                      {timeline.markers.map((marker) => (
                                        <span
                                          key={marker.id}
                                          className="live-session-track-marker"
                                          style={{ left: `${marker.position}%` }}
                                          title={`${marker.label} · ${formatDate(marker.timestamp)}`}
                                        >
                                          <span className="live-session-track-marker-time">{marker.timeLabel}</span>
                                          <span className="live-session-track-marker-glyph">x</span>
                                        </span>
                                      ))}
                                      {timeline.hiddenErrorCount > 0 ? (
                                        <span className="live-session-track-marker live-session-track-marker-more" style={{ left: "91%" }}>
                                          +{timeline.hiddenErrorCount}
                                        </span>
                                      ) : null}
                                      <span className="live-session-track-point live-session-track-point-end" />
                                    </div>

                                    <div className="live-session-track-labels">
                                      <div className="live-session-track-label">
                                        <span className="session-timeline-label">Start</span>
                                        <strong>{formatDate(session.startedAt)}</strong>
                                      </div>
                                      <div className="live-session-track-label live-session-track-label-end">
                                        <span className="session-timeline-label">Live now</span>
                                        <strong>{formatDate(sessionEnd)}</strong>
                                      </div>
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
                                    <strong>{displayLocation(session)}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>IP</span>
                                    <strong className="session-detail-mono">{session.clientIp ?? "unknown"}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Started</span>
                                    <strong>{timeAgo(session.startedAt)}</strong>
                                  </div>
                                  <div className="session-detail-item">
                                    <span>Last event</span>
                                    <strong>{formatEventName(session.lastEvent)}</strong>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}

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
