import { ensureTelemetrySchema } from "./storage";
import type { RuntimeEnv } from "./types";

// Mirrors stats.ts: sessions longer than 2 days are artifacts and would
// credit absurd online time to a single day.
const MAX_PLAUSIBLE_DURATION_MS = 172_800_000;
const IDENTITY_SQL = "COALESCE(hwid, install_id)";
// Hard cap on the zero-filled day series (10 years, same ceiling as stats ranges).
const MAX_SERIES_DAYS = 3650;

export interface UserActivityDay {
  /** Local calendar date (user's timezone), YYYY-MM-DD. */
  date: string;
  seconds: number;
  sessions: number;
}

export interface UserActivityInterval {
  /** Exact interval bounds in UTC. Display them in `timezone`. */
  startedAt: string;
  endedAt: string;
  /** True when the end comes from the latest heartbeat instead of session_end. */
  approximateEnd: boolean;
}

export interface UserActivityPayload {
  identity: string;
  /** Latest valid IANA timezone reported by this user; UTC when unavailable. */
  timezone: string;
  rangeDays: number | null;
  totalSeconds: number;
  sessionCount: number;
  averageSessionSeconds: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** True when the user only ever reported legacy install-scoped sessions — no per-run history exists. */
  legacyOnly: boolean;
  days: UserActivityDay[];
  /** Deduplicated online intervals, clipped to the selected local-calendar range. */
  intervals: UserActivityInterval[];
  /** False only when more than the safety cap of 20,000 sessions exists. */
  intervalsComplete: boolean;
  /** Seconds online per weekday x hour (local time); [0][*] = Monday. */
  hourOfWeek: number[][];
  /** Seconds online per local hour of day, all weekdays combined. */
  hourOfDay: number[];
  /** Seconds online per weekday; index 0 = Monday. */
  weekdayTotals: number[];
}

interface SessionRow {
  started_at: string | null;
  ended_at: string | null;
  last_seen_at: string | null;
  is_active: number | null;
  last_event: string | null;
  client_timezone: string | null;
}

interface LocalParts {
  date: string;
  weekday: number;
  hour: number;
}

interface ActivityInterval {
  startMs: number;
  endMs: number;
  approximateEnd: boolean;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function createLocalPartsResolver(timezone: string): (epochMs: number) => LocalParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    });
  }

  // Current IANA offsets are quarter-hour aligned. Bucketing below walks those
  // boundaries, so this cache remains correct for :30/:45 zones as well.
  const cache = new Map<number, LocalParts>();

  return (epochMs: number) => {
    const quarterHourFloor = Math.floor(epochMs / 900_000);
    const cached = cache.get(quarterHourFloor);
    if (cached) {
      return cached;
    }

    const parts = formatter.formatToParts(epochMs);
    const lookup: Record<string, string> = {};
    for (const part of parts) {
      lookup[part.type] = part.value;
    }
    const resolved: LocalParts = {
      date: `${lookup.year}-${lookup.month}-${lookup.day}`,
      weekday: WEEKDAY_INDEX[lookup.weekday ?? ""] ?? 0,
      // "24" shows up for midnight in some ICU versions of hour12:false.
      hour: Number.parseInt(lookup.hour ?? "0", 10) % 24,
    };
    cache.set(quarterHourFloor, resolved);
    return resolved;
  };
}

function pickTimezone(rowsNewestFirst: SessionRow[]): string {
  for (const row of rowsNewestFirst) {
    const tz = row.client_timezone?.trim();
    if (!tz) continue;
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz }).format(0);
      return tz;
    } catch {
      // Keep looking; old clients could report an invalid timezone string.
    }
  }
  return "UTC";
}

function parseTimestamp(value: string | null): number {
  const ts = Date.parse(value ?? "");
  return Number.isFinite(ts) ? ts : Number.NaN;
}

