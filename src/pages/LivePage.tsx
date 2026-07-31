import { ChevronDown, ChevronUp, Globe2, Radio } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { StatusBadge } from "../components/StatusBadge";
import { Badge, LiveBadge } from "../components/ds/Badge";
import { IconButton } from "../components/ds/Button";
import { DetailGrid } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent } from "../types/telemetry";
import { formatAccuracy, formatDate, formatDuration, formatEventName, formatGeoSource, formatNumber, timeAgo } from "../utils/format";
import { resolveCountry } from "../utils/geography";
import { prefersReducedMotion } from "../utils/motion";

interface LivePageProps {
  summary: SummaryPayload;
  focusedSessionId?: string | null;
  focusedSessionToken?: number;
  /** One-shot handshake: after the scroll+highlight lands, App clears the focus state. */
  onFocusConsumed?: () => void;
  onOpenMapSession: (sessionId: string) => void;
  filterBar?: ReactNode;
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

export function LivePage({ summary, focusedSessionId = null, focusedSessionToken = 0, onFocusConsumed, onOpenMapSession, filterBar }: LivePageProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  // Local highlight copy — lives only while this page is mounted, so revisiting
  // the page later never re-scrolls / re-highlights a long-dismissed session.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  useEffect(() => {
    // 5s tick, not 1s: `now` only drives the 6-minute liveness cutoff and
    // "Xm ago" labels, and a full table re-render every second caused visible
    // scroll jank on longer session lists.
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
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
    setHighlightedId(focusedSessionId);
    onFocusConsumed?.();
    const row = rowRefs.current.get(focusedSessionId);
    if (!row) return;
    const frameId = window.requestAnimationFrame(() => {
      row.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      row.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [focusedSessionId, focusedSessionToken, onFocusConsumed]);

  function toggleExpanded(sessionId: string) {
    setExpandedSessionIds((curr) => curr.includes(sessionId) ? curr.filter((id) => id !== sessionId) : [...curr, sessionId]);
  }

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <PageHeader
        kicker="Realtime"
        title="Live Sessions"
        sub="Active sessions from the last 6 minutes. Rows hold stable order while you read."
        right={<>
          {filterBar}
          <LiveBadge>{formatNumber(activeSessions.length)} live</LiveBadge>
          <Badge
            tone={rpcLive > 0 ? "accent" : "muted"}
            title={rpcReported
              ? `${formatNumber(rpcLive)} active sessions report Discord Rich Presence on`
              : "No active session reports the RPC field yet"}
          >
            Discord RPC · {rpcReported ? formatNumber(rpcLive) : "—"}
          </Badge>
          <MetaRow items={[
            { label: "Live Errors", value: formatNumber(liveErrors) },
            { label: "Last Ingest", value: summary.stats.lastIngestAt ? timeAgo(summary.stats.lastIngestAt) : "Waiting" },
            { label: "Updated",     value: timeAgo(summary.generatedAt) },
          ]} />
        </>}
      />

      {/* Sessions table */}
      <CollapsiblePanel
        collapsible={false}
        kicker="Active"
        title="Open Sessions"
        sub="Showing sessions active within the last 6 minutes."
        padding="flush"
        right={<>
          <LiveBadge>{activeSessions.length}</LiveBadge>
          {liveErrors > 0 ? <Badge tone="danger">{liveErrors} errors</Badge> : null}
        </>}
      >
        {activeSessions.length > 0 ? (
          <div className="data-table-wrap">
            <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Location</th>
                    <th>Version</th>
                    <th className="col-lg">Platform</th>
                    <th>Duration</th>
                    <th className="col-xl">Last Event</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.map((session) => {
                    const isExpanded = expandedSessionIds.includes(session.id);
                    const isFocused  = session.id === highlightedId;
                    const timeline   = sessionTimelines.get(session.id);
                    const canMap     = resolveCountry(session.clientCountry) !== null;

                    return (
                      <Fragment key={session.id}>
                        <tr
                          ref={(el) => { if (el) rowRefs.current.set(session.id, el); else rowRefs.current.delete(session.id); }}
                          tabIndex={0}
                          className={[isExpanded ? "row-expanded" : "", isFocused ? "row-focused" : ""].join(" ").trim() || undefined}
                        >
                          <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.8125rem" }}>
                                {displayUser(session)}
                              </span>
                              {session.discordUser?.trim() ? (
                                <span style={{ fontSize: "0.6875rem", color: "var(--text-2)" }} title={`Discord: ${session.discordUser.trim()}`}>
                                  @{session.discordUser.trim()}
                                </span>
                              ) : null}
                              {session.rpcEnabled === true ? (
                                <Badge tone="accent" title="Discord Rich Presence on">RPC</Badge>
                              ) : null}
                            </span>
                          </td>
                          <td className="muted" style={{ maxWidth: 190, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={displayLocation(session)}>{displayLocation(session)}</td>
                          <td><Badge tone="muted">{session.displayVersion ?? session.appVersion ?? "—"}</Badge></td>
                          <td className="muted col-lg">{session.platform ?? "—"}</td>
                          <td className="muted">{resolveSessionDuration(session)}</td>
                          <td className="col-xl">
                            <span style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                              {session.lastEvent ? formatEventName(session.lastEvent) : "—"}
                            </span>
                          </td>
                          <td><StatusBadge status={session.lastStatus ?? "unknown"} /></td>
                          <td>
                            <span style={{ display: "inline-flex", gap: 4 }}>
                              {canMap ? (
                                <IconButton icon={<Globe2 />} title="View on map" onClick={() => onOpenMapSession(session.id)} />
                              ) : null}
                              <IconButton
                                icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                                title={isExpanded ? "Collapse" : "Expand"}
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                                onClick={() => toggleExpanded(session.id)}
                              />
                            </span>
                          </td>
                        </tr>

                        {isExpanded && timeline ? (
                          <tr>
                            <td colSpan={8} className="row-expand-panel">
                              <div className="row-expand-content">
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
                                <DetailGrid items={[
                                  { k: "Install ID",   v: session.installId },
                                  { k: "Session ID",   v: session.id },
                                  { k: "Client IP",    v: session.clientIp ?? "—" },
                                  { k: "Hardware ID",  v: session.hwid ?? "—" },
                                  { k: "Started",      v: formatDate(session.startedAt) },
                                  { k: "Last Seen",    v: timeAgo(session.lastSeenAt) },
                                  { k: "Events",       v: String(timeline.trackedEventCount) },
                                  { k: "Error Count",  v: String(session.errorCount) },
                                  { k: "Discord RPC",  v: session.rpcEnabled === true ? "On" : session.rpcEnabled === false ? "Off" : "Unknown" },
                                  { k: "Discord User", v: session.discordUser?.trim() || "—" },
                                  { k: "Timezone",     v: session.clientTimezone ?? "—" },
                                  { k: "Geo Source",   v: formatGeoSource(session.clientGeoSource, session.clientGeoSignalSource) },
                                  { k: "Geo Accuracy", v: formatAccuracy(session.clientAccuracyMeters) },
                                ]} />

                                {/* Licenses grid */}
                                {session.licenses && session.licenses.length > 0 && (
                                  <div style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                                    <p className="label-sm" style={{ marginBottom: 12, color: "var(--accent)" }}>Bound Licenses ({session.licenses.length})</p>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                                      {session.licenses.map(lic => (
                                        <div key={lic.license_key} style={{ background: "var(--bg-card)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
                                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                            <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "0.875rem", color: lic.max_uses > 1 ? "var(--accent)" : "var(--text)" }}>{lic.license_key}</span>
                                            <Badge tone={lic.status === "active" ? "success" : lic.status === "revoked" ? "danger" : "warning"}>{lic.status.toUpperCase()}</Badge>
                                          </div>
                                          <DetailGrid items={[
                                            { k: "Type", v: lic.type === "lifetime" ? "Lifetime" : `${lic.duration_days} Days` },
                                            { k: "Uses", v: lic.max_uses === -1 ? `${lic.usage_count} / Infinite` : `${lic.usage_count} / ${lic.max_uses}` },
                                            { k: "Expires", v: lic.expires_at ? formatDate(lic.expires_at) : "Never" },
                                            { k: "Created", v: formatDate(lic.created_at) }
                                          ]} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
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
          <EmptyState icon={<Radio />} title="All quiet">
            No sessions seen in the last 6 minutes. New sessions surface here within seconds of ingest.
          </EmptyState>
        )}
      </CollapsiblePanel>
    </div>
  );
}
