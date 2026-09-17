import "../theme/session-history-workspace.css";
import { RecordLink, TableFrame } from "../components/ds/TableFrame";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import {
  CustomerAvatar,
  useCustomerDirectory,
  useCustomerProfiles,
} from "../components/CustomerProfiles";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
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
  useRef,
  useState,
} from "react";
import { PageToolbar } from "../components/ds/PageToolbar";
import { versionLabel } from "../utils/versionLabel";
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
  // "Errors", not "With errors": the four pills then fit a 390px phone on one row
  // (the Errors page names the same scope the same way).
  { key: "errors", label: "Errors" },
];
/** Column count of the history table — keeps the loading skeleton in step with the head. */
const HISTORY_COLUMNS = 8;
/** Characters of an identifier that stay visible when the rest ellipsises. */
const ID_TAIL = 6;
/** The identity is the hardware id itself for every customer that reports one. */
const sameIdentifier = (user: UserRollupRecord) =>
  Boolean(user.hwid && user.hwid.trim().toLowerCase() === user.identity.trim().toLowerCase());

interface IdentifierFactProps {
  label: string;
  /** What the copy control names, e.g. "hardware ID". */
  kind: string;
  value: string | null;
  copied: boolean;
  onCopy: (value: string) => void;
}

/**
 * One identifier in the device details: a single line that ellipsises in the
 * middle instead of wrapping a 32-character id over three, plus the copy
 * control Licenses and Customer 360 use (check mark for 1.8 s on success).
 */
