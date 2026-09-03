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
  ScanSearch,
  Search,
  Users as UsersIcon,
} from "lucide-react";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { Customer360Overlay } from "../components/Customer360Overlay";
import { GlassDropdown } from "../components/GlassDropdown";
import { RowExpandClip } from "../components/RowExpandClip";
import { type KpiDrilldown, KpiStatCard } from "../components/KpiStatCard";
import { type SessionPresence, StatusBadge } from "../components/StatusBadge";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { DetailGrid } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { Feed } from "../components/ds/Feed";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { TablePagination } from "../components/ds/TablePagination";
import { Tag } from "../components/ds/Tag";
import type {
  AppSessionRecord,
  InstallRecord,
  StatsPayload,
  SummaryPayload,
  TelemetryEvent,
  UserRollupRecord,
} from "../types/telemetry";
import { fetchInstalls, revokeInstall } from "../utils/api";
import {
  formatAccuracy,
  formatDate,
  formatDuration,
  formatEventName,
  formatGeoSource,
  formatNumber,
  timeAgo,
} from "../utils/format";
import { resolveCountry } from "../utils/geography";
import { paginate } from "../utils/pagination";
import {
  buildSessionDirectoryOptions,
  defaultSessionSortDirection,
  filterAndSortSessions,
  type SessionDirectorySortKey,
} from "../utils/sessionDirectory";
import {
  buildUserDirectoryOptions,
  defaultUserSortDirection,
  filterAndSortUsers,
  type DirectorySortDirection,
  type UserDirectoryFilters,
  type UserDirectorySortKey,
} from "../utils/userDirectory";

const UserActivityPanel = lazy(() =>
  import("../components/UserActivityPanel").then((module) => ({
    default: module.UserActivityPanel,
  })),
);

interface WorkersPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  users: UserRollupRecord[] | null;
  focusedWorkerId?: string | null;
  onOpenMapSession: (sessionId: string) => void;
  /** Focuses a rollup user on the map's All-time view — works for OFFLINE users too. */
  onOpenMapUser: (identity: string) => void;
  filterBar?: ReactNode;
}

type TabKey = "users" | "sessions";

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
const SESSION_COLUMN_COUNT = 10;
const USER_PAGE_SIZE = 100;
const SESSION_PAGE_SIZE = 75;

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

/* ── per-user Excel export ───────────────────────────────────── */

const USER_EXPORT_COLUMNS = [
  "User",
  "Discord",
  "Tier",
  "Version",
  "Platform",
  "OS",
  "Device",
  "City",
  "Country",
  "Timezone",
  "RPC",
  "Sessions",
  "Total Time",
  "Errors",
  "First Seen",
  "Last Seen",
  "Last Event",
  "Identity",
  "HWID",
] as const;

/**
 * One row per user — the whole rollup (every user ever seen), not a row per
 * session. Defensive dedupe by identity in case the rollup ever ships dupes.
 */
function buildUserRows(users: UserRollupRecord[]): Record<string, string | number>[] {
  const byIdentity = new Map<string, UserRollupRecord>();
  for (const u of users) {
    const key = u.identity.trim().toLowerCase();
    const existing = byIdentity.get(key);
    if (!existing || parseTimestamp(u.lastSeen) > parseTimestamp(existing.lastSeen))
      byIdentity.set(key, u);
  }
  return [...byIdentity.values()]
    .sort((a, b) => parseTimestamp(b.lastSeen) - parseTimestamp(a.lastSeen))
    .map((u) => ({
      User: u.userLabel?.trim() || u.identity,
      Discord: u.discordUser?.trim() ? discordHandle(u.discordUser) : "",
      Tier: u.licenseTier ?? "",
      Version: u.displayVersion ?? u.appVersion ?? "",
      Platform: u.platform ?? "",
      OS: u.osVersion ?? "",
      Device: u.deviceModel ?? "",
      City: u.city ?? "",
      Country: u.country ?? "",
      Timezone: u.timezone ?? "",
      RPC: u.rpcEnabled === true ? "On" : u.rpcEnabled === false ? "Off" : "",
      Sessions: u.sessions,
      "Total Time": u.totalDurationSeconds > 0 ? formatDuration(u.totalDurationSeconds) : "",
      Errors: u.errors,
      "First Seen": u.firstSeen ? formatDate(u.firstSeen) : "",
      "Last Seen": u.lastSeen ? formatDate(u.lastSeen) : "",
      "Last Event": u.lastEvent ? formatEventName(u.lastEvent) : "",
      Identity: u.identity,
      HWID: u.hwid ?? "",
    }));
}

