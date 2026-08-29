import { Ban, ShieldAlert, ShieldCheck, Clock, User, RotateCcw } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { TablePagination } from "../components/ds/TablePagination";
import { GlassDropdown } from "../components/GlassDropdown";
import { fetchAdminSuspensions, postSuspend, postLiftSuspension } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import { timeAgo, formatDate } from "../utils/format";
import type { SuspensionRecord, UserRollupRecord } from "../types/telemetry";
import { paginate } from "../utils/pagination";

const ACCESS_USER_PAGE_SIZE = 100;

interface AccessPageProps {
  users?: UserRollupRecord[] | null;
  onOpenWorker?: (identity: string) => void;
  filterBar?: ReactNode;
}

type SortMode = "last_seen" | "first_seen" | "active";

const SORT_LABELS: Record<SortMode, string> = {
  last_seen: "Last seen",
  first_seen: "First seen",
  active: "Active first",
};

/** A suspension counts as in force when active and either permanent or still inside its window. */
function isEffective(row: SuspensionRecord, nowMs: number): boolean {
  if (row.is_active !== 1) return false;
  if (!row.banned_until) return true;
  return new Date(row.banned_until).getTime() > nowMs;
}

function paidKeysOf(user: UserRollupRecord): string[] {
  if (user.paidLicenseKeys && user.paidLicenseKeys.length > 0) return user.paidLicenseKeys;
  return user.licenseTier === "premium" ? ["(active license)"] : [];
}

