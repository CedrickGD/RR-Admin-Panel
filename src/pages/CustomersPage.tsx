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
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { Customer360Overlay, type Customer360Anchor } from "../components/Customer360Overlay";
import {
  CustomerAccessDialog,
  type CustomerAccessTarget,
} from "../components/CustomerAccessDialog";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { SortHeader, type SortState } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { Skeleton, SkeletonRows, type SkeletonColumn } from "../components/ds/Skeleton";
import { PageHeader } from "../components/ds/PageHeader";
import { PageToolbar } from "../components/ds/PageToolbar";
import { SearchInput } from "../components/ds/SearchInput";
import { Select } from "../components/ds/Select";
import { RelativeTime } from "../components/ds/RelativeTime";
import { usePanelPermission } from "../hooks/usePanelPermission";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { resolveCountry } from "../utils/geography";
import { TablePagination } from "../components/ds/TablePagination";
import type { SuspensionRecord, UserRollupRecord } from "../types/telemetry";
import { fetchAdminSuspensions } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
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

/**
 * A restriction is in force when it is active and either permanent or still
 * inside its window — the same rule the server applies before it attaches
 * `user.suspension` to a rollup row, so a telemetry row and its record agree.
 */
function isEffective(row: SuspensionRecord, nowMs: number): boolean {
  if (row.is_active !== 1) return false;
  if (!row.banned_until) return true;
  return new Date(row.banned_until).getTime() > nowMs;
}

function identifierKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/** Every identifier a restriction may be matched to a directory row by. */
function restrictionKeys(row: SuspensionRecord): string[] {
  return [row.identity, row.hwid, row.install_id]
    .map(identifierKey)
    .filter((key): key is string => key !== null);
}

