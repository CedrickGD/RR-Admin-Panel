import { TableFrame } from "../components/ds/TableFrame";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import {
  CustomerAvatar,
  useCustomerDirectory,
  useCustomerProfiles,
} from "../components/CustomerProfiles";
import {
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
} from "lucide-react";
import {
  Fragment,
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PageToolbar } from "../components/ds/PageToolbar";
import { SearchInput } from "../components/ds/SearchInput";
import { Select } from "../components/ds/Select";
import { InstallsPanel } from "../components/InstallsPanel";
import { KpiStatCard } from "../components/KpiStatCard";
import { Button, IconButton } from "../components/ds/Button";
import { SortHeader, type SortState } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { PageHeader } from "../components/ds/PageHeader";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SegmentedControl, type TabItem } from "../components/ds/SegmentedControl";
import { SkeletonRows } from "../components/ds/Skeleton";
import { TablePagination } from "../components/ds/TablePagination";
import type { StatsPayload, SummaryPayload, UserRollupRecord } from "../types/telemetry";
import { openCustomerWorkspace } from "../utils/customerNavigation";
import { formatDate, formatDuration, formatNumber } from "../utils/format";
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
}
const nameOf = (user: UserRollupRecord) => user.userLabel?.trim() || user.identity;
const versionOf = (user: UserRollupRecord) => user.displayVersion || user.appVersion || "Unknown";
type Scope = "all" | "online" | "offline" | "errors";
const SCOPES: TabItem<Scope>[] = [
  { key: "all", label: "All customers" },
  { key: "online", label: "Online", icon: <Radio /> },
  { key: "offline", label: "Offline" },
  { key: "errors", label: "With errors" },
];
/** Column count of the history table — keeps the loading skeleton in step with the head. */
const HISTORY_COLUMNS = 8;
async function exportHistory(users: UserRollupRecord[]) {
  const XLSX = await import("xlsx");
  const rows = users.map((u) => ({
    Customer: nameOf(u),
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
  users: sourceUsers,
  focusedWorkerId,
  onOpenMapSession,
  onOpenMapUser,
}: WorkersPageProps) {
  const users = useCustomerDirectory(sourceUsers);
  const findProfile = useCustomerProfiles();
  const [query, setQuery] = useWorkspaceSearch("workers");
  const search = useDeferredValue(query);
  const [scope, setScope] = useState<Scope>("all");
  const [version, setVersion] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
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
  useEffect(() => setPage(1), [search, scope, version, country, sort, direction]);
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
    const eligible = directory.filter(
      (u) =>
        scope === "all" ||
        (scope === "online" && u.isActive) ||
        (scope === "offline" && !u.isActive) ||
        (scope === "errors" && u.errors > 0),
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
  }, [directory, search, scope, version, country, sort, direction]);
  const visible = paginate(rows, page, 50);
  const totals = rows.reduce(
    (t, u) => ({
      sessions: t.sessions + u.sessions,
      online: t.online + Number(u.isActive),
      seconds: t.seconds + u.totalDurationSeconds,
    }),
    { sessions: 0, online: 0, seconds: 0 },
  );
  const filtered = Boolean(query || scope !== "all" || version || country);
  function clear() {
    setQuery("");
    setScope("all");
    setVersion(null);
    setCountry(null);
    setPage(1);
  }
  /** SortHeader hands back the column key; the page owns the direction toggle. */
  function changeSort(next: string) {
    const key = next as UserDirectorySortKey;
    if (key === sort) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection(key === "version" ? "desc" : defaultUserSortDirection(key));
    }
  }
  const sortState: SortState = { key: sort, direction };
  function heading(label: string, key: UserDirectorySortKey, numeric = false) {
    return (
      <SortHeader
        sortKey={key}
        label={label}
        sort={sortState}
        onSortChange={changeSort}
        className={numeric ? "numeric" : undefined}
      />
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
        page="workers"
        right={
          <Button
            permission="exports.read"
            icon={<Download />}
            onClick={download}
            disabled={exporting || users === null || !rows.length}
          >
            {exporting ? "Exporting…" : "Export"}
          </Button>
        }
      />
      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="Customers"
          value={formatNumber(rows.length)}
          sub={filtered ? "Matching the current filters" : "All recorded customers"}
          icon={<UsersRound />}
          loading={users === null}
        />
        <KpiStatCard
          label="Online now"
          value={formatNumber(totals.online)}
          sub="Customers active right now"
          icon={<Radio />}
          tone="success"
          loading={users === null}
        />
        <KpiStatCard
          label="Sessions"
          value={formatNumber(totals.sessions)}
          sub="Lifetime totals"
          icon={<History />}
          loading={users === null}
        />
        <KpiStatCard
          label="Time in app"
          value={formatDuration(totals.seconds)}
          sub="Lifetime totals"
          icon={<Clock3 />}
          loading={users === null}
        />
      </div>
      {/* The one filter place on this page (handoff §2.3), directly above the
          history it filters. Replaces the old scope row plus the separate
          filter row and its "Clear filters" button. */}
      <PageToolbar
        aria-label="Session history filters"
        canReset={filtered}
        onReset={clear}
        left={
          <SegmentedControl
            aria-label="Activity filter"
            items={SCOPES}
            value={scope}
            onChange={setScope}
          />
        }
        search={
          <SearchInput
            aria-label="Search session history"
            value={query}
            onChange={setQuery}
            placeholder="Search session history by customer or PC…"
          />
        }
        filters={
          <>
            <Select
              aria-label="App version"
              value={version ?? ""}
              onValueChange={(value) => setVersion(value || null)}
            >
              <option value="">All versions</option>
              {[...options.versions].sort(compareVersionsNewestFirst).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Country"
              value={country ?? ""}
              onValueChange={(value) => setCountry(value || null)}
            >
              <option value="">All countries</option>
              {options.countries.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <section className="monitor-surface" aria-label="Customers and session history">
        {error && (
          <p className="inline-notice danger" role="alert">
            {error}
          </p>
        )}
        {users !== null && rows.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No customers match"
          >
            Nothing matches the current search and filters.
          </EmptyState>
        ) : (
          <TableFrame stickyActions mobileLayout="stack" aria-busy={users === null || undefined}>
            <caption className="table-caption">
              Customers and their session history, sortable by column
            </caption>
            <thead>
              <tr>
                {heading("Customer", "user")}
                <th scope="col">Status</th>
                {heading("Version", "version")}
                {heading("Sessions", "sessions", true)}
                {heading("Time in app", "totalTime", true)}
                {heading("Last active", "lastSeen")}
                {heading("Location", "location")}
                <th scope="col" aria-label="Customer actions" />
              </tr>
            </thead>
            <tbody>
              {/* Nothing has loaded yet: skeleton rows stand in, so the frame keeps its shape. */}
              {users === null && <SkeletonRows columns={HISTORY_COLUMNS} />}
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
                          aria-label={`${isExpanded ? "Hide" : "Show"} session history for ${label}`}
                        >
                          <CustomerAvatar
                            profile={findProfile(session?.installId, user.hwid ?? user.identity)}
                            label={label}
                          />
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
                      <td data-label="Status">
                        <span className={`presence ${user.isActive ? "online" : "offline"}`}>
                          <i />
                          {user.isActive ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td data-label="Version">
                        <span className="version-text">{versionOf(user)}</span>
                        {user.rpcEnabled && (
                          <Radio className="rpc-icon" size={13} aria-label="Discord RPC enabled" />
                        )}
                      </td>
                      <td className="numeric" data-label="Sessions">
                        <strong className="table-number">{formatNumber(user.sessions)}</strong>
                      </td>
                      <td className="numeric" data-label="Time in app">
                        {formatDuration(user.totalDurationSeconds)}
                      </td>
                      <td data-label="Last active">
                        <RelativeTime iso={user.lastSeen} />
                        {user.errors > 0 && (
                          <small className="row-error">
                            {formatNumber(user.errors)} errors recorded
                          </small>
                        )}
                      </td>
                      <td data-label="Location">
                        <span
                          className="cell-location"
                          title={[user.city, resolveCountry(user.country)?.label ?? user.country]
                            .filter(Boolean)
                            .join(", ")}
                        >
                          {[user.city, resolveCountry(user.country)?.label ?? user.country]
                            .filter(Boolean)
                            .join(", ") || "Unknown"}
                        </span>
                      </td>
                      <td>
                        <IconButton
                          icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Hide" : "Show"} session history for ${label}`}
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
                                  openCustomerWorkspace({
                                    selector: user.hwid ? "hwid" : "install_id",
                                    value: user.hwid || session?.installId || user.identity,
                                  })
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
          </TableFrame>
        )}
        <TablePagination
          {...visible}
          itemLabel="customers"
          onPageChange={(p) => {
            setPage(p);
            setExpanded(null);
          }}
        />
      </section>
    </div>
  );
}
