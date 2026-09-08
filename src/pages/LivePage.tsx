import { TableFrame, RecordCell } from "../components/ds/TableFrame";
import { LiveStatusDot } from "../components/LiveStatusDot";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { CustomerAvatar, useCustomerProfiles } from "../components/CustomerProfiles";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Globe2,
  Radio,
  RadioTower,
  X,
} from "lucide-react";
import { GlassDropdown } from "../components/GlassDropdown";
import { KpiStatCard } from "../components/KpiStatCard";
import {
  isSessionLive,
  latestSessions,
  compareVersionsNewestFirst,
} from "../utils/monitoringDirectory";
import {
  buildSessionDirectoryOptions,
  defaultSessionSortDirection,
  filterAndSortSessions,
  type SessionDirectorySortKey,
} from "../utils/sessionDirectory";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { StatusBadge } from "../components/StatusBadge";
import { Badge, LiveBadge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { DetailGrid, SortHeader, type SortState } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SegmentedControl, type TabItem } from "../components/ds/SegmentedControl";
import type { AppSessionRecord, SummaryPayload, TelemetryEvent } from "../types/telemetry";
import {
  formatAccuracy,
  formatDate,
  formatDuration,
  formatEventName,
  formatGeoSource,
  formatNumber,
} from "../utils/format";
import { openCustomerWorkspace } from "../utils/customerNavigation";
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