/** `paid_license_keys` is stored comma-joined (see the suspend endpoint). */
function paidKeysOfRestriction(row: SuspensionRecord): string[] {
  return (row.paid_license_keys ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/**
 * A restriction whose identity has no rollup row, dressed as one so it can be
 * searched, sorted and paginated with the rest of the directory. Everything the
 * record cannot know stays empty and the row renders "—" for it: the rollup is
 * built from app_sessions, and a customer can be banned from Customer 360
 * before they ever launch the app (anchored by licence key or order id).
 */
function restrictionAsDirectoryRow(
  row: SuspensionRecord,
  label: string | null,
  discordUser: string | null,
): UserRollupRecord {
  return {
    identity: row.identity,
    userLabel: label ?? row.user_label,
    firstSeen: "",
    lastSeen: "",
    sessions: 0,
    totalDurationSeconds: 0,
    errors: 0,
    isActive: false,
    licenseTier: row.had_paid_license === 1 ? "premium" : undefined,
    paidLicenseKeys: paidKeysOfRestriction(row),
    suspension: {
      mode: row.mode,
      reason: row.reason,
      bannedUntil: row.banned_until,
      hadPaidLicense: row.had_paid_license === 1,
      createdAt: row.created_at,
    },
    hwid: row.hwid,
    appVersion: null,
    displayVersion: null,
    platform: null,
    osVersion: null,
    deviceModel: null,
    country: null,
    city: null,
    timezone: null,
    rpcEnabled: null,
    discordUser,
    latitude: null,
    longitude: null,
    lastStatus: null,
    lastEvent: null,
    features: {},
    recentErrors: [],
  };
}

/** What the shared app-access dialog needs from a directory row. */
function accessTargetOf(
  user: UserRollupRecord,
  restriction?: SuspensionRecord,
): CustomerAccessTarget {
  return {
    identity: user.identity,
    hwid: user.hwid,
    // A restriction-only row carries no rollup identifiers, so the record's own
    // install_id is the third key the dialog can recognise the customer by.
    install_id: restriction?.install_id ?? null,
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

/**
 * The head of the directory table as the skeleton sees it: one entry per column,
 * in the same order and carrying the same priority tier, so a placeholder cell
 * bows out exactly when its column does. Without the tiers the loading body is
 * wider than the head at every width where a tier has fired. Eleven columns as
 * standard; the restricted scope adds "Restriction" after Support.
 */
function directorySkeletonColumns(showRestrictions: boolean): SkeletonColumn[] {
  return [
    {}, // Customer
    { className: "col-md" }, // Contact
    {}, // Version
    { className: "col-lg" }, // Device / OS
    { className: "col-xl" }, // Location
    {}, // Sessions
    { className: "col-lg" }, // Total time
    {}, // Support
    ...(showRestrictions ? [{}] : []), // Restriction
    {}, // First seen
    {}, // Last seen
    {}, // Customer actions
  ];
}

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

  /*
   * ── Enforcement overview ──────────────────────────────────────────────────
   * The rollup this page lists is derived from app_sessions, so a restriction
   * written against an identity that never opened the app has no row here and
   * would be invisible forever. GET /api/admin/access is the authority on what
   * is actually in force, so the restricted scope loads it and folds the
   * records that match no rollup row into the table as ordinary rows.
   *
   * Only under that scope: leaving the default page load at exactly the
   * requests it made before is worth more than pre-fetching a list that four
   * scopes out of five never show.
   *
   * DECISION (F067, permission-shaped hole): this stays gated on access.read,
   * the same permission as the row action and the badge, but the directory
   * itself needs customers.read. A member granted access.read while
   * customers.read is denied by override could reach the old App access page,
   * which is now retired, and has no access surface left. That is accepted, not
   * overlooked: no built-in role is in that position (support and viewer both
   * carry customers.read), and widening the directory to access.read alone
   * would mean serving /api/admin/users to someone deliberately denied the
   * customer list. Such a member should be granted customers.read.
   */
  const canReadAccess = usePanelPermission("access.read");
  const restrictedScope = scope === "restricted";
  // null until the first answer lands — a failed or empty load settles on [],
  // so a row can say "unavailable" instead of shimmering forever.
  const [restrictions, setRestrictions] = useState<SuspensionRecord[] | null>(null);

  const loadRestrictions = useCallback(async () => {
    try {
      const result = await fetchAdminSuspensions();
      if (result.ok && result.suspensions) setRestrictions(result.suspensions);
      else setRestrictions((current) => current ?? []);
    } catch (error) {
      console.error(error);
      setRestrictions((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    if (!restrictedScope || !canReadAccess || restrictions !== null) return;
    void loadRestrictions();
  }, [restrictedScope, canReadAccess, restrictions, loadRestrictions]);

  // Suspending or lifting from the dialog emits on the refresh bus, as does the
  // header refresh button — re-pull in place, and never back to a skeleton.
  useRefreshSignal(() => {
    if (restrictedScope && canReadAccess && restrictions !== null) void loadRestrictions();
  });

  const filterOptions = useMemo(
    () => buildUserDirectoryOptions(users ?? [], filters.continent),
    [users, filters.continent],
  );
  /** Restrictions in force, indexed by every identifier they may be keyed by. */
  const restrictionByKey = useMemo(() => {
    const map = new Map<string, SuspensionRecord>();
    const nowMs = Date.now();
    for (const row of restrictions ?? []) {
      if (!isEffective(row, nowMs)) continue;
      for (const key of restrictionKeys(row)) map.set(key, row);
    }
    return map;
  }, [restrictions]);

  /** Restrictions whose identity has no rollup row — the rows only this fetch knows about. */
  const restrictionOnlyUsers = useMemo(() => {
    if (!restrictedScope || !canReadAccess || !restrictions || !users) return [];
    const known = new Set<string>();
    for (const user of users) {
      for (const key of [identifierKey(user.identity), identifierKey(user.hwid)]) {
        if (key) known.add(key);
      }
    }
    const nowMs = Date.now();
    const rows: UserRollupRecord[] = [];
    for (const row of restrictions) {
      if (!isEffective(row, nowMs)) continue;
      if (restrictionKeys(row).some((key) => known.has(key))) continue;
      const profile = findProfile(row.identity, row.hwid);
      rows.push(
        restrictionAsDirectoryRow(
          row,
          profile?.displayName ?? null,
          profile?.discordUsername ?? null,
        ),
      );
    }
    return rows;
  }, [restrictedScope, canReadAccess, restrictions, users, findProfile]);

  /** True for a row that exists only because a restriction does. */
  const restrictionOnlyIdentities = useMemo(
    () => new Set(restrictionOnlyUsers.map((user) => user.identity)),
    [restrictionOnlyUsers],
  );

  const directoryUsers = useMemo(() => {
    if (!users) return null;
    const source = restrictionOnlyUsers.length > 0 ? [...users, ...restrictionOnlyUsers] : users;
    return filterAndSortUsers(source, deferredQuery, filters, sortKey, sortDirection).filter(
      (user) => matchesScope(user, scope),
    );
  }, [users, restrictionOnlyUsers, deferredQuery, filters, sortKey, sortDirection, scope]);
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

  /** The record behind a restricted row — reason and issuer live only there. */
  function restrictionFor(user: UserRollupRecord): SuspensionRecord | undefined {
    return (
      restrictionByKey.get(identifierKey(user.identity) ?? "") ??
      restrictionByKey.get(identifierKey(user.hwid) ?? "")
    );
  }

  /*
   * Reason and issuer are shown in one "Restriction" column rather than in the
   * access badge's tooltip: a tooltip is one row at a time and mouse-only,
   * while the point of both is scanning a whole restricted list at once. The
   * column carries content for restricted customers only, so it is mounted with
   * the scope that selects them and the default view keeps its own columns.
   */
  const showRestrictions = restrictedScope && canReadAccess;
  const skeletonColumns = directorySkeletonColumns(showRestrictions);

  return (
    <div className="page-content page-stack-lg">
      <PageHeader kicker="Customer support" page="customers" right={filterBar} />

      {/* The one filter place on this page (handoff §2.3). Search is the same
          value the navbar field writes — useWorkspaceSearch("customers") is a
          shared store — so both stay in step while the global search is still
          around to be decided on. */}
      <PageToolbar
        aria-label="Customer filters"
        canReset={hasFilters}
        onReset={clearFilters}
        search={
          <SearchInput
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
                  {value}
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
            ? `${formatNumber(directoryUsers.length)} of ${formatNumber((users?.length ?? 0) + restrictionOnlyUsers.length)} shown · all-time customer records`
            : "Loading all-time customer records…"
        }
      >
        <div className="panel-body-flush">
          {directoryUsers === null || directoryUsers.length > 0 ? (
            <>
              <TableFrame
                // The extra Restriction column is untiered, so this view needs
                // more room than the default one at the same width — app-glue.css
                // keys its own thresholds off the marker class.
                className={`data-table customer-directory-table${showRestrictions ? " customer-directory-restricted" : ""}`}
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
                    {/* Untiered on purpose: this column is the reason the scope
                        was selected, so it must survive the widths at which
                        .col-md/.col-lg/.col-xl bow out. What those tiers hide —
                        Contact, Device / OS, Location, Total time — is not one
                        row expansion away; this table has none. It is in the
                        Customer 360 workspace, a separate screen and a separate
                        fetch, opened from the name link or the scan icon. On a
                        restriction-only row there is no rollup behind those four
                        anyway: they read "—" whether a tier has fired or not. */}
                    {showRestrictions ? <th scope="col">Restriction</th> : null}
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
                    <SkeletonRows columns={skeletonColumns} />
                  ) : (
                    (paginated?.items ?? []).map((user) => {
                      const restriction = restrictionFor(user);
                      // No telemetry behind this row: everything the rollup
                      // would have supplied renders as "—".
                      const restrictionOnly = restrictionOnlyIdentities.has(user.identity);
                      return (
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
                                secondary={
                                  restrictionOnly
                                    ? user.licenseTier === "premium"
                                      ? "Premium · no app sessions on record"
                                      : "No app sessions on record"
                                    : user.licenseTier === "premium"
                                      ? "Premium"
                                      : "Free"
                                }
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
                          <td
                            className={restrictionOnly ? "muted" : undefined}
                            data-label="Version"
                          >
                            {restrictionOnly ? (
                              "—"
                            ) : (
                              <Badge tone="muted">{versionLabel(user)}</Badge>
                            )}
                          </td>
                          <td className="muted col-lg" data-label="Device / OS">
                            {restrictionOnly ? (
                              "—"
                            ) : (
                              <div className="customer-directory-stacked">
                                <span>
                                  {user.deviceModel?.trim() || user.platform?.trim() || "—"}
                                </span>
                                <small>{user.osVersion?.trim() || "OS not reported"}</small>
                              </div>
                            )}
                          </td>
                          <td
                            className="muted col-xl"
                            data-label="Location"
                            title={locationLabel(user)}
                          >
                            {locationLabel(user)}
                          </td>
                          <td className="muted numeric" data-label="Sessions">
                            {restrictionOnly ? "—" : formatNumber(user.sessions)}
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
                          {showRestrictions ? (
                            <td className="muted" data-label="Restriction">
                              <div className="customer-directory-stacked">
                                <span
                                  className="cell-truncate"
                                  style={{ "--cell-max": "260px" } as CSSProperties}
                                  title={
                                    restriction?.reason ?? user.suspension?.reason ?? undefined
                                  }
                                >
                                  {restriction?.reason ||
                                    user.suspension?.reason ||
                                    "No reason given"}
                                </span>
                                {/* created_by is the only record of who issued a
                                  restriction — the suspend endpoint writes no
                                  panel_audit row. */}
                                {restriction ? (
                                  <small title={restriction.created_by ?? undefined}>
                                    {restriction.created_by
                                      ? `by ${restriction.created_by}`
                                      : "issuer not recorded"}
                                  </small>
                                ) : restrictions === null ? (
                                  <Skeleton width={96} height={10} />
                                ) : (
                                  <small>issuer unavailable</small>
                                )}
                              </div>
                            </td>
                          ) : null}
                          <td
                            className="muted customer-directory-first-seen"
                            data-label="First seen"
                          >
                            {restrictionOnly ? "—" : <RelativeTime iso={user.firstSeen} />}
                          </td>
                          <td className="muted customer-directory-last-seen" data-label="Last seen">
                            {restrictionOnly ? (
                              "—"
                            ) : (
                              <>
                                {user.isActive ? <span className="status-dot" /> : null}
                                <RelativeTime iso={user.lastSeen} />
                              </>
                            )}
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
                                onClick={() => setAccessTarget(accessTargetOf(user, restriction))}
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
                      );
                    })
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