/** Real .xlsx (not CSV) so it opens with clean columns in Excel on any locale. */
async function exportUsersXlsx(users: UserRollupRecord[]): Promise<void> {
  const XLSX = await import("xlsx");
  const header = [...USER_EXPORT_COLUMNS];
  const sheet = XLSX.utils.json_to_sheet(buildUserRows(users), { header });
  sheet["!cols"] = header.map((h) => ({
    wch:
      h === "Identity" || h === "HWID"
        ? 34
        : h === "User" || h === "Discord" || h === "City" || h === "Device"
          ? 18
          : 12,
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Users");
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  XLSX.writeFile(book, `rr-users-${stamp}.xlsx`);
}

/* ── users tab helpers ──────────────────────────────────────── */

function userDisplayName(user: UserRollupRecord): string {
  return user.userLabel?.trim() || user.identity;
}

function userLocation(user: UserRollupRecord): string {
  return [user.city, user.country].filter((v): v is string => Boolean(v?.trim())).join(", ");
}

/* ── sessions tab helpers (preserved behaviour) ─────────────── */

function displaySessionUser(session: AppSessionRecord): string {
  return session.userLabel?.trim() || session.installId;
}

function resolveSessionEnd(session: AppSessionRecord): string {
  return session.endedAt ?? session.lastSeenAt;
}

function resolveSessionDuration(session: AppSessionRecord): string {
  if (session.durationSeconds !== null && Number.isFinite(session.durationSeconds))
    return formatDuration(session.durationSeconds);
  const startedAt = Date.parse(session.startedAt);
  const endedAt = Date.parse(resolveSessionEnd(session));
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt)
    return "open";
  return formatDuration((endedAt - startedAt) / 1000);
}

function buildSessionLocationLabel(session: AppSessionRecord): string {
  return [session.clientCity, session.clientRegion, session.clientCountry]
    .filter((v): v is string => Boolean(v?.trim()))
    .join(", ");
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
    .filter((e) => {
      if (!eventMatchesSession(e, session)) return false;
      const ts = parseTimestamp(e.timestamp);
      return Number.isFinite(ts) && ts >= rangeStart && ts <= rangeEnd;
    })
    .sort((a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp));
  const errorEvents = relevantEvents.filter((e) => e.service === APP_ERROR);
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
  if (rpcEnabled === true)
    return (
      <Badge tone="accent" title="Discord Rich Presence on">
        RPC
      </Badge>
    );
  if (rpcEnabled === false) return <Badge tone="muted">Off</Badge>;
  return (
    <span
      className="badge badge-muted"
      style={{ opacity: 0.55 }}
      title="Not reported yet — RPC telemetry is a newer field"
    >
      —
    </span>
  );
}

/* ── installs (rr.install.v1) ───────────────────────────────── */

interface InstallsPanelProps {
  hwid: string | null;
}

/**
 * Registered installs of one device: short install id, version, last seen, a Verified badge
 * when a license is bound, and a two-step Revoke that invalidates the install's signing key.
 * Loaded on first expand (the detail row stays mounted) and refreshed after every revoke.
 */
function InstallsPanel({ hwid }: InstallsPanelProps) {
  const [installs, setInstalls] = useState<InstallRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    if (!hwid) return;
    const seq = ++requestSeq.current;
    setLoadError(null);
    void fetchInstalls(hwid)
      .then((result) => {
        if (requestSeq.current !== seq) return;
        if (result.ok && result.installs) setInstalls(result.installs);
        else setLoadError(`Could not load installs (HTTP ${result.status}).`);
      })
      .catch(() => {
        if (requestSeq.current === seq) setLoadError("Could not load installs.");
      });
  }, [hwid]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(installId: string) {
    setBusyId(installId);
    setActionError(null);
    try {
      const result = await revokeInstall(installId, reason.trim() || null);
      if (!result.ok) {
        setActionError(result.error ?? `Could not revoke install (HTTP ${result.status}).`);
        return;
      }
      setConfirmId(null);
      setReason("");
      load();
    } catch {
      setActionError("Could not revoke install.");
    } finally {
      setBusyId(null);
    }
  }

  let body: ReactNode;
  if (!hwid) {
    body = (
      <p style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
        No hardware ID reported — installs are keyed by device.
      </p>
    );
  } else if (loadError) {
    body = (
      <p
        style={{
          fontSize: "0.75rem",
          color: "var(--danger)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {loadError}
        <Button size="xs" onClick={load}>
          Retry
        </Button>
      </p>
    );
  } else if (installs === null) {
    body = <div className="skeleton" style={{ height: 12, width: 160 }} />;
  } else if (installs.length === 0) {
    body = (
      <p style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
        No registered installs yet — clients before 1.4.9 never register.
      </p>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {installs.map((install) => {
          const revoked = install.revokedAt !== null;
          const confirming = confirmId === install.installId;
          const busy = busyId === install.installId;
          return (
            <div
              key={install.installId}
              className="glass-inset"
              style={{
                padding: "6px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                opacity: revoked ? 0.7 : 1,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  color: "var(--text-1)",
                }}
                title={install.installId}
              >
                {install.installId.slice(0, 8)}
              </span>
              <Badge tone="muted">{versionLabel(install.appVersion)}</Badge>
              {install.licenseId !== null ? (
                <Badge tone="accent" title="A license is bound to this install">
                  Verified
                </Badge>
              ) : null}
              {revoked ? (
                <Badge
                  tone="danger"
                  title={`Revoked ${formatDate(install.revokedAt)}${install.revokeReason ? ` — ${install.revokeReason}` : ""}`}
                >
                  Revoked
                </Badge>
              ) : null}
              <span
                style={{ fontSize: "0.71875rem", color: "var(--text-3)", whiteSpace: "nowrap" }}
                title={install.lastSeenAt ? formatDate(install.lastSeenAt) : undefined}
              >
                {install.lastSeenAt ? `seen ${timeAgo(install.lastSeenAt)}` : "not seen yet"}
              </span>
              {!revoked ? (
                <span
                  style={{
                    marginLeft: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {confirming ? (
                    <>
                      <input
                        className="glass-input"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (optional)"
                        maxLength={500}
                        disabled={busy}
                        style={{ height: 26, fontSize: "0.75rem", width: 180 }}
                      />
                      <Button
                        size="xs"
                        onClick={() => {
                          setConfirmId(null);
                          setReason("");
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        onClick={() => void revoke(install.installId)}
                        disabled={busy}
                      >
                        {busy ? "Revoking…" : "Confirm revoke"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="xs"
                      variant="danger"
                      title="Invalidate this install's signing key — the app must register a new install"
                      onClick={() => {
                        setConfirmId(install.installId);
                        setReason("");
                        setActionError(null);
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </span>
              ) : null}
            </div>
          );
        })}
        {actionError ? (
          <p style={{ fontSize: "0.75rem", color: "var(--danger)", margin: 0 }}>{actionError}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <p className="label-sm" style={{ marginBottom: 8 }}>
        Installs
      </p>
      {body}
    </div>
  );
}

interface SortableThProps {
  label: string;
  sortKey: UserDirectorySortKey;
  activeKey: UserDirectorySortKey;
  dir: DirectorySortDirection;
  onSort: (key: UserDirectorySortKey) => void;
  /** Column-priority tag (col-xl / col-lg / col-md) — hides with its tds on narrow viewports. */
  className?: string;
}

function SortableTh({ label, sortKey, activeKey, dir, onSort, className }: SortableThProps) {
  const isActive = activeKey === sortKey;
  return (
    <th
      className={className}
      onClick={() => onSort(sortKey)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {isActive ? (
          dir === "asc" ? (
            <ArrowUp size={12} style={{ color: "var(--accent)" }} />
          ) : (
            <ArrowDown size={12} style={{ color: "var(--accent)" }} />
          )
        ) : null}
      </span>
    </th>
  );
}

interface SessionSortableThProps {
  label: string;
  sortKey: SessionDirectorySortKey;
  activeKey: SessionDirectorySortKey;
  dir: DirectorySortDirection;
  onSort: (key: SessionDirectorySortKey) => void;
  className?: string;
}

function SessionSortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: SessionSortableThProps) {
  const isActive = activeKey === sortKey;
  return (
    <th
      className={className}
      onClick={() => onSort(sortKey)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {isActive ? (
          dir === "asc" ? (
            <ArrowUp size={12} style={{ color: "var(--accent)" }} />
          ) : (
            <ArrowDown size={12} style={{ color: "var(--accent)" }} />
          )
        ) : null}
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

export function WorkersPage({
  summary,
  stats,
  users,
  focusedWorkerId,
  onOpenMapSession,
  onOpenMapUser,
  filterBar,
}: WorkersPageProps) {
  const [tab, setTab] = useState<TabKey>("users");

  // Users tab state
  const [userQuery, setUserQuery] = useState("");
  const deferredUserQuery = useDeferredValue(userQuery);
  const [userPage, setUserPage] = useState(1);
  const [sortKey, setSortKey] = useState<UserDirectorySortKey>("lastSeen");
  const [sortDir, setSortDir] = useState<DirectorySortDirection>("desc");
  const [userFilters, setUserFilters] = useState<UserDirectoryFilters>({
    version: null,
    continent: null,
    country: null,
  });
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (focusedWorkerId) {
      setTab("users");
      setUserQuery(focusedWorkerId);
      setUserPage(1);
      setExpandedUsers(new Set([focusedWorkerId]));
    }
  }, [focusedWorkerId]);

  // Sessions tab state
  const [sessionQuery, setSessionQuery] = useState("");
  const deferredSessionQuery = useDeferredValue(sessionQuery);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionSortKey, setSessionSortKey] = useState<SessionDirectorySortKey>("lastSeen");
  const [sessionSortDir, setSessionSortDir] = useState<DirectorySortDirection>("desc");
  const [sessionFilters, setSessionFilters] = useState<UserDirectoryFilters>({
    version: null,
    continent: null,
    country: null,
  });
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [customer360Session, setCustomer360Session] = useState<AppSessionRecord | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /* ── users derivations (rollup-backed; never the 200-row window) ── */

  const userFilterOptions = useMemo(
    () => buildUserDirectoryOptions(users ?? [], userFilters.continent),
    [users, userFilters.continent],
  );

  const countryOptionLabels = useMemo(
    () => new Map(userFilterOptions.countries.map((option) => [option.value, option.label])),
    [userFilterOptions.countries],
  );
  const hasUserFilters = Boolean(
    userFilters.version || userFilters.continent || userFilters.country,
  );

  const filteredUsers = useMemo(() => {
    if (!users) return null;
    return filterAndSortUsers(users, deferredUserQuery, userFilters, sortKey, sortDir);
  }, [users, deferredUserQuery, userFilters, sortKey, sortDir]);

  const paginatedUsers = useMemo(
    () => (filteredUsers ? paginate(filteredUsers, userPage, USER_PAGE_SIZE) : null),
    [filteredUsers, userPage],
  );

  useEffect(() => {
    if (paginatedUsers && paginatedUsers.page !== userPage) {
      setUserPage(paginatedUsers.page);
    }
  }, [paginatedUsers, userPage]);

  function handleUserQuery(value: string) {
    setUserQuery(value);
    setUserPage(1);
    setExpandedUsers(new Set());
  }

  function handleSort(key: UserDirectorySortKey) {
    setUserPage(1);
    setExpandedUsers(new Set());
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(defaultUserSortDirection(key));
    }
  }

  function updateUserFilter(key: keyof UserDirectoryFilters, value: string | null) {
    setUserFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "continent" ? { country: null } : {}),
    }));
    setUserPage(1);
    setExpandedUsers(new Set());
  }

  function toggleUserExpanded(identity: string) {
    setExpandedUsers((current) => {
      const next = new Set(current);
      if (!next.delete(identity)) next.add(identity);
      return next;
    });
  }

  function changeUserPage(page: number) {
    setExpandedUsers(new Set());
    setUserPage(page);
  }

  /* ── header KPI values (stats/rollup driven, summary fallback) ── */

  const totalUsersValue = users
    ? users.length
    : stats
      ? stats.totals.lifetimeUsers
      : summary.stats.lifetimeUsers;
  const activeNowValue = stats ? stats.totals.activeNow : summary.stats.activeUsers;

  const totalUsersDrill: KpiDrilldown | null = useMemo(() => {
    if (!stats) return null;
    const lifetime = stats.totals.lifetimeUsers;
    return {
      timespans: [
        { label: "In range", value: formatNumber(stats.totals.usersInRange) },
        { label: "New in range", value: formatNumber(stats.totals.newUsersInRange) },
        { label: "All-time", value: formatNumber(lifetime) },
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
        {
          label: "On",
          value: formatNumber(rpcEnabledUsers),
          share: lifetimeUsers > 0 ? rpcEnabledUsers / lifetimeUsers : undefined,
        },
        {
          label: "Off",
          value: formatNumber(Math.max(0, rpcKnownUsers - rpcEnabledUsers)),
          share:
            lifetimeUsers > 0
              ? Math.max(0, rpcKnownUsers - rpcEnabledUsers) / lifetimeUsers
              : undefined,
        },
        {
          label: "Unknown (no report yet)",
          value: formatNumber(unknown),
          share: lifetimeUsers > 0 ? unknown / lifetimeUsers : undefined,
        },
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

  const sessionFilterOptions = useMemo(
    () => buildSessionDirectoryOptions(summary.recentSessions, sessionFilters.continent),
    [summary.recentSessions, sessionFilters.continent],
  );
  const sessionCountryOptionLabels = useMemo(
    () => new Map(sessionFilterOptions.countries.map((option) => [option.value, option.label])),
    [sessionFilterOptions.countries],
  );
  const hasSessionFilters = Boolean(
    sessionFilters.version || sessionFilters.continent || sessionFilters.country,
  );

  const sessions = useMemo(
    () =>
      filterAndSortSessions(
        summary.recentSessions,
        deferredSessionQuery,
        sessionFilters,
        sessionSortKey,
        sessionSortDir,
      ),
    [deferredSessionQuery, sessionFilters, sessionSortDir, sessionSortKey, summary.recentSessions],
  );

  const paginatedSessions = useMemo(
    () => paginate(sessions, sessionPage, SESSION_PAGE_SIZE),
    [sessions, sessionPage],
  );

  useEffect(() => {
    if (paginatedSessions.page !== sessionPage) {
      setSessionPage(paginatedSessions.page);
    }
  }, [paginatedSessions, sessionPage]);

  function handleSessionQuery(value: string) {
    setSessionQuery(value);
    setSessionPage(1);
    setExpandedSessions(new Set());
  }

  function handleSessionSort(key: SessionDirectorySortKey) {
    setSessionPage(1);
    setExpandedSessions(new Set());
    if (key === sessionSortKey) {
      setSessionSortDir((direction) => (direction === "desc" ? "asc" : "desc"));
    } else {
      setSessionSortKey(key);
      setSessionSortDir(defaultSessionSortDirection(key));
    }
  }

  function updateSessionFilter(key: keyof UserDirectoryFilters, value: string | null) {
    setSessionFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "continent" ? { country: null } : {}),
    }));
    setSessionPage(1);
    setExpandedSessions(new Set());
  }

  function toggleSessionExpanded(sessionId: string) {
    setExpandedSessions((current) => {
      const next = new Set(current);
      if (!next.delete(sessionId)) next.add(sessionId);
      return next;
    });
  }

  function changeSessionPage(page: number) {
    setExpandedSessions(new Set());
    setSessionPage(page);
  }

  async function handleExport() {
    if (!users || users.length === 0) {
      setExportError("No users to export yet — the directory fills as telemetry arrives.");
      return;
    }
    setExportError(null);
    setExporting(true);
    try {
      await exportUsersXlsx(users);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to export users.");
    } finally {
      setExporting(false);
    }
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
              {(
                [
                  { key: "users", label: "Users" },
                  { key: "sessions", label: "Sessions" },
                ] as Array<{ key: TabKey; label: string }>
              ).map((t) => (
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
            <Button
              size="sm"
              icon={<Download />}
              onClick={() => void handleExport()}
              disabled={exporting || !users || users.length === 0}
              title="Download one row per user (every user ever seen) as a clean Excel (.xlsx) sheet"
            >
              {exporting ? "Preparing…" : "Export Users"}
            </Button>
          </>
        }
      />

      {/* Headline KPIs */}
      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="Total Users"
          value={formatNumber(totalUsersValue)}
          sub={
            stats
              ? `${formatNumber(stats.totals.lifetimeUsers)} all-time · ${formatNumber(stats.totals.newUsersInRange)} new in range`
              : "All-time unique users"
          }
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
          sub={
            stats
              ? `of ${formatNumber(stats.totals.rpcKnownUsers)} reporting · ${formatNumber(stats.totals.rpcLiveNow)} live now`
              : "Waiting for stats…"
          }
          icon={<RadioTower size={14} />}
          tone="amber"
          drilldown={rpcDrill}
        />
        <KpiStatCard
          label="Errors in Range"
          value={
            stats
              ? formatNumber(stats.totals.errorsInRange)
              : formatNumber(summary.stats.errorsLast24Hours)
          }
          sub={stats ? "Within selected range" : "Last 24 h · fallback window"}
          icon={<AlertTriangle size={14} />}
          tone="rose"
          drilldown={errorsDrill}
        />
      </div>

      {exportError ? (
        <div className="inline-danger-note" role="alert">
          {exportError}
        </div>
      ) : null}

      {tab === "users" ? (
        /* ════════════════ USERS TAB ════════════════ */
        <CollapsiblePanel
          kicker="Rollup"
          title="All Users"
          collapsible={false}
          sub={
            filteredUsers
              ? `${formatNumber(filteredUsers.length)} of ${formatNumber(users?.length ?? 0)} shown · every user ever seen, rolled up across the full session history`
              : "Loading user rollup…"
          }
          right={
            <div className="user-directory-controls">
              <SearchInput
                value={userQuery}
                onChange={handleUserQuery}
                placeholder="Search user or Discord…"
                style={{ width: "min(260px,100%)" }}
              />
              <GlassDropdown
                placeholder="All versions"
                options={userFilterOptions.versions}
                value={userFilters.version}
                onChange={(value) => updateUserFilter("version", value)}
                renderOption={(value) => versionLabel(value)}
                align="left"
              />
              <GlassDropdown
                placeholder="All continents"
                options={userFilterOptions.continents}
                value={userFilters.continent}
                onChange={(value) => updateUserFilter("continent", value)}
                align="left"
              />
              <GlassDropdown
                placeholder="All countries"
                options={userFilterOptions.countries.map((option) => option.value)}
                value={userFilters.country}
                onChange={(value) => updateUserFilter("country", value)}
                renderOption={(value) => countryOptionLabels.get(value) ?? value}
                align="left"
              />
            </div>
          }
        >
          <div className="panel-body-flush">
            {filteredUsers === null || filteredUsers.length > 0 ? (
              <>
                <div className="data-table-wrap data-table-wrap-paginated">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <SortableTh
                          label="User"
                          sortKey="user"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                        <SortableTh
                          label="Discord"
                          sortKey="discord"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                          className="col-lg"
                        />
                        <SortableTh
                          label="Version"
                          sortKey="version"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                        <SortableTh
                          label="Location"
                          sortKey="location"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                          className="col-md"
                        />
                        <th className="col-md">RPC</th>
                        <SortableTh
                          label="Sessions"
                          sortKey="sessions"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                        <SortableTh
                          label="Total Time"
                          sortKey="totalTime"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                        <SortableTh
                          label="Errors"
                          sortKey="errors"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                        <SortableTh
                          label="Last Seen"
                          sortKey="lastSeen"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                        <SortableTh
                          label="First Seen"
                          sortKey="firstSeen"
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                          className="col-xl"
                        />
                        <th></th>
                      </tr>
                    </thead>
                    <tbody
                      key={filteredUsers === null ? "loading" : "loaded"}
                      className={filteredUsers === null ? undefined : "dt-settle"}
                    >
                      {filteredUsers === null ? (
                        <SkeletonRows />
                      ) : (
                        (paginatedUsers?.items ?? []).map((user) => {
                          const isExpanded = expandedUsers.has(user.identity);
                          const features = isExpanded
                            ? Object.entries(user.features ?? {}).sort((a, b) => b[1] - a[1])
                            : [];
                          const recentErrors = isExpanded ? (user.recentErrors ?? []) : [];
                          // Mappable when the rollup has coordinates or at least a known
                          // country (centroid fallback) — online OR offline.
                          const canMap =
                            resolveCountry(user.country) !== null ||
                            (Number.isFinite(user.latitude ?? Number.NaN) &&
                              Number.isFinite(user.longitude ?? Number.NaN));

                          return (
                            <Fragment key={user.identity}>
                              <tr
                                className={isExpanded ? "row-expanded" : ""}
                                onClick={() => toggleUserExpanded(user.identity)}
                                style={{ cursor: "pointer" }}
                              >
                                <td style={{ whiteSpace: "nowrap" }}>
                                  <span
                                    style={{
                                      fontFamily: "var(--font-display)",
                                      fontWeight: 600,
                                      fontSize: "0.8125rem",
                                      marginRight: 6,
                                      display: "inline-block",
                                      maxWidth: 190,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      verticalAlign: "bottom",
                                    }}
                                    title={userDisplayName(user)}
                                  >
                                    {userDisplayName(user)}
                                  </span>
                                  {user.licenseTier === "premium" ? (
                                    <span
                                      style={{
                                        fontSize: "0.625rem",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        background: "var(--accent-subtle)",
                                        color: "var(--accent-text)",
                                        fontWeight: 700,
                                        letterSpacing: "0.05em",
                                        verticalAlign: "middle",
                                      }}
                                    >
                                      PREMIUM
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: "0.625rem",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        background: "var(--bg-subtle)",
                                        color: "var(--text-muted)",
                                        fontWeight: 700,
                                        letterSpacing: "0.05em",
                                        verticalAlign: "middle",
                                      }}
                                    >
                                      FREE
                                    </span>
                                  )}
                                  <span
                                    style={{
                                      fontFamily: "var(--font-mono)",
                                      fontSize: "0.6875rem",
                                      color: "var(--text-3)",
                                      marginLeft: 8,
                                    }}
                                  >
                                    {user.identity.slice(0, 8)}
                                  </span>
                                </td>
                                <td
                                  className="col-lg"
                                  style={{
                                    whiteSpace: "nowrap",
                                    maxWidth: 160,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {user.discordUser?.trim() ? (
                                    <span
                                      style={{ fontSize: "0.71875rem", color: "var(--text-2)" }}
                                      title={`Discord: ${user.discordUser}`}
                                    >
                                      {discordHandle(user.discordUser)}
                                    </span>
                                  ) : (
                                    <span
                                      style={{ color: "var(--text-3)", opacity: 0.55 }}
                                      title="RPC not connected / not reported yet"
                                    >
                                      —
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <Badge tone="muted" title={user.appVersion ?? undefined}>
                                    {versionLabel(user.displayVersion ?? user.appVersion)}
                                  </Badge>
                                </td>
                                <td
                                  className="muted col-md"
                                  style={{
                                    whiteSpace: "nowrap",
                                    maxWidth: 150,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                  title={userLocation(user) || undefined}
                                >
                                  {userLocation(user) || "—"}
                                </td>
                                <td className="col-md">
                                  <RpcBadge rpcEnabled={user.rpcEnabled} />
                                </td>
                                <td className="muted">{formatNumber(user.sessions)}</td>
                                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                                  {user.totalDurationSeconds > 0
                                    ? formatDuration(user.totalDurationSeconds)
                                    : "—"}
                                </td>
                                <td>
                                  {user.errors > 0 ? (
                                    <Badge tone="danger">{formatNumber(user.errors)}</Badge>
                                  ) : (
                                    <Badge tone="muted">0</Badge>
                                  )}
                                </td>
                                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                                  <span
                                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                                  >
                                    {user.isActive ? <span className="status-dot" /> : null}
                                    {timeAgo(user.lastSeen)}
                                  </span>
                                </td>
                                <td className="muted col-xl" style={{ whiteSpace: "nowrap" }}>
                                  {formatDateOnly(user.firstSeen)}
                                </td>
                                <td>
                                  <div style={{ display: "flex", gap: 4 }}>
                                    <IconButton
                                      icon={<Globe2 />}
                                      style={{ padding: 4 }}
                                      disabled={!canMap}
                                      title={
                                        canMap
                                          ? user.isActive
                                            ? "Show on map"
                                            : "Show last known location"
                                          : "No location data"
                                      }
                                      aria-label="Show on map"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (canMap) onOpenMapUser(user.identity);
                                      }}
                                    />
                                    <IconButton
                                      icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                                      style={{ padding: 4 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleUserExpanded(user.identity);
                                      }}
                                      aria-label={isExpanded ? "Collapse" : "Expand"}
                                    />
                                  </div>
                                </td>
                              </tr>

                              {isExpanded ? (
                                <tr>
                                  <td
                                    colSpan={USER_COLUMN_COUNT}
                                    className="row-expand-panel row-expand-td"
                                  >
                                    <RowExpandClip open>
                                      <div style={{ marginBottom: 14 }}>
                                        <DetailGrid
                                          items={[
                                            { k: "Identity", v: user.identity },
                                            { k: "Hardware ID", v: user.hwid ?? "—" },
                                            {
                                              k: "Discord",
                                              v: user.discordUser?.trim()
                                                ? discordHandle(user.discordUser)
                                                : "—",
                                            },
                                            { k: "Device Model", v: user.deviceModel ?? "—" },
                                            { k: "OS Version", v: user.osVersion ?? "—" },
                                            { k: "Timezone", v: user.timezone ?? "—" },
                                            {
                                              k: "App Version",
                                              v: user.displayVersion ?? user.appVersion ?? "—",
                                            },
                                            { k: "Last Status", v: user.lastStatus ?? "—" },
                                            {
                                              k: "Last Event",
                                              v: user.lastEvent
                                                ? formatEventName(user.lastEvent)
                                                : "—",
                                            },
                                            { k: "First Seen", v: formatDate(user.firstSeen) },
                                            { k: "Last Seen", v: formatDate(user.lastSeen) },
                                          ]}
                                        />
                                      </div>

                                      <InstallsPanel hwid={user.hwid} />

                                      <Suspense
                                        fallback={
                                          <div
                                            className="skeleton"
                                            style={{ height: 96, marginBottom: 14 }}
                                          />
                                        }
                                      >
                                        <UserActivityPanel identity={user.identity} />
                                      </Suspense>

                                      <p className="label-sm" style={{ marginBottom: 8 }}>
                                        Recent Errors
                                      </p>
                                      {recentErrors.length > 0 ? (
                                        <div style={{ marginBottom: 14 }}>
                                          <Feed
                                            items={recentErrors.map((err, i) => ({
                                              id: `${err.timestamp}-${i}`,
                                              tone: "bad" as const,
                                              title: (
                                                <span title={err.message ?? undefined}>
                                                  {err.type?.trim() || "error"}
                                                </span>
                                              ),
                                              meta: (
                                                <span title={err.message ?? undefined}>
                                                  {err.message?.trim() || "(no message)"}
                                                </span>
                                              ),
                                              time: timeAgo(err.timestamp),
                                            }))}
                                          />
                                        </div>
                                      ) : (
                                        <p
                                          style={{
                                            fontSize: "0.75rem",
                                            color: "var(--text-3)",
                                            marginBottom: 14,
                                          }}
                                        >
                                          No errors recorded.
                                        </p>
                                      )}

                                      <p className="label-sm" style={{ marginBottom: 8 }}>
                                        Feature Usage
                                      </p>
                                      {features.length > 0 ? (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                          {features.map(([feature, count]) => (
                                            <Tag key={feature} accent>
                                              {feature} ×{formatNumber(count)}
                                            </Tag>
                                          ))}
                                        </div>
                                      ) : (
                                        <p style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
                                          No feature usage reported yet.
                                        </p>
                                      )}
                                    </RowExpandClip>
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
                {paginatedUsers ? (
                  <TablePagination
                    page={paginatedUsers.page}
                    pageCount={paginatedUsers.pageCount}
                    start={paginatedUsers.start}
                    end={paginatedUsers.end}
                    total={paginatedUsers.total}
                    itemLabel="users"
                    onPageChange={changeUserPage}
                  />
                ) : null}
              </>
            ) : userQuery || hasUserFilters ? (
              <EmptyState icon={<Search />} title="No users match">
                Nothing in the rollup matches the current search and filters. Clear them to see
                every user.
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
          collapsible={false}
          sub="One row per user · most recent session from the retained window. Expand for timeline detail."
          right={
            <div className="user-directory-controls">
              <SearchInput
                value={sessionQuery}
                onChange={handleSessionQuery}
                placeholder="Search user or Discord…"
                style={{ width: "min(260px,100%)" }}
              />
              <GlassDropdown
                placeholder="All versions"
                options={sessionFilterOptions.versions}
                value={sessionFilters.version}
                onChange={(value) => updateSessionFilter("version", value)}
                renderOption={(value) => versionLabel(value)}
                align="left"
              />
              <GlassDropdown
                placeholder="All continents"
                options={sessionFilterOptions.continents}
                value={sessionFilters.continent}
                onChange={(value) => updateSessionFilter("continent", value)}
                align="left"
              />
              <GlassDropdown
                placeholder="All countries"
                options={sessionFilterOptions.countries.map((option) => option.value)}
                value={sessionFilters.country}
                onChange={(value) => updateSessionFilter("country", value)}
                renderOption={(value) => sessionCountryOptionLabels.get(value) ?? value}
                align="left"
              />
            </div>
          }
        >
          <div className="panel-body-flush">
            {sessions.length > 0 ? (
              <>
                <div className="data-table-wrap data-table-wrap-paginated">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <SessionSortableTh
                          label="User"
                          sortKey="user"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                        />
                        <SessionSortableTh
                          label="Discord"
                          sortKey="discord"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                          className="col-lg"
                        />
                        <SessionSortableTh
                          label="Location"
                          sortKey="location"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                        />
                        <SessionSortableTh
                          label="Version"
                          sortKey="version"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                        />
                        <SessionSortableTh
                          label="Duration"
                          sortKey="duration"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                        />
                        <SessionSortableTh
                          label="Started"
                          sortKey="startedAt"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                          className="col-lg"
                        />
                        <SessionSortableTh
                          label="Last Seen"
                          sortKey="lastSeen"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                        />
                        <SessionSortableTh
                          label="Errors"
                          sortKey="errors"
                          activeKey={sessionSortKey}
                          dir={sessionSortDir}
                          onSort={handleSessionSort}
                          className="col-md"
                        />
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedSessions.items.map((session) => {
                        const isExpanded = expandedSessions.has(session.id);
                        const timeline = isExpanded
                          ? buildSessionTimeline(session, summary.recentEvents)
                          : null;

                        return (
                          <Fragment key={session.id}>
                            <tr className={isExpanded ? "row-expanded" : ""}>
                              <td style={{ whiteSpace: "nowrap" }}>
                                <span
                                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                                >
                                  <span
                                    style={{
                                      fontFamily: "var(--font-display)",
                                      fontWeight: 600,
                                      fontSize: "0.8125rem",
                                      maxWidth: 180,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                    title={displaySessionUser(session)}
                                  >
                                    {displaySessionUser(session)}
                                  </span>
                                  {session.rpcEnabled ? (
                                    <Badge tone="accent" title="Discord Rich Presence on">
                                      RPC
                                    </Badge>
                                  ) : null}
                                </span>
                              </td>
                              <td
                                className="muted col-lg"
                                style={{
                                  whiteSpace: "nowrap",
                                  maxWidth: 150,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {session.discordUser?.trim()
                                  ? discordHandle(session.discordUser)
                                  : "—"}
                              </td>
                              <td
                                className="muted"
                                style={{
                                  whiteSpace: "nowrap",
                                  maxWidth: 170,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                title={buildSessionLocationLabel(session) || undefined}
                              >
                                {buildSessionLocationLabel(session) || "—"}
                              </td>
                              <td>
                                <Badge tone="muted">
                                  {session.displayVersion ?? session.appVersion ?? "—"}
                                </Badge>
                              </td>
                              <td className="muted">{resolveSessionDuration(session)}</td>
                              <td className="muted col-lg" style={{ whiteSpace: "nowrap" }}>
                                {formatDateOnly(session.startedAt)}
                              </td>
                              <td className="muted">{timeAgo(session.lastSeenAt)}</td>
                              <td className="col-md">
                                {session.errorCount > 0 ? (
                                  <Badge tone="warning">{session.errorCount}</Badge>
                                ) : (
                                  <Badge tone="success">0</Badge>
                                )}
                              </td>
                              <td>
                                <StatusBadge presence={resolvePresence(session)} />
                              </td>
                              <td>
                                <div style={{ display: "flex", gap: 4 }}>
                                  <IconButton
                                    icon={<ScanSearch />}
                                    style={{ padding: 4 }}
                                    title="Open Customer 360"
                                    aria-label={`Open Customer 360 for ${displaySessionUser(session)}`}
                                    onClick={() => setCustomer360Session(session)}
                                  />
                                  <IconButton
                                    icon={<Globe2 />}
                                    style={{ padding: 4 }}
                                    title="Show on map"
                                    onClick={() => onOpenMapSession(session.id)}
                                  />
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
                                <td
                                  colSpan={SESSION_COLUMN_COUNT}
                                  className="row-expand-panel row-expand-td"
                                >
                                  <RowExpandClip open>
                                    {timeline.markers.length > 0 ? (
                                      <div style={{ marginBottom: 14 }}>
                                        <p className="label-sm" style={{ marginBottom: 8 }}>
                                          Error Timeline
                                        </p>
                                        <div className="timeline-track">
                                          <div
                                            className="timeline-fill"
                                            style={{ width: "100%" }}
                                          />
                                          {timeline.markers.map((marker) => (
                                            <div
                                              key={marker.id}
                                              className="timeline-marker is-error"
                                              style={{ left: `${marker.position}%` }}
                                              title={marker.label}
                                            />
                                          ))}
                                        </div>
                                        <div
                                          style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            marginTop: 4,
                                          }}
                                        >
                                          <span
                                            style={{
                                              fontSize: "0.6875rem",
                                              color: "var(--text-3)",
                                            }}
                                          >
                                            {formatDate(session.startedAt)}
                                          </span>
                                          {timeline.hiddenErrorCount > 0 ? (
                                            <span
                                              style={{
                                                fontSize: "0.6875rem",
                                                color: "var(--danger)",
                                              }}
                                            >
                                              +{timeline.hiddenErrorCount} more
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                    ) : null}

                                    <DetailGrid
                                      items={[
                                        { k: "Install ID", v: session.installId },
                                        { k: "Session ID", v: session.id },
                                        { k: "Hardware ID", v: session.hwid ?? "—" },
                                        { k: "Client IP", v: session.clientIp ?? "—" },
                                        { k: "Started", v: formatDate(session.startedAt) },
                                        { k: "Last Seen", v: timeAgo(session.lastSeenAt) },
                                        { k: "Events", v: String(timeline.trackedEventCount) },
                                        {
                                          k: "Discord User",
                                          v: session.discordUser?.trim()
                                            ? discordHandle(session.discordUser)
                                            : "—",
                                        },
                                        {
                                          k: "Discord RPC",
                                          v:
                                            session.rpcEnabled === true
                                              ? "On"
                                              : session.rpcEnabled === false
                                                ? "Off"
                                                : "—",
                                        },
                                        { k: "Timezone", v: session.clientTimezone ?? "—" },
                                        {
                                          k: "Geo Source",
                                          v: formatGeoSource(
                                            session.clientGeoSource,
                                            session.clientGeoSignalSource,
                                          ),
                                        },
                                        {
                                          k: "Geo Accuracy",
                                          v: formatAccuracy(session.clientAccuracyMeters),
                                        },
                                        {
                                          k: "Last Event",
                                          v: session.lastEvent
                                            ? formatEventName(session.lastEvent)
                                            : "—",
                                        },
                                      ]}
                                    />
                                  </RowExpandClip>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  page={paginatedSessions.page}
                  pageCount={paginatedSessions.pageCount}
                  start={paginatedSessions.start}
                  end={paginatedSessions.end}
                  total={paginatedSessions.total}
                  itemLabel="sessions"
                  onPageChange={changeSessionPage}
                />
              </>
            ) : sessionQuery || hasSessionFilters ? (
              <EmptyState icon={<Search />} title="No sessions match">
                Nothing in the retained window matches the current search and filters. Clear them to
                see every session.
              </EmptyState>
            ) : (
              <EmptyState icon={<History />} title="No sessions recorded yet">
                Sessions surface here within seconds of ingest.
              </EmptyState>
            )}
          </div>
        </CollapsiblePanel>
      )}
      <Customer360Overlay
        open={customer360Session !== null}
        session={customer360Session}
        onClose={() => setCustomer360Session(null)}
      />
    </div>
  );
}
