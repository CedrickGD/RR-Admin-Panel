import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Crown,
  Radio,
  ScanSearch,
  Search,
  UsersRound,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { Customer360Overlay, type Customer360Anchor } from "../components/Customer360Overlay";
import { GlassDropdown } from "../components/GlassDropdown";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { TablePagination } from "../components/ds/TablePagination";
import type { UserRollupRecord } from "../types/telemetry";
import { formatDuration, formatNumber, timeAgo } from "../utils/format";
import { paginate } from "../utils/pagination";
import {
  buildUserDirectoryOptions,
  defaultUserSortDirection,
  filterAndSortUsers,
  type DirectorySortDirection,
  type UserDirectoryFilters,
  type UserDirectorySortKey,
} from "../utils/userDirectory";

interface CustomersPageProps {
  users: UserRollupRecord[] | null;
  filterBar?: ReactNode;
}

type CustomerScope = "premium" | "free" | "online" | "attention";

const PAGE_SIZE = 75;
const EMPTY_FILTERS: UserDirectoryFilters = {
  version: null,
  continent: null,
  country: null,
};
const CUSTOMER_SCOPES: CustomerScope[] = ["premium", "free", "online", "attention"];
const SCOPE_LABELS: Record<CustomerScope, string> = {
  premium: "Premium",
  free: "Free",
  online: "Online now",
  attention: "Needs attention",
};

function displayName(user: UserRollupRecord): string {
  return user.userLabel?.trim() || user.identity;
}

function versionLabel(user: UserRollupRecord): string {
  const value = user.displayVersion?.trim() || user.appVersion?.trim();
  if (!value) return "Unknown";
  return value === "legacy" ? "Legacy (pre-1.4)" : value;
}

function discordHandle(value: string | null): string {
  const normalized = value?.trim().replace(/^@/, "");
  return normalized ? `@${normalized}` : "—";
}

function locationLabel(user: UserRollupRecord): string {
  return [user.city, user.country].filter((value) => Boolean(value?.trim())).join(", ") || "—";
}

function needsAttention(user: UserRollupRecord): boolean {
  return (
    user.errors > 0 ||
    Boolean(user.suspension) ||
    user.lastStatus === "degraded" ||
    user.lastStatus === "down"
  );
}

function matchesScope(user: UserRollupRecord, scope: CustomerScope | null): boolean {
  switch (scope) {
    case "premium":
      return user.licenseTier === "premium";
    case "free":
      return user.licenseTier !== "premium";
    case "online":
      return user.isActive;
    case "attention":
      return needsAttention(user);
    default:
      return true;
  }
}

function customerAnchor(user: UserRollupRecord): Customer360Anchor {
  const hwid = user.hwid?.trim();
  return {
    selector: hwid ? "hwid" : "install_id",
    value: hwid || user.identity,
    label: displayName(user),
    detail: `All-time customer · ${versionLabel(user)} · ${discordHandle(user.discordUser)}`,
  };
}

interface SortableThProps {
  label: string;
  sortKey: UserDirectorySortKey;
  activeKey: UserDirectorySortKey;
  direction: DirectorySortDirection;
  className?: string;
  onSort: (key: UserDirectorySortKey) => void;
}

function SortableTh({ label, sortKey, activeKey, direction, className, onSort }: SortableThProps) {
  const active = activeKey === sortKey;
  return (
    <th
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={`sort-th${active ? " sort-th-active" : ""}`}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? direction === "asc" ? <ArrowUp /> : <ArrowDown /> : null}
      </button>
    </th>
  );
}

function LoadingRows() {
  return Array.from({ length: 6 }, (_, index) => (
    <tr key={index} aria-hidden="true">
      <td colSpan={10}>
        <div className="skeleton customer-directory-skeleton" />
      </td>
    </tr>
  ));
}

