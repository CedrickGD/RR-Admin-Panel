import { ChevronDown, ChevronUp, Globe2, Radio } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent } from "../types/telemetry";
import { formatAccuracy, formatDate, formatDuration, formatEventName, formatGeoSource, formatNumber, timeAgo } from "../utils/format";
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
  const parts = [session.clientCity?.trim(), session.clientRegion?.trim()].filter((v): v is string => Boolean(v));
  if (parts.length > 0) {
    if (session.clientCountry?.trim()) parts.push(session.clientCountry.trim());
    return parts.join(", ");
  }
  return session.clientCountry ?? "unknown";
}

function resolveSessionEnd(session: AppSessionRecord): string {
  return session.endedAt ?? session.lastSeenAt;
}

function parseTimestamp(value: string | null | undefined): number {
  const ts = Date.parse(value ?? "");
  return Number.isFinite(ts) ? ts : Number.NaN;
}

function resolveSessionDuration(session: AppSessionRecord): string {
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds)) return formatDuration(session.durationSeconds);
  const startedAt = parseTimestamp(session.startedAt);
  const endedAt   = parseTimestamp(resolveSessionEnd(session));
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return "open";
  return formatDuration((endedAt - startedAt) / 1000);
}

function readMetricText(metrics: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function eventMatchesSession(event: TelemetryEvent, session: AppSessionRecord): boolean {
  const sessionId = readMetricText(event.metrics, ["session_id"]);
  if (sessionId && sessionId === session.id) return true;
  return readMetricText(event.metrics, ["install_id"]) === session.installId;
}

function buildLiveSessionTimeline(session: AppSessionRecord, recentEvents: TelemetryEvent[]): LiveSessionTimelineData {
  const startedAt = parseTimestamp(session.startedAt);
  const endedAt   = parseTimestamp(resolveSessionEnd(session));
  const hasRange  = Number.isFinite(startedAt) && Number.isFinite(endedAt);
  const rangeStart = hasRange ? Math.min(startedAt, endedAt) : Number.NEGATIVE_INFINITY;
  const rangeEnd   = hasRange ? Math.max(startedAt, endedAt) : Number.POSITIVE_INFINITY;
  const relevantEvents = recentEvents.filter((e) => {
    if (!eventMatchesSession(e, session)) return false;
    const ts = parseTimestamp(e.timestamp);
    return Number.isFinite(ts) && ts >= rangeStart && ts <= rangeEnd;
  }).sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
  const errorEvents = relevantEvents.filter((e) => e.service === APP_ERROR);
  const visibleErrors = errorEvents.slice(-MAX_LIVE_TIMELINE_MARKERS);
  const duration = hasRange ? Math.max(1, rangeEnd - rangeStart) : 1;
  const markers = visibleErrors.map((event, index) => {
    const ts = parseTimestamp(event.timestamp);
    const rawPos = hasRange ? ((ts - rangeStart) / duration) * 100 : 50;
    return {
      id: `${event.id}-${index}`,
      label: String(event.metrics["exception_type"] ?? event.message ?? "Error"),
      timestamp: event.timestamp,
      timeLabel: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      position: Math.max(6, Math.min(94, rawPos)),
    };
  });
  return { trackedEventCount: relevantEvents.length, hiddenErrorCount: Math.max(0, session.errorCount - markers.length), markers };
}

export function LivePage({ summary, focusedSessionId = null, focusedSessionToken = 0, onOpenMapSession }: LivePageProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const activeSessions = useMemo(() => {
    const filtered = [...summary.activeSessions].filter((s) => {
      const lastSeenTs = Date.parse(s.lastSeenAt);
      return s.isActive && Number.isFinite(lastSeenTs) && now - lastSeenTs <= LIVE_SESSION_MAX_AGE_MS;
    });

    // Deduplicate by user identity (hwid preferred, installId fallback) — keep most
    // recent session per user so a relaunching client never shows up twice.
    const byUser = new Map<string, AppSessionRecord>();
    for (const s of filtered) {
      const identity = (s.hwid?.trim() || s.installId).toLowerCase();
      const prev = byUser.get(identity);
      if (!prev || Date.parse(s.lastSeenAt) > Date.parse(prev.lastSeenAt)) {
        byUser.set(identity, s);
      }
    }

    return [...byUser.values()]
      .sort((a, b) => displayUser(a).localeCompare(displayUser(b), undefined, { sensitivity: "base" }) || a.installId.localeCompare(b.installId, undefined, { sensitivity: "base" }));
  }, [now, summary.activeSessions]);

  const liveErrors = activeSessions.filter((s) => s.errorCount > 0).length;
  // rpcEnabled is a new field — null/undefined means "not reported yet", not "off".
  const rpcLive = activeSessions.filter((s) => s.rpcEnabled === true).length;
  const rpcReported = activeSessions.some((s) => typeof s.rpcEnabled === "boolean");

  const sessionTimelines = useMemo(() => {
    const timelines = new Map<string, LiveSessionTimelineData>();
    for (const session of activeSessions) {
      timelines.set(session.id, buildLiveSessionTimeline(session, summary.recentEvents));
    }
    return timelines;
  }, [activeSessions, summary.recentEvents]);

  useEffect(() => {
    if (!focusedSessionId || focusedSessionToken <= 0) return;
    const row = rowRefs.current.get(focusedSessionId);
    if (!row) return;
    const frameId = window.requestAnimationFrame(() => {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [focusedSessionId, focusedSessionToken]);

  function toggleExpanded(sessionId: string) {
    setExpandedSessionIds((curr) => curr.includes(sessionId) ? curr.filter((id) => id !== sessionId) : [...curr, sessionId]);
  }

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Live Sessions
            <span className="kicker">Realtime</span>
          </h1>
          <p className="page-subtitle">
            Active sessions from the last 6 minutes. Rows hold stable order while you read.
          </p>
        </div>
        <div className="page-header-right">
          <span className="badge-live">{formatNumber(activeSessions.length)} live</span>
          <span
            className={rpcLive > 0 ? "badge badge-accent" : "badge badge-muted"}
            title={rpcReported
              ? `${formatNumber(rpcLive)} active sessions report Discord Rich Presence on`
              : "No active session reports the RPC field yet"}
          >
            Discord RPC · {rpcReported ? formatNumber(rpcLive) : "—"}
          </span>
          <div className="meta-row" style={{ marginLeft: 8 }}>
            {[
              { label: "Live Errors",  val: formatNumber(liveErrors) },
              { label: "Last Ingest",  val: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
              { label: "Updated",      val: timeAgo(summary.generatedAt) },
            ].map((m) => (
              <div className="meta-item" key={m.label}><span>{m.label}</span><strong>{m.val}</strong></div>
            ))}
          </div>
        </div>
      </section>

      {/* Sessions table */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Active</p>
            <h2 className="section-title">Open Sessions</h2>
            <p className="section-sub">Showing sessions active within the last 6 minutes.</p>
          </div>
          <div className="panel-head-right">
            <span className="badge-live">{activeSessions.length}</span>
            {liveErrors > 0 ? <span className="badge badge-danger">{liveErrors} errors</span> : null}
          </div>
        </div>

        <div className="panel-body-flush">
          {activeSessions.length > 0 ? (
            <div className="data-table-wrap" style={{ borderRadius: 0, border: "none" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Location</th>
                    <th>Version</th>
                    <th>Platform</th>
                    <th>Duration</th>
                    <th>Last Event</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.map((session) => {
                    const isExpanded = expandedSessionIds.includes(session.id);
                    const isFocused  = session.id === focusedSessionId;
                    const timeline   = sessionTimelines.get(session.id);
                    const canMap     = resolveCountry(session.clientCountry) !== null;

                    return (
                      <Fragment key={session.id}>
                        <tr
                          ref={(el) => { if (el) rowRefs.current.set(session.id, el); else rowRefs.current.delete(session.id); }}
                          tabIndex={0}
                          className={isExpanded ? "row-expanded" : ""}
                          style={isFocused ? { outline: "1px solid var(--accent)", outlineOffset: -1 } : undefined}
                        >
                          <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: "0.8125rem" }}>
                              {displayUser(session)}
                            </span>
                            {session.discordUser?.trim() ? (
                              <span className="muted" style={{ marginLeft: 6, fontSize: "0.6875rem" }} title={`Discord: ${session.discordUser.trim()}`}>
                                @{session.discordUser.trim()}
                              </span>
                            ) : null}
                            {session.rpcEnabled === true ? (
                              <span className="badge badge-accent" style={{ marginLeft: 6, fontSize: "0.625rem", padding: "1px 6px", verticalAlign: "middle" }} title="Discord Rich Presence on">
                                RPC
                              </span>
                            ) : null}
                          </td>
                          <td className="muted">{displayLocation(session)}</td>
                          <td><span className="badge badge-muted">{session.appVersion ?? "—"}</span></td>
                          <td className="muted">{session.platform ?? "—"}</td>
                          <td className="muted">{resolveSessionDuration(session)}</td>
                          <td>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                              {session.lastEvent ? formatEventName(session.lastEvent) : "—"}
                            </span>
                          </td>
                          <td><StatusBadge status={session.lastStatus ?? "unknown"} /></td>
                          <td>
                            <div style={{ display: "flex", gap: 4 }}>
                              {canMap ? (
                                <button type="button" className="btn-icon" style={{ padding: 4 }} title="View on map" onClick={() => onOpenMapSession(session.id)}>
                                  <Globe2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                              <button type="button" className="btn-icon" style={{ padding: 4 }} onClick={() => toggleExpanded(session.id)} aria-label={isExpanded ? "Collapse" : "Expand"}>
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && timeline ? (
                          <tr>
                            <td colSpan={8} className="row-expand-panel">
                              <div className="row-expand-inner">
                                {/* Timeline */}
                                <div style={{ marginBottom: 14 }}>
                                  <p className="label-sm" style={{ marginBottom: 8 }}>Session Timeline</p>
                                  <div className="timeline-track">
                                    <div className="timeline-fill" style={{ width: "100%" }} />
                                    {timeline.markers.map((marker) => (
                                      <div
                                        key={marker.id}
                                        className="timeline-marker is-error"
                                        style={{ left: `${marker.position}%` }}
                                        title={`${marker.label} at ${marker.timeLabel}`}
                                      />
                                    ))}
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                    <span style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>{formatDate(session.startedAt)}</span>
                                    {timeline.hiddenErrorCount > 0 ? <span style={{ fontSize: "0.6875rem", color: "var(--danger)" }}>+{timeline.hiddenErrorCount} more errors</span> : null}
                                  </div>
                                </div>

                                {/* Meta grid */}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 10 }}>
                                  {[
                                    { k: "Install ID",  v: session.installId },
                                    { k: "Session ID",  v: session.id },
                                    { k: "Client IP",   v: session.clientIp ?? "—" },
                                    { k: "Started",     v: formatDate(session.startedAt) },
                                    { k: "Last Seen",   v: timeAgo(session.lastSeenAt) },
                                    { k: "Events",      v: String(timeline.trackedEventCount) },
                                    { k: "Error Count", v: String(session.errorCount) },
                                    { k: "Discord RPC", v: session.rpcEnabled === true ? "On" : session.rpcEnabled === false ? "Off" : "Unknown" },
                                    { k: "Discord User", v: session.discordUser?.trim() || "—" },
                                    { k: "Timezone",    v: session.clientTimezone ?? "—" },
                                    { k: "Geo Source",  v: formatGeoSource(session.clientGeoSource, session.clientGeoSignalSource) },
                                    { k: "Geo Accuracy", v: formatAccuracy(session.clientAccuracyMeters) },
                                  ].map(({ k, v }) => (
                                    <div key={k} className="glass-inset" style={{ padding: "8px 12px" }}>
                                      <p className="label-sm" style={{ marginBottom: 3 }}>{k}</p>
                                      <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem", color: "var(--text-1)", wordBreak: "break-all" }}>{v}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon"><Radio className="h-5 w-5" /></div>
              <strong>No active sessions</strong>
              <p>No sessions seen in the last 6 minutes. Check back soon.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