function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function localDateStartEpoch(date: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const localDateAt = (epochMs: number): string => {
    const values: Record<string, string> = {};
    for (const part of formatter.formatToParts(epochMs)) values[part.type] = part.value;
    return `${values.year}-${values.month}-${values.day}`;
  };

  // Find the first real instant whose local calendar date is the requested
  // date. Offset iteration oscillates when DST jumps at 00:00 and that wall
  // time does not exist (for example Havana and Santiago). Local calendar
  // dates are monotonic over this bounded UTC window, so a lower-bound search
  // also resolves those days to their first valid wall time (usually 01:00).
  let low = target - 36 * 60 * 60 * 1000;
  let high = target + 36 * 60 * 60 * 1000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (localDateAt(middle) < date) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export async function loadUserActivity(
  env: RuntimeEnv,
  identity: string,
  rangeDays: number | null,
): Promise<UserActivityPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("User activity requires the D1 storage backend.");
  }

  await ensureTelemetrySchema(db);

  const [sessions, identitySummary] = await Promise.all([
    db
      .prepare(
        `SELECT started_at, ended_at, last_seen_at, is_active, last_event, client_timezone
         FROM app_sessions
         WHERE ${IDENTITY_SQL} = ? AND session_id NOT LIKE 'install:%'
         ORDER BY started_at DESC
         LIMIT 20001`,
      )
      .bind(identity)
      .all<SessionRow>(),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN session_id LIKE 'install:%' THEN 1 ELSE 0 END) AS legacy_rows,
           MIN(started_at) AS first_seen,
           MAX(CASE WHEN session_id LIKE 'install:%' THEN last_seen_at END) AS legacy_last_seen
         FROM app_sessions
         WHERE ${IDENTITY_SQL} = ?`,
      )
      .bind(identity)
      .first<{
        legacy_rows: number | null;
        first_seen: string | null;
        legacy_last_seen: string | null;
      }>(),
  ]);

  const newestRows = sessions.results;
  const intervalsComplete = newestRows.length <= 20000;
  const timezone = pickTimezone(newestRows);
  // Keep the newest sessions when the safety cap is reached, then restore
  // chronological order for interval merging.
  const rows = newestRows.slice(0, 20000).reverse();
  const toLocal = createLocalPartsResolver(timezone);

  const nowMs = Date.now();
  const currentLocalDate = toLocal(nowMs).date;
  const rangeStartDate =
    rangeDays !== null
      ? addCalendarDays(currentLocalDate, -(Math.min(rangeDays, MAX_SERIES_DAYS) - 1))
      : null;
  const cutoffMs = rangeStartDate
    ? localDateStartEpoch(rangeStartDate, timezone)
    : Number.NEGATIVE_INFINITY;

  const secondsByDate = new Map<string, number>();
  const sessionsByDate = new Map<string, number>();
  const hourOfWeek: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));

  let totalSeconds = 0;
  let sessionCount = 0;
  let rawSessionSeconds = 0;
  let firstSeenMs = Number.POSITIVE_INFINITY;
  let lastSeenMs = Number.NEGATIVE_INFINITY;

  const intervals: ActivityInterval[] = [];
  for (const row of rows) {
    const startMs = parseTimestamp(row.started_at);
    let endMs = parseTimestamp(row.ended_at ?? row.last_seen_at);
    if (!Number.isFinite(startMs)) {
      continue;
    }
    if (!Number.isFinite(endMs) || endMs < startMs) {
      endMs = startMs;
    }
    endMs = Math.min(endMs, startMs + MAX_PLAUSIBLE_DURATION_MS, nowMs);

    firstSeenMs = Math.min(firstSeenMs, startMs);
    lastSeenMs = Math.max(lastSeenMs, endMs);

    if (endMs < cutoffMs) {
      continue;
    }
    const effectiveStart = Math.max(startMs, cutoffMs);

    sessionCount += 1;
    rawSessionSeconds += (endMs - effectiveStart) / 1000;
    const startParts = toLocal(effectiveStart);
    sessionsByDate.set(startParts.date, (sessionsByDate.get(startParts.date) ?? 0) + 1);

    if (endMs > effectiveStart) {
      intervals.push({
        startMs: effectiveStart,
        endMs,
        // Lazy expiry closes a crashed session by copying last_seen_at into
        // ended_at. last_event remains the heartbeat/feature that was actually
        // observed; a real app shutdown records session_end explicitly.
        approximateEnd:
          !row.ended_at || (row.last_event !== "session_end" && row.ended_at === row.last_seen_at),
      });
    }
  }

  // Merge overlapping intervals first: a client relaunch while the previous
  // session row is still open (or a crash later revived by heartbeats) would
  // otherwise double-count the same wall-clock time — days showing "28h online".
  intervals.sort((a, b) => a.startMs - b.startMs);
  const merged: ActivityInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.startMs <= last.endMs) {
      if (interval.endMs > last.endMs) {
        last.endMs = interval.endMs;
        last.approximateEnd = interval.approximateEnd;
      } else if (interval.endMs === last.endMs) {
        last.approximateEnd = last.approximateEnd && interval.approximateEnd;
      }
    } else {
      merged.push({ ...interval });
    }
  }

  for (const { startMs: intervalStart, endMs: intervalEnd } of merged) {
    // Quarter-hour boundaries align with every current IANA UTC offset. This
    // keeps calendar/hour buckets correct in zones such as Asia/Kathmandu
    // (+05:45), where UTC-hour slicing assigns time to the wrong local hour.
    let cursor = intervalStart;
    while (cursor < intervalEnd) {
      const nextQuarterHourBoundary = (Math.floor(cursor / 900_000) + 1) * 900_000;
      const sliceEnd = Math.min(intervalEnd, nextQuarterHourBoundary);
      const sliceSeconds = (sliceEnd - cursor) / 1000;
      const local = toLocal(cursor);

      secondsByDate.set(local.date, (secondsByDate.get(local.date) ?? 0) + sliceSeconds);
      hourOfWeek[local.weekday][local.hour] += sliceSeconds;
      totalSeconds += sliceSeconds;

      cursor = sliceEnd;
    }
  }

  const legacyRows = identitySummary?.legacy_rows ?? 0;
  const allSessionsFirstMs = parseTimestamp(identitySummary?.first_seen ?? null);
  const legacyLastMs = parseTimestamp(identitySummary?.legacy_last_seen ?? null);
  if (Number.isFinite(allSessionsFirstMs)) {
    // The interval query intentionally keeps only the newest 20,000 sessions.
    // This aggregate remains the true lifetime first seen even when capped.
    firstSeenMs = allSessionsFirstMs;
  }
  if (Number.isFinite(legacyLastMs)) {
    lastSeenMs = Math.max(lastSeenMs, legacyLastMs);
  }

  // Zero-filled day series across the visible span so charts do not skip quiet days.
  const days: UserActivityDay[] = [];
  const lifetimeStartDate = Number.isFinite(firstSeenMs)
    ? toLocal(firstSeenMs).date
    : currentLocalDate;
  const earliestAllowedDate = addCalendarDays(currentLocalDate, -(MAX_SERIES_DAYS - 1));
  const seriesStartDate =
    rangeStartDate ??
    (lifetimeStartDate < earliestAllowedDate ? earliestAllowedDate : lifetimeStartDate);
  for (let key = seriesStartDate; key <= currentLocalDate; key = addCalendarDays(key, 1)) {
    days.push({
      date: key,
      seconds: Math.round(secondsByDate.get(key) ?? 0),
      sessions: sessionsByDate.get(key) ?? 0,
    });
  }

  const hourOfDay = Array<number>(24).fill(0);
  const weekdayTotals = Array<number>(7).fill(0);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const seconds = Math.round(hourOfWeek[weekday][hour]);
      hourOfWeek[weekday][hour] = seconds;
      hourOfDay[hour] += seconds;
      weekdayTotals[weekday] += seconds;
    }
  }

  return {
    identity,
    timezone,
    rangeDays,
    totalSeconds: Math.round(totalSeconds),
    sessionCount,
    // Average uses raw (unmerged) session lengths — "how long does a session
    // last", while totalSeconds is deduplicated wall-clock online time.
    averageSessionSeconds: sessionCount > 0 ? Math.round(rawSessionSeconds / sessionCount) : 0,
    firstSeen: Number.isFinite(firstSeenMs) ? new Date(firstSeenMs).toISOString() : null,
    lastSeen: Number.isFinite(lastSeenMs) ? new Date(lastSeenMs).toISOString() : null,
    legacyOnly: rows.length === 0 && legacyRows > 0,
    days,
    intervals: merged.map((interval) => ({
      startedAt: new Date(interval.startMs).toISOString(),
      endedAt: new Date(interval.endMs).toISOString(),
      approximateEnd: interval.approximateEnd,
    })),
    intervalsComplete,
    hourOfWeek,
    hourOfDay,
    weekdayTotals,
  };
}