export function CustomersPage({ users, filterBar }: CustomersPageProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<UserDirectoryFilters>(EMPTY_FILTERS);
  const [scope, setScope] = useState<CustomerScope | null>(null);
  const [sortKey, setSortKey] = useState<UserDirectorySortKey>("lastSeen");
  const [sortDirection, setSortDirection] = useState<DirectorySortDirection>("desc");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<UserRollupRecord | null>(null);

  const filterOptions = useMemo(
    () => buildUserDirectoryOptions(users ?? [], filters.continent),
    [users, filters.continent],
  );
  const countryLabels = useMemo(
    () => new Map(filterOptions.countries.map((option) => [option.value, option.label])),
    [filterOptions.countries],
  );
  const directoryUsers = useMemo(() => {
    if (!users) return null;
    return filterAndSortUsers(users, deferredQuery, filters, sortKey, sortDirection).filter(
      (user) => matchesScope(user, scope),
    );
  }, [users, deferredQuery, filters, sortKey, sortDirection, scope]);
  const paginated = useMemo(
    () => (directoryUsers ? paginate(directoryUsers, page, PAGE_SIZE) : null),
    [directoryUsers, page],
  );
  const totals = useMemo(() => {
    const all = users ?? [];
    return {
      customers: all.length,
      online: all.filter((user) => user.isActive).length,
      premium: all.filter((user) => user.licenseTier === "premium").length,
      attention: all.filter(needsAttention).length,
    };
  }, [users]);
  const hasFilters = Boolean(
    query || scope || filters.version || filters.continent || filters.country,
  );
  const selectedAnchor = selectedUser ? customerAnchor(selectedUser) : null;

  useEffect(() => {
    if (paginated && paginated.page !== page) setPage(paginated.page);
  }, [paginated, page]);

  function resetToFirstPage() {
    setPage(1);
  }

  function updateFilter(key: keyof UserDirectoryFilters, value: string | null) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "continent" ? { country: null } : {}),
    }));
    resetToFirstPage();
  }

  function updateScope(value: string | null) {
    setScope(CUSTOMER_SCOPES.includes(value as CustomerScope) ? (value as CustomerScope) : null);
    resetToFirstPage();
  }

  function changeSort(next: UserDirectorySortKey) {
    if (next === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDirection(defaultUserSortDirection(next));
    }
    resetToFirstPage();
  }

  return (
    <div className="page-content page-stack-lg">
      <PageHeader kicker="Customer support" title="Customers" right={filterBar} />

      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="All-time customers"
          value={users ? formatNumber(totals.customers) : "—"}
          sub="Every customer identity ever seen"
          icon={<UsersRound />}
        />
        <KpiStatCard
          label="Online now"
          value={users ? formatNumber(totals.online) : "—"}
          sub="Active customer sessions"
          icon={<Radio />}
          tone="success"
        />
        <KpiStatCard
          label="Premium"
          value={users ? formatNumber(totals.premium) : "—"}
          sub="Customers linked to a paid license"
          icon={<Crown />}
          tone="accent"
        />
        <KpiStatCard
          label="Needs attention"
          value={users ? formatNumber(totals.attention) : "—"}
          sub="Errors, suspension, or degraded state"
          icon={<AlertTriangle />}
          tone={totals.attention > 0 ? "danger" : "success"}
        />
      </div>

      <CollapsiblePanel
        kicker="CRM"
        title="Customer Directory"
        collapsible={false}
        sub={
          directoryUsers
            ? `${formatNumber(directoryUsers.length)} of ${formatNumber(users?.length ?? 0)} shown · all-time customer records`
            : "Loading all-time customer records…"
        }
        right={
          <div className="user-directory-controls customer-directory-controls">
            <SearchInput
              value={query}
              onChange={(value) => {
                setQuery(value);
                resetToFirstPage();
              }}
              placeholder="Search customer, PC, Discord or HWID…"
              style={{ width: "min(330px,100%)" }}
            />
            <GlassDropdown
              placeholder="All customers"
              options={CUSTOMER_SCOPES}
              value={scope}
              onChange={updateScope}
              renderOption={(value) => SCOPE_LABELS[value as CustomerScope] ?? value}
              align="left"
            />
            <GlassDropdown
              placeholder="All versions"
              options={filterOptions.versions}
              value={filters.version}
              onChange={(value) => updateFilter("version", value)}
              align="left"
            />
            <GlassDropdown
              placeholder="All continents"
              options={filterOptions.continents}
              value={filters.continent}
              onChange={(value) => updateFilter("continent", value)}
              align="left"
            />
            <GlassDropdown
              placeholder="All countries"
              options={filterOptions.countries.map((option) => option.value)}
              value={filters.country}
              onChange={(value) => updateFilter("country", value)}
              renderOption={(value) => countryLabels.get(value) ?? value}
              align="left"
            />
          </div>
        }
      >
        <div className="panel-body-flush">
          {directoryUsers === null || directoryUsers.length > 0 ? (
            <>
              <div className="data-table-wrap data-table-wrap-paginated">
                <table className="data-table customer-directory-table">
                  <thead>
                    <tr>
                      <SortableTh
                        label="Customer"
                        sortKey="user"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                      />
                      <SortableTh
                        label="Contact"
                        sortKey="discord"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                        className="col-md"
                      />
                      <SortableTh
                        label="Version"
                        sortKey="version"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                      />
                      <th className="col-lg">Device / OS</th>
                      <SortableTh
                        label="Location"
                        sortKey="location"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                        className="col-xl"
                      />
                      <SortableTh
                        label="Sessions"
                        sortKey="sessions"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                      />
                      <SortableTh
                        label="Total time"
                        sortKey="totalTime"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                        className="col-lg"
                      />
                      <SortableTh
                        label="Support"
                        sortKey="errors"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                      />
                      <SortableTh
                        label="Last seen"
                        sortKey="lastSeen"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={changeSort}
                      />
                      <th aria-label="Customer actions" />
                    </tr>
                  </thead>
                  <tbody className={directoryUsers === null ? undefined : "dt-settle"}>
                    {directoryUsers === null ? (
                      <LoadingRows />
                    ) : (
                      (paginated?.items ?? []).map((user) => (
                        <tr key={user.identity}>
                          <td>
                            <div className="customer-directory-identity">
                              <span className="customer-directory-name" title={displayName(user)}>
                                {displayName(user)}
                              </span>
                              <span className="customer-directory-badges">
                                <Badge tone={user.licenseTier === "premium" ? "accent" : "muted"}>
                                  {user.licenseTier === "premium" ? "Premium" : "Free"}
                                </Badge>
                                {user.isActive ? <Badge tone="success">Online</Badge> : null}
                              </span>
                              <span className="customer-directory-id" title={user.identity}>
                                {user.identity.slice(0, 12)}
                              </span>
                            </div>
                          </td>
                          <td className="muted col-md" title={user.discordUser ?? undefined}>
                            {discordHandle(user.discordUser)}
                          </td>
                          <td>
                            <Badge tone="muted">{versionLabel(user)}</Badge>
                          </td>
                          <td className="muted col-lg">
                            <div className="customer-directory-stacked">
                              <span>
                                {user.deviceModel?.trim() || user.platform?.trim() || "—"}
                              </span>
                              <small>{user.osVersion?.trim() || "OS not reported"}</small>
                            </div>
                          </td>
                          <td className="muted col-xl" title={locationLabel(user)}>
                            {locationLabel(user)}
                          </td>
                          <td className="muted">{formatNumber(user.sessions)}</td>
                          <td className="muted col-lg">
                            {user.totalDurationSeconds > 0
                              ? formatDuration(user.totalDurationSeconds)
                              : "—"}
                          </td>
                          <td>
                            <div className="customer-directory-support">
                              {user.suspension ? (
                                <Badge tone="danger">
                                  {user.suspension.mode === "ban" ? "Banned" : "Suspended"}
                                </Badge>
                              ) : null}
                              {user.errors > 0 ? (
                                <Badge tone="warning">{formatNumber(user.errors)} errors</Badge>
                              ) : null}
                              {user.errors === 0 &&
                              !user.suspension &&
                              (user.lastStatus === "degraded" || user.lastStatus === "down") ? (
                                <Badge tone={user.lastStatus === "down" ? "danger" : "warning"}>
                                  {user.lastStatus === "down" ? "Down" : "Degraded"}
                                </Badge>
                              ) : null}
                              {!needsAttention(user) ? <Badge tone="success">Clear</Badge> : null}
                            </div>
                          </td>
                          <td className="muted customer-directory-last-seen">
                            {user.isActive ? <span className="status-dot" /> : null}
                            {timeAgo(user.lastSeen)}
                          </td>
                          <td>
                            <Button
                              variant="accent"
                              size="xs"
                              icon={<ScanSearch />}
                              aria-label={`Open Customer 360 for ${displayName(user)}`}
                              onClick={() => setSelectedUser(user)}
                            >
                              Open 360
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {paginated ? (
                <TablePagination
                  page={paginated.page}
                  pageCount={paginated.pageCount}
                  start={paginated.start}
                  end={paginated.end}
                  total={paginated.total}
                  itemLabel="customers"
                  onPageChange={setPage}
                />
              ) : null}
            </>
          ) : hasFilters ? (
            <EmptyState icon={<Search />} title="No customers match">
              Nothing matches the current search and filters. Clear them to see every customer.
            </EmptyState>
          ) : (
            <EmptyState icon={<UsersRound />} title="No customers recorded yet">
              The directory fills automatically as customer telemetry arrives.
            </EmptyState>
          )}
        </div>
      </CollapsiblePanel>

      <Customer360Overlay
        open={selectedUser !== null}
        session={null}
        anchor={selectedAnchor}
        onClose={() => setSelectedUser(null)}
      />
    </div>
  );
}
