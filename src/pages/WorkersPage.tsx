import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  Globe2,
  History,
  Radio,
  Search,
  UsersRound,
  X,
} from "lucide-react";
import {
  Fragment,
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { GlassDropdown } from "../components/GlassDropdown";
import { InstallsPanel } from "../components/InstallsPanel";
import { MonitoringSummary } from "../components/MonitoringSummary";
import { Button, IconButton } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { PageHeader } from "../components/ds/PageHeader";
import { TablePagination } from "../components/ds/TablePagination";
import type { StatsPayload, SummaryPayload, UserRollupRecord } from "../types/telemetry";
import { formatDate, formatDuration, formatNumber, timeAgo } from "../utils/format";
import { resolveCountry } from "../utils/geography";
import {
  buildMonitoringDirectory,
  compareVersionsNewestFirst,
  latestSessions,
} from "../utils/monitoringDirectory";
import { paginate } from "../utils/pagination";
import {
  buildUserDirectoryOptions,
  defaultUserSortDirection,
  filterAndSortUsers,
  type DirectorySortDirection,
  type UserDirectorySortKey,
} from "../utils/userDirectory";
const UserActivityPanel = lazy(() =>
  import("../components/UserActivityPanel").then((m) => ({ default: m.UserActivityPanel })),
);
interface WorkersPageProps {
  summary: SummaryPayload;
  stats: StatsPayload | null;
  users: UserRollupRecord[] | null;
  focusedWorkerId?: string | null;
  onOpenMapSession: (id: string) => void;
  onOpenMapUser: (identity: string) => void;
  filterBar?: ReactNode;
}
const nameOf = (user: UserRollupRecord) => user.userLabel?.trim() || user.identity;
const versionOf = (user: UserRollupRecord) => user.displayVersion || user.appVersion || "Unknown";
type Scope = "all" | "online" | "offline" | "errors";
const SCOPES: Array<[Scope, string]> = [
  ["all", "Everyone"],
  ["online", "Online"],
  ["offline", "Offline"],
  ["errors", "With errors"],
];
async function exportHistory(users: UserRollupRecord[]) {
  const XLSX = await import("xlsx");
  const rows = users.map((u) => ({
    User: nameOf(u),
    Discord: u.discordUser || "",
    Status: u.isActive ? "Online" : "Offline",
    Version: versionOf(u),
    Country: u.country || "",
    City: u.city || "",
    Sessions: u.sessions,
    "Total seconds": u.totalDurationSeconds,
    Errors: u.errors,
    "First seen": u.firstSeen,
    "Last active": u.lastSeen,
    "RPC enabled": u.rpcEnabled ?? "",
    Identity: u.identity,
    "Hardware ID": u.hwid || "",
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = Object.keys(rows[0] ?? {}).map(() => ({ wch: 22 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Session history");
  XLSX.writeFile(book, `rr-session-history-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
export function WorkersPage({
  summary,
  users,
  focusedWorkerId,
  onOpenMapSession,
  onOpenMapUser,
  filterBar,
}: WorkersPageProps) {
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const [scope, setScope] = useState<Scope>("all");
  const [version, setVersion] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [lastActive, setLastActive] = useState<string | null>(null);
  const [sort, setSort] = useState<UserDirectorySortKey>("lastSeen");
  const [direction, setDirection] = useState<DirectorySortDirection>("desc");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (focusedWorkerId) {
      setQuery(focusedWorkerId);
      setExpanded(focusedWorkerId);
      setPage(1);
    }
  }, [focusedWorkerId]);
  useEffect(() => setPage(1), [search, scope, version, country, lastActive, sort, direction]);
  const sessions = useMemo(
    () => [
      ...new Map(
        [...summary.recentSessions, ...summary.activeSessions].map((s) => [s.id, s]),
      ).values(),
    ],
    [summary.recentSessions, summary.activeSessions],
  );
  const latest = useMemo(() => latestSessions(sessions), [sessions]);
  const directory = useMemo(
    () => buildMonitoringDirectory(users ?? [], sessions, now),
    [users, sessions, now],
  );
  const options = useMemo(() => buildUserDirectoryOptions(directory, null), [directory]);
  const rows = useMemo(() => {
    const cutoff = lastActive ? now - Number(lastActive) * 86400000 : 0;
    const eligible = directory.filter(
      (u) =>
        (!cutoff || Date.parse(u.lastSeen) >= cutoff) &&
        (scope === "all" ||
          (scope === "online" && u.isActive) ||
          (scope === "offline" && !u.isActive) ||
          (scope === "errors" && u.errors > 0)),
    );
    const filtered = filterAndSortUsers(
      eligible,
      search,
      { version, country, continent: null },
      sort,
      direction,
    );
    if (sort === "version")
      filtered.sort(
        (a, b) =>
          (direction === "desc" ? 1 : -1) * compareVersionsNewestFirst(versionOf(a), versionOf(b)),
      );
    return filtered;
  }, [directory, search, scope, version, country, lastActive, sort, direction, now]);
  const visible = paginate(rows, page, 50);
  const totals = rows.reduce(
    (t, u) => ({
      sessions: t.sessions + u.sessions,
      online: t.online + Number(u.isActive),
      seconds: t.seconds + u.totalDurationSeconds,
    }),
    { sessions: 0, online: 0, seconds: 0 },
  );
  const filtered = Boolean(query || scope !== "all" || version || country || lastActive);
  function clear() {
    setQuery("");
    setScope("all");
    setVersion(null);
    setCountry(null);
    setLastActive(null);
    setPage(1);
  }
  function changeSort(key: UserDirectorySortKey) {
    if (key === sort) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection(key === "version" ? "desc" : defaultUserSortDirection(key));
    }
  }
  function heading(label: string, key: UserDirectorySortKey) {
    return (
      <th aria-sort={sort === key ? (direction === "asc" ? "ascending" : "descending") : undefined}>
        <button className="table-sort" onClick={() => changeSort(key)}>
          {label}
          {sort === key && (direction === "asc" ? <ArrowUp /> : <ArrowDown />)}
        </button>
      </th>
    );
  }
  async function download() {
    setExporting(true);
    setError("");
    try {
      await exportHistory(rows);
    } catch {
      setError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="page-content monitor-workspace">
      <PageHeader
        title="Session history"
        sub="People, activity and every recorded session. One place to look."
        right={
          <>
            {filterBar}
            <Button
              permission="exports.read"
              icon={<Download />}
              onClick={download}
              disabled={exporting || users === null || !rows.length}
            >
              {exporting ? "Exporting…" : "Export"}
            </Button>
          </>
        }
      />
      <MonitoringSummary
        items={[
          {
            label: "People",
            value: users === null ? "…" : formatNumber(rows.length),
            icon: <UsersRound />,
            tone: "violet",
            note: filtered ? "Matching filters" : "All recorded users",
          },
          {
            label: "Online now",
            value: formatNumber(totals.online),
            icon: <Radio />,
            tone: "green",
          },
          {
            label: "Sessions",
            value: formatNumber(totals.sessions),
            icon: <History />,
            tone: "blue",
            note: "Lifetime totals",
          },
          {
            label: "Time in app",
            value: formatDuration(totals.seconds),
            icon: <Clock3 />,
            tone: "amber",
            note: "Lifetime totals",
          },
        ]}
      />
      <section className="monitor-surface" aria-label="People and session history">
        <div className="monitor-toolbar">
          <label className="monitor-search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a person, Discord name or device…"
              aria-label="Search session history"
            />
            {query && (
              <IconButton icon={<X />} aria-label="Clear search" onClick={() => setQuery("")} />
            )}
          </label>
          <div className="monitor-scopes" aria-label="Activity filter">
            {SCOPES.map(([key, label]) => (
              <button
                key={key}
                aria-pressed={scope === key}
                className={scope === key ? "selected" : ""}
                onClick={() => setScope(key)}
              >
                {key === "online" && <i />}
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="monitor-filter-row">
          <div className="monitor-filter">
            <span>Version</span>
            <GlassDropdown
              placeholder="All versions"
              options={[...options.versions].sort(compareVersionsNewestFirst)}
              value={version}
              onChange={setVersion}
              align="left"
            />
          </div>
          <div className="monitor-filter">
            <span>Country</span>
            <GlassDropdown
              placeholder="All countries"
              options={options.countries.map((c) => c.value)}
              renderOption={(key) => options.countries.find((c) => c.value === key)?.label ?? key}
              value={country}
              onChange={setCountry}
              align="left"
            />
          </div>
          <div className="monitor-filter">
            <span>Last active</span>
            <GlassDropdown
              placeholder="Any time"
              options={["1", "7", "30", "90"]}
              renderOption={(v) => (v === "1" ? "Last 24 hours" : `Last ${v} days`)}
              value={lastActive}
              onChange={setLastActive}
              align="left"
            />
          </div>
          {filtered && (
            <Button size="sm" icon={<X />} onClick={clear}>
              Clear filters
            </Button>
          )}
          <span className="monitor-results">
            {formatNumber(rows.length)} people · expand a row for sessions
          </span>
        </div>
        {error && (
          <p className="inline-notice danger" role="alert">
            {error}
          </p>
        )}
        {users === null ? (
          <div className="monitor-loading" role="status">
            Loading the complete history…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Search />} title="No matching activity">
            <Button onClick={clear}>Clear filters</Button>
          </EmptyState>
        ) : (
          <div className="monitor-table-scroll">
            <table className="monitor-table">
              <thead>
                <tr>
                  {heading("Person", "user")}
                  <th>Status</th>
                  {heading("Version", "version")}
                  {heading("Sessions", "sessions")}
                  {heading("Time in app", "totalTime")}
                  {heading("Last active", "lastSeen")}
                  {heading("Location", "location")}
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.items.map((user) => {
                  const isExpanded = expanded === user.identity;
                  const session = latest.get((user.hwid?.trim() || user.identity).toLowerCase());
                  const label = nameOf(user);
                  return (
                    <Fragment key={user.identity}>
                      <tr className={isExpanded ? "is-expanded" : ""}>
                        <td>
                          <button
                            className="person-cell"
                            onClick={() => setExpanded(isExpanded ? null : user.identity)}
                            aria-expanded={isExpanded}
                            aria-label={`Show session history for ${label}`}
                          >
                            <span className="person-avatar">{label.slice(0, 2).toUpperCase()}</span>
                            <span>
                              <strong title={label}>{label}</strong>
                              <small>
                                {user.discordUser
                                  ? `@${user.discordUser.replace(/^@/, "")}`
                                  : "No Discord linked"}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className={`presence ${user.isActive ? "online" : "offline"}`}>
                            <i />
                            {user.isActive ? "Online" : "Offline"}
                          </span>
                        </td>
                        <td>
                          <span className="version-text">{versionOf(user)}</span>
                          {user.rpcEnabled && (
                            <Radio
                              className="rpc-icon"
                              size={13}
                              aria-label="Discord RPC enabled"
                            />
                          )}
                        </td>
                        <td>
                          <strong className="table-number">{formatNumber(user.sessions)}</strong>
                        </td>
                        <td>{formatDuration(user.totalDurationSeconds)}</td>
                        <td title={formatDate(user.lastSeen)}>
                          {timeAgo(user.lastSeen)}
                          {user.errors > 0 && (
                            <small className="row-error">
                              {formatNumber(user.errors)} errors recorded
                            </small>
                          )}
                        </td>
                        <td>
                          <span
                            className="cell-location"
                            title={[user.city, user.country].filter(Boolean).join(", ")}
                          >
                            {[user.city, user.country].filter(Boolean).join(", ") || "Unknown"}
                          </span>
                        </td>
                        <td>
                          <IconButton
                            icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} history for ${label}`}
                            onClick={() => setExpanded(isExpanded ? null : user.identity)}
                          />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="history-expanded">
                          <td colSpan={8}>
                            <div className="history-detail-head">
                              <div>
                                <History />
                                <strong>{label} · session timeline</strong>
                              </div>
                              <div className="row-actions">
                                {resolveCountry(user.country) && (
                                  <Button
                                    size="sm"
                                    icon={<Globe2 />}
                                    onClick={() =>
                                      session
                                        ? onOpenMapSession(session.id)
                                        : onOpenMapUser(user.identity)
                                    }
                                  >
                                    Map
                                  </Button>
                                )}
                                <Button
                                  permission="customers.read"
                                  size="sm"
                                  variant="accent"
                                  icon={<ArrowUpRight />}
                                  onClick={() =>
                                    window.dispatchEvent(
                                      new CustomEvent("rr:open-customer", {
                                        detail: {
                                          selector: user.hwid ? "hwid" : "install_id",
                                          value: user.hwid || session?.installId || user.identity,
                                        },
                                      }),
                                    )
                                  }
                                >
                                  Customer workspace
                                </Button>
                              </div>
                            </div>
                            <Suspense
                              fallback={
                                <div className="monitor-loading">Loading session timeline…</div>
                              }
                            >
                              <UserActivityPanel identity={user.identity} />
                            </Suspense>
                            <details className="history-device-details">
                              <summary>Device & installation details</summary>
                              <div className="detail-facts">
                                <div>
                                  <span>Device</span>
                                  <strong>{user.deviceModel || user.platform || "Unknown"}</strong>
                                </div>
                                <div>
                                  <span>First seen</span>
                                  <strong>{formatDate(user.firstSeen)}</strong>
                                </div>
                                <div>
                                  <span>Hardware ID</span>
                                  <code>{user.hwid || "Not reported"}</code>
                                </div>
                              </div>
                              <InstallsPanel hwid={user.hwid} />
                            </details>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination
          {...visible}
          itemLabel="people"
          onPageChange={(p) => {
            setPage(p);
            setExpanded(null);
          }}
        />
      </section>
    </div>
  );
}
