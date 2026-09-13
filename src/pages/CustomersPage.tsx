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
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { Customer360Overlay, type Customer360Anchor } from "../components/Customer360Overlay";
import {
  CustomerAccessDialog,
  type CustomerAccessTarget,
} from "../components/CustomerAccessDialog";
import { CustomerRestrictions } from "../components/CustomerRestrictions";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { SortHeader, type SortState } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { SkeletonRows, type SkeletonColumn } from "../components/ds/Skeleton";
import { PageHeader } from "../components/ds/PageHeader";
import { PageToolbar } from "../components/ds/PageToolbar";
import { SearchInput } from "../components/ds/SearchInput";
import { Select } from "../components/ds/Select";
import { Tabs, type TabItem } from "../components/ds/Tabs";
import { RelativeTime } from "../components/ds/RelativeTime";
import { usePanelPermission } from "../hooks/usePanelPermission";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { versionLabel } from "../utils/versionLabel";
import { resolveCountry } from "../utils/geography";
import { TablePagination } from "../components/ds/TablePagination";
import type { SuspensionRecord, UserRollupRecord } from "../types/telemetry";
import { fetchAdminSuspensions } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import { formatDate, formatDay, formatDuration, formatNumber } from "../utils/format";
import { paginate } from "../utils/pagination";
import { restrictionState } from "../utils/restrictions";
import {
  buildUserDirectoryOptions,
  defaultUserSortDirection,
  filterAndSortUsers,
  needsAttention,
  type DirectorySortDirection,
  type UserDirectoryFilters,
  type UserDirectorySortKey,
} from "../utils/userDirectory";

interface CustomersPageProps {
  users: UserRollupRecord[] | null;
}

type CustomerScope = "premium" | "free" | "online" | "attention";

/**
 * The page's two sections (ds/Tabs — page sections, not a filter). "Suspended or banned" used to
 * be a directory scope with its own Restriction column; Restrictions lists those records itself,
 * including the ones no telemetry row exists for, with the lift action next to them.
 */
type CustomerSection = "directory" | "restrictions";

/**
 * The open section lives in the query string, beside Customer 360's `customer`/`customerTab`
 * (the hash is the page key, see utils/pageRouting): `/?section=restrictions#/customers`.
 */
const SECTION_PARAM = "section";

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

function readSection(): CustomerSection {
  return new URLSearchParams(window.location.search).get(SECTION_PARAM) === "restrictions"
    ? "restrictions"
    : "directory";
}

/**
 * Mirrors the section into the address without a new history entry. The entry keeps its state —
 * a history layer's record (useHistoryLayer), which a reload adopts.
 */
function writeSection(section: CustomerSection | null) {
  const url = new URL(window.location.href);
  if (section === "restrictions") url.searchParams.set(SECTION_PARAM, section);
  else url.searchParams.delete(SECTION_PARAM);
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, "", url);
  }
}

function displayName(user: UserRollupRecord): string {
  return user.userLabel?.trim() || user.identity;
}