export function AccessPage({ users = null, onOpenWorker, filterBar }: AccessPageProps) {
  const [suspensions, setSuspensions] = useState<SuspensionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [userPage, setUserPage] = useState(1);
  const [tierFilter, setTierFilter] = useState<"all" | "paid" | "suspended">("all");
  const [sortMode, setSortMode] = useState<SortMode>("last_seen");

  const [suspendTarget, setSuspendTarget] = useState<UserRollupRecord | null>(null);
  const [mode, setMode] = useState<"ban" | "suspend">("ban");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

    return list.sort((a, b) => {
      if (sortMode === "active") {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
      }
      if (sortMode === "first_seen") {
        return new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime();
      }
      return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
    });
  }, [users, deferredQuery, tierFilter, activeByKey, sortMode]);

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

  const activeSuspensions = useMemo(
    () => suspensions.filter((r) => isEffective(r, nowMs)),
    [suspensions, nowMs],
  );

  function openSuspend(user: UserRollupRecord) {
    setSuspendTarget(user);
    setMode("ban");
    setUntil("");
    setReason("");
    setFormError(null);
  }

  async function confirmSuspend() {
    if (!suspendTarget || busy) return;
    setFormError(null);

    let bannedUntil: string | null = null;
    if (mode === "suspend") {
      if (!until) {
        setFormError("Pick a date/time for the suspension to end.");
        return;
      }
      const parsed = new Date(until);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= nowMs) {
        setFormError("The suspension end must be in the future.");
        return;
      }
      bannedUntil = parsed.toISOString();
    }

    setBusy(true);
    try {
      const res = await postSuspend({
        identity: suspendTarget.identity,
        hwid: suspendTarget.hwid,
        user_label: suspendTarget.userLabel,
        mode,
        reason: reason.trim() || null,
        banned_until: bannedUntil,
      });
      if (!res.ok) {
        setFormError(res.data?.error ?? "Failed to apply. Please try again.");
        return;
      }
      setSuspendTarget(null);
      await loadSuspensions();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Unexpected error.");
    } finally {
      setBusy(false);
    }
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

  const targetPaidKeys = suspendTarget ? paidKeysOf(suspendTarget) : [];

  return (
    <div className="page-content page-stack-lg">
      <PageHeader kicker="Access" title="Access Control" right={filterBar} />

      {/* ── Users ── */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">Users</h2>
            <p className="section-sub">
              Suspend or ban a user's access to the app — paid users are flagged before you do.
            </p>
          </div>
          <div
            className="panel-head-right"
            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
          >
            <div
              style={{
                display: "flex",
                gap: 4,
                background: "var(--surface-2)",
                padding: 4,
                borderRadius: 8,
                border: "1px solid var(--line)",
              }}
            >
              {(
                [
                  ["all", "All"],
                  ["paid", "Paid"],
                  ["suspended", "Suspended"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTierFilter(key);
                    setUserPage(1);
                  }}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: "none",
                    background:
                      tierFilter === key
                        ? "var(--surface-1, rgba(255,255,255,0.06))"
                        : "transparent",
                    color: tierFilter === key ? "var(--text-1)" : "var(--text-2)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <GlassDropdown
              placeholder="Last seen"
              options={["last_seen", "first_seen", "active"]}
              value={sortMode === "last_seen" ? null : sortMode}
              onChange={(next) => {
                setSortMode((next as SortMode) ?? "last_seen");
                setUserPage(1);
              }}
              renderOption={(o) => SORT_LABELS[o as SortMode]}
            />
            <SearchInput
              value={query}
              onChange={changeQuery}
              placeholder="Search user, HWID, Discord…"
              style={{ maxWidth: 240 }}
            />
            <Badge tone="muted">{filteredUsers.length}</Badge>
          </div>
        </div>

        {users === null ? (
          <div className="panel-body" aria-label="Loading user directory">
            <div className="skeleton" style={{ height: 14, width: 220 }} />
          </div>
        ) : filteredUsers.length === 0 ? (
          <EmptyState icon={<User />} title="No users">
            {query
              ? "No users match your search."
              : "No users have reported in the selected range yet."}
          </EmptyState>
        ) : (
          <>
            <div className="data-table-wrap data-table-wrap-paginated">
              {/* DS .data-table — one table anatomy console-wide. */}
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>{sortMode === "first_seen" ? "First seen" : "Last seen"}</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUsers.items.map((u) => {
                    const susp = suspensionForUser(u);
                    const paid = paidKeysOf(u).length > 0;
                    return (
                      <tr key={u.identity}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {/* Plain-text name; hover reveals the link affordance. Click opens the
                            user's detail view (Sessions). */}
                            <button
                              type="button"
                              onClick={() => onOpenWorker?.(u.identity)}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.textDecoration = "underline";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.textDecoration = "none";
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: onOpenWorker ? "pointer" : "default",
                                color: "var(--text-1)",
                                padding: 0,
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                textAlign: "left",
                              }}
                              title="View user details"
                            >
                              {u.userLabel || "Unknown user"}
                            </button>
                            {paid ? <Badge tone="warning">Paid</Badge> : null}
                            {susp ? (
                              <Badge tone="danger">
                                {susp.mode === "ban" ? "Banned" : "Suspended"}
                              </Badge>
                            ) : null}
                          </div>
                          {u.discordUser ? (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-3)" }}>
                              {u.discordUser}
                            </div>
                          ) : null}
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>
                          {timeAgo(sortMode === "first_seen" ? u.firstSeen : u.lastSeen)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {susp ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<RotateCcw size={14} />}
                              onClick={() =>
                                setLiftTarget({
                                  identity: susp.identity,
                                  label: u.userLabel || susp.identity,
                                })
                              }
                            >
                              Lift
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={<Ban size={14} />}
                              onClick={() => openSuspend(u)}
                            >
                              Suspend
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={paginatedUsers.page}
              pageCount={paginatedUsers.pageCount}
              start={paginatedUsers.start}
              end={paginatedUsers.end}
              total={paginatedUsers.total}
              itemLabel="users"
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

        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-2)" }}>
            <div className="spinner spinner-md" style={{ margin: "0 auto 12px" }} />
            Loading…
          </div>
        ) : activeSuspensions.length === 0 ? (
          <EmptyState allClear title="No one is suspended">
            Every user currently has access.
          </EmptyState>
        ) : (
          <div className="data-table-wrap">
            {/* DS .data-table — one table anatomy console-wide. */}
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Type</th>
                  <th className="col-md">Reason</th>
                  <th className="col-lg">By</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeSuspensions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => onOpenWorker?.(row.identity)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.textDecoration = "underline";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.textDecoration = "none";
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: onOpenWorker ? "pointer" : "default",
                            color: "var(--text-1)",
                            padding: 0,
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                            textAlign: "left",
                          }}
                          title="View user details"
                        >
                          {row.user_label || "Unknown user"}
                        </button>
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
                    <td style={{ whiteSpace: "nowrap" }}>
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
            </table>
          </div>
        )}
      </section>

      {/* ── Suspend modal ── */}
      <Modal
        open={!!suspendTarget}
        onClose={() => (busy ? undefined : setSuspendTarget(null))}
        kicker="Restrict access"
        title={mode === "ban" ? "Ban user" : "Suspend user"}
        sub={suspendTarget?.userLabel || suspendTarget?.identity}
      >
        {suspendTarget ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 16 }}>
            {targetPaidKeys.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "var(--warning-sub)",
                  border: "1px solid color-mix(in srgb, var(--warning) 32%, transparent)",
                }}
              >
                <ShieldAlert
                  size={16}
                  style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }}
                />
                <div style={{ fontSize: "0.8125rem", color: "var(--text-1)", lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--warning)" }}>This user has paid.</strong> An active
                  license is bound to this machine
                  {targetPaidKeys[0] !== "(active license)" ? (
                    <>
                      {" "}
                      (
                      <span style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>
                        {targetPaidKeys.join(", ")}
                      </span>
                      )
                    </>
                  ) : null}
                  . Removing access revokes something they paid for — proceed only if you're sure.
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: "0.8125rem",
                  color: "var(--text-2)",
                }}
              >
                <ShieldCheck size={15} style={{ color: "var(--text-3)" }} /> Free user — no
                purchased license found on this machine.
              </div>
            )}

            {/* mode toggle */}
            <div
              style={{
                display: "flex",
                gap: 6,
                background: "var(--surface-2)",
                padding: 4,
                borderRadius: 8,
                border: "1px solid var(--line)",
                width: "fit-content",
              }}
            >
              {(["ban", "suspend"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    border: "none",
                    background: mode === m ? "var(--surface-1, var(--surface-2))" : "transparent",
                    color: mode === m ? "var(--text-1)" : "var(--text-2)",
                    boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.25)" : "none",
                  }}
                >
                  {m === "ban" ? "Permanent ban" : "Timed suspend"}
                </button>
              ))}
            </div>

            {mode === "suspend" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="label-sm">Suspended until</label>
                <input
                  type="datetime-local"
                  className="glass-input"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="label-sm">Reason (shown to the user)</label>
              <textarea
                className="glass-input"
                rows={3}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Sharing releases outside the community"
                style={{ resize: "vertical" }}
              />
            </div>

            {formError ? (
              <p style={{ color: "var(--danger)", fontSize: "0.8125rem", margin: 0 }}>
                {formError}
              </p>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <Button variant="ghost" onClick={() => setSuspendTarget(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmSuspend()} disabled={busy}>
                {busy ? "Applying…" : mode === "ban" ? "Ban access" : "Suspend access"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Lift confirm ── */}
      <Modal
        open={!!liftTarget}
        onClose={() => (lifting ? undefined : setLiftTarget(null))}
        kicker="Restore access"
        title="Lift suspension"
        sub={liftTarget?.label}
      >
        <p style={{ fontSize: "0.8125rem", color: "var(--text-2)", lineHeight: 1.6, marginTop: 4 }}>
          This restores the user's access. Their app unlocks within one status-poll interval.
        </p>
        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <Button variant="ghost" onClick={() => setLiftTarget(null)} disabled={lifting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void confirmLift()} disabled={lifting}>
            {lifting ? "Lifting…" : "Lift now"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
