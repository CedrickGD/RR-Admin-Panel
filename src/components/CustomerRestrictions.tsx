/**
 * Customers → Restrictions: every suspension and ban the panel has issued — active ones first —
 * with the customer named, the reason, who issued it, and a Lift action (handoff 2026-09-12 §2.7).
 * Before this tab a ban could only be lifted from inside one customer's access dialog, so lifting
 * meant already knowing who the customer was.
 *
 * CustomersPage owns the records (it loads them once, which also feeds the tab label's count);
 * this tab names, filters and optimistically updates them. The rules live in utils/restrictions.
 */
import { Ban, Check, Clock3, RotateCcw, Search, ShieldCheck } from "lucide-react";
import {
  useCallback,
  useContext,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { PanelIdentity, usePanelPermission } from "../hooks/usePanelPermission";
import type { SuspensionRecord, UserRollupRecord } from "../types/telemetry";
import { postLiftSuspension } from "../utils/api";
import { openCustomerWorkspace, type CustomerWorkspaceTarget } from "../utils/customerNavigation";
import { formatDate, formatDay, formatNumber } from "../utils/format";
import { emitRefresh } from "../utils/refreshBus";
import {
  DEFAULT_RESTRICTION_FILTERS,
  RECENT_LIFT_DAYS,
  filterRestrictions,
  isDefaultRestrictionFilters,
  remainingTime,
  summarizeRestrictions,
  toRestrictionEntries,
  type RestrictionEntry,
  type RestrictionFilters,
  type RestrictionTypeFilter,
  type RestrictionView,
} from "../utils/restrictions";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { CustomerAvatar, useCustomerProfiles } from "./CustomerProfiles";
import { Badge } from "./ds/Badge";
import { Button } from "./ds/Button";
import { DataTable, type DataTableColumn } from "./ds/DataTable";
import { EmptyState } from "./ds/EmptyState";
import { Modal, ModalActions } from "./ds/Modal";
import { PageToolbar } from "./ds/PageToolbar";
import { RelativeTime } from "./ds/RelativeTime";
import { SearchInput } from "./ds/SearchInput";
import { SegmentedControl, type TabItem } from "./ds/SegmentedControl";
import { Select } from "./ds/Select";
import { SkeletonRows } from "./ds/Skeleton";
import { RecordCell, RecordOpen, TableFrame } from "./ds/TableFrame";

const NO_WRAP: CSSProperties = { whiteSpace: "nowrap" };

const VIEWS: TabItem<RestrictionView>[] = [
  { key: "active", label: "Active" },
  { key: "lifted", label: "Lifted" },
  { key: "all", label: "All" },
];

export interface CustomerRestrictionsProps {
  /** Every record from GET /api/admin/access; null until the first answer. */
  records: SuspensionRecord[] | null;
  /** Why the last load failed; shown with a retry. */
  loadError: string | null;
  /** Directory rows (already merged with customer profiles) that name a record's customer. */
  users: UserRollupRecord[] | null;
  onReload: () => void;
  /** Applies an optimistic change to the loaded records. */
  onRecordsChange: (update: (records: SuspensionRecord[]) => SuspensionRecord[]) => void;
}

/** A server answer the admin can act on, as opposed to a dropped connection. */
class LiftError extends Error {}

function identifierKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

/** Customer 360 anchored the way the directory anchors a row: the hwid first, else the install. */
function workspaceTarget(entry: RestrictionEntry): CustomerWorkspaceTarget {
  const { record } = entry;
  const label = entry.name ?? "Unknown customer";
  return record.hwid
    ? { selector: "hwid", value: record.hwid, label }
    : { selector: "install_id", value: record.install_id ?? record.identity, label };
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 16)}…` : value;
}

function restrictionLabel(record: SuspensionRecord): string {
  return record.mode === "ban" || !record.banned_until
    ? "Permanent ban"
    : `Suspended until ${formatDay(record.banned_until)}`;
}

export function CustomerRestrictions({
  records,
  loadError,
  users,
  onReload,
  onRecordsChange,
}: CustomerRestrictionsProps) {
  const canWrite = usePanelPermission("access.write");
  const actor = useContext(PanelIdentity)?.email ?? null;
  const findProfile = useCustomerProfiles();
  const [filters, setFilters] = useState<RestrictionFilters>(DEFAULT_RESTRICTION_FILTERS);
  const deferredQuery = useDeferredValue(filters.query);
  const [target, setTarget] = useState<RestrictionEntry | null>(null);
  // The dialog keeps its copy while it animates out after `target` is cleared.
  const lastTarget = useRef<RestrictionEntry | null>(null);
  if (target) lastTarget.current = target;
  const dialogEntry = target ?? lastTarget.current;
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const usersByKey = useMemo(() => {
    const map = new Map<string, UserRollupRecord>();
    for (const user of users ?? []) {
      for (const key of [identifierKey(user.identity), identifierKey(user.hwid)]) {
        if (key && !map.has(key)) map.set(key, user);
      }
    }
    return map;
  }, [users]);

  const identify = useCallback(
    (record: SuspensionRecord) => {
      const profile = findProfile(record.install_id ?? record.identity, record.hwid);
      const user = [record.identity, record.hwid, record.install_id]
        .map(identifierKey)
        .map((key) => (key ? usersByKey.get(key) : undefined))
        .find(Boolean);
      return {
        name: profile?.displayName || user?.userLabel || null,
        discord: profile?.discordUsername || user?.discordUser || null,
      };
    },
    [findProfile, usersByKey],
  );

  // Re-read with every load, so "18 days left" and active/expired follow the data's refreshes.
  const nowMs = useMemo(() => Date.now(), [records]);
  const entries = useMemo(
    () => toRestrictionEntries(records ?? [], identify, nowMs),
    [records, identify, nowMs],
  );
  const shown = useMemo(
    () => filterRestrictions(entries, { ...filters, query: deferredQuery }),
    [entries, filters, deferredQuery],
  );
  const summary = useMemo(() => summarizeRestrictions(entries, nowMs), [entries, nowMs]);
  const filtered = !isDefaultRestrictionFilters(filters);

  function update(next: Partial<RestrictionFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  async function lift(entry: RestrictionEntry) {
    const before = entry.record;
    const name = entry.name ?? before.identity;
    const liftedAt = new Date().toISOString();
    setTarget(null);
    setNotice("");
    setError("");
    onRecordsChange((rows) =>
      rows.map((row) =>
        row.identity === before.identity
          ? { ...row, is_active: 0, lifted_at: liftedAt, lifted_by: actor, updated_at: liftedAt }
          : row,
      ),
    );
    try {
      const result = await postLiftSuspension(before.identity);
      if (!result.ok) {
        throw new LiftError(
          result.status === 403
            ? "You do not have permission to lift restrictions."
            : result.status === 404
              ? `The restriction for ${name} no longer exists.`
              : `The restriction for ${name} could not be lifted. Please try again.`,
        );
      }
      setNotice(`Restriction lifted for ${name}. Their app unlocks within one status poll.`);
    } catch (err) {
      onRecordsChange((rows) =>
        rows.map((row) => (row.identity === before.identity ? before : row)),
      );
      setError(
        err instanceof LiftError
          ? err.message
          : `The restriction for ${name} could not be lifted. Check the connection and try again.`,
      );
    } finally {
      // The list here and the directory's rows (Support badge, "Needs attention") re-pull from
      // the server, so switching back to Directory never shows the lifted ban.
      emitRefresh();
    }
  }

  const showEnded = shown.some((entry) => entry.state !== "active");
  const showActions = canWrite && shown.some((entry) => entry.state === "active");

  const columns: DataTableColumn<RestrictionEntry>[] = [
    {
      key: "customer",
      header: "Customer",
      render: (entry) => {
        const { record } = entry;
        const id = record.hwid ?? record.identity;
        const name = entry.name ?? "Unknown customer";
        return (
          // The whole head — avatar, name and the facts under it — opens Customer 360, the
          // way the directory's rows do (ds/RecordOpen): on the stacked phone card the tap
          // target is the card head, on the desktop the name still reads as the record link.
          <RecordOpen
            className="person-cell customer-directory-open"
            title="Open Customer 360"
            aria-label={`Open Customer 360 for ${name}`}
            onClick={(event) => {
              // Safari does not focus a tapped button; the workspace hands focus back to
              // whatever had it, so make sure that is this head.
              event.currentTarget.focus();
              openCustomerWorkspace(workspaceTarget(entry));
            }}
          >
            <CustomerAvatar
              profile={findProfile(record.install_id ?? record.identity, record.hwid)}
              label={entry.name ?? record.identity}
            />
            <RecordCell
              primary={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span className="record-link">{name}</span>
                  {record.had_paid_license === 1 ? (
                    <Badge tone="muted" title="Had an active paid license when restricted">
                      Paid
                    </Badge>
                  ) : null}
                </span>
              }
              secondary={
                <span title={id}>
                  {[entry.discord ? `@${entry.discord}` : null, shortId(id)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              }
            />
          </RecordOpen>
        );
      },
    },
    {
      key: "type",
      header: "Type",
      render: ({ record, state }) => {
        const permanent = record.mode === "ban" || !record.banned_until;
        if (state === "active") {
          return permanent ? (
            <Badge tone="danger">Permanent</Badge>
          ) : (
            <div className="customer-directory-stacked">
              <span>
                <Badge
                  tone="warning"
                  title={`Lifts automatically on ${formatDate(record.banned_until)}`}
                >
                  Until {formatDay(record.banned_until)}
                </Badge>
              </span>
              <small style={NO_WRAP}>{remainingTime(record.banned_until!, nowMs)}</small>
            </div>
          );
        }
        return (
          <div className="customer-directory-stacked">
            <span>
              <Badge tone="muted">{state === "lifted" ? "Lifted" : "Expired"}</Badge>
            </span>
            <small style={NO_WRAP}>
              {state === "expired"
                ? `ended ${formatDay(record.banned_until)}`
                : permanent
                  ? "was permanent"
                  : `was until ${formatDay(record.banned_until)}`}
            </small>
          </div>
        );
      },
    },
    {
      key: "reason",
      header: "Reason",
      render: ({ record }) =>
        record.reason ? (
          <span
            className="cell-truncate"
            style={{ display: "block", "--cell-max": "360px" } as CSSProperties}
            title={record.reason}
          >
            {record.reason}
          </span>
        ) : (
          <span className="muted">No reason given</span>
        ),
    },
    {
      key: "issued",
      header: "Issued",
      render: (entry) => (
        <div className="customer-directory-stacked">
          <span title={entry.record.created_by ?? undefined}>
            {entry.record.created_by ?? "Issuer not recorded"}
          </span>
          <small>
            <RelativeTime iso={entry.issuedAt} />
          </small>
        </div>
      ),
    },
    ...(showEnded
      ? [
          {
            key: "ended",
            header: "Lifted",
            render: (entry: RestrictionEntry) =>
              entry.state !== "lifted" ? (
                <span className="muted">—</span>
              ) : (
                <div className="customer-directory-stacked">
                  <span title={entry.record.lifted_by ?? undefined}>
                    {entry.record.lifted_by ?? "Not recorded"}
                  </span>
                  <small>
                    <RelativeTime iso={entry.endedAt} />
                  </small>
                </div>
              ),
          },
        ]
      : []),
    ...(showActions
      ? [
          {
            key: "actions",
            header: "",
            render: (entry: RestrictionEntry) =>
              entry.state === "active" ? (
                <div className="row-actions">
                  <Button
                    size="sm"
                    permission="access.write"
                    icon={<RotateCcw />}
                    aria-label={`Lift restriction for ${entry.name ?? entry.record.identity}`}
                    onClick={() => setTarget(entry)}
                  >
                    Lift
                  </Button>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  function renderBody() {
    if (records === null) {
      return loadError ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="Restrictions could not be loaded"
          action={
            <Button size="sm" onClick={onReload}>
              Retry
            </Button>
          }
        >
          {loadError}
        </EmptyState>
      ) : (
        <TableFrame mobileLayout="stack" aria-busy>
          <caption className="table-caption">Loading customer restrictions</caption>
          <tbody>
            <SkeletonRows columns={4} rows={3} />
          </tbody>
        </TableFrame>
      );
    }
    if (shown.length === 0) {
      if (filters.query.trim() || filters.type) {
        return (
          <EmptyState
            icon={<Search />}
            title="No restrictions match"
            action={
              <Button
                size="sm"
                icon={<RotateCcw />}
                onClick={() => setFilters(DEFAULT_RESTRICTION_FILTERS)}
              >
                Reset
              </Button>
            }
          >
            Nothing matches the current search and type.
          </EmptyState>
        );
      }
      if (filters.view === "active") {
        return (
          <EmptyState icon={<ShieldCheck />} title="No active restrictions">
            Every customer currently has app access.
          </EmptyState>
        );
      }
      return (
        <EmptyState icon={<RotateCcw />} title="Nothing lifted yet">
          Restrictions you lift, and suspensions that run out, are kept here.
        </EmptyState>
      );
    }
    return (
      <DataTable
        caption="Customer restrictions, active first and newest on top"
        columns={columns}
        rows={shown}
        rowKey={(entry) => entry.record.id}
        stickyActions={showActions}
        mobileLayout="stack"
      />
    );
  }

  const count = (value: number) => (records ? formatNumber(value) : "—");

  return (
    <>
      <div className="team-summary customer-restrictions-summary" aria-label="Restriction summary">
        <span>
          <Ban />
          <strong>{count(summary.permanent)}</strong>
          permanent
        </span>
        <span>
          <Clock3 />
          <strong>{count(summary.temporary)}</strong>
          temporary
        </span>
        <span>
          <RotateCcw />
          <strong>{count(summary.liftedRecently)}</strong>
          lifted in {RECENT_LIFT_DAYS} days
        </span>
      </div>

      {notice ? (
        <div className="inline-notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      ) : null}
      {error || (loadError && records !== null) ? (
        <div className="inline-notice danger" role="alert">
          {error || loadError}
          {!error ? (
            <Button size="sm" onClick={onReload}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* The one filter place of this tab, directly above the list it filters. */}
      <PageToolbar
        aria-label="Restriction filters"
        canReset={filtered}
        onReset={() => setFilters(DEFAULT_RESTRICTION_FILTERS)}
        left={
          <SegmentedControl
            aria-label="Restriction status"
            items={VIEWS}
            value={filters.view}
            onChange={(view) => update({ view })}
          />
        }
        search={
          <SearchInput
            aria-label="Search restrictions"
            value={filters.query}
            onChange={(query) => update({ query })}
            placeholder="Search customer, HWID, Discord, reason or issuer…"
          />
        }
        filters={
          <Select
            aria-label="Restriction type"
            value={filters.type}
            onValueChange={(value) => update({ type: value as RestrictionTypeFilter })}
          >
            <option value="">All types</option>
            <option value="ban">Permanent</option>
            <option value="suspend">Temporary</option>
          </Select>
        }
      />

      <CollapsiblePanel
        kicker="Enforcement"
        title="Restrictions"
        collapsible={false}
        sub={
          records
            ? `${formatNumber(shown.length)} of ${formatNumber(entries.length)} shown`
            : "Loading customer restrictions…"
        }
      >
        <div className="panel-body-flush">{renderBody()}</div>
      </CollapsiblePanel>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Lift restriction"
        sub={dialogEntry ? (dialogEntry.name ?? dialogEntry.record.identity) : undefined}
      >
        {dialogEntry ? (
          <>
            <p className="confirm-copy">
              {restrictionLabel(dialogEntry.record)}
              {dialogEntry.record.created_by ? `, issued by ${dialogEntry.record.created_by}` : ""}
              {dialogEntry.record.reason ? ` · ${dialogEntry.record.reason}` : ""}
            </p>
            <p className="confirm-copy">
              The customer’s app unlocks within one status poll. The record stays in this list under
              Lifted.
            </p>
          </>
        ) : null}
        <ModalActions>
          <Button variant="ghost" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            permission="access.write"
            icon={<RotateCcw />}
            onClick={() => target && void lift(target)}
          >
            Lift restriction
          </Button>
        </ModalActions>
      </Modal>
    </>
  );
}
