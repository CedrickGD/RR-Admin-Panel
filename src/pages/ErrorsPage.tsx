import { Select } from "../components/ds/Select";
import { TableFrame } from "../components/ds/TableFrame";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Search,
  Timer,
  Users as UsersIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { RowExpandClip } from "../components/RowExpandClip";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { DetailGrid } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { Tag } from "../components/ds/Tag";
import { useAdminErrors } from "../hooks/useAdminErrors";
import type { ErrorEventDetail, ErrorsRangeKey, ErrorUserGroup } from "../types/telemetry";
import { formatDate, formatNumber, timeAgo } from "../utils/format";

type ViewKey = "users" | "failures";
type SortKey = "errors" | "firstError" | "lastError";
type SortDir = "asc" | "desc";

const RANGES: Array<{ key: ErrorsRangeKey; label: string; title: string }> = [
  { key: "1h", label: "1 h", title: "Last hour" },
  { key: "6h", label: "6 h", title: "Last 6 hours" },
  { key: "12h", label: "12 h", title: "Last 12 hours" },
  { key: "24h", label: "24 h", title: "Last 24 hours" },
  { key: "3d", label: "3 d", title: "Last 3 days" },
  { key: "7d", label: "7 d", title: "Last 7 days" },
  { key: "30d", label: "30 d", title: "Last 30 days" },
  { key: "all", label: "All", title: "Full retained history (90 days)" },
];

const BACKGROUND_KIND = "background";
const UNATTRIBUTED_IDENTITY = "unattributed";
const USER_COLUMN_COUNT = 10;
const SKELETON_ROWS = 6;
const EVENTS_PREVIEW_COUNT = 25;
const FAILURE_OCCURRENCES_SHOWN = 50;

const KIND_LABELS: Record<string, string> = {
  background: "Background Task",
  unhandled: "Unhandled",
};

interface VisibleGroup extends ErrorUserGroup {
  visibleEvents: ErrorEventDetail[];
  visibleCount: number;
  /** First/last error under the current background toggle (events ship newest-first). */
  firstAt: string;
  lastAt: string;
}

interface FailureGroup {
  key: string;
  type: string;
  message: string;
  kind: string | null;
  code: string | null;
  count: number;
  identities: Set<string>;
  latest: ErrorEventDetail;
  occurrences: Array<{ event: ErrorEventDetail; user: VisibleGroup }>;
}

/* ── helpers ─────────────────────────────────────────────────── */

function kindLabel(kind: string | null): string {
  if (!kind) return "unclassified";
  return KIND_LABELS[kind] ?? kind;
}

function kindTone(kind: string | null): "danger" | "warning" | "muted" {
  if (kind === "unhandled") return "danger";
  if (kind === BACKGROUND_KIND) return "warning";
  return "muted";
}

function parseTimestamp(value: string | null | undefined): number {
  const ts = Date.parse(value ?? "");
  return Number.isFinite(ts) ? ts : 0;
}

function isUnattributed(group: ErrorUserGroup): boolean {
  return group.identity === UNATTRIBUTED_IDENTITY;
}

function displayName(group: ErrorUserGroup): string {
  if (group.userLabel?.trim()) return group.userLabel.trim();
  if (isUnattributed(group)) return "Unattributed";
  return group.identity;
}

function userLocation(group: ErrorUserGroup): string {
  return [group.city, group.country].filter((v): v is string => Boolean(v?.trim())).join(", ");
}

function versionLabel(version: string | null): string {
  if (!version?.trim()) return "—";
  return version === "legacy" ? "Legacy (pre-1.4)" : version;
}

/** Discord handles render as muted `@name` — strip a stored leading @ so we never double it. */
function discordHandle(value: string): string {
  return `@${value.trim().replace(/^@/, "")}`;
}

function shortId(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value;
}

function sortValue(group: VisibleGroup, key: SortKey): number {
  switch (key) {
    case "errors":
      return group.visibleCount;
    case "firstError":
      return parseTimestamp(group.firstAt);
    case "lastError":
      return parseTimestamp(group.lastAt);
  }
}