/** A customer's reported version, through the one shared label rule. */
function userVersionLabel(user: UserRollupRecord): string {
  return versionLabel(user.displayVersion?.trim() || user.appVersion, "Unknown");
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

/** What the shared app-access dialog needs from a directory row. */
function accessTargetOf(user: UserRollupRecord): CustomerAccessTarget {
  return {
    identity: user.identity,
    hwid: user.hwid,
    install_id: null,
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
    detail: `All-time customer · ${userVersionLabel(user)} · ${discordHandle(user.discordUser)}`,
  };
}

/**
 * The head of the directory table as the skeleton sees it: one entry per column,
 * in the same order and carrying the same priority tier, so a placeholder cell
 * bows out exactly when its column does. Without the tiers the loading body is
 * wider than the head at every width where a tier has fired.
 */
const DIRECTORY_SKELETON_COLUMNS: SkeletonColumn[] = [
  {}, // Customer
  { className: "col-md" }, // Contact
  {}, // Version
  { className: "col-lg" }, // Device / OS
  { className: "col-xl" }, // Location
  {}, // Sessions
  { className: "col-lg" }, // Total time
  {}, // Support
  {}, // First seen
  {}, // Last seen
  {}, // Customer actions
];

export function CustomersPage({ users: sourceUsers }: CustomersPageProps) {
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

  /*
   * ── Sections ──────────────────────────────────────────────────────────────
   * Restrictions needs access.read (GET /api/admin/access enforces it too). Without
   * it there is no second section, so the tab row is not rendered at all and a
   * deep link to ?section=restrictions opens the directory.
   */
  const canReadAccess = usePanelPermission("access.read");
  const [requestedSection, setSection] = useState<CustomerSection>(readSection);
  const section: CustomerSection = canReadAccess ? requestedSection : "directory";

  useEffect(() => {
    writeSection(section);
    // Leaving the page takes the parameter with it, so it never rides along to another page.
    return () => writeSection(null);
  }, [section]);

  // Back/Forward onto an entry of this page whose section differs (Customer 360 opened over one
  // section, closed over the other) — follow the address.
  useEffect(() => {
    const follow = () => setSection(readSection());
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  /*
   * ── Restriction records ───────────────────────────────────────────────────
   * Loaded once per visit rather than per section: the tab label counts what is
   * in force, and switching sections must not flash a skeleton. The refresh bus
   * re-pulls them — the header refresh button, a lift in the Restrictions tab
   * and the app-access dialog all emit on it, and useAdminStats re-pulls the
   * directory rows on the same signal, so neither section goes stale.
   */
  // null until the first answer lands; a failed first load stays null and says so.
  const [restrictions, setRestrictions] = useState<SuspensionRecord[] | null>(null);
  const [restrictionsError, setRestrictionsError] = useState<string | null>(null);

  const loadRestrictions = useCallback(async () => {
    try {
      const result = await fetchAdminSuspensions();
      if (!result.ok || !result.suspensions) throw new Error(`HTTP ${result.status}`);
      setRestrictions(result.suspensions);
      setRestrictionsError(null);
    } catch (error) {
      console.error(error);
      setRestrictionsError("Restrictions could not be loaded. The list may be out of date.");
    }
  }, []);

  useEffect(() => {
    if (canReadAccess) void loadRestrictions();
  }, [canReadAccess, loadRestrictions]);

  useRefreshSignal(() => {
    if (canReadAccess) void loadRestrictions();
  });

  const activeRestrictions = useMemo(() => {
    const nowMs = Date.now();
    return (restrictions ?? []).filter((row) => restrictionState(row, nowMs) === "active").length;
  }, [restrictions]);

  const sectionTabs: TabItem<CustomerSection>[] = [
    { key: "directory", label: "Directory", panelId: "customers-panel-directory" },
    {
      key: "restrictions",
      // Neutral text, not a count pill: the number is information, not an alert.
      label: activeRestrictions > 0 ? `Restrictions · ${activeRestrictions}` : "Restrictions",
      panelId: "customers-panel-restrictions",
    },
  ];

  const filterOptions = useMemo(
    () => buildUserDirectoryOptions(users ?? [], filters.continent),
    [users, filters.continent],
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

  // With one section there is no tab row, so the panel must not claim to be a tab panel.
  const panelProps = (key: CustomerSection) =>
    canReadAccess
      ? {
          role: "tabpanel",
          id: `customers-panel-${key}`,
          "aria-labelledby": `customers-panel-${key}-tab`,
        }
      : {};

  return (
    <div className="page-content page-stack-lg customer-glass customer-directory-workspace">
      <PageHeader kicker="Customer support" page="customers" />

      {canReadAccess ? (
        <Tabs
          aria-label="Customer sections"
          items={sectionTabs}
          value={section}
          onChange={setSection}
        />
      ) : null}

      {section === "restrictions" ? (
        <div className="page-stack-lg" {...panelProps("restrictions")}>
          <CustomerRestrictions
            records={restrictions}
            loadError={restrictionsError}
            users={users}
            onReload={() => void loadRestrictions()}
            onRecordsChange={(update) =>
              setRestrictions((current) => (current ? update(current) : current))
            }
          />
        </div>
      ) : (
        <div className="page-stack-lg customer-directory-section" {...panelProps("directory")}>
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

          {/* The one filter place on this page (handoff §2.3), directly above the
              directory it filters. The search is this page's stored query
              (useWorkspaceSearch), so a carried-over search is already in it. */}
          <PageToolbar
            aria-label="Customer filters"
            canReset={hasFilters}
            onReset={clearFilters}
            search={
              <SearchInput
                aria-label="Search customers"
                value={query}
                onChange={setQuery}
                placeholder="Search customer, PC, Discord or HWID…"
              />
            }
            filters={
              <>
                <Select
                  aria-label="Customer scope"
                  value={scope ?? ""}
                  onValueChange={(value) => updateScope(value || null)}
                >
                  <option value="">All customers</option>
                  {CUSTOMER_SCOPES.map((value) => (
                    <option key={value} value={value}>
                      {SCOPE_LABELS[value]}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="App version"
                  value={filters.version ?? ""}
                  onValueChange={(value) => updateFilter("version", value || null)}
                >
                  <option value="">All versions</option>
                  {filterOptions.versions.map((value) => (
                    <option key={value} value={value}>
                      {versionLabel(value)}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Continent"
                  value={filters.continent ?? ""}
                  onValueChange={(value) => updateFilter("continent", value || null)}
                >
                  <option value="">All continents</option>
                  {filterOptions.continents.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Country"
                  value={filters.country ?? ""}
                  onValueChange={(value) => updateFilter("country", value || null)}
                >
                  <option value="">All countries</option>
                  {filterOptions.countries.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </>
            }
          />

          <CollapsiblePanel
            kicker="CRM"
            title="Directory"
            collapsible={false}
            sub={
              directoryUsers
                ? `${formatNumber(directoryUsers.length)} of ${formatNumber(users?.length ?? 0)} shown · all-time customer records`
                : "Loading all-time customer records…"
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
                    minWidth={960}
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
                          label="First seen"
                          sortKey="firstSeen"
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
                        <SkeletonRows columns={DIRECTORY_SKELETON_COLUMNS} />
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
                              <Badge tone="muted">{userVersionLabel(user)}</Badge>
                            </td>
                            <td className="muted col-lg" data-label="Device / OS">
                              <div className="customer-directory-stacked">
                                <span>
                                  {user.deviceModel?.trim() || user.platform?.trim() || "—"}
                                </span>
                                <small>{user.osVersion?.trim() || "OS not reported"}</small>
                              </div>
                            </td>
                            <td
                              className="muted col-xl"
                              data-label="Location"
                              title={locationLabel(user)}
                            >
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
                                {!needsAttention(user) ? (
                                  <Badge tone="success">Clear</Badge>
                                ) : null}
                              </div>
                            </td>
                            <td
                              className="muted customer-directory-first-seen"
                              data-label="First seen"
                            >
                              <RelativeTime iso={user.firstSeen} />
                            </td>
                            <td
                              className="muted customer-directory-last-seen"
                              data-label="Last seen"
                            >
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
        </div>
      )}

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
