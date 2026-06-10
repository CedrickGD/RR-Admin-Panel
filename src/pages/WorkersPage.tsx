import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  Globe2,
  RadioTower,
  Search,
  Users as UsersIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { type KpiDrilldown, KpiStatCard } from "../components/KpiStatCard";
import { type SessionPresence, StatusBadge } from "../components/StatusBadge";
import type { AppSessionRecord, StatsPayload, SummaryPayload, TelemetryEvent, UserRollupRecord } from "../types/telemetry";
import { downloadSessionExport } from "../utils/api";
import { formatAccuracy, formatDate, formatDuration, formatEventName, formatGeoSource, formatNumber, timeAgo } from "../utils/format";
import { resolveCountry } from "../utils/geography";

interface WorkersPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  users: UserRollupRecord[] | null;
  onOpenMapSession: (sessionId: string) => void;
}

type TabKey = "users" | "sessions";
type SortKey = "lastSeen" | "firstSeen" | "sessions" | "totalTime" | "errors";
type SortDir = "asc" | "desc";

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
const SKELETON_ROWS = 8;
const USER_COLUMN_COUNT = 11;

/* ── shared helpers ─────────────────────────────────────────── */

function versionLabel(version: string | null): string {
  if (!version?.trim()) return "—";
  return version === "legacy" ? "Legacy (pre-1.4)" : version;
}

function parseTimestamp(value: string | null | undefined): number {
  const ts = Date.parse(value ?? "");
  return Number.isFinite(ts) ? ts : Number.NaN;
}

function formatDateOnly(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleDateString();
}

/* ── users tab helpers ──────────────────────────────────────── */

function userDisplayName(user: UserRollupRecord): string {
  return user.userLabel?.trim() || user.identity;
}

function userLocation(user: UserRollupRecord): string {
  return [user.city, user.country].filter((v): v is string => Boolean(v?.trim())).join(", ");
}

function userSortValue(user: UserRollupRecord, key: SortKey): number {
  switch (key) {
    case "lastSeen": {
      const ts = parseTimestamp(user.lastSeen);
      return Number.isFinite(ts) ? ts : 0;
    }
    case "firstSeen": {
      const ts = parseTimestamp(user.firstSeen);
      return Number.isFinite(ts) ? ts : 0;
    }
    case "sessions":  return user.sessions;
    case "totalTime": return user.totalDurationSeconds;
    case "errors":    return user.errors;
  }
}

/* ── sessions tab helpers (preserved behaviour) ─────────────── */

function displaySessionUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function resolveSessionEnd(session: AppSessionRecord): string {
  return session.endedAt ?? session.lastSeenAt;
}

function resolveSessionDuration(session: AppSessionRecord): string {
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds)) return formatDuration(session.durationSeconds);
  const startedAt = Date.parse(session.startedAt);
  const endedAt   = Date.parse(resolveSessionEnd(session));
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return "open";
  return formatDuration((endedAt - startedAt) / 1000);
}

function buildSessionLocationLabel(session: AppSessionRecord): string {
  return [session.clientCity, session.clientRegion, session.clientCountry].filter((v): v is string => Boolean(v?.trim())).join(", ");
}