function IdentifierFact({ label, kind, value, copied, onCopy }: IdentifierFactProps) {
  if (!value) {
    return (
      <div>
        <span>{label}</span>
        <code>Not reported</code>
      </div>
    );
  }
  const split = Math.max(0, value.length - ID_TAIL);
  return (
    <div>
      <span>{label}</span>
      <span className="session-history-id">
        <code title={value}>
          <span className="session-history-id-head">{value.slice(0, split)}</span>
          <span className="session-history-id-tail">{value.slice(split)}</span>
        </code>
        <IconButton
          icon={copied ? <Check /> : <Copy />}
          size={12}
          title={copied ? "Copied" : `Copy ${kind}`}
          aria-label={copied ? `${kind} ${value} copied` : `Copy ${kind} ${value}`}
          onClick={() => onCopy(value)}
        />
      </span>
    </div>
  );
}
async function exportHistory(users: UserRollupRecord[]) {
  const XLSX = await import("xlsx");
  const rows = users.map((u) => ({
    Customer: nameOf(u),
    Discord: u.discordUser || "",
    Status: u.isActive ? "Online" : "Offline",
    Version: versionOf(u),
    Country: u.country || "",
    City: u.city || "",
    "Client IP": u.lastIp || "",
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
  // Which identifier was copied last — one flag, because only one confirmation shows at a time.
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(copyTimer.current ?? undefined), []);
  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.clearTimeout(copyTimer.current ?? undefined);
      copyTimer.current = window.setTimeout(() => setCopiedValue(null), 1800);
    } catch {
      setCopiedValue(null);
    }
  }
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
    <div className="page-content monitor-workspace session-history-workspace">
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
      <section
        className="monitor-surface session-history-surface"
        aria-label="Customers and session history"
      >
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
                    {versionLabel(value)}
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
        <div className="session-history-list-meta">
          <span aria-live="polite" aria-atomic="true">
            {users === null
              ? "Loading session history..."
              : `${formatNumber(rows.length)} ${rows.length === 1 ? "customer" : "customers"}${filtered ? " matching filters" : " recorded"}`}
          </span>
          <span>Lifetime activity per customer</span>
        </div>
        {error && (
          <p className="inline-notice danger" role="alert">
            {error}
          </p>
        )}
        {users !== null && rows.length === 0 ? (
          <EmptyState icon={<Search />} title="No customers match">
            {filtered
              ? "Nothing matches the current search and filters."
              : "No customer session history has been recorded yet."}
          </EmptyState>
        ) : (
          <TableFrame
            className="session-history-table"
            stickyActions
            mobileLayout="stack"
            aria-busy={users === null || undefined}
          >
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
                const countryLabel = resolveCountry(user.country)?.label ?? user.country;
                const timelineId = `session-history-${encodeURIComponent(user.identity)}`;
                return (
                  <Fragment key={user.identity}>
                    <tr
                      className={`session-history-record${isExpanded ? " is-expanded" : ""}`}
                      aria-label={`Session history for ${label}`}
                    >
                      <td className="session-history-customer">
                        <RecordLink
                          className="person-cell session-history-identity"
                          onClick={() => setExpanded(isExpanded ? null : user.identity)}
                          aria-expanded={isExpanded}
                          aria-controls={isExpanded ? timelineId : undefined}
                          aria-label={`${isExpanded ? "Hide" : "Show"} session history for ${label}`}
                        >
                          <CustomerAvatar
                            profile={findProfile(session?.installId, user.hwid ?? user.identity)}
                            label={label}
                          />
                          <span className="session-history-identity-copy">
                            <strong title={label}>{label}</strong>
                            <small>
                              {user.discordUser
                                ? `@${user.discordUser.replace(/^@/, "")}`
                                : "No Discord linked"}
                            </small>
                          </span>
                        </RecordLink>
                      </td>
                      <td data-label="Status">
                        <div className="session-history-status">
                          <span className={`presence ${user.isActive ? "online" : "offline"}`}>
                            <i aria-hidden="true" />
                            {user.isActive ? "Online" : "Offline"}
                          </span>
                          {user.errors > 0 && (
                            <small className="row-error">
                              {formatNumber(user.errors)} {user.errors === 1 ? "error" : "errors"}{" "}
                              recorded
                            </small>
                          )}
                        </div>
                      </td>
                      <td data-label="Version">
                        <span className="version-text">{versionOf(user)}</span>
                      </td>
                      <td className="numeric" data-label="Sessions">
                        <strong className="table-number">{formatNumber(user.sessions)}</strong>
                      </td>
                      <td className="numeric" data-label="Time in app">
                        {formatDuration(user.totalDurationSeconds)}
                      </td>
                      <td data-label="Last active">
                        <RelativeTime iso={user.lastSeen} />
                      </td>
                      <td data-label="Location">
                        <span
                          className="cell-location session-history-location"
                          title={[user.city, countryLabel].filter(Boolean).join(", ")}
                        >
                          <span>{countryLabel || user.city || "Unknown"}</span>
                          {countryLabel && user.city && <small>{user.city}</small>}
                        </span>
                      </td>
                      <td className="session-history-row-actions">
                        <IconButton
                          icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                          aria-expanded={isExpanded}
                          aria-controls={isExpanded ? timelineId : undefined}
                          aria-label={`${isExpanded ? "Hide" : "Show"} session history for ${label}`}
                          onClick={() => setExpanded(isExpanded ? null : user.identity)}
                        />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="history-expanded">
                        <td colSpan={HISTORY_COLUMNS}>
                          <section
                            className="session-history-timeline"
                            id={timelineId}
                            aria-label={`Session timeline for ${label}`}
                          >
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
                                {/* One id when the identity is the hardware id — the phone
                                    showed the same 32 characters twice, six lines of mono. */}
                                <IdentifierFact
                                  label={
                                    sameIdentifier(user) ? "Hardware ID · identity" : "Hardware ID"
                                  }
                                  kind="hardware ID"
                                  value={user.hwid}
                                  copied={copiedValue === user.hwid}
                                  onCopy={(value) => void copyValue(value)}
                                />
                                <div>
                                  <span>Version</span>
                                  <strong>{versionOf(user)}</strong>
                                </div>
                                <div>
                                  <span>Discord RPC</span>
                                  <strong>
                                    {user.rpcEnabled === true
                                      ? "Enabled"
                                      : user.rpcEnabled === false
                                        ? "Disabled"
                                        : "Not reported"}
                                  </strong>
                                </div>
                                {!sameIdentifier(user) && (
                                  <IdentifierFact
                                    label="Identity"
                                    kind="identity"
                                    value={user.identity}
                                    copied={copiedValue === user.identity}
                                    onCopy={(value) => void copyValue(value)}
                                  />
                                )}
                              </div>
                              <InstallsPanel hwid={user.hwid} />
                            </details>
                          </section>
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
