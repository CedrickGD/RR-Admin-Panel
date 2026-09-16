import { Select } from "../components/ds/Select";
import { RecordLink, TableFrame } from "../components/ds/TableFrame";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  Timer,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { RowExpandClip } from "../components/RowExpandClip";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import {
  DataTable,
  DetailGrid,
  SortHeader,
  type DataTableColumn,
  type SortState,
} from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { PageHeader } from "../components/ds/PageHeader";
import { PageToolbar } from "../components/ds/PageToolbar";
import { versionLabel } from "../utils/versionLabel";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SearchInput } from "../components/ds/SearchInput";
import { SegmentedControl, type TabItem } from "../components/ds/SegmentedControl";
import { Skeleton, SkeletonRows, type SkeletonColumn } from "../components/ds/Skeleton";
import { Tag } from "../components/ds/Tag";
import { useAdminErrors } from "../hooks/useAdminErrors";
import type {
  BackgroundFaultGroup,
  ErrorEventDetail,
  ErrorsRangeKey,
  ErrorUserGroup,
} from "../types/telemetry";
import { formatDate, formatNumber } from "../utils/format";
import { BACKGROUND_ERROR_KIND, describeSuppressedIo, isRealErrorRow } from "../utils/errorEvents";

type ViewKey = "users" | "failures";
type SortKey = "errors" | "firstError" | "lastError";
type SortDir = "asc" | "desc";
/** One exclusive page state: banner, KPIs, panel subtitle and body all key off it. */
type PageState = "loading" | "error" | "empty" | "data";
/**
 * The page's one scope switch: real errors, or the background faults kept apart from them.
 * Background faults are the desktop client reporting a fault in a background task or a render
 * update (RR-E1003); they never crash the app and are not counted as errors anywhere in the
 * panel. From client 1.5.3 one row can stand for many faults, so the table counts faults
 * (SUM of occurrences), not rows.
 */
type Segment = "errors" | "background";
type FaultsState = "loading" | "error" | "unavailable" | "data";

/** `phrase` completes a sentence: "No crashes reported in the last 24 hours". */
const RANGES: Array<{ key: ErrorsRangeKey; label: string; title: string; phrase: string }> = [
  { key: "1h", label: "1 h", title: "Last hour", phrase: "the last hour" },
  { key: "6h", label: "6 h", title: "Last 6 hours", phrase: "the last 6 hours" },
  { key: "12h", label: "12 h", title: "Last 12 hours", phrase: "the last 12 hours" },
  { key: "24h", label: "24 h", title: "Last 24 hours", phrase: "the last 24 hours" },
  { key: "3d", label: "3 d", title: "Last 3 days", phrase: "the last 3 days" },
  { key: "7d", label: "7 d", title: "Last 7 days", phrase: "the last 7 days" },
  { key: "30d", label: "30 d", title: "Last 30 days", phrase: "the last 30 days" },
  {
    key: "all",
    label: "All",
    title: "Full retained history (90 days)",
    phrase: "the retained history (90 days)",
  },
];

const UNATTRIBUTED_IDENTITY = "unattributed";
const USER_COLUMN_COUNT = 10;
const SKELETON_ROWS = 6;
const EVENTS_PREVIEW_COUNT = 25;
const FAILURE_OCCURRENCES_SHOWN = 50;

const KIND_LABELS: Record<string, string> = {
  background: "Background task",
  unhandled: "Unhandled",
};

/**
 * One entry per header column, in document order — the tiers are repeated here
 * on purpose. A placeholder cell that stays while its header hides leaves the
 * loading table wider than the loaded one, and the columns jump when data lands.
 */
const USER_SKELETON_COLUMNS: SkeletonColumn[] = [
  {}, // Customer
  { className: "col-lg" }, // Discord
  {}, // Version
  { className: "col-lg" }, // Platform
  { className: "col-md" }, // Location
  {}, // Errors
  {}, // Top type
  { className: "col-xl" }, // First error
  {}, // Last error
  {}, // row actions
];