/** Derive a human-meaningful presence from session state */
function resolvePresence(session: AppSessionRecord): SessionPresence {
  const lastEvent = session.lastEvent?.toLowerCase() ?? "";
  if (lastEvent === "app_uninstall" || lastEvent === "uninstall") return "unreachable";
  if (session.endedAt && !session.isActive) return "ended";

  if (session.isActive) {
    const lastSeen = Date.parse(session.lastSeenAt);
    const staleThreshold = 5 * 60 * 1000;
    if (Number.isFinite(lastSeen) && Date.now() - lastSeen > staleThreshold) return "idle";
    return "online";
  }

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

/* ── small presentational pieces ────────────────────────────── */

function RpcBadge({ rpcEnabled }: { rpcEnabled: boolean | null }) {
  if (rpcEnabled === true)  return <span className="badge badge-success">On</span>;
  if (rpcEnabled === false) return <span className="badge badge-muted">Off</span>;
  return (
    <span className="badge badge-muted" style={{ opacity: 0.55 }} title="Not reported yet — RPC telemetry is a newer field">
      —
    </span>
  );
}

interface SortableThProps {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}

function SortableTh({ label, sortKey, activeKey, dir, onSort }: SortableThProps) {
  const isActive = activeKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {isActive
          ? dir === "asc"
            ? <ArrowUp className="h-3 w-3" style={{ color: "var(--accent)" }} />
            : <ArrowDown className="h-3 w-3" style={{ color: "var(--accent)" }} />
          : null}
      </span>
    </th>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <tr key={`skeleton-${row}`}>
          {Array.from({ length: USER_COLUMN_COUNT }, (_, col) => (
            <td key={col}>
              <div className="skeleton" style={{ height: 12, width: col === 0 ? 120 : 48 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ── page ───────────────────────────────────────────────────── */

export function WorkersPage({ summary, stats, users, onOpenMapSession }: WorkersPageProps) {
  const [tab, setTab] = useState<TabKey>("users");

  // Users tab state
  const [userQuery, setUserQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastSeen");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedUsers, setExpandedUsers] = useState<string[]>([]);

  // Sessions tab state
  const [sessionQuery, setSessionQuery] = useState("");
  const [expandedSessions, setExpandedSessions] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  /* ── users derivations (rollup-backed; never the 200-row window) ── */

  const filteredUsers = useMemo(() => {
    if (!users) return null;
    const q = userQuery.trim().toLowerCase();
    const filtered = !q
      ? users
      : users.filter((u) => {
          const hay = [
            u.userLabel ?? "",
            u.identity,
            u.displayVersion ?? "",
            u.appVersion ?? "",
            u.country ?? "",
            u.city ?? "",
            u.platform ?? "",
          ].join(" ").toLowerCase();
          return hay.includes(q);
        });
    const factor = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (userSortValue(a, sortKey) - userSortValue(b, sortKey)) * factor);
  }, [users, userQuery, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function toggleUserExpanded(identity: string) {
    setExpandedUsers((curr) => curr.includes(identity) ? curr.filter((id) => id !== identity) : [...curr, identity]);
  }

  /* ── header KPI values (stats/rollup driven, summary fallback) ── */

  const totalUsersValue = users ? users.length : stats ? stats.totals.lifetimeUsers : summary.stats.lifetimeUsers;
  const activeNowValue  = stats ? stats.totals.activeNow : summary.stats.activeUsers;

  const totalUsersDrill: KpiDrilldown | null = useMemo(() => {
    if (!stats) return null;
    const lifetime = stats.totals.lifetimeUsers;
    return {
      timespans: [
        { label: "In range",     value: formatNumber(stats.totals.usersInRange) },
        { label: "New in range", value: formatNumber(stats.totals.newUsersInRange) },
        { label: "Lifetime",     value: formatNumber(lifetime) },
      ],
      series: stats.series.newUsersPerDay.map((p) => ({ day: p.day, value: p.users })),
      seriesName: "New users",
      breakdown: stats.breakdowns.versionsCurrent.slice(0, 6).map((v) => ({
        label: versionLabel(v.version),
        value: formatNumber(v.users),
        share: lifetime > 0 ? v.users / lifetime : undefined,
      })),
      breakdownTitle: "Current version split",
    };
  }, [stats]);

  const rpcDrill: KpiDrilldown | null = useMemo(() => {
    if (!stats) return null;
    const { rpcEnabledUsers, rpcKnownUsers, rpcLiveNow, lifetimeUsers } = stats.totals;
    const unknown = Math.max(0, lifetimeUsers - rpcKnownUsers);
    return {
      breakdown: [
        { label: "On",                 value: formatNumber(rpcEnabledUsers), share: lifetimeUsers > 0 ? rpcEnabledUsers / lifetimeUsers : undefined },
        { label: "Off",                value: formatNumber(Math.max(0, rpcKnownUsers - rpcEnabledUsers)), share: lifetimeUsers > 0 ? Math.max(0, rpcKnownUsers - rpcEnabledUsers) / lifetimeUsers : undefined },
        { label: "Unknown (no report yet)", value: formatNumber(unknown), share: lifetimeUsers > 0 ? unknown / lifetimeUsers : undefined },
      ],
      breakdownTitle: "RPC adoption",
      note: `${formatNumber(rpcLiveNow)} live right now. RPC telemetry is a newer field — older clients have not reported it yet.`,
    };
  }, [stats]);

  const errorsDrill: KpiDrilldown | null = useMemo(() => {
    if (!stats) return null;
    return {
      series: stats.series.errorsPerDay.map((p) => ({ day: p.day, value: p.errors })),
      seriesName: "Errors",
      note: "Errors recorded inside the selected range and filters.",
    };
  }, [stats]);

  /* ── sessions derivations (preserved recent-sessions view) ── */

  const sessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    const base = summary.recentSessions.filter((s) => !s.id.startsWith("install:"));
    // One row per user: keep only each user's most recent session so the list
    // isn't flooded with duplicates from people who relaunch often.
    const latestPerUser = new Map<string, (typeof base)[number]>();
    for (const session of base) {
      const identity = (session.hwid ?? session.installId).trim().toLowerCase();
      const existing = latestPerUser.get(identity);
      if (!existing || Date.parse(session.lastSeenAt) > Date.parse(existing.lastSeenAt)) {
        latestPerUser.set(identity, session);
      }
    }
    const deduped = [...latestPerUser.values()];
    const filtered = !q
      ? deduped
      : deduped.filter((s) => {
          const hay = [displaySessionUser(s), s.installId, s.clientIp ?? "", s.clientCountry ?? "", s.appVersion ?? "", s.platform ?? "", s.lastEvent ?? ""].join(" ").toLowerCase();
          return hay.includes(q);
        });
    return filtered.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  }, [sessionQuery, summary.recentSessions]);

  const sessionTimelines = useMemo(() => {
    const map = new Map<string, SessionTimelineData>();
    for (const session of sessions) map.set(session.id, buildSessionTimeline(session, summary.recentEvents));
    return map;
  }, [sessions, summary.recentEvents]);

  function toggleSessionExpanded(sessionId: string) {
    setExpandedSessions((curr) => curr.includes(sessionId) ? curr.filter((id) => id !== sessionId) : [...curr, sessionId]);
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
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Users
            <span className="kicker">Directory</span>
          </h1>
          <p className="page-subtitle">
            Every user ever seen, rolled up across the full session history.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="seg-control">
            {([
              { key: "users",    label: "Users" },
              { key: "sessions", label: "Sessions" },
            ] as Array<{ key: TabKey; label: string }>).map((t) => (
              <button
                key={t.key}
                type="button"
                className={`seg-btn${tab === t.key ? " active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "sessions" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleExport()} disabled={exporting}>
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Preparing…" : "Export TXT"}
            </button>
          ) : null}
        </div>
      </section>

      {/* Headline KPIs */}
      <div className="stat-grid">
        <KpiStatCard
          label="Total Users"
          value={formatNumber(totalUsersValue)}
          sub={stats ? `${formatNumber(stats.totals.lifetimeUsers)} lifetime · ${formatNumber(stats.totals.newUsersInRange)} new in range` : "Lifetime unique users"}
          icon={<UsersIcon className="h-4 w-4" />}
          tone="primary"
          drilldown={totalUsersDrill}
        />
        <KpiStatCard
          label="Active Now"
          value={formatNumber(activeNowValue)}
          sub="Sessions live right now"
          tone="accent"
          icon={<Activity className="h-4 w-4" />}
        />
        <KpiStatCard
          label="RPC On"
          value={stats ? formatNumber(stats.totals.rpcEnabledUsers) : "—"}
          sub={stats ? `of ${formatNumber(stats.totals.rpcKnownUsers)} reporting · ${formatNumber(stats.totals.rpcLiveNow)} live now` : "Waiting for stats…"}
          icon={<RadioTower className="h-4 w-4" />}
          tone="amber"
          drilldown={rpcDrill}
        />
        <KpiStatCard
          label="Errors in Range"
          value={stats ? formatNumber(stats.totals.errorsInRange) : formatNumber(summary.stats.errorsLast24Hours)}
          sub={stats ? "Within selected range" : "Last 24 hours (fallback)"}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="rose"
          drilldown={errorsDrill}
        />
      </div>

      {exportError ? (
        <div style={{ background: "var(--danger-sub)", border: "1px solid hsl(4 86% 58% / 0.25)", borderRadius: 10, padding: "10px 14px", fontSize: "0.8125rem", color: "hsl(4 86% 72%)" }}>
          {exportError}
        </div>
      ) : null}

      {tab === "users" ? (
        /* ════════════════ USERS TAB ════════════════ */
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Directory</p>
              <h2 className="section-title">All Users</h2>
              <p className="section-sub">
                {filteredUsers
                  ? `${formatNumber(filteredUsers.length)} of ${formatNumber(users?.length ?? 0)} users · full history rollup`
                  : "Loading user rollup…"}
              </p>
            </div>
            <div className="panel-head-right">
              <div className="search-wrap" style={{ width: "min(280px,100%)" }}>
                <Search className="search-icon h-3.5 w-3.5" />
                <input
                  type="search"
                  className="glass-input"
                  placeholder="Search user, version, country…"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="panel-body-flush">
            {filteredUsers === null || filteredUsers.length > 0 ? (
              <div className="data-table-wrap" style={{ borderRadius: 0, border: "none" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Version</th>
                      <th>Platform</th>
                      <th>Location</th>
                      <th>RPC</th>
                      <SortableTh label="Sessions"   sortKey="sessions"  activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Total Time" sortKey="totalTime" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Errors"     sortKey="errors"    activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Last Seen"  sortKey="lastSeen"  activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="First Seen" sortKey="firstSeen" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers === null ? (
                      <SkeletonRows />
                    ) : (
                      filteredUsers.map((user) => {
                        const isExpanded = expandedUsers.includes(user.identity);
                        const features = Object.entries(user.features).sort((a, b) => b[1] - a[1]);

                        return (
                          <Fragment key={user.identity}>
                            <tr
                              className={isExpanded ? "row-expanded" : ""}
                              onClick={() => toggleUserExpanded(user.identity)}
                              style={{ cursor: "pointer" }}
                            >
                              <td style={{ whiteSpace: "nowrap" }}>
                                <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: "0.8125rem" }}>{userDisplayName(user)}</span>
                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.6875rem", color: "var(--text-3)", marginLeft: 8 }}>
                                  {user.identity.slice(0, 8)}
                                </span>
                              </td>
                              <td>
                                <span className="badge badge-muted" title={user.appVersion ?? undefined}>
                                  {versionLabel(user.displayVersion ?? user.appVersion)}
                                </span>
                              </td>
                              <td className="muted">{user.platform ?? "—"}</td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>{userLocation(user) || "—"}</td>
                              <td><RpcBadge rpcEnabled={user.rpcEnabled} /></td>
                              <td className="muted">{formatNumber(user.sessions)}</td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>{user.totalDurationSeconds > 0 ? formatDuration(user.totalDurationSeconds) : "—"}</td>
                              <td>
                                {user.errors > 0
                                  ? <span className="badge badge-danger">{formatNumber(user.errors)}</span>
                                  : <span className="badge badge-muted">0</span>}
                              </td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  {user.isActive ? <span className="status-dot pulse" /> : null}
                                  {timeAgo(user.lastSeen)}
                                </span>
                              </td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateOnly(user.firstSeen)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  style={{ padding: 4 }}
                                  onClick={(e) => { e.stopPropagation(); toggleUserExpanded(user.identity); }}
                                  aria-label={isExpanded ? "Collapse" : "Expand"}
                                >
                                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                              </td>
                            </tr>

                            {isExpanded ? (
                              <tr>
                                <td colSpan={USER_COLUMN_COUNT} className="row-expand-panel">
                                  <div className="row-expand-inner">
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
                                      {[
                                        { k: "Identity",     v: user.identity },
                                        { k: "Device Model", v: user.deviceModel ?? "—" },
                                        { k: "OS Version",   v: user.osVersion ?? "—" },
                                        { k: "Timezone",     v: user.timezone ?? "—" },
                                        { k: "App Version",  v: user.appVersion ?? "—" },
                                        { k: "Last Status",  v: user.lastStatus ?? "—" },
                                        { k: "Last Event",   v: user.lastEvent ? formatEventName(user.lastEvent) : "—" },
                                        { k: "First Seen",   v: formatDate(user.firstSeen) },
                                        { k: "Last Seen",    v: formatDate(user.lastSeen) },
                                      ].map(({ k, v }) => (
                                        <div key={k} className="glass-inset" style={{ padding: "8px 12px" }}>
                                          <p className="label-sm" style={{ marginBottom: 3 }}>{k}</p>
                                          <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem", color: "var(--text-1)", wordBreak: "break-all" }}>{v}</p>
                                        </div>
                                      ))}
                                    </div>

                                    <p className="label-sm" style={{ marginBottom: 8 }}>Feature Usage</p>
                                    {features.length > 0 ? (
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                        {features.map(([feature, count]) => (
                                          <span key={feature} className="badge badge-accent" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                                            {feature} ×{formatNumber(count)}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>No feature usage reported yet.</p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <strong>{userQuery ? "No users match your search." : "No users recorded yet."}</strong>
                <p>{userQuery ? "Try a different search term." : "Users will appear as telemetry arrives."}</p>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* ════════════════ SESSIONS TAB ════════════════ */
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker">Archive</p>
              <h2 className="section-title">Recent Sessions</h2>
              <p className="section-sub">Most recent sessions from the retained window. Expand for full timeline detail.</p>
            </div>
            <div className="panel-head-right">
              <div className="search-wrap" style={{ width: "min(280px,100%)" }}>
                <Search className="search-icon h-3.5 w-3.5" />
                <input
                  type="search"
                  className="glass-input"
                  placeholder="Search user, IP, version…"
                  value={sessionQuery}
                  onChange={(e) => setSessionQuery(e.target.value)}
                />
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
                      const isExpanded = expandedSessions.includes(session.id);
                      const timeline   = sessionTimelines.get(session.id);

                      return (
                        <Fragment key={session.id}>
                          <tr className={isExpanded ? "row-expanded" : ""}>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: "0.8125rem" }}>{displaySessionUser(session)}</span>
                            </td>
                            <td className="muted" style={{ whiteSpace: "nowrap" }}>{buildSessionLocationLabel(session) || "—"}</td>
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
                                <button type="button" className="btn-icon" style={{ padding: 4 }} onClick={() => toggleSessionExpanded(session.id)} aria-label={isExpanded ? "Collapse" : "Expand"}>
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
                <strong>{sessionQuery ? "No sessions match your search." : "No sessions recorded yet."}</strong>
                <p>{sessionQuery ? "Try a different search term." : "Sessions will appear as telemetry arrives."}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
