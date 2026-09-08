import { TableFrame, RecordCell, RecordLink } from "../components/ds/TableFrame";
import {
  CustomerAvatar,
  useCustomerDirectory,
  useCustomerProfiles,
} from "../components/CustomerProfiles";
import {
  AlertTriangle,
  Crown,
  Radio,
  ScanSearch,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { Customer360Overlay, type Customer360Anchor } from "../components/Customer360Overlay";
import {
  CustomerAccessDialog,
  type CustomerAccessTarget,
} from "../components/CustomerAccessDialog";
import { GlassDropdown } from "../components/GlassDropdown";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { SortHeader, type SortState } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { SkeletonRows } from "../components/ds/Skeleton";
import { PageHeader } from "../components/ds/PageHeader";
import { RelativeTime } from "../components/ds/RelativeTime";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { resolveCountry } from "../utils/geography";
import { TablePagination } from "../components/ds/TablePagination";
import type { UserRollupRecord } from "../types/telemetry";
import { formatDate, formatDay, formatDuration, formatNumber } from "../utils/format";
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

type CustomerScope = "premium" | "free" | "online" | "attention" | "restricted";

const PAGE_SIZE = 75;
const EMPTY_FILTERS: UserDirectoryFilters = {
  version: null,
  continent: null,
  country: null,
};
const CUSTOMER_SCOPES: CustomerScope[] = ["premium", "free", "online", "attention", "restricted"];
const SCOPE_LABELS: Record<CustomerScope, string> = {
  premium: "Premium",
  free: "Free",
  online: "Online now",
  attention: "Needs attention",
  restricted: "Suspended or banned",
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
  return (
    [user.city, resolveCountry(user.country)?.label ?? user.country]
      .filter((value) => Boolean(value?.trim()))
      .join(", ") || "—"
  );
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
    case "restricted":
      return Boolean(user.suspension);
    default:
      return true;
  }
}