const LIVE_SCOPES: TabItem<"all" | "errors">[] = [
  { key: "all", label: "All live" },
  { key: "errors", label: "With errors" },
];

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
  const parts = [session.clientCity?.trim(), session.clientRegion?.trim()].filter(
    (v): v is string => Boolean(v),
  );
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
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds))
    return formatDuration(session.durationSeconds);
  const startedAt = parseTimestamp(session.startedAt);
  const endedAt = parseTimestamp(resolveSessionEnd(session));
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt)
    return "open";
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
    .filter((e) => {
      if (!eventMatchesSession(e, session)) return false;
      const ts = parseTimestamp(e.timestamp);
      return Number.isFinite(ts) && ts >= rangeStart && ts <= rangeEnd;
    })
    .sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
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
  onFocusConsumed,
  onOpenMapSession,
}: LivePageProps) {
  const findProfile = useCustomerProfiles();
  const [now, setNow] = useState(Date.now);
  const [query, setQuery] = useWorkspaceSearch("live");
  const [version, setVersion] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [sortKey, setSortKey] = useState<SessionDirectorySortKey>("user");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  const active = useMemo(
    () =>
      [...latestSessions(summary.activeSessions.filter((s) => isSessionLive(s, now))).values()]
        .map((session) => {
          const profile = findProfile(session.installId, session.hwid);
          return profile
            ? { ...session, userLabel: profile.displayName, discordUser: profile.discordUsername }
            : session;
        })
        .sort((a, b) => displayUser(a).localeCompare(displayUser(b))),
    [summary.activeSessions, now, findProfile],
  );
  const options = useMemo(() => buildSessionDirectoryOptions(active, null, true), [active]);
  const rows = useMemo(
    () =>
      filterAndSortSessions(
        active,
        query,
        { version, country, continent: null },
        sortKey,
        sortDirection,
        true,
      ).filter((s) => !onlyErrors || s.errorCount > 0),
    [active, query, version, country, onlyErrors, sortKey, sortDirection],
  );
  const sort: SortState = { key: sortKey, direction: sortDirection };
  /** SortHeader hands back the column key; the page owns the direction toggle. */
  function changeSort(next: string) {
    const key = next as SessionDirectorySortKey;
    if (key === sortKey) setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection(defaultSessionSortDirection(key));
    }
  }
  const hasFilters = Boolean(query || version || country || onlyErrors);
  function clear() {
    setQuery("");
    setVersion(null);
    setCountry(null);
    setOnlyErrors(false);
  }
  useEffect(() => {
    if (!focusedSessionId || focusedSessionToken <= 0) return;
    clear();
    setHighlightedId(focusedSessionId);
    setExpanded(focusedSessionId);
    onFocusConsumed?.();
  }, [focusedSessionId, focusedSessionToken, onFocusConsumed]);
  useEffect(() => {
    if (!highlightedId) return;
    const row = rowRefs.current.get(highlightedId);
    row?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    row?.focus({ preventScroll: true });
  }, [highlightedId]);
  const rpcCount = rows.filter((s) => s.rpcEnabled).length;
  const errorCount = rows.filter((s) => s.errorCount > 0).length;
  return (
    <div className="page-content monitor-workspace">
      <PageHeader
        page="live"
        right={
          <span className="live-update">
            <i />
            <span>
              Updating automatically · <RelativeTime iso={summary.generatedAt} />
            </span>
          </span>
        }
      />
      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          density="compact"
          label="Online now"
          value={formatNumber(rows.length)}
          sub={hasFilters ? "Matching the current filters" : "Active in the last 6 minutes"}
          icon={<Radio />}
          tone="success"
        />
        <KpiStatCard
          density="compact"
          label="Discord RPC"
          value={formatNumber(rpcCount)}
          sub="Rich presence currently enabled"
          icon={<RadioTower />}
        />
        <KpiStatCard
          density="compact"
          label="With errors"
          value={formatNumber(errorCount)}
          sub="Live sessions reporting a failure"
          icon={<AlertTriangle />}
          tone={errorCount ? "danger" : "success"}
        />
        <KpiStatCard
          density="compact"
          label="Countries"
          value={formatNumber(new Set(rows.map((s) => s.clientCountry).filter(Boolean)).size)}
          sub="Distinct countries online"
          icon={<Globe2 />}
        />
      </div>
      <section className="monitor-surface" aria-label="Live activity">
        <div className="monitor-toolbar">
          <SegmentedControl
            aria-label="Live session filter"
            items={LIVE_SCOPES}
            value={onlyErrors ? "errors" : "all"}
            onChange={(key) => setOnlyErrors(key === "errors")}
          />
        </div>
        <div className="monitor-filter-row">
          <div className="monitor-filter">
            <GlassDropdown
              placeholder="All versions"
              options={[...options.versions].sort(compareVersionsNewestFirst)}
              value={version}
              onChange={setVersion}
              align="left"
            />
          </div>
          <div className="monitor-filter">
            <GlassDropdown
              placeholder="All countries"
              options={options.countries.map((c) => c.value)}
              renderOption={(key) => options.countries.find((c) => c.value === key)?.label ?? key}
              value={country}
              onChange={setCountry}
              align="left"
            />
          </div>
          {hasFilters && (
            <Button size="sm" icon={<X />} onClick={clear}>
              Clear filters
            </Button>
          )}
          <span className="monitor-results">
            {rows.length} live · expand a row for session details
          </span>
        </div>
        <TableFrame stickyActions mobileLayout="stack">
          <caption className="table-caption">Live sessions, sortable by column</caption>
          <thead>
            <tr>
              <SortHeader sortKey="user" label="Customer" sort={sort} onSortChange={changeSort} />
              <SortHeader
                sortKey="version"
                label="Version"
                sort={sort}
                onSortChange={changeSort}
              />
              <SortHeader
                sortKey="duration"
                label="Session time"
                sort={sort}
                onSortChange={changeSort}
                className="numeric"
              />
              <SortHeader
                sortKey="location"
                label="Location"
                sort={sort}
                onSortChange={changeSort}
              />
              <th scope="col">Status</th>
              <th scope="col" aria-label="Session actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((session) => {
              const open = expanded === session.id,
                label = displayUser(session),
                timeline = buildLiveSessionTimeline(session, summary.recentEvents);
              return (
                <Fragment key={session.id}>
                  <tr
                    ref={(el) => {
                      if (el) rowRefs.current.set(session.id, el);
                      else rowRefs.current.delete(session.id);
                    }}
                    tabIndex={-1}
                    className={highlightedId === session.id ? "row-focused" : undefined}
                  >
                    <td>
                      <button
                        className="person-cell"
                        onClick={() => setExpanded(open ? null : session.id)}
                        aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} session details for ${label}`}
                      >
                        <CustomerAvatar
                          profile={findProfile(session.installId, session.hwid)}
                          label={label}
                        />
                        <span>
                          <strong title={label}>{label}</strong>
                          <small>
                            {session.discordUser
                              ? `@${session.discordUser.replace(/^@/, "")}`
                              : displayLocation(session)}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td data-label="Version">
                      {session.displayVersion || session.appVersion || "Unknown"}
                    </td>
                    <td className="numeric" data-label="Session time">
                      {resolveSessionDuration(session)}
                    </td>
                    <td data-label="Location">{displayLocation(session)}</td>
                    <td data-label="Status">
                      <div className="live-session-status">
                        <LiveStatusDot />
                        <RecordCell
                          primary="Online"
                          secondary={
                            session.errorCount
                              ? session.errorCount + " errors"
                              : session.rpcEnabled
                                ? "Discord RPC on"
                                : "No errors"
                          }
                        />
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        {resolveCountry(session.clientCountry) && (
                          <IconButton
                            icon={<Globe2 />}
                            title="View on map"
                            aria-label={`View ${label} on map`}
                            onClick={() => onOpenMapSession(session.id)}
                          />
                        )}
                        <IconButton
                          icon={open ? <ChevronUp /> : <ChevronDown />}
                          aria-expanded={open}
                          aria-label={`${open ? "Hide" : "Show"} session details for ${label}`}
                          onClick={() => setExpanded(open ? null : session.id)}
                        />
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} className="live-detail-cell">
                        <div className="live-record-detail">
                          <div className="history-detail-head">
                            <div>
                              <Activity />
                              <strong>Current session</strong>
                            </div>
                            <Button
                              permission="customers.read"
                              size="sm"
                              variant="accent"
                              icon={<ArrowUpRight />}
                              onClick={() =>
                                openCustomerWorkspace({
                                  selector: "session_id",
                                  value: session.id,
                                })
                              }
                            >
                              Customer workspace
                            </Button>
                          </div>
                          <div className="detail-facts">
                            <div>
                              <span>Started</span>
                              <strong>{formatDate(session.startedAt)}</strong>
                            </div>
                            <div>
                              <span>Last seen</span>
                              <strong>
                                <RelativeTime iso={session.lastSeenAt} />
                              </strong>
                            </div>
                            <div>
                              <span>Latest event</span>
                              <strong>
                                {session.lastEvent ? formatEventName(session.lastEvent) : "None"}
                              </strong>
                            </div>
                            <div>
                              <span>Device</span>
                              <strong>
                                {session.deviceModel ||
                                  session.osVersion ||
                                  session.platform ||
                                  "Unknown"}
                              </strong>
                            </div>
                          </div>
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
                          <div className="live-timeline-caption">
                            <span>{formatDate(session.startedAt)}</span>
                            <span>
                              {timeline.hiddenErrorCount > 0
                                ? `${timeline.hiddenErrorCount} additional errors`
                                : "Now"}
                            </span>
                          </div>
                          <details className="history-device-details">
                            <summary>Connection & device details</summary>
                            <DetailGrid
                              items={[
                                { k: "Install ID", v: session.installId },
                                { k: "Session ID", v: session.id },
                                { k: "Hardware ID", v: session.hwid || "Not reported" },
                                { k: "Client IP", v: session.clientIp || "Unknown" },
                                { k: "Timezone", v: session.clientTimezone || "Unknown" },
                                {
                                  k: "Geo source",
                                  v: formatGeoSource(
                                    session.clientGeoSource,
                                    session.clientGeoSignalSource,
                                  ),
                                },
                                { k: "Accuracy", v: formatAccuracy(session.clientAccuracyMeters) },
                              ]}
                            />
                          </details>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </TableFrame>
        {rows.length === 0 && (
          <EmptyState
            icon={<Radio />}
            title={hasFilters ? "No matching live sessions" : "All quiet"}
            action={
              hasFilters ? (
                <Button icon={<X />} onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {hasFilters
              ? "Nothing matches the current search and filters."
              : "New sessions appear automatically."}
          </EmptyState>
        )}
      </section>
    </div>
  );
}