interface VisibleGroup extends ErrorUserGroup {
  visibleEvents: ErrorEventDetail[];
  visibleCount: number;
  /** First/last real error (events ship newest-first). */
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
  if (kind === BACKGROUND_ERROR_KIND) return "warning";
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

const SEGMENTS: TabItem<Segment>[] = [
  { key: "errors", label: "Errors" },
  { key: "background", label: "Background faults" },
];

/** Grouping of the real errors — a view, offered as a select next to the time window. */
const VIEW_TABS: TabItem<ViewKey>[] = [
  { key: "users", label: "By customer" },
  { key: "failures", label: "By failure" },
];

/** "System.Net.Sockets.SocketException" → "SocketException"; the full name stays in the title. */
function shortTypeName(type: string | null): string {
  const trimmed = type?.trim();
  if (!trimmed) return "—";
  return trimmed.split(".").pop() || trimmed;
}

function faultKey(fault: BackgroundFaultGroup): string {
  return `${fault.code ?? ""}::${fault.exceptionType ?? ""}::${fault.faultSource ?? ""}::${fault.topFrame ?? ""}`;
}

/**
 * The member alone: "RazorReaper.Components.Pages.Home.UpdateResources (Home.razor:1394)" →
 * "Home.UpdateResources". The file and line, and the frame chain, stay in the cell's title
 * (frameTitle). Sentinels such as "(no RazorReaper frame)" have no namespace and stay as they are.
 */
function frameMember(frame: string | null): string {
  const trimmed = frame?.trim();
  if (!trimmed) return "—";
  const at = trimmed.indexOf(" (");
  const member = at === -1 ? trimmed : trimmed.slice(0, at);
  const parts = member.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : member;
}

/** The chain (top frame with its file:line first, then its callers) when the client sent one. */
function frameTitle(fault: BackgroundFaultGroup): string | undefined {
  return fault.topFrames ?? fault.topFrame ?? undefined;
}

/** metrics.fault_source, as a word: which client path reported the fault. */
const SOURCE_LABELS: Record<string, string> = {
  unobserved_task: "Task",
  render_dispatch: "Render",
};
const RENDER_STOPPED_TITLE =
  "The component stopped rendering for the rest of the session after 10 consecutive faults.";

function sourceWord(fault: BackgroundFaultGroup): string {
  return SOURCE_LABELS[fault.faultSource] ?? fault.faultSource ?? "—";
}

/**
 * The render breaker, as a muted line under the source word: kept out of the word itself so the
 * Source column stays one word wide and the table keeps fitting its frame.
 */
function stoppedNote(fault: BackgroundFaultGroup): string | null {
  if (!(fault.stoppedSessions > 0)) return null;
  return `stopped in ${formatNumber(fault.stoppedSessions)} ${
    fault.stoppedSessions === 1 ? "session" : "sessions"
  }`;
}

/*
 * Column caps (DataTableColumn.maxWidth) are what let this table promise to fit the 1130px its
 * frame has in a 1440px window with the rail expanded. Every other column is bounded on its own:
 * Code is one fixed-format token, the counts are numbers, the two dates are relative, Source is
 * one word with a wrapping note, and Versions wraps at its commas. The two mono identifiers are
 * the only cells free text could widen, so they ellipsise with the full value in their title:
 * Exception at 240px and Top frame at 210px. Measured with the rail expanded: the columns came to
 * 94+227+204+99+69+72+84+106+88+87 = 1130, no capped cell cut — "InvalidOperationException" (25
 * characters) and "(no RazorReaper frame)" (22) both whole. tests/errors-page.test.tsx pins the caps.
 */
const EXCEPTION_CELL_MAX = 240;
const FRAME_CELL_MAX = 210;

const FAULT_COLUMNS: Array<DataTableColumn<BackgroundFaultGroup>> = [
  { key: "code", header: "Code", mono: true, render: (fault) => fault.code ?? "—" },
  {
    key: "exception",
    header: "Exception",
    mono: true,
    maxWidth: EXCEPTION_CELL_MAX,
    render: (fault) => (
      <span title={fault.exceptionType ?? undefined}>{shortTypeName(fault.exceptionType)}</span>
    ),
  },
  {
    key: "frame",
    header: "Top frame",
    mono: true,
    muted: true,
    maxWidth: FRAME_CELL_MAX,
    render: (fault) => (
      <span className="error-fault-frame" title={frameTitle(fault)}>
        {frameMember(fault.topFrame)}
      </span>
    ),
  },
  {
    key: "source",
    header: "Source",
    muted: true,
    render: (fault) => {
      const stopped = stoppedNote(fault);
      // One wrapper: the stacked mobile cell is a flex row, and the note must stay under the word.
      return (
        <span className="error-fault-source">
          <span>{sourceWord(fault)}</span>
          {stopped ? (
            <span className="error-cell-note" title={RENDER_STOPPED_TITLE}>
              {stopped}
            </span>
          ) : null}
        </span>
      );
    },
  },
  {
    key: "faults",
    header: "Faults",
    numeric: true,
    render: (fault) => (
      <span
        title={
          fault.reports > 0 && fault.reports < fault.events
            ? `${formatNumber(fault.reports)} ${fault.reports === 1 ? "report" : "reports"} from the client`
            : undefined
        }
      >
        {formatNumber(fault.events)}
      </span>
    ),
  },
  {
    key: "installs",
    header: "Installs",
    numeric: true,
    render: (fault) => formatNumber(fault.installs),
  },
  {
    key: "sessions",
    header: "Sessions",
    numeric: true,
    render: (fault) => formatNumber(fault.sessions),
  },
  {
    key: "versions",
    header: "Versions",
    muted: true,
    render: (fault) => (
      // A list that grows with every release: it wraps at its commas rather than widen the table.
      <span className="error-fault-versions">
        {fault.versions.length > 0 ? fault.versions.map((v) => versionLabel(v)).join(", ") : "—"}
      </span>
    ),
  },
  {
    key: "firstSeen",
    header: "First seen",
    muted: true,
    render: (fault) => <RelativeTime iso={fault.firstSeen} />,
  },
  {
    key: "lastSeen",
    header: "Last seen",
    muted: true,
    render: (fault) => <RelativeTime iso={fault.lastSeen} />,
  },
];

/**
 * The Background faults segment: one row per error code + base exception type + fault source +
 * top frame, aggregated on the server (faults, distinct installs and sessions, versions,
 * first/last seen). Deliberately quiet — muted count, no status colour: nothing here is an error.
 */
function BackgroundFaultsPanel({
  state,
  faults,
  total,
  rangePhrase,
  loadFailed,
}: {
  state: FaultsState;
  faults: BackgroundFaultGroup[];
  total: number;
  rangePhrase: string;
  loadFailed: ReactNode;
}) {
  return (
    <CollapsiblePanel
      kicker="Known client bug"
      title="Background faults"
      sub="Faults in the desktop app's background tasks and render updates. They do not crash the app and are not counted as errors anywhere. From client 1.5.3 a distinct fault is reported once and rolled up every 5 minutes; older clients report every fault separately."
      right={
        state === "data" && total > 0 ? (
          <Badge tone="muted">
            {formatNumber(total)} {total === 1 ? "fault" : "faults"}
          </Badge>
        ) : undefined
      }
      padding="flush"
    >
      {state === "error" ? (
        loadFailed
      ) : state === "loading" ? (
        <div className="error-group-list" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={`fault-skeleton-${i}`} className="error-skeleton-row">
              <Skeleton width={90} />
              <Skeleton className="error-skeleton-grow" />
              <Skeleton width={60} />
            </div>
          ))}
        </div>
      ) : state === "unavailable" ? (
        <EmptyState title="Not reported by this API build">
          Background faults are listed once rr-api runs the current version.
        </EmptyState>
      ) : faults.length === 0 ? (
        <EmptyState allClear title={`No background faults in ${rangePhrase}`} />
      ) : (
        <DataTable
          columns={FAULT_COLUMNS}
          rows={faults}
          rowKey={faultKey}
          flush
          mobileLayout="stack"
          caption={`Background faults in ${rangePhrase}, most frequent first`}
        />
      )}
    </CollapsiblePanel>
  );
}

