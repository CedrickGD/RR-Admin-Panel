import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  Globe2,
  History,
  RadioTower,
  Search,
  Users as UsersIcon,
} from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { type KpiDrilldown, KpiStatCard } from "../components/KpiStatCard";
import { type SessionPresence, StatusBadge } from "../components/StatusBadge";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { DetailGrid } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { Feed } from "../components/ds/Feed";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { Tag } from "../components/ds/Tag";
import type { AppSessionRecord, StatsPayload, SummaryPayload, TelemetryEvent, UserRollupRecord } from "../types/telemetry";
import { downloadSessionExport } from "../utils/api";
import { formatAccuracy, formatDate, formatDuration, formatEventName, formatGeoSource, formatNumber, timeAgo } from "../utils/format";

interface WorkersPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  users: UserRollupRecord[] | null;
  onOpenMapSession: (sessionId: string) => void;
  filterBar?: ReactNode;
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
const USER_COLUMN_COUNT = 12;

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

/** Discord handles render as muted `@name` — strip a stored leading @ so we never double it. */
function discordHandle(value: string): string {
  return `@${value.trim().replace(/^@/, "")}`;
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

/** Rich Presence renders as a tiny accent "RPC" badge; Off and not-yet-reported stay quiet. */
function RpcBadge({ rpcEnabled }: { rpcEnabled: boolean | null }) {
  if (rpcEnabled === true)  return <Badge tone="accent" title="Discord Rich Presence on">RPC</Badge>;
  if (rpcEnabled === false) return <Badge tone="muted">Off</Badge>;
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
            ? <ArrowUp size={12} style={{ color: "var(--accent)" }} />
            : <ArrowDown size={12} style={{ color: "var(--accent)" }} />
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

export function WorkersPage({ summary, stats, users, onOpenMapSession, filterBar }: WorkersPageProps) {
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
    // Defensive dedupe — exactly one row per identity even if the rollup ever ships duplicates.
    const byIdentity = new Map<string, UserRollupRecord>();
    for (const u of users) {
      const key = u.identity.trim().toLowerCase();
      const existing = byIdentity.get(key);
      if (!existing || parseTimestamp(u.lastSeen) > parseTimestamp(existing.lastSeen)) byIdentity.set(key, u);
    }
    const deduped = [...byIdentity.values()];
    const q = userQuery.trim().toLowerCase();
    const filtered = !q
      ? deduped
      : deduped.filter((u) => {
          const hay = [
            u.userLabel ?? "",
            u.identity,
            u.discordUser ?? "",
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

  // The rollup doesn't carry a session id, so lift each user's most recent one from
  // the summary window (same identity key the rollup uses: hwid, else installId).
  // Lets a rollup row deep-link to the map exactly like LivePage / the Sessions tab.
  const lastSessionByIdentity = useMemo(() => {
    const map = new Map<string, { id: string; lastSeenTs: number }>();
    for (const session of [...summary.activeSessions, ...summary.recentSessions]) {
      if (session.id.startsWith("install:")) continue;
      const identity = (session.hwid ?? session.installId).trim().toLowerCase();
      const ts = parseTimestamp(session.lastSeenAt);
      const lastSeenTs = Number.isFinite(ts) ? ts : 0;
      const existing = map.get(identity);
      if (!existing || lastSeenTs > existing.lastSeenTs) map.set(identity, { id: session.id, lastSeenTs });
    }
    return map;
  }, [summary.activeSessions, summary.recentSessions]);

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
        { label: "All-time",     value: formatNumber(lifetime) },
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
      <PageHeader
        kicker="Directory"
        title="Users & Sessions"
        right={
          <>
            {filterBar}
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
              <Button size="sm" icon={<Download />} onClick={() => void handleExport()} disabled={exporting}>
                {exporting ? "Preparing…" : "Export TXT"}
              </Button>
            ) : null}
          </>
        }
      />

      {/* Headline KPIs */}
      <div className="stat-grid stat-grid-4 v2-stagger">
        <KpiStatCard
          label="Total Users"
          value={formatNumber(totalUsersValue)}
          sub={stats ? `${formatNumber(stats.totals.lifetimeUsers)} all-time · ${formatNumber(stats.totals.newUsersInRange)} new in range` : "All-time unique users"}
          icon={<UsersIcon size={14} />}
          tone="primary"
          drilldown={totalUsersDrill}
        />
        <KpiStatCard
          label="Active Now"
          value={formatNumber(activeNowValue)}
          sub="Sessions live right now"
          tone="accent"
          icon={<Activity size={14} />}
        />
        <KpiStatCard
          label="RPC On"
          value={stats ? formatNumber(stats.totals.rpcEnabledUsers) : "—"}
          sub={stats ? `of ${formatNumber(stats.totals.rpcKnownUsers)} reporting · ${formatNumber(stats.totals.rpcLiveNow)} live now` : "Waiting for stats…"}
          icon={<RadioTower size={14} />}
          tone="amber"
          drilldown={rpcDrill}
        />
        <KpiStatCard
          label="Errors in Range"
          value={stats ? formatNumber(stats.totals.errorsInRange) : formatNumber(summary.stats.errorsLast24Hours)}
          sub={stats ? "Within selected range" : "Last 24 h · fallback window"}
          icon={<AlertTriangle size={14} />}
          tone="rose"
          drilldown={errorsDrill}
        />
      </div>

      {exportError ? (
        <div className="inline-danger-note" role="alert">{exportError}</div>
      ) : null}

      {tab === "users" ? (
        /* ════════════════ USERS TAB ════════════════ */
        <CollapsiblePanel
          kicker="Rollup"
          title="All Users"
          sub={filteredUsers
            ? `${formatNumber(filteredUsers.length)} of ${formatNumber(users?.length ?? 0)} shown · every user ever seen, rolled up across the full session history`
            : "Loading user rollup…"}
          right={
            <SearchInput
              value={userQuery}
              onChange={setUserQuery}
              placeholder="Search user, Discord, version…"
              style={{ width: "min(280px,100%)" }}
            />
          }
        >
          <div className="panel-body-flush">
            {filteredUsers === null || filteredUsers.length > 0 ? (
              <div className="data-table-wrap" style={{ borderRadius: 0, border: "none" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Discord</th>
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
                        const features = Object.entries(user.features ?? {}).sort((a, b) => b[1] - a[1]);
                        const recentErrors = user.recentErrors ?? [];
                        const lastSessionId = lastSessionByIdentity.get(user.identity.trim().toLowerCase())?.id ?? null;

                        return (
                          <Fragment key={user.identity}>
                            <tr
                              className={isExpanded ? "row-expanded" : ""}
                              onClick={() => toggleUserExpanded(user.identity)}
                              style={{ cursor: "pointer" }}
                            >
                              <td style={{ whiteSpace: "nowrap" }}>
                                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.8125rem" }}>{userDisplayName(user)}</span>
                                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6875rem", color: "var(--text-3)", marginLeft: 8 }}>
                                  {user.identity.slice(0, 8)}
                                </span>
                              </td>
                              <td style={{ whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                                {user.discordUser?.trim() ? (
                                  <span style={{ fontSize: "0.71875rem", color: "var(--text-2)" }} title={`Discord: ${user.discordUser}`}>
                                    {discordHandle(user.discordUser)}
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--text-3)", opacity: 0.55 }} title="RPC not connected / not reported yet">—</span>
                                )}
                              </td>
                              <td>
                                <Badge tone="muted" title={user.appVersion ?? undefined}>
                                  {versionLabel(user.displayVersion ?? user.appVersion)}
                                </Badge>
                              </td>
                              <td className="muted">{user.platform ?? "—"}</td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>{userLocation(user) || "—"}</td>
                              <td><RpcBadge rpcEnabled={user.rpcEnabled} /></td>
                              <td className="muted">{formatNumber(user.sessions)}</td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>{user.totalDurationSeconds > 0 ? formatDuration(user.totalDurationSeconds) : "—"}</td>
                              <td>
                                {user.errors > 0
                                  ? <Badge tone="danger">{formatNumber(user.errors)}</Badge>
                                  : <Badge tone="muted">0</Badge>}
                              </td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  {user.isActive ? <span className="status-dot pulse" /> : null}
                                  {timeAgo(user.lastSeen)}
                                </span>
                              </td>
                              <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateOnly(user.firstSeen)}</td>
                              <td>
                                <div style={{ display: "flex", gap: 4 }}>
                                  {lastSessionId ? (
                                    <IconButton
                                      icon={<Globe2 />}
                                      style={{ padding: 4 }}
                                      title="Show on map"
                                      aria-label="Show on map"
                                      onClick={(e) => { e.stopPropagation(); onOpenMapSession(lastSessionId); }}
                                    />
                                  ) : null}
                                  <IconButton
                                    icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                                    style={{ padding: 4 }}
                                    onClick={(e) => { e.stopPropagation(); toggleUserExpanded(user.identity); }}
                                    aria-label={isExpanded ? "Collapse" : "Expand"}
                                  />
                                </div>
                              </td>
                            </tr>

                            {isExpanded ? (
                              <tr>
                                <td colSpan={USER_COLUMN_COUNT} className="row-expand-panel">
                                  <div className="row-expand-inner">
                                    <div style={{ marginBottom: 14 }}>
                                      <DetailGrid
                                        items={[
                                          { k: "Identity",     v: user.identity },
                                          { k: "Discord",      v: user.discordUser?.trim() ? discordHandle(user.discordUser) : "—" },
                                          { k: "Device Model", v: user.deviceModel ?? "—" },
                                          { k: "OS Version",   v: user.osVersion ?? "—" },
                                          { k: "Timezone",     v: user.timezone ?? "—" },
                                          { k: "App Version",  v: user.appVersion ?? "—" },
                                          { k: "Last Status",  v: user.lastStatus ?? "—" },
                                          { k: "Last Event",   v: user.lastEvent ? formatEventName(user.lastEvent) : "—" },
                                          { k: "First Seen",   v: formatDate(user.firstSeen) },
                                          { k: "Last Seen",    v: formatDate(user.lastSeen) },
                                        ]}
                                      />
                                    </div>

                                    <p className="label-sm" style={{ marginBottom: 8 }}>Recent Errors</p>
                                    {recentErrors.length > 0 ? (
                                      <div style={{ marginBottom: 14 }}>
                                        <Feed
                                          items={recentErrors.map((err, i) => ({
                                            id: `${err.timestamp}-${i}`,
                                            tone: "bad" as const,
                                            title: <span title={err.message ?? undefined}>{err.type?.trim() || "error"}</span>,
                                            meta: <span title={err.message ?? undefined}>{err.message?.trim() || "(no message)"}</span>,
                                            time: timeAgo(err.timestamp),
                                          }))}
                                        />
                                      </div>
                                    ) : (
                                      <p style={{ fontSize: "0.75rem", color: "var(--text-3)", marginBottom: 14 }}>No errors recorded.</p>
                                    )}

                                    <p className="label-sm" style={{ marginBottom: 8 }}>Feature Usage</p>
                                    {features.length > 0 ? (
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                        {features.map(([feature, count]) => (
                                          <Tag key={feature} accent>
                                            {feature} ×{formatNumber(count)}
                                          </Tag>
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
            ) : userQuery ? (
              <EmptyState icon={<Search />} title="No users match">
                Nothing in the rollup matches “{userQuery}”. Clear the search to see every user.
              </EmptyState>
            ) : (
              <EmptyState icon={<UsersIcon />} title="No users recorded yet">
                The directory fills as telemetry arrives.
              </EmptyState>
            )}
          </div>
        </CollapsiblePanel>
      ) : (
        /* ════════════════ SESSIONS TAB ════════════════ */
        <CollapsiblePanel
          kicker="Archive"
          title="Recent Sessions"
          sub="One row per user · most recent session from the retained window. Expand for timeline detail."
          right={
            <SearchInput
              value={sessionQuery}
              onChange={setSessionQuery}
              placeholder="Search user, IP, version…"
              style={{ width: "min(280px,100%)" }}
            />
          }
        >
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
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.8125rem" }}>{displaySessionUser(session)}</span>
                                {session.discordUser?.trim() ? (
                                  <span style={{ fontSize: "0.6875rem", color: "var(--text-2)" }} title={`Discord: ${session.discordUser}`}>
                                    {discordHandle(session.discordUser)}
                                  </span>
                                ) : null}
                                {session.rpcEnabled ? <Badge tone="accent" title="Discord Rich Presence on">RPC</Badge> : null}
                              </span>
                            </td>
                            <td className="muted" style={{ whiteSpace: "nowrap" }}>{buildSessionLocationLabel(session) || "—"}</td>
                            <td><Badge tone="muted">{session.appVersion ?? "—"}</Badge></td>
                            <td className="muted">{session.platform ?? "—"}</td>
                            <td className="muted">{resolveSessionDuration(session)}</td>
                            <td className="muted">{timeAgo(session.lastSeenAt)}</td>
                            <td>
                              {session.errorCount > 0
                                ? <Badge tone="warning">{session.errorCount}</Badge>
                                : <Badge tone="success">0</Badge>
                              }
                            </td>
                            <td><StatusBadge presence={resolvePresence(session)} /></td>
                            <td>
                              <div style={{ display: "flex", gap: 4 }}>
                                <IconButton icon={<Globe2 />} style={{ padding: 4 }} title="Show on map" onClick={() => onOpenMapSession(session.id)} />
                                <IconButton
                                  icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                                  style={{ padding: 4 }}
                                  onClick={() => toggleSessionExpanded(session.id)}
                                  aria-label={isExpanded ? "Collapse" : "Expand"}
                                />
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

                                  <DetailGrid
                                    items={[
                                      { k: "Install ID",  v: session.installId },
                                      { k: "Session ID",  v: session.id },
                                      { k: "Client IP",   v: session.clientIp ?? "—" },
                                      { k: "Started",     v: formatDate(session.startedAt) },
                                      { k: "Last Seen",   v: timeAgo(session.lastSeenAt) },
                                      { k: "Events",      v: String(timeline.trackedEventCount) },
                                      { k: "Discord User", v: session.discordUser?.trim() ? discordHandle(session.discordUser) : "—" },
                                      { k: "Discord RPC", v: session.rpcEnabled === true ? "On" : session.rpcEnabled === false ? "Off" : "—" },
                                      { k: "Timezone",    v: session.clientTimezone ?? "—" },
                                      { k: "Geo Source",  v: formatGeoSource(session.clientGeoSource, session.clientGeoSignalSource) },
                                      { k: "Geo Accuracy", v: formatAccuracy(session.clientAccuracyMeters) },
                                      { k: "Last Event",  v: session.lastEvent ? formatEventName(session.lastEvent) : "—" },
                                    ]}
                                  />
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
            ) : sessionQuery ? (
              <EmptyState icon={<Search />} title="No sessions match">
                Nothing in the retained window matches “{sessionQuery}”. Clear the search to see every session.
              </EmptyState>
            ) : (
              <EmptyState icon={<History />} title="No sessions recorded yet">
                Sessions surface here within seconds of ingest.
              </EmptyState>
            )}
          </div>
        </CollapsiblePanel>
      )}
    </div>
  );
}