function topType(group: VisibleGroup): { type: string; more: number } | null {
  const counts = new Map<string, number>();
  for (const event of group.visibleEvents) {
    const type = event.type?.trim() || "unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { type: ranked[0][0], more: ranked.length - 1 };
}

/* ── presentational pieces ──────────────────────────────────── */

interface SortableThProps {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  /** Column-priority tag (col-xl / col-lg / col-md) — hides with its tds on narrow viewports. */
  className?: string;
}

function SortableTh({ label, sortKey, activeKey, dir, onSort, className }: SortableThProps) {
  const isActive = activeKey === sortKey;
  return (
    <th
      className={className}
      onClick={() => onSort(sortKey)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {isActive ? (
          dir === "asc" ? (
            <ArrowUp size={12} style={{ color: "var(--accent)" }} />
          ) : (
            <ArrowDown size={12} style={{ color: "var(--accent)" }} />
          )
        ) : null}
      </span>
    </th>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <tr key={`skeleton-${row}`}>
          {Array.from({ length: USER_COLUMN_COUNT }, (_, col) => (
            <td key={col}>
              <div className="skeleton" style={{ height: 12, width: col === 0 ? 120 : 48 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** One collected error, rendered in full: type, kind, message, and every leftover metric. */
function ErrorEventCard({ event }: { event: ErrorEventDetail }) {
  const extras = Object.entries(event.extras);
  return (
    <div className="glass-inset" style={{ padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <AlertTriangle
          size={13}
          style={{
            flexShrink: 0,
            color: event.kind === BACKGROUND_KIND ? "var(--warning)" : "var(--danger)",
          }}
        />
        <span
          className="mono"
          style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-1)" }}
        >
          {event.type?.trim() || "error"}
        </span>
        <Badge tone={kindTone(event.kind)}>{kindLabel(event.kind)}</Badge>
        {event.code ? <Tag title="Error code">{event.code}</Tag> : null}
        <span
          className="mono"
          style={{
            marginLeft: "auto",
            fontSize: "0.6875rem",
            color: "var(--text-3)",
            whiteSpace: "nowrap",
          }}
          title={event.receivedAt ? `Received ${formatDate(event.receivedAt)}` : undefined}
        >
          {formatDate(event.timestamp)} · {timeAgo(event.timestamp)}
        </span>
      </div>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "0.78125rem",
          color: "var(--text-1)",
          lineHeight: 1.55,
          wordBreak: "break-word",
        }}
      >
        {event.message?.trim() || "(no message)"}
      </p>
      {event.appVersion || event.sessionId || extras.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {event.appVersion ? (
            <span className="error-metric-tag">version: {event.appVersion}</span>
          ) : null}
          {event.sessionId ? (
            <span className="error-metric-tag" title={event.sessionId}>
              session: {shortId(event.sessionId)}
            </span>
          ) : null}
          {extras.map(([key, value]) => (
            <span key={key} className="error-metric-tag" title={`${key}: ${value}`}>
              {key}: {value}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────── */

export function ErrorsPage() {
  const [range, setRange] = useState<ErrorsRangeKey>("24h");
  const [view, setView] = useState<ViewKey>("users");
  const [query, setQuery] = useState("");
  const [showBackground, setShowBackground] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<string[]>([]);
  // "Has ever expanded" memory — rows never expanded keep costing nothing (no detail DOM).
  const [expandedEverUsers, setExpandedEverUsers] = useState<Set<string>>(new Set());
  const [expandedFailures, setExpandedFailures] = useState<string[]>([]);
  const [showAllEvents, setShowAllEvents] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("lastError");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, loading, error, refresh } = useAdminErrors(true, range);

  // A payload for a different range is stale, not current — render skeletons
  // instead of last range's numbers under this range's labels.
  const current = data && data.range === range ? data : null;

  /* ── background-toggle-aware groups (pre-search) ──────────── */
  const visibleGroups = useMemo<VisibleGroup[] | null>(() => {
    if (!current) return null;
    return current.users
      .map((group) => {
        const visibleEvents = showBackground
          ? group.events
          : group.events.filter((event) => event.kind !== BACKGROUND_KIND);
        return {
          ...group,
          visibleEvents,
          visibleCount: showBackground
            ? group.errorCount + group.backgroundCount
            : group.errorCount,
          // Events ship newest-first; the newest visible one is exact. The oldest is
          // only exact when nothing was capped away — otherwise keep the server bound.
          lastAt: visibleEvents[0]?.timestamp ?? group.lastErrorAt,
          firstAt:
            !group.truncated && visibleEvents.length > 0
              ? visibleEvents[visibleEvents.length - 1].timestamp
              : group.firstErrorAt,
        };
      })
      .filter((group) => group.visibleCount > 0);
  }, [current, showBackground]);

  /* ── searched + sorted rows for the users table ───────────── */
  const rows = useMemo(() => {
    if (!visibleGroups) return null;
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? visibleGroups
      : visibleGroups.filter((group) => {
          const hay = [
            group.userLabel ?? "",
            group.identity,
            group.discordUser ?? "",
            group.hwid ?? "",
            group.installId ?? "",
            group.country ?? "",
            group.city ?? "",
            group.platform ?? "",
            group.displayVersion ?? "",
            group.appVersion ?? "",
            group.deviceModel ?? "",
            ...group.visibleEvents.flatMap((event) => [
              event.type ?? "",
              event.message ?? "",
              event.code ?? "",
            ]),
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
    const factor = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (sortValue(a, sortKey) - sortValue(b, sortKey)) * factor);
  }, [visibleGroups, query, sortKey, sortDir]);

  /* ── failure-centric grouping (grouped first, THEN searched, so a query
        matches the failure itself or a hit user — never a user's unrelated
        errors dragged along) ─────────────────────────────────── */
  const failures = useMemo<FailureGroup[] | null>(() => {
    if (!visibleGroups) return null;
    const map = new Map<string, FailureGroup>();
    for (const user of visibleGroups) {
      for (const event of user.visibleEvents) {
        const key = `${event.type ?? "unknown"}::${event.message ?? ""}`;
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
          existing.identities.add(user.identity);
          existing.occurrences.push({ event, user });
          if (parseTimestamp(event.timestamp) > parseTimestamp(existing.latest.timestamp))
            existing.latest = event;
        } else {
          map.set(key, {
            key,
            type: event.type?.trim() || "unknown",
            message: event.message?.trim() || "No message",
            kind: event.kind,
            code: event.code,
            count: 1,
            identities: new Set([user.identity]),
            latest: event,
            occurrences: [{ event, user }],
          });
        }
      }
    }
    const q = query.trim().toLowerCase();
    const groups = [...map.values()].filter((group) => {
      if (!q) return true;
      if ([group.type, group.message, group.code ?? ""].join(" ").toLowerCase().includes(q))
        return true;
      return group.occurrences.some(({ user }) =>
        [user.userLabel ?? "", user.identity, user.discordUser ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    });
    for (const group of groups) {
      group.occurrences.sort(
        (a, b) => parseTimestamp(b.event.timestamp) - parseTimestamp(a.event.timestamp),
      );
    }
    return groups.sort(
      (a, b) => parseTimestamp(b.latest.timestamp) - parseTimestamp(a.latest.timestamp),
    );
  }, [visibleGroups, query]);

  /* ── KPI values (respect the background toggle, not search) ── */
  const kpis = useMemo(() => {
    if (!current || !visibleGroups) return null;
    const errorsInRange = showBackground
      ? current.totals.errors + current.totals.backgroundErrors
      : current.totals.errors;
    let lastErrorAt: string | null = null;
    for (const group of visibleGroups) {
      if (lastErrorAt === null || parseTimestamp(group.lastAt) > parseTimestamp(lastErrorAt)) {
        lastErrorAt = group.lastAt;
      }
    }
    return { errorsInRange, affectedUsers: visibleGroups.length, lastErrorAt };
  }, [current, visibleGroups, showBackground]);

  const rangeTitle = RANGES.find((r) => r.key === range)?.title ?? "Selected range";
  const backgroundTotal = current?.totals.backgroundErrors ?? 0;

  /* ── interactions ─────────────────────────────────────────── */
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function toggleUser(identity: string) {
    setExpandedUsers((curr) =>
      curr.includes(identity) ? curr.filter((id) => id !== identity) : [...curr, identity],
    );
    setExpandedEverUsers((prev) => (prev.has(identity) ? prev : new Set(prev).add(identity)));
  }

  function toggleFailure(key: string) {
    setExpandedFailures((curr) =>
      curr.includes(key) ? curr.filter((k) => k !== key) : [...curr, key],
    );
  }

  function toggleShowAllEvents(identity: string) {
    setShowAllEvents((curr) => {
      const next = new Set(curr);
      next.has(identity) ? next.delete(identity) : next.add(identity);
      return next;
    });
  }

  /** From a failure occurrence straight to that user's row in the users view. */
  function jumpToUser(identity: string) {
    setView("users");
    setQuery(identity);
    setExpandedUsers([identity]);
    setExpandedEverUsers((prev) => (prev.has(identity) ? prev : new Set(prev).add(identity)));
  }

  /* ── render ───────────────────────────────────────────────── */
  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Failures"
        title="Errors"
        sub="Every collected error, linked to the user it came from."
        right={
          <>
            <Select
              aria-label="Time window"
              value={range}
              onValueChange={(value) => setRange(value as ErrorsRangeKey)}
            >
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.title}
                </option>
              ))}
            </Select>
            <div className="seg-control">
              {(
                [
                  { key: "users", label: "By User" },
                  { key: "failures", label: "By Failure" },
                ] as Array<{ key: ViewKey; label: string }>
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`seg-btn${view === t.key ? " active" : ""}`}
                  onClick={() => setView(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </>
        }
      />

      {/* KPIs */}
      <div className="stat-grid stat-grid-3">
        <KpiStatCard
          label="Errors in Range"
          value={kpis ? formatNumber(kpis.errorsInRange) : "—"}
          sub={`${rangeTitle}${showBackground ? " · background included" : " · background hidden"}`}
          tone={kpis && kpis.errorsInRange > 0 ? "danger" : "primary"}
          icon={<AlertTriangle size={14} />}
        />
        <KpiStatCard
          label="Affected Users"
          value={kpis ? formatNumber(kpis.affectedUsers) : "—"}
          sub="Users with at least one error in range"
          tone={kpis && kpis.affectedUsers > 0 ? "warning" : "primary"}
          icon={<UsersIcon size={14} />}
        />
        <KpiStatCard
          label="Last Failure"
          value={kpis?.lastErrorAt ? timeAgo(kpis.lastErrorAt) : "None"}
          sub={kpis?.lastErrorAt ? formatDate(kpis.lastErrorAt) : "No failures in range"}
          tone={kpis?.lastErrorAt ? "warning" : "primary"}
          icon={<Timer size={14} />}
        />
      </div>

      {error ? (
        <div
          className="inline-danger-note"
          role="alert"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <span style={{ flex: 1 }}>
            {error}
            {current ? " Showing the last loaded data." : ""}
          </span>
          <Button size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}

      {current?.scanTruncated ? (
        <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: "-8px 0 0" }}>
          Heavy range — only the most recent error events are included; narrow the timespan for full
          coverage.
        </p>
      ) : null}
      {current?.usersTruncated ? (
        <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: "-8px 0 0" }}>
          Showing the most recently affected users — totals still count everyone; narrow the
          timespan to see the rest.
        </p>
      ) : null}

      <CollapsiblePanel
        kicker={view === "users" ? "Linked" : "Grouped"}
        title={view === "users" ? "Users with Errors" : "Failures"}
        sub={
          rows
            ? view === "users"
              ? `${formatNumber(rows.length)} of ${formatNumber(visibleGroups?.length ?? 0)} affected users shown · expand a row for every error`
              : `${formatNumber(failures?.length ?? 0)} distinct failures · expand for occurrences with the user behind each one`
            : "Loading errors…"
        }
        padding="flush"
        right={
          <>
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={
                view === "users" ? "Search user, Discord, error…" : "Search failure, user…"
              }
              style={{ width: "min(280px,100%)" }}
            />
            <Button
              size="sm"
              icon={showBackground ? <Eye /> : <EyeOff />}
              className={showBackground ? "is-active" : ""}
              onClick={() => setShowBackground((v) => !v)}
              title={
                showBackground
                  ? "Background task errors are shown — click to hide them"
                  : "Background task errors are hidden — click to include them"
              }
            >
              Background{backgroundTotal > 0 ? ` (${formatNumber(backgroundTotal)})` : ""}
            </Button>
          </>
        }
      >
        {view === "users" ? (
          rows === null || rows.length > 0 ? (
            <TableFrame>
              <thead>
                <tr>
                  <th>User</th>
                  <th className="col-lg">Discord</th>
                  <th>Version</th>
                  <th className="col-lg">Platform</th>
                  <th className="col-md">Location</th>
                  <SortableTh
                    label="Errors"
                    sortKey="errors"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                  <th>Top Type</th>
                  <SortableTh
                    label="First Error"
                    sortKey="firstError"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                    className="col-xl"
                  />
                  <SortableTh
                    label="Last Error"
                    sortKey="lastError"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  />
                  <th></th>
                </tr>
              </thead>
              <tbody
                key={rows === null ? "loading" : "loaded"}
                className={rows === null ? undefined : "dt-settle"}
              >
                {rows === null ? (
                  <SkeletonRows />
                ) : (
                  rows.map((user) => {
                    const isExpanded = expandedUsers.includes(user.identity);
                    const top = topType(user);
                    const showAll = showAllEvents.has(user.identity);
                    const events = showAll
                      ? user.visibleEvents
                      : user.visibleEvents.slice(0, EVENTS_PREVIEW_COUNT);
                    const hiddenBeyondCap = user.visibleCount - user.visibleEvents.length;

                    return (
                      <Fragment key={user.identity}>
                        <tr
                          className={isExpanded ? "row-expanded" : ""}
                          onClick={() => toggleUser(user.identity)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ whiteSpace: "nowrap" }}>
                            <span
                              style={{
                                fontFamily: "var(--font-display)",
                                fontWeight: 600,
                                fontSize: "0.8125rem",
                                marginRight: 6,
                              }}
                            >
                              {displayName(user)}
                            </span>
                            {!isUnattributed(user) ? (
                              <>
                                {user.licenseTier === "premium" ? (
                                  <span
                                    style={{
                                      fontSize: "0.625rem",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      background: "var(--accent-subtle)",
                                      color: "var(--accent-text)",
                                      fontWeight: 700,
                                      letterSpacing: "0.05em",
                                      verticalAlign: "middle",
                                    }}
                                  >
                                    PREMIUM
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: "0.625rem",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      background: "var(--bg-subtle)",
                                      color: "var(--text-muted)",
                                      fontWeight: 700,
                                      letterSpacing: "0.05em",
                                      verticalAlign: "middle",
                                    }}
                                  >
                                    FREE
                                  </span>
                                )}
                                <span
                                  style={{
                                    fontFamily: "var(--font-mono)",
                                    fontSize: "0.6875rem",
                                    color: "var(--text-3)",
                                    marginLeft: 8,
                                  }}
                                >
                                  {user.identity.slice(0, 8)}
                                </span>
                              </>
                            ) : (
                              <span
                                style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}
                                title="These events carried no install id or hwid"
                              >
                                no identity in payload
                              </span>
                            )}
                          </td>
                          <td
                            className="col-lg"
                            style={{
                              whiteSpace: "nowrap",
                              maxWidth: 160,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {user.discordUser?.trim() ? (
                              <span
                                style={{ fontSize: "0.71875rem", color: "var(--text-2)" }}
                                title={`Discord: ${user.discordUser}`}
                              >
                                {discordHandle(user.discordUser)}
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-3)", opacity: 0.55 }}>—</span>
                            )}
                          </td>
                          <td>
                            <Badge tone="muted" title={user.appVersion ?? undefined}>
                              {versionLabel(user.displayVersion ?? user.appVersion)}
                            </Badge>
                          </td>
                          <td className="muted col-lg">{user.platform ?? "—"}</td>
                          <td
                            className="muted col-md"
                            style={{
                              whiteSpace: "nowrap",
                              maxWidth: 150,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={userLocation(user) || undefined}
                          >
                            {userLocation(user) || "—"}
                          </td>
                          <td>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Badge tone="danger">{formatNumber(user.visibleCount)}</Badge>
                              {showBackground && user.backgroundCount > 0 ? (
                                <span
                                  style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}
                                  title="Background task errors included in the count"
                                >
                                  {formatNumber(user.backgroundCount)} bg
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td
                            style={{
                              whiteSpace: "nowrap",
                              maxWidth: 200,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {top ? (
                              <span
                                className="mono"
                                style={{ fontSize: "0.71875rem", color: "var(--text-2)" }}
                                title={top.type}
                              >
                                {top.type}
                                {top.more > 0 ? (
                                  <span style={{ color: "var(--text-3)" }}> +{top.more}</span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td
                            className="muted col-xl"
                            style={{ whiteSpace: "nowrap" }}
                            title={formatDate(user.firstAt)}
                          >
                            {timeAgo(user.firstAt)}
                          </td>
                          <td
                            className="muted"
                            style={{ whiteSpace: "nowrap" }}
                            title={formatDate(user.lastAt)}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              {user.isActive ? (
                                <span className="status-dot" title="User is online right now" />
                              ) : null}
                              {timeAgo(user.lastAt)}
                            </span>
                          </td>
                          <td>
                            <IconButton
                              icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                              style={{ padding: 4 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleUser(user.identity);
                              }}
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                            />
                          </td>
                        </tr>

                        {/* Detail stays mounted once opened; the grid-rows clip animates the fold smoothly. */}
                        {expandedEverUsers.has(user.identity) ? (
                          <tr className={isExpanded ? undefined : "row-expand-collapsed"}>
                            <td
                              colSpan={USER_COLUMN_COUNT}
                              className="row-expand-panel row-expand-td"
                            >
                              <RowExpandClip open={isExpanded}>
                                <div style={{ marginBottom: 14 }}>
                                  <DetailGrid
                                    items={[
                                      { k: "Identity", v: user.identity },
                                      { k: "Hardware ID", v: user.hwid ?? "—" },
                                      { k: "Install ID", v: user.installId ?? "—" },
                                      {
                                        k: "Discord",
                                        v: user.discordUser?.trim()
                                          ? discordHandle(user.discordUser)
                                          : "—",
                                      },
                                      { k: "Device Model", v: user.deviceModel ?? "—" },
                                      { k: "OS Version", v: user.osVersion ?? "—" },
                                      { k: "Timezone", v: user.timezone ?? "—" },
                                      {
                                        k: "App Version",
                                        v: user.displayVersion ?? user.appVersion ?? "—",
                                      },
                                      {
                                        k: "Last Seen",
                                        v: user.lastSeen ? formatDate(user.lastSeen) : "—",
                                      },
                                      {
                                        k: "Errors in Range",
                                        v: `${formatNumber(user.errorCount)} real · ${formatNumber(user.backgroundCount)} background`,
                                      },
                                      { k: "First Error", v: formatDate(user.firstAt) },
                                      { k: "Last Error", v: formatDate(user.lastAt) },
                                    ]}
                                  />
                                </div>

                                <p className="label-sm" style={{ marginBottom: 8 }}>
                                  Errors ({formatNumber(user.visibleEvents.length)}
                                  {hiddenBeyondCap > 0
                                    ? ` of ${formatNumber(user.visibleCount)}`
                                    : ""}
                                  )
                                </p>
                                <div style={{ display: "grid", gap: 8 }}>
                                  {events.map((event) => (
                                    <ErrorEventCard key={event.id} event={event} />
                                  ))}
                                </div>
                                {user.visibleEvents.length > EVENTS_PREVIEW_COUNT ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "center",
                                      marginTop: 10,
                                    }}
                                  >
                                    <Button
                                      size="sm"
                                      onClick={() => toggleShowAllEvents(user.identity)}
                                    >
                                      {showAll
                                        ? "Show fewer"
                                        : `Show all ${formatNumber(user.visibleEvents.length)} errors`}
                                    </Button>
                                  </div>
                                ) : null}
                                {hiddenBeyondCap > 0 ? (
                                  <p
                                    style={{
                                      fontSize: "0.71875rem",
                                      color: "var(--text-3)",
                                      marginTop: 10,
                                    }}
                                  >
                                    Only the latest {formatNumber(user.visibleEvents.length)}{" "}
                                    occurrences ship to the dashboard —{" "}
                                    {formatNumber(hiddenBeyondCap)} older ones in this range are
                                    counted but not listed.
                                  </p>
                                ) : null}
                              </RowExpandClip>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </TableFrame>
          ) : query ? (
            <EmptyState icon={<Search />} title="No users match">
              No affected user matches “{query}”. Clear the search to see everyone with errors in
              range.
            </EmptyState>
          ) : (
            <EmptyState allClear>
              No {showBackground ? "" : "real "}failures in {rangeTitle.toLowerCase()}. New errors
              surface here within seconds of ingest.
            </EmptyState>
          )
        ) : failures === null || failures.length > 0 ? (
          <div className="error-group-list">
            {failures === null
              ? Array.from({ length: 4 }, (_, i) => (
                  <div
                    key={`skeleton-${i}`}
                    style={{ padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}
                  >
                    <div className="skeleton" style={{ height: 12, width: 160 }} />
                    <div className="skeleton" style={{ height: 12, flex: 1, maxWidth: 420 }} />
                    <div className="skeleton" style={{ height: 12, width: 60 }} />
                  </div>
                ))
              : failures.map((failure) => {
                  const isOpen = expandedFailures.includes(failure.key);
                  const shown = failure.occurrences.slice(0, FAILURE_OCCURRENCES_SHOWN);
                  return (
                    <div key={failure.key} className={`error-group${isOpen ? " is-open" : ""}`}>
                      <button
                        type="button"
                        className="error-group-row"
                        onClick={() => toggleFailure(failure.key)}
                      >
                        <div className="error-group-chevron">
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </div>
                        <AlertTriangle
                          size={14}
                          style={{ flexShrink: 0, color: "var(--danger)" }}
                        />
                        <div className="error-group-info">
                          <span className="error-group-type mono">{failure.type}</span>
                          <span className="error-group-msg">{failure.message}</span>
                        </div>
                        <div className="error-group-meta">
                          <Badge tone={kindTone(failure.kind)}>{kindLabel(failure.kind)}</Badge>
                          <Badge
                            tone="warning"
                            title={`${failure.count} occurrence${failure.count !== 1 ? "s" : ""}`}
                          >
                            {failure.count}×
                          </Badge>
                          <Badge tone="muted" title="Distinct users hit by this failure">
                            {failure.identities.size} user{failure.identities.size !== 1 ? "s" : ""}
                          </Badge>
                          <span
                            className="error-group-time muted-text"
                            title={formatDate(failure.latest.timestamp)}
                          >
                            {timeAgo(failure.latest.timestamp)}
                          </span>
                        </div>
                      </button>

                      {isOpen ? (
                        <div className="error-group-detail">
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              alignItems: "center",
                              marginBottom: 10,
                            }}
                          >
                            {failure.code ? <Tag>{failure.code}</Tag> : null}
                            <span className="muted-text" style={{ fontSize: "0.75rem" }}>
                              {failure.count} occurrence{failure.count !== 1 ? "s" : ""} across{" "}
                              {failure.identities.size} user
                              {failure.identities.size !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="error-occurrence-list">
                            {shown.map(({ event, user }) => (
                              <div key={event.id} className="error-occurrence-item">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs"
                                  onClick={() => jumpToUser(user.identity)}
                                  title={`Open ${displayName(user)} in the user view`}
                                >
                                  {displayName(user)}
                                </button>
                                <span className="mono muted-text" style={{ fontSize: "0.6875rem" }}>
                                  {formatDate(event.timestamp)}
                                </span>
                                <span className="muted-text" style={{ fontSize: "0.75rem" }}>
                                  {timeAgo(event.timestamp)}
                                </span>
                                {event.appVersion ? <Tag>{event.appVersion}</Tag> : null}
                              </div>
                            ))}
                          </div>
                          {failure.occurrences.length > shown.length ? (
                            <p
                              style={{
                                fontSize: "0.71875rem",
                                color: "var(--text-3)",
                                marginTop: 8,
                              }}
                            >
                              Showing the latest {FAILURE_OCCURRENCES_SHOWN} of{" "}
                              {formatNumber(failure.occurrences.length)} occurrences.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
          </div>
        ) : query ? (
          <EmptyState icon={<Search />} title="No failures match">
            Nothing in range matches “{query}”. Clear the search to see every failure.
          </EmptyState>
        ) : (
          <EmptyState allClear>
            No {showBackground ? "" : "real "}failures in {rangeTitle.toLowerCase()}. New errors
            surface here within seconds of ingest.
          </EmptyState>
        )}
      </CollapsiblePanel>
    </div>
  );
}
