import { TableFrame, RecordCell, RecordLink } from "../components/ds/TableFrame";
import { Ban, ShieldAlert, ShieldCheck, Clock, User, RotateCcw, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CustomerAccessDialog,
  type CustomerAccessTarget,
} from "../components/CustomerAccessDialog";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { SortHeader, type SortState } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal, ModalActions } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SearchInput } from "../components/ds/SearchInput";
import { SegmentedControl, type TabItem } from "../components/ds/SegmentedControl";
import { Skeleton, SkeletonRows } from "../components/ds/Skeleton";
import { TablePagination } from "../components/ds/TablePagination";
import { fetchAdminSuspensions, postLiftSuspension } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import { formatDate, formatDay } from "../utils/format";
import type { SuspensionRecord, UserRollupRecord } from "../types/telemetry";
import { paginate } from "../utils/pagination";

const ACCESS_USER_PAGE_SIZE = 100;

interface AccessPageProps {
  users?: UserRollupRecord[] | null;
  onOpenWorker?: (identity: string) => void;
  filterBar?: ReactNode;
}

/** Column keys the customer table sorts by — the header row owns the choice. */
type SortKey = "access" | "first_seen" | "last_seen";

const TIER_FILTERS: TabItem[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "suspended", label: "Suspended" },
];

const ACCESS_COLUMNS = 5;

/** A suspension counts as in force when active and either permanent or still inside its window. */
function isEffective(row: SuspensionRecord, nowMs: number): boolean {
  if (row.is_active !== 1) return false;
  if (!row.banned_until) return true;
  return new Date(row.banned_until).getTime() > nowMs;
}

/**
 * The row states its access before anyone opens the dialog: allowed, banned, or
 * suspended with the date it lifts itself.
 */
function accessBadge(row: SuspensionRecord | undefined) {
  if (!row) return <Badge tone="success">Allowed</Badge>;
  if (row.mode === "ban") return <Badge tone="danger">Banned</Badge>;
  return (
    <Badge
      tone="warning"
      title={
        row.banned_until ? `Lifts automatically on ${formatDate(row.banned_until)}` : undefined
      }
    >
      {row.banned_until ? `Suspended until ${formatDay(row.banned_until)}` : "Suspended"}
    </Badge>
  );
}

function paidKeysOf(user: UserRollupRecord): string[] {
  if (user.paidLicenseKeys && user.paidLicenseKeys.length > 0) return user.paidLicenseKeys;
  return user.licenseTier === "premium" ? ["(active license)"] : [];
}

