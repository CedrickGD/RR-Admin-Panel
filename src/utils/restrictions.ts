/**
 * The model behind Customers → Restrictions: every record GET /api/admin/access returns,
 * classified, named, sorted and filtered. Pure, so the rules are testable without the page.
 */
import type { SuspensionRecord } from "../types/telemetry";

/** The list scope in the tab's toolbar. "lifted" covers everything no longer in force. */
export type RestrictionView = "active" | "lifted" | "all";
/** "" = all types; otherwise the record's `mode`. */
export type RestrictionTypeFilter = "" | "ban" | "suspend";
/**
 * active  — in force: permanent, or a timed suspension still inside its window;
 * lifted  — an admin lifted it (is_active = 0);
 * expired — a timed suspension that ran out on its own (still is_active = 1 on the server).
 */
export type RestrictionState = "active" | "lifted" | "expired";

export interface RestrictionFilters {
  view: RestrictionView;
  type: RestrictionTypeFilter;
  query: string;
}

export const DEFAULT_RESTRICTION_FILTERS: RestrictionFilters = {
  view: "active",
  type: "",
  query: "",
};

/** How far back "Lifted in the last N days" in the summary line reaches. */
export const RECENT_LIFT_DAYS = 30;

/** Who a record belongs to, as far as the panel can tell. */
export interface RestrictionIdentity {
  name: string | null;
  discord: string | null;
}

export interface RestrictionEntry {
  record: SuspensionRecord;
  state: RestrictionState;
  /** Best known customer name; null when nothing names the customer. */
  name: string | null;
  /** Discord username without the leading "@". */
  discord: string | null;
  /**
   * When the restriction on the row was issued. While it is active that is `updated_at`, because
   * a re-suspend rewrites the same row; once lifted `updated_at` is the lift, so `created_at`.
   */
  issuedAt: string;
  /** When it stopped applying: the lift, or the end of a window that ran out. Null while active. */
  endedAt: string | null;
}

export interface RestrictionSummary {
  /** Permanent bans in force. */
  permanent: number;
  /** Timed suspensions in force. */
  temporary: number;
  /** The soonest end among the timed suspensions in force. */
  nextEnd: string | null;
  /** Lifted by an admin within RECENT_LIFT_DAYS. */
  liftedRecently: number;
}

/** Same in-force rule as the server's isSuspensionActive: an unreadable end date is not in force. */
export function restrictionState(row: SuspensionRecord, nowMs: number): RestrictionState {
  if (row.is_active !== 1) return "lifted";
  if (!row.banned_until) return "active";
  return Date.parse(row.banned_until) > nowMs ? "active" : "expired";
}

function timeOf(iso: string | null | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Active first, newest issued on top; then everything else, most recently ended on top. */
export function compareRestrictions(a: RestrictionEntry, b: RestrictionEntry): number {
  const aActive = a.state === "active";
  const bActive = b.state === "active";
  if (aActive !== bActive) return aActive ? -1 : 1;
  const aTime = aActive ? timeOf(a.issuedAt) : timeOf(a.endedAt);
  const bTime = bActive ? timeOf(b.issuedAt) : timeOf(b.endedAt);
  return bTime - aTime || b.record.id - a.record.id;
}

export function toRestrictionEntries(
  records: readonly SuspensionRecord[],
  identify: (record: SuspensionRecord) => RestrictionIdentity,
  nowMs: number,
): RestrictionEntry[] {
  return records
    .map((record) => {
      const state = restrictionState(record, nowMs);
      const identity = identify(record);
      return {
        record,
        state,
        name: text(identity.name) ?? text(record.user_label),
        discord: text(identity.discord)?.replace(/^@/, "") ?? null,
        issuedAt: state === "lifted" ? record.created_at : record.updated_at,
        endedAt:
          state === "lifted"
            ? (record.lifted_at ?? record.updated_at)
            : state === "expired"
              ? record.banned_until
              : null,
      };
    })
    .sort(compareRestrictions);
}

export function filterRestrictions(
  entries: readonly RestrictionEntry[],
  filters: RestrictionFilters,
): RestrictionEntry[] {
  const query = filters.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.view === "active" && entry.state !== "active") return false;
    if (filters.view === "lifted" && entry.state === "active") return false;
    if (filters.type && entry.record.mode !== filters.type) return false;
    if (!query) return true;
    const { record } = entry;
    return [
      entry.name,
      entry.discord ? `@${entry.discord}` : null,
      record.user_label,
      record.identity,
      record.hwid,
      record.install_id,
      record.reason,
      record.created_by,
      record.lifted_by,
    ].some((value) => value?.toLowerCase().includes(query));
  });
}

export function isDefaultRestrictionFilters(filters: RestrictionFilters): boolean {
  return (
    filters.view === DEFAULT_RESTRICTION_FILTERS.view &&
    filters.type === DEFAULT_RESTRICTION_FILTERS.type &&
    filters.query.trim() === ""
  );
}

export function summarizeRestrictions(
  entries: readonly RestrictionEntry[],
  nowMs: number,
): RestrictionSummary {
  const since = nowMs - RECENT_LIFT_DAYS * 86_400_000;
  const summary: RestrictionSummary = {
    permanent: 0,
    temporary: 0,
    nextEnd: null,
    liftedRecently: 0,
  };
  for (const entry of entries) {
    if (entry.state === "active") {
      if (entry.record.mode === "ban" || !entry.record.banned_until) summary.permanent += 1;
      else {
        summary.temporary += 1;
        const end = entry.record.banned_until;
        if (!summary.nextEnd || timeOf(end) < timeOf(summary.nextEnd)) summary.nextEnd = end;
      }
    } else if (entry.state === "lifted" && timeOf(entry.endedAt) >= since) {
      summary.liftedRecently += 1;
    }
  }
  return summary;
}

/** "18 days left", "5 hours left", "less than an hour left" — the secondary line of an Until badge. */
export function remainingTime(untilIso: string, nowMs: number): string {
  const ms = Date.parse(untilIso) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return "ended";
  const hours = ms / 3_600_000;
  if (hours < 1) return "less than an hour left";
  if (hours < 48) {
    const whole = Math.floor(hours);
    return `${whole} ${whole === 1 ? "hour" : "hours"} left`;
  }
  return `${Math.floor(hours / 24)} days left`;
}
