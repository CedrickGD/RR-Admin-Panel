import { ChevronDown, ChevronUp, Download, Globe2, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { type SessionPresence, StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent } from "../types/telemetry";
import { downloadSessionExport } from "../utils/api";
import { formatAccuracy, formatDate, formatDuration, formatEventName, formatGeoSource, formatNumber, timeAgo } from "../utils/format";
import { resolveCountry } from "../utils/geography";

interface WorkersPageProps {
  summary: SummaryPayload;
  onOpenMapSession: (sessionId: string) => void;
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
  const hwid = session.hwid?.trim();
  if (hwid) return hwid.toLowerCase();
  return session.installId.trim().toLowerCase();
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
  const startedAt = Date.parse(session.startedAt);
  const endedAt   = Date.parse(resolveSessionEnd(session));
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return "open";
  return formatDuration((endedAt - startedAt) / 1000);
}

function buildLocationLabel(session: AppSessionRecord): string {
  return [session.clientCity, session.clientRegion, session.clientCountry].filter((v): v is string => Boolean(v?.trim())).join(", ");
}

/** Derive a human-meaningful presence from session state */
function resolvePresence(session: AppSessionRecord): SessionPresence {
  // Ended / uninstalled → unreachable (red)
  const lastEvent = session.lastEvent?.toLowerCase() ?? "";
  if (lastEvent === "app_uninstall" || lastEvent === "uninstall") return "unreachable";
  if (session.endedAt && !session.isActive) return "ended";

  // Active but stale (no heartbeat for 5+ min) → idle
  if (session.isActive) {
    const lastSeen = Date.parse(session.lastSeenAt);
    const staleThreshold = 5 * 60 * 1000;
    if (Number.isFinite(lastSeen) && Date.now() - lastSeen > staleThreshold) return "idle";
    return "online";
  }

  // Fallback based on legacy status
  if (session.lastStatus === "down") return "unreachable";
  if (session.lastStatus === "degraded") return "idle";
  return "ended";
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

function buildSessionTimeline(session: AppSessionRecord, recentEvents: TelemetryEvent[]): SessionTimelineData {
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
  const errorEvents   = relevantEvents.filter((e) => e.service === APP_ERROR);
  const visibleErrors = errorEvents.slice(-MAX_TIMELINE_MARKERS);
  const duration = hasRange ? Math.max(1, rangeEnd - rangeStart) : 1;
  const markers = visibleErrors.map((event, i) => {
    const ts = parseTimestamp(event.timestamp);
    const rawPos = hasRange ? ((ts - rangeStart) / duration) * 100 : 50;
    return {
      id: `${event.id}-${i}`,
      label: String(event.metrics["exception_type"] ?? event.message ?? "Error"),
      timestamp: event.timestamp,
      position: Math.max(3, Math.min(97, rawPos)),
    };
  });
  return {
    trackedEventCount: relevantEvents.length,
    visibleErrorCount: markers.length,
    hiddenErrorCount: Math.max(0, session.errorCount - markers.length),
    markers,
  };
}

export function WorkersPage({ summary, onOpenMapSession }: WorkersPageProps) {
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<string[]>([]);

  const sessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? summary.recentSessions
      : summary.recentSessions.filter((s) => {
          const hay = [displayUser(s), s.installId, s.clientIp ?? "", s.clientCountry ?? "", s.appVersion ?? "", s.platform ?? "", s.lastEvent ?? ""].join(" ").toLowerCase();
          return hay.includes(q);
        });
    const seen = new Set<string>();
    return [...filtered].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)).filter((s) => {
      const id = userIdentity(s);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [query, summary.recentSessions]);

  const activeInResults   = sessions.filter((s) => s.isActive).length;
  const resultsWithErrors = sessions.filter((s) => s.errorCount > 0).length;
  const endedCount        = sessions.filter((s) => !s.isActive && s.endedAt).length;
  const unreachableCount  = sessions.filter((s) => resolvePresence(s) === "unreachable").length;

  const sessionTimelines = useMemo(() => {
    const map = new Map<string, SessionTimelineData>();
    for (const session of sessions) map.set(userIdentity(session), buildSessionTimeline(session, summary.recentEvents));
    return map;
  }, [sessions, summary.recentEvents]);

  function toggleExpanded(identity: string) {
    setExpandedUsers((curr) => curr.includes(identity) ? curr.filter((id) => id !== identity) : [...curr, identity]);
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try { await downloadSessionExport(); }
    catch (err) { setExportError(err instanceof Error ? err.message : "Failed to download."); }
    finally { setExporting(false); }
  }

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header" style={{ flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
          <div>
            <h1 className="page-title">
              Sessions
              <span className="kicker">Session Archive</span>
            </h1>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleExport()} disabled={exporting}>
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Preparing…" : "Export TXT"}
          </button>
        </div>
      </section>

      {/* Stat cards */}
      <div className="stat-grid">
        {[
          { label: "Total Users",   value: formatNumber(sessions.length), sub: "Unique users loaded", tone: "" },
          { label: "Online",        value: formatNumber(activeInResults),  sub: "Active right now",    tone: activeInResults > 0 ? "tone-success" : "" },
          { label: "Ended",         value: formatNumber(endedCount),       sub: "Sessions closed",     tone: "" },
          { label: "Unreachable",   value: formatNumber(unreachableCount), sub: "Lost or uninstalled", tone: unreachableCount > 0 ? "tone-danger" : "" },
          { label: "With Errors",   value: formatNumber(resultsWithErrors), sub: "At least 1 error",  tone: resultsWithErrors > 0 ? "tone-warning" : "tone-success" },
          { label: "Avg Duration",  value: formatDuration(summary.stats.averageSessionDurationSeconds), sub: "Per session", tone: "" },
        ].map((s) => (
          <div className={`stat-card ${s.tone}`} key={s.label}>
            <span className="stat-label">{s.label}</span>
            <strong className="stat-value" style={{ fontSize: "1.5rem" }}>{s.value}</strong>
            <p className="stat-sub">{s.sub}</p>
          </div>
        ))}
      </div>

      {exportError ? (
        <div style={{ background: "var(--danger-sub)", border: "1px solid hsl(4 86% 58% / 0.25)", borderRadius: 10, padding: "10px 14px", fontSize: "0.8125rem", color: "hsl(4 86% 72%)" }}>
          {exportError}
        </div>
      ) : null}

      {/* Table */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker">Directory</p>
            <h2 className="section-title">Latest User Sessions</h2>
            <p className="section-sub">Most recent session per unique user. Expand for full timeline detail.</p>
          </div>
          <div className="panel-head-right">
            <div className="search-wrap" style={{ width: "min(280px,100%)" }}>
              <Search className="search-icon h-3.5 w-3.5" />
              <input type="search" className="glass-input" placeholder="Search user, IP, version…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="panel-body-flush">
          {sessions.length > 0 ? (
            <div className="data-table-wrap" style={{ borderRadius: 0, border: "none" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Location</th>
                    <th>Version</th>
                    <th>Platform</th>
                    <th>Duration</th>
                    <th>Last Seen</th>
                    <th>Errors</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const identity  = userIdentity(session);
                    const isExpanded = expandedUsers.includes(identity);
                    const timeline   = sessionTimelines.get(identity);

                    return (
                      <Fragment key={identity}>
                        <tr className={isExpanded ? "row-expanded" : ""}>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: "0.8125rem" }}>{displayUser(session)}</span>
                          </td>
                          <td className="muted" style={{ whiteSpace: "nowrap" }}>{buildLocationLabel(session) || "—"}</td>
                          <td><span className="badge badge-muted">{session.appVersion ?? "—"}</span></td>
                          <td className="muted">{session.platform ?? "—"}</td>
                          <td className="muted">{resolveSessionDuration(session)}</td>
                          <td className="muted">{timeAgo(session.lastSeenAt)}</td>
                          <td>
                            {session.errorCount > 0
                              ? <span className="badge badge-warning">{session.errorCount}</span>
                              : <span className="badge badge-success">0</span>
                            }
                          </td>
                          <td><StatusBadge presence={resolvePresence(session)} /></td>
                          <td>
                            <div style={{ display: "flex", gap: 4 }}>
                              {resolveCountry(session.clientCountry) !== null ? (
                                <button type="button" className="btn-icon" style={{ padding: 4 }} title="View on map" onClick={() => onOpenMapSession(session.id)}>
                                  <Globe2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                              <button type="button" className="btn-icon" style={{ padding: 4 }} onClick={() => toggleExpanded(identity)} aria-label={isExpanded ? "Collapse" : "Expand"}>
                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && timeline ? (
                          <tr>
                            <td colSpan={9} className="row-expand-panel">
                              <div className="row-expand-inner">
                                {timeline.markers.length > 0 ? (
                                  <div style={{ marginBottom: 14 }}>
                                    <p className="label-sm" style={{ marginBottom: 8 }}>Error Timeline</p>
                                    <div className="timeline-track">
                                      <div className="timeline-fill" style={{ width: "100%" }} />
                                      {timeline.markers.map((marker) => (
                                        <div key={marker.id} className="timeline-marker is-error" style={{ left: `${marker.position}%` }} title={marker.label} />
                                      ))}
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                      <span style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>{formatDate(session.startedAt)}</span>
                                      {timeline.hiddenErrorCount > 0 ? <span style={{ fontSize: "0.6875rem", color: "var(--danger)" }}>+{timeline.hiddenErrorCount} more</span> : null}
                                    </div>
                                  </div>
                                ) : null}

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 10 }}>
                                  {[
                                    { k: "Install ID",  v: session.installId },
                                    { k: "Session ID",  v: session.id },
                                    { k: "Client IP",   v: session.clientIp ?? "—" },
                                    { k: "Started",     v: formatDate(session.startedAt) },
                                    { k: "Last Seen",   v: timeAgo(session.lastSeenAt) },
                                    { k: "Events",      v: String(timeline.trackedEventCount) },
                                    { k: "Timezone",    v: session.clientTimezone ?? "—" },
                                    { k: "Geo Source",  v: formatGeoSource(session.clientGeoSource, session.clientGeoSignalSource) },
                                    { k: "Geo Accuracy", v: formatAccuracy(session.clientAccuracyMeters) },
                                    { k: "Last Event",  v: session.lastEvent ? formatEventName(session.lastEvent) : "—" },
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
              <strong>{query ? "No sessions match your search." : "No sessions recorded yet."}</strong>
              <p>{query ? "Try a different search term." : "Sessions will appear as telemetry arrives."}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