export function AccessPage({ users = null, onOpenWorker, filterBar }: AccessPageProps) {
  const [suspensions, setSuspensions] = useState<SuspensionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(() => {
    const value = sessionStorage.getItem("rr:access-search") ?? "";
    sessionStorage.removeItem("rr:access-search");
    return value;
  });
  const deferredQuery = useDeferredValue(query);
  const [userPage, setUserPage] = useState(1);
  const [tierFilter, setTierFilter] = useState<"all" | "paid" | "suspended">("all");
  const [sortKey, setSortKey] = useState<SortKey>("last_seen");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Restricting or restoring access is the same dialog everywhere in the panel
  // (Customer 360, the customer directory, this page) — see CustomerAccessDialog.
  const [accessTarget, setAccessTarget] = useState<CustomerAccessTarget | null>(null);

  const [liftTarget, setLiftTarget] = useState<{ identity: string; label: string } | null>(null);
  const [lifting, setLifting] = useState(false);

  const loadSuspensions = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetchAdminSuspensions();
      if (res.ok && res.suspensions) setSuspensions(res.suspensions);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadSuspensions();
  }, []);

  // Header refresh button: silent re-pull from the worker, no skeleton flash.
  useRefreshSignal(() => void loadSuspensions(true));

  const nowMs = Date.now();

  // Authoritative access state comes from the suspensions table (refetched after every mutation),
  // indexed by every identifier a user might be keyed by so the Users table reflects changes
  // immediately without waiting for the next global stats refresh.
  const activeByKey = useMemo(() => {
    const map = new Map<string, SuspensionRecord>();
    for (const row of suspensions) {
      if (!isEffective(row, nowMs)) continue;
      for (const key of [row.identity, row.hwid, row.install_id]) {
        if (key) map.set(key, row);
      }
    }
    return map;
  }, [suspensions, nowMs]);

  function suspensionForUser(user: UserRollupRecord): SuspensionRecord | undefined {
    return activeByKey.get(user.identity) ?? (user.hwid ? activeByKey.get(user.hwid) : undefined);
  }

  const filteredUsers = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = (users ?? []).filter((u) => {
      if (tierFilter === "paid" && paidKeysOf(u).length === 0) return false;
      if (
        tierFilter === "suspended" &&
        !(activeByKey.get(u.identity) ?? (u.hwid ? activeByKey.get(u.hwid) : undefined))
      )
        return false;
      if (!q) return true;
      return (
        u.userLabel?.toLowerCase().includes(q) ||
        u.identity.toLowerCase().includes(q) ||
        u.hwid?.toLowerCase().includes(q) ||
        u.discordUser?.toLowerCase().includes(q)
      );
    });

    const factor = sortDirection === "asc" ? 1 : -1;
    const restricted = (u: UserRollupRecord) =>
      activeByKey.get(u.identity) ?? (u.hwid ? activeByKey.get(u.hwid) : undefined) ? 1 : 0;

    return list.sort((a, b) => {
      if (sortKey === "access") {
        // Ties keep the recency order, so a page of "Allowed" rows still reads newest first.
        const compared = restricted(a) - restricted(b);
        if (compared !== 0) return compared * factor;
        return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
      }
      const field = sortKey === "first_seen" ? "firstSeen" : "lastSeen";
      return (new Date(a[field]).getTime() - new Date(b[field]).getTime()) * factor;
    });
  }, [users, deferredQuery, tierFilter, activeByKey, sortKey, sortDirection]);

  const paginatedUsers = useMemo(
    () => paginate(filteredUsers, userPage, ACCESS_USER_PAGE_SIZE),
    [filteredUsers, userPage],
  );

  useEffect(() => {
    if (paginatedUsers.page !== userPage) setUserPage(paginatedUsers.page);
  }, [paginatedUsers, userPage]);

  function changeUserPage(page: number) {
    setUserPage(page);
  }

  function changeQuery(value: string) {
    setQuery(value);
    setUserPage(1);
  }

  function clearFilters() {
    setQuery("");
    setTierFilter("all");
    setUserPage(1);
  }

  const sort: SortState = { key: sortKey, direction: sortDirection };
  /** SortHeader hands back the column key; the page owns the direction toggle. */
  function changeSort(next: string) {
    const key = next as SortKey;
    if (key === sortKey) setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("desc");
    }
    setUserPage(1);
  }

  const activeSuspensions = useMemo(
    () => suspensions.filter((r) => isEffective(r, nowMs)),
    [suspensions, nowMs],
  );

  function openAccess(user: UserRollupRecord) {
    const keys = paidKeysOf(user);
    setAccessTarget({
      identity: user.identity,
      hwid: user.hwid,
      label: user.userLabel || user.identity,
      paid: keys.length > 0,
      // "(active license)" is the placeholder for a premium tier with no key on
      // record — the dialog only lists keys it can actually show.
      paidKeys: user.paidLicenseKeys,
    });
  }

  async function confirmLift() {
    if (!liftTarget || lifting) return;
    setLifting(true);
    try {
      await postLiftSuspension(liftTarget.identity);
      setLiftTarget(null);
      await loadSuspensions();
    } catch (e) {
      console.error(e);
    } finally {
      setLifting(false);
    }
  }

  return (
    <div className="page-content page-stack-lg">
      <PageHeader page="access" right={filterBar} />

      {/* ── Users ── */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">Customers</h2>
            <p className="section-sub">
              Suspend or ban a customer's access to the app — paying customers are flagged before
              you do.
            </p>
          </div>
          <div
            className="panel-head-right"
            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
          >
            <SegmentedControl
              aria-label="Customer filter"
              items={TIER_FILTERS}
              value={tierFilter}
              onChange={(key) => {
                setTierFilter(key as "all" | "paid" | "suspended");
                setUserPage(1);
              }}
            />
            <SearchInput
              value={query}
              onChange={changeQuery}
              placeholder="Search customer, HWID, Discord…"
              style={{ maxWidth: 240 }}
            />
            <Badge tone="muted">{filteredUsers.length}</Badge>
          </div>
        </div>

        {users !== null && filteredUsers.length === 0 ? (
          <EmptyState
            icon={<User />}
            title="No customers"
            action={
              query || tierFilter !== "all" ? (
                <Button size="sm" icon={<X size={14} />} onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {query || tierFilter !== "all"
              ? "Nothing matches the current search and filter."
              : "No customers have reported in the selected range yet."}
          </EmptyState>
        ) : (
          <>
            <TableFrame
              paginated
              stickyActions
              mobileLayout="stack"
              aria-busy={users === null || undefined}
            >
              <caption className="table-caption">
                Customers and their app access, sortable by column
              </caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <SortHeader
                    label="Access"
                    sortKey="access"
                    sort={sort}
                    onSortChange={changeSort}
                  />
                  <SortHeader
                    label="First seen"
                    sortKey="first_seen"
                    sort={sort}
                    onSortChange={changeSort}
                  />
                  <SortHeader
                    label="Last seen"
                    sortKey="last_seen"
                    sort={sort}
                    onSortChange={changeSort}
                  />
                  <th scope="col" style={{ textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {users === null && <SkeletonRows columns={ACCESS_COLUMNS} />}
                {paginatedUsers.items.map((u) => {
                  const susp = suspensionForUser(u);
                  const paid = paidKeysOf(u).length > 0;
                  return (
                    <tr key={u.identity}>
                      <td>
                        <RecordCell
                          primary={
                            <RecordLink
                              onClick={() => onOpenWorker?.(u.identity)}
                              title="View customer details"
                            >
                              {u.userLabel || "Unknown customer"}
                            </RecordLink>
                          }
                          secondary={[u.discordUser, paid ? "Premium" : "Free"]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                      </td>
                      <td data-label="Access">
                        {/* The suspensions list is the authority; until it lands the
                            cell stays a skeleton rather than claiming "Allowed". */}
                        {loading ? <Skeleton width={72} height={14} /> : accessBadge(susp)}
                      </td>
                      <td className="muted" data-label="First seen" style={{ whiteSpace: "nowrap" }}>
                        <RelativeTime iso={u.firstSeen} />
                      </td>
                      <td className="muted" data-label="Last seen" style={{ whiteSpace: "nowrap" }}>
                        {u.isActive ? (
                          <span className="status-dot" title="Customer is online right now" />
                        ) : null}{" "}
                        <RelativeTime iso={u.lastSeen} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          permission="access.read"
                          icon={<ShieldCheck size={14} />}
                          onClick={() => openAccess(u)}
                        >
                          Manage access
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
            <TablePagination
              page={paginatedUsers.page}
              pageCount={paginatedUsers.pageCount}
              start={paginatedUsers.start}
              end={paginatedUsers.end}
              total={paginatedUsers.total}
              itemLabel="customers"
              onPageChange={changeUserPage}
            />
          </>
        )}
      </section>

      {/* ── Active suspensions ── */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker kicker-row">
              <ShieldAlert size={12} /> Enforcement
            </p>
            <h2 className="section-title">Active suspensions &amp; bans</h2>
          </div>
          <div className="panel-head-right">
            <Badge tone="muted">{activeSuspensions.length}</Badge>
          </div>
        </div>

        {!loading && activeSuspensions.length === 0 ? (
          <EmptyState allClear title="No one is suspended">
            Every customer currently has access.
          </EmptyState>
        ) : (
          <TableFrame stickyActions mobileLayout="stack" aria-busy={loading || undefined}>
            <caption className="table-caption">Suspensions and bans currently in force</caption>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Type</th>
                <th scope="col" className="col-md">
                  Reason
                </th>
                <th scope="col" className="col-lg">
                  By
                </th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows columns={ACCESS_COLUMNS} rows={3} />}
              {activeSuspensions.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <RecordLink
                        onClick={() => onOpenWorker?.(row.identity)}
                        title="View customer details"
                      >
                        {row.user_label || "Unknown customer"}
                      </RecordLink>
                      {row.had_paid_license === 1 ? (
                        <Badge tone="warning" title="Had an active paid license when suspended">
                          Paid
                        </Badge>
                      ) : null}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.72rem",
                        color: "var(--text-3)",
                      }}
                      title={row.hwid ?? row.identity}
                    >
                      {(row.hwid ?? row.identity).slice(0, 16)}…
                    </div>
                  </td>
                  <td data-label="Type" style={{ whiteSpace: "nowrap" }}>
                    {row.mode === "ban" ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          color: "var(--danger)",
                        }}
                      >
                        <Ban size={13} /> Permanent
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          color: "var(--warning)",
                        }}
                      >
                        <Clock size={13} /> Until {formatDate(row.banned_until ?? "")}
                      </span>
                    )}
                  </td>
                  <td
                    className="muted col-md"
                    data-label="Reason"
                    style={{
                      maxWidth: 260,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.reason ?? undefined}
                  >
                    {row.reason || (
                      <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>—</span>
                    )}
                  </td>
                  <td
                    className="muted col-lg"
                    data-label="By"
                    style={{
                      maxWidth: 180,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.created_by ?? undefined}
                  >
                    {row.created_by || "—"}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      permission="access.write"
                      icon={<RotateCcw size={14} />}
                      onClick={() =>
                        setLiftTarget({
                          identity: row.identity,
                          label: row.user_label || row.identity,
                        })
                      }
                    >
                      Lift
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </section>

      {/* ── Restrict or restore access — the panel-wide dialog ── */}
      {accessTarget ? (
        <CustomerAccessDialog target={accessTarget} onClose={() => setAccessTarget(null)} />
      ) : null}

      {/* ── Lift confirm ── */}
      <Modal
        open={!!liftTarget}
        onClose={() => (lifting ? undefined : setLiftTarget(null))}
        kicker="Restore access"
        title="Lift suspension"
        sub={liftTarget?.label}
      >
        <p style={{ fontSize: "0.8125rem", color: "var(--text-2)", lineHeight: 1.6, marginTop: 4 }}>
          This restores the customer's access. Their app unlocks within one status-poll interval.
        </p>
        <ModalActions>
          <Button variant="ghost" onClick={() => setLiftTarget(null)} disabled={lifting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            permission="access.write"
            onClick={() => void confirmLift()}
            disabled={lifting}
          >
            {lifting ? "Lifting…" : "Lift now"}
          </Button>
        </ModalActions>
      </Modal>
    </div>
  );
}