/** One collected error, rendered in full: type, kind, message, and every leftover metric. */
function ErrorEventCard({ event }: { event: ErrorEventDetail }) {
  const extras = Object.entries(event.extras);
  return (
    <div className="glass-inset error-event-card">
      <div className="error-event-head">
        <AlertTriangle
          size={13}
          style={{
            flexShrink: 0,
            color: event.kind === BACKGROUND_ERROR_KIND ? "var(--warning)" : "var(--danger)",
          }}
        />
        <span className="mono error-event-type">{event.type?.trim() || "error"}</span>
        <Badge tone={kindTone(event.kind)}>{kindLabel(event.kind)}</Badge>
        {event.code ? <Tag title="Error code">{event.code}</Tag> : null}
        <span
          className="mono error-event-time"
          title={event.receivedAt ? `Received ${formatDate(event.receivedAt)}` : undefined}
        >
          {formatDate(event.timestamp)} · <RelativeTime iso={event.timestamp} />
        </span>
      </div>
      <p className="error-event-msg">{event.message?.trim() || "(no message)"}</p>
      {event.appVersion || event.sessionId || extras.length > 0 ? (
        <div className="error-event-tags">
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
  // Plain state, not a history entry: Back leaves the page instead of flipping the segment.
  const [segment, setSegment] = useState<Segment>("errors");
  /** Filters, not the segment or the grouping view: what the toolbar's Reset puts back. */
  const errorFiltersActive = (segment === "errors" && query.trim().length > 0) || range !== "24h";
  function resetErrorFilters() {
    setQuery("");
    setRange("24h");
  }
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

  /* ── real-error groups (pre-search) ───────────────────────── */
  const visibleGroups = useMemo<VisibleGroup[] | null>(() => {
    if (!current) return null;
    return current.users
      .map((group) => {
        // The API ships real errors only; builds before WP 2.9 still mixed background events in.
        const visibleEvents = group.events.filter(isRealErrorRow);
        return {
          ...group,
          visibleEvents,
          visibleCount: group.errorCount,
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
  }, [current]);

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

  /* ── KPI values: real errors in range, whatever the segment or search ──
        The tiles are the page summary of what counts as an error. Background
        faults are counted nowhere, so they never feed a tile — switching the
        segment leaves the row as it is; the fault table carries its own counts. */
  const kpis = useMemo(() => {
    if (!current || !visibleGroups) return null;
    // Both totals are the server's uncapped counts. The user list is capped at
    // 500 groups, so counting the rows here would understate the blast radius of
    // a bad release — and contradict the truncation note on this same page,
    // which promises the totals still count everyone.
    const errorsInRange = current.totals.errors;
    const affectedUsers = current.totals.affectedUsers;
    let lastErrorAt: string | null = null;
    for (const group of visibleGroups) {
      if (lastErrorAt === null || parseTimestamp(group.lastAt) > parseTimestamp(lastErrorAt)) {
        lastErrorAt = group.lastAt;
      }
    }
    return { errorsInRange, affectedUsers, lastErrorAt };
  }, [current, visibleGroups]);

  const rangeEntry = RANGES.find((r) => r.key === range);
  const rangeTitle = rangeEntry?.title ?? "Selected range";
  const rangePhrase = rangeEntry?.phrase ?? "the selected range";
  const backgroundTotal = current?.totals.backgroundErrors ?? 0;
  const backgroundSuppressed = current?.totals.backgroundSuppressed ?? 0;
  const faultsState: FaultsState = !current
    ? error
      ? "error"
      : "loading"
    : current.backgroundFaults === undefined
      ? "unavailable"
      : "data";

  // No usable payload for this range: a failure owns the screen, otherwise it's
  // loading. Never both — a skeleton or "None" must not sit beside the alert.
  const pageState: PageState = !visibleGroups
    ? error
      ? "error"
      : "loading"
    : visibleGroups.length === 0
      ? "empty"
      : "data";
  const unavailable = pageState === "error";

  /* ── interactions ─────────────────────────────────────────── */
  const sort: SortState = { key: sortKey, direction: sortDir };
  /** SortHeader hands back the column key; the page owns the direction toggle. */
  function handleSort(next: string) {
    const key = next as SortKey;
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
  // Calm by design: no crashes is the normal state. When the range held background faults,
  // one quiet line says where they are, with a link that switches the segment.
  const noErrorsState = (
    <EmptyState allClear title={`No crashes reported in ${rangePhrase}`}>
      {backgroundTotal > 0 ? (
        <>
          {formatNumber(backgroundTotal)} background {backgroundTotal === 1 ? "fault" : "faults"}{" "}
          from a known client bug {backgroundTotal === 1 ? "is" : "are"} listed under{" "}
          <RecordLink className="is-inline" onClick={() => setSegment("background")}>
            Background faults
          </RecordLink>
          .
        </>
      ) : (
        "New errors surface here within seconds of ingest."
      )}
    </EmptyState>
  );
  const loadFailed = (
    <EmptyState
      icon={<AlertTriangle />}
      title="Couldn't load errors"
      action={
        <Button size="sm" onClick={refresh} disabled={loading}>
          {loading ? "Retrying…" : "Retry"}
        </Button>
      }
    >
      {/* No data to show, so the banner stays hidden and the reason lives here. */}
      {error}
    </EmptyState>
  );

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Failures"
        page="errors"
        sub="Errors from the desktop app, per customer — background faults from a known client bug are listed apart and never counted."
      />

      {/* KPIs */}
      <div className="stat-grid stat-grid-3">
        <KpiStatCard
          label="Errors in range"
          value={kpis ? formatNumber(kpis.errorsInRange) : "—"}
          sub={unavailable ? "Unavailable" : `${rangeTitle} · background faults excluded`}
          tone={kpis && kpis.errorsInRange > 0 ? "danger" : "primary"}
          icon={<AlertTriangle size={14} />}
          loading={pageState === "loading"}
        />
        <KpiStatCard
          label="Affected customers"
          value={kpis ? formatNumber(kpis.affectedUsers) : "—"}
          sub={unavailable ? "Unavailable" : "Customers with at least one error in range"}
          tone={kpis && kpis.affectedUsers > 0 ? "warning" : "primary"}
          icon={<UsersIcon size={14} />}
          loading={pageState === "loading"}
        />
        <KpiStatCard
          label="Last failure"
          value={kpis ? (kpis.lastErrorAt ? <RelativeTime iso={kpis.lastErrorAt} /> : "None") : "—"}
          sub={
            unavailable
              ? "Unavailable"
              : kpis
                ? kpis.lastErrorAt
                  ? formatDate(kpis.lastErrorAt)
                  : "No failures in range"
                : rangeTitle
          }
          tone={kpis?.lastErrorAt ? "warning" : "primary"}
          icon={<Timer size={14} />}
          loading={pageState === "loading"}
        />
      </div>

      {/* Stale data on screen: warn next to it. With no data the panel's
          empty state carries the failure instead, so it is never reported twice. */}
      {error && current ? (
        <div className="inline-danger-note" role="alert">
          <span>{error} Showing the last loaded data.</span>
          <Button size="sm" onClick={refresh} disabled={loading}>
            {loading ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : null}

      {segment === "errors" && current?.scanTruncated ? (
        <p className="page-note">
          More errors in this range than one request reads — only the most recent are listed and
          counted; narrow the time window for the rest.
        </p>
      ) : null}
      {segment === "errors" && current?.usersTruncated ? (
        <p className="page-note">
          Showing the most recently affected customers — totals still count everyone; narrow the
          timespan to see the rest.
        </p>
      ) : null}
      {segment === "background" && current?.backgroundFaultsTruncated ? (
        <p className="page-note">
          Showing the most frequent fault groups — the fault count covers all of them.
        </p>
      ) : null}
      {segment === "background" && backgroundSuppressed > 0 ? (
        // The same sentence Customer 360 prints under such a row (utils/errorEvents.ts).
        <p className="page-note">{describeSuppressedIo(backgroundSuppressed)}.</p>
      ) : null}

      {/* The one filter place on this page (handoff §2.3), directly above the
          panel it filters. Left: the page's scope — real errors, or the
          background faults kept apart from them (a radiogroup over plain state,
          not history). Then search and grouping for the errors, and the time
          window both segments share. Reset puts the filters back; segment and
          grouping are views, not filters, so they stay. */}
      <PageToolbar
        aria-label="Error filters"
        canReset={errorFiltersActive}
        onReset={resetErrorFilters}
        left={
          <SegmentedControl
            aria-label="Error type"
            items={SEGMENTS}
            value={segment}
            onChange={setSegment}
          />
        }
        search={
          segment === "errors" ? (
            <SearchInput
              aria-label="Search errors"
              value={query}
              onChange={setQuery}
              placeholder={
                view === "users" ? "Search customer, Discord, error…" : "Search failure, customer…"
              }
            />
          ) : undefined
        }
        filters={
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
            {segment === "errors" ? (
              <Select
                aria-label="Error grouping"
                value={view}
                onValueChange={(value) => setView(value as ViewKey)}
              >
                {VIEW_TABS.map((tab) => (
                  <option key={tab.key} value={tab.key}>
                    {tab.label}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        }
      />

      {segment === "background" ? (
        <BackgroundFaultsPanel
          state={faultsState}
          faults={current?.backgroundFaults ?? []}
          total={backgroundTotal}
          rangePhrase={rangePhrase}
          loadFailed={loadFailed}
        />
      ) : (
      <CollapsiblePanel
        kicker={view === "users" ? "Linked" : "Grouped"}
        title={view === "users" ? "Customers with errors" : "Failures"}
        sub={
          pageState === "loading"
            ? "Loading errors…"
            : pageState === "data"
              ? view === "users"
                ? `${formatNumber(rows?.length ?? 0)} of ${formatNumber(visibleGroups?.length ?? 0)} affected customers shown · expand a row for every error`
                : `${formatNumber(failures?.length ?? 0)} distinct failures · expand for occurrences with the customer behind each one`
              : undefined
        }
        padding="flush"
      >
        {view === "users" ? (
          unavailable ? (
            loadFailed
          ) : pageState === "loading" || (rows && rows.length > 0) ? (
            <TableFrame
              className="error-users-table"
              stickyActions
              mobileLayout="stack"
              aria-busy={rows === null || undefined}
            >
              <caption className="table-caption">
                Customers with errors in {rangeTitle.toLowerCase()}, sortable by column
              </caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col" className="col-lg">
                    Discord
                  </th>
                  <th scope="col">Version</th>
                  <th scope="col" className="col-lg">
                    Platform
                  </th>
                  <th scope="col" className="col-md">
                    Location
                  </th>
                  <SortHeader
                    label="Errors"
                    sortKey="errors"
                    sort={sort}
                    onSortChange={handleSort}
                    className="numeric"
                  />
                  <th scope="col">Top type</th>
                  <SortHeader
                    label="First error"
                    sortKey="firstError"
                    sort={sort}
                    onSortChange={handleSort}
                    className="col-xl"
                  />
                  <SortHeader
                    label="Last error"
                    sortKey="lastError"
                    sort={sort}
                    onSortChange={handleSort}
                  />
                  <th scope="col" aria-label="Customer actions" />
                </tr>
              </thead>
              <tbody
                key={rows === null ? "loading" : "loaded"}
                className={rows === null ? undefined : "dt-settle"}
              >
                {rows === null ? (
                  <SkeletonRows columns={USER_SKELETON_COLUMNS} rows={SKELETON_ROWS} />
                ) : (
                  rows.map((user) => {
                    const isExpanded = expandedUsers.includes(user.identity);
                    const name = displayName(user);
                    const top = topType(user);
                    const showAll = showAllEvents.has(user.identity);
                    const events = showAll
                      ? user.visibleEvents
                      : user.visibleEvents.slice(0, EVENTS_PREVIEW_COUNT);
                    const hiddenBeyondCap = user.visibleCount - user.visibleEvents.length;

                    return (
                      <Fragment key={user.identity}>
                        <tr className={isExpanded ? "row-expanded" : ""}>
                          <td>
                            <button
                              type="button"
                              className="person-cell"
                              onClick={() => toggleUser(user.identity)}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Hide" : "Show"} errors for ${name}`}
                            >
                              <span>
                                <strong title={name}>{name}</strong>
                                {!isUnattributed(user) ? (
                                  <small>
                                    {user.licenseTier === "premium" ? (
                                      <span className="error-tier-pill is-premium">PREMIUM</span>
                                    ) : (
                                      <span className="error-tier-pill is-free">FREE</span>
                                    )}
                                    <span className="mono error-identity-id">
                                      {user.identity.slice(0, 8)}
                                    </span>
                                  </small>
                                ) : (
                                  <small title="These events carried no install id or hwid">
                                    No identity in payload
                                  </small>
                                )}
                              </span>
                            </button>
                          </td>
                          <td
                            className="col-lg cell-truncate"
                            data-label="Discord"
                            style={{ "--cell-max": "160px" } as CSSProperties}
                          >
                            {user.discordUser?.trim() ? (
                              <span
                                className="error-cell-sub"
                                title={`Discord: ${user.discordUser}`}
                              >
                                {discordHandle(user.discordUser)}
                              </span>
                            ) : (
                              <span className="error-cell-empty">—</span>
                            )}
                          </td>
                          <td data-label="Version">
                            <Badge tone="muted" title={user.appVersion ?? undefined}>
                              {versionLabel(user.displayVersion ?? user.appVersion)}
                            </Badge>
                          </td>
                          <td className="muted col-lg" data-label="Platform">
                            {user.platform ?? "—"}
                          </td>
                          <td
                            className="muted col-md cell-truncate"
                            data-label="Location"
                            style={{ "--cell-max": "150px" } as CSSProperties}
                            title={userLocation(user) || undefined}
                          >
                            {userLocation(user) || "—"}
                          </td>
                          <td className="numeric" data-label="Errors">
                            <span className="cell-inline">
                              <Badge tone="danger">{formatNumber(user.visibleCount)}</Badge>
                            </span>
                          </td>
                          <td className="cell-truncate" data-label="Top type">
                            {top ? (
                              <span className="mono error-cell-sub" title={top.type}>
                                {top.type}
                                {top.more > 0 ? (
                                  <span className="error-cell-more"> +{top.more}</span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="muted col-xl" data-label="First error" style={{ whiteSpace: "nowrap" }}>
                            <RelativeTime iso={user.firstAt} />
                          </td>
                          <td className="muted" data-label="Last error" style={{ whiteSpace: "nowrap" }}>
                            <span className="cell-inline">
                              {user.isActive ? (
                                <span className="status-dot" title="Customer is online right now" />
                              ) : null}
                              <RelativeTime iso={user.lastAt} />
                            </span>
                          </td>
                          <td>
                            <IconButton
                              icon={isExpanded ? <ChevronUp /> : <ChevronDown />}
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Hide" : "Show"} errors for ${name}`}
                              onClick={() => toggleUser(user.identity)}
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
                                <div className="detail-block">
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
                                      // Platform and Location also live in tiered
                                      // columns, so a narrow table is the only place
                                      // they can be read — same values, same fallback.
                                      { k: "Platform", v: user.platform ?? "—" },
                                      { k: "Device model", v: user.deviceModel ?? "—" },
                                      { k: "OS version", v: user.osVersion ?? "—" },
                                      { k: "Timezone", v: user.timezone ?? "—" },
                                      { k: "Location", v: userLocation(user) || "—" },
                                      {
                                        k: "App version",
                                        v: user.displayVersion ?? user.appVersion ?? "—",
                                      },
                                      {
                                        k: "Last seen",
                                        v: user.lastSeen ? formatDate(user.lastSeen) : "—",
                                      },
                                      {
                                        k: "Errors in range",
                                        v: formatNumber(user.errorCount),
                                      },
                                      { k: "First error", v: formatDate(user.firstAt) },
                                      { k: "Last error", v: formatDate(user.lastAt) },
                                    ]}
                                  />
                                </div>

                                <p className="label-sm detail-label">
                                  Errors ({formatNumber(user.visibleEvents.length)}
                                  {hiddenBeyondCap > 0
                                    ? ` of ${formatNumber(user.visibleCount)}`
                                    : ""}
                                  )
                                </p>
                                <div className="error-event-list">
                                  {events.map((event) => (
                                    <ErrorEventCard key={event.id} event={event} />
                                  ))}
                                </div>
                                {user.visibleEvents.length > EVENTS_PREVIEW_COUNT ? (
                                  <div className="error-events-more">
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
                                  <p className="error-events-note">
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
            <EmptyState icon={<Search />} title="No customers match">
              No affected customer matches “{query}”.
            </EmptyState>
          ) : (
            noErrorsState
          )
        ) : unavailable ? (
          loadFailed
        ) : pageState === "loading" || (failures && failures.length > 0) ? (
          <div className="error-group-list">
            {failures === null
              ? Array.from({ length: 4 }, (_, i) => (
                  <div key={`skeleton-${i}`} className="error-skeleton-row">
                    <Skeleton width={160} />
                    <Skeleton className="error-skeleton-grow" />
                    <Skeleton width={60} />
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
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} occurrences of ${failure.type}`}
                      >
                        <div className="error-group-chevron">
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </div>
                        <AlertTriangle size={14} className="error-group-icon" />
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
                          <Badge tone="muted" title="Distinct customers hit by this failure">
                            {failure.identities.size} customer
                            {failure.identities.size !== 1 ? "s" : ""}
                          </Badge>
                          <span className="error-group-time muted-text">
                            <RelativeTime iso={failure.latest.timestamp} />
                          </span>
                        </div>
                      </button>

                      {isOpen ? (
                        <div className="error-group-detail">
                          <div className="error-failure-summary">
                            {failure.code ? <Tag>{failure.code}</Tag> : null}
                            <span className="muted-text text-tiny">
                              {failure.count} occurrence{failure.count !== 1 ? "s" : ""} across{" "}
                              {failure.identities.size} customer
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
                                  title={`Open ${displayName(user)} in the customer view`}
                                >
                                  {displayName(user)}
                                </button>
                                <span className="mono muted-text text-micro">
                                  {formatDate(event.timestamp)}
                                </span>
                                <span className="muted-text text-tiny">
                                  <RelativeTime iso={event.timestamp} />
                                </span>
                                {event.appVersion ? <Tag>{event.appVersion}</Tag> : null}
                              </div>
                            ))}
                          </div>
                          {failure.occurrences.length > shown.length ? (
                            <p className="error-occurrences-note">
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
          <EmptyState
            icon={<Search />}
            title="No failures match"
            action={
              <Button size="sm" icon={<X />} onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          >
            Nothing in range matches “{query}”.
          </EmptyState>
        ) : (
          noErrorsState
        )}
      </CollapsiblePanel>
      )}
    </div>
  );
}