/** What the shared app-access dialog needs from a directory row. */
function accessTargetOf(user: UserRollupRecord): CustomerAccessTarget {
  return {
    identity: user.identity,
    hwid: user.hwid,
    label: displayName(user),
    paid: user.licenseTier === "premium",
    paidKeys: user.paidLicenseKeys,
  };
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

/** Column count of the directory table — keeps the skeleton in step with the head. */
const DIRECTORY_COLUMNS = 10;

export function CustomersPage({ users: sourceUsers, filterBar }: CustomersPageProps) {
  const users = useCustomerDirectory(sourceUsers);
  const findProfile = useCustomerProfiles();
  const [query, setQuery] = useWorkspaceSearch("customers");
  useEffect(() => {
    setPage(1);
  }, [query]);
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<UserDirectoryFilters>(EMPTY_FILTERS);
  const [scope, setScope] = useState<CustomerScope | null>(null);
  const [sortKey, setSortKey] = useState<UserDirectorySortKey>("lastSeen");
  const [sortDirection, setSortDirection] = useState<DirectorySortDirection>("desc");
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<UserRollupRecord | null>(null);
  const [accessTarget, setAccessTarget] = useState<CustomerAccessTarget | null>(null);

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

  function clearFilters() {
    setQuery("");
    setScope(null);
    setFilters(EMPTY_FILTERS);
    resetToFirstPage();
  }

  /** SortHeader hands back the column key; the page owns the direction toggle. */
  function changeSort(next: string) {
    const key = next as UserDirectorySortKey;
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(defaultUserSortDirection(key));
    }
    resetToFirstPage();
  }

  const sort: SortState = { key: sortKey, direction: sortDirection };

  return (
    <div className="page-content page-stack-lg">
      <PageHeader kicker="Customer support" page="customers" right={filterBar} />

      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="All-time customers"
          value={formatNumber(totals.customers)}
          sub="Every customer identity ever seen"
          icon={<UsersRound />}
          loading={!users}
        />
        <KpiStatCard
          label="Online now"
          value={formatNumber(totals.online)}
          sub="Active customer sessions"
          icon={<Radio />}
          tone="success"
          loading={!users}
        />
        <KpiStatCard
          label="Premium"
          value={formatNumber(totals.premium)}
          sub="Customers linked to a paid license"
          icon={<Crown />}
          tone="accent"
          loading={!users}
        />
        <KpiStatCard
          label="Needs attention"
          value={formatNumber(totals.attention)}
          sub="Errors, suspension, or degraded state"
          icon={<AlertTriangle />}
          tone={totals.attention > 0 ? "danger" : "success"}
          loading={!users}
        />
      </div>

      <CollapsiblePanel
        kicker="CRM"
        title="Directory"
        collapsible={false}
        sub={
          directoryUsers
            ? `${formatNumber(directoryUsers.length)} of ${formatNumber(users?.length ?? 0)} shown · all-time customer records`
            : "Loading all-time customer records…"
        }
        right={
          <div className="user-directory-controls customer-directory-controls">
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
              <TableFrame
                className="data-table customer-directory-table"
                paginated
                stickyActions
                mobileLayout="stack"
                aria-busy={directoryUsers === null || undefined}
              >
                <caption className="table-caption">
                  All-time customer directory, sortable by column
                </caption>
                <thead>
                  <tr>
                    <SortHeader
                      label="Customer"
                      sortKey="user"
                      sort={sort}
                      onSortChange={changeSort}
                    />
                    <SortHeader
                      label="Contact"
                      sortKey="discord"
                      sort={sort}
                      onSortChange={changeSort}
                      className="col-md"
                    />
                    <SortHeader
                      label="Version"
                      sortKey="version"
                      sort={sort}
                      onSortChange={changeSort}
                    />
                    <th scope="col" className="col-lg">
                      Device / OS
                    </th>
                    <SortHeader
                      label="Location"
                      sortKey="location"
                      sort={sort}
                      onSortChange={changeSort}
                      className="col-xl"
                    />
                    <SortHeader
                      label="Sessions"
                      sortKey="sessions"
                      sort={sort}
                      onSortChange={changeSort}
                      className="numeric"
                    />
                    <SortHeader
                      label="Total time"
                      sortKey="totalTime"
                      sort={sort}
                      onSortChange={changeSort}
                      className="col-lg numeric"
                    />
                    <SortHeader
                      label="Support"
                      sortKey="errors"
                      sort={sort}
                      onSortChange={changeSort}
                    />
                    <SortHeader
                      label="Last seen"
                      sortKey="lastSeen"
                      sort={sort}
                      onSortChange={changeSort}
                    />
                    <th scope="col" aria-label="Customer actions" />
                  </tr>
                </thead>
                <tbody className={directoryUsers === null ? undefined : "dt-settle"}>
                  {directoryUsers === null ? (
                    <SkeletonRows columns={DIRECTORY_COLUMNS} />
                  ) : (
                    (paginated?.items ?? []).map((user) => (
                      <tr key={user.identity}>
                        <td>
                          <div className="person-cell">
                            <CustomerAvatar
                              profile={findProfile(user.identity, user.hwid)}
                              label={displayName(user)}
                            />
                            <RecordCell
                              primary={
                                // The name opens the same workspace as the row action,
                                // so Customer 360 is one click away from the first column.
                                <RecordLink
                                  title="Open customer workspace"
                                  onClick={() => setSelectedUser(user)}
                                >
                                  {displayName(user)}
                                </RecordLink>
                              }
                              secondary={user.licenseTier === "premium" ? "Premium" : "Free"}
                            />
                          </div>
                        </td>
                        <td
                          className="muted col-md"
                          data-label="Contact"
                          title={user.discordUser ?? undefined}
                        >
                          {discordHandle(user.discordUser)}
                        </td>
                        <td data-label="Version">
                          <Badge tone="muted">{versionLabel(user)}</Badge>
                        </td>
                        <td className="muted col-lg" data-label="Device / OS">
                          <div className="customer-directory-stacked">
                            <span>{user.deviceModel?.trim() || user.platform?.trim() || "—"}</span>
                            <small>{user.osVersion?.trim() || "OS not reported"}</small>
                          </div>
                        </td>
                        <td className="muted col-xl" data-label="Location" title={locationLabel(user)}>
                          {locationLabel(user)}
                        </td>
                        <td className="muted numeric" data-label="Sessions">
                          {formatNumber(user.sessions)}
                        </td>
                        <td className="muted col-lg numeric" data-label="Total time">
                          {user.totalDurationSeconds > 0
                            ? formatDuration(user.totalDurationSeconds)
                            : "—"}
                        </td>
                        <td data-label="Support">
                          <div className="customer-directory-support">
                            {user.suspension ? (
                              <Badge
                                tone={user.suspension.mode === "ban" ? "danger" : "warning"}
                                title={
                                  user.suspension.bannedUntil
                                    ? `Lifts automatically on ${formatDate(user.suspension.bannedUntil)}`
                                    : undefined
                                }
                              >
                                {user.suspension.mode === "ban"
                                  ? "Banned"
                                  : user.suspension.bannedUntil
                                    ? `Suspended until ${formatDay(user.suspension.bannedUntil)}`
                                    : "Suspended"}
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
                        <td className="muted customer-directory-last-seen" data-label="Last seen">
                          {user.isActive ? <span className="status-dot" /> : null}
                          <RelativeTime iso={user.lastSeen} />
                        </td>
                        <td>
                          <div className="row-actions">
                            {/* Suspending is a directory action, not something
                                buried one workspace deeper. */}
                            <IconButton
                              permission="access.read"
                              title="Manage app access"
                              icon={<ShieldCheck />}
                              aria-label={`Manage app access for ${displayName(user)}`}
                              onClick={() => setAccessTarget(accessTargetOf(user))}
                            />
                            <IconButton
                              title="Open customer workspace"
                              icon={<ScanSearch />}
                              aria-label={`Open Customer 360 for ${displayName(user)}`}
                              onClick={() => setSelectedUser(user)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableFrame>
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
            <EmptyState
              icon={<Search />}
              title="No customers match"
              action={
                <Button size="sm" icon={<X />} onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            >
              Nothing matches the current search and filters.
            </EmptyState>
          ) : (
            <EmptyState icon={<UsersRound />} title="No customers recorded yet">
              The directory fills automatically as customer telemetry arrives.
            </EmptyState>
          )}
        </div>
      </CollapsiblePanel>

      {accessTarget ? (
        <CustomerAccessDialog target={accessTarget} onClose={() => setAccessTarget(null)} />
      ) : null}

      <Customer360Overlay
        open={selectedUser !== null}
        session={null}
        anchor={selectedAnchor}
        onClose={() => setSelectedUser(null)}
      />
    </div>
  );
}
