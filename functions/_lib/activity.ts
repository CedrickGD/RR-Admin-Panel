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

export interface UserActivityPayload {
  identity: string;
  /** IANA timezone the buckets were computed in (most frequent across sessions). */
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
  client_timezone: string | null;
}

interface LocalParts {
  date: string;
  weekday: number;
  hour: number;
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

  // Bucketing walks hour-aligned slices, so memoize per hour floor.
  const cache = new Map<number, LocalParts>();

  return (epochMs: number) => {
    const hourFloor = Math.floor(epochMs / 3_600_000);
    const cached = cache.get(hourFloor);
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
    cache.set(hourFloor, resolved);
    return resolved;
  };
}

function pickTimezone(rows: SessionRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const tz = row.client_timezone?.trim();
    if (!tz) {
      continue;
    }
    counts.set(tz, (counts.get(tz) ?? 0) + 1);
  }
  let best = "UTC";
  let bestCount = 0;
  for (const [tz, count] of counts) {
    if (count > bestCount) {
      best = tz;
      bestCount = count;
    }
  }
  return best;
}

function parseTimestamp(value: string | null): number {
  const ts = Date.parse(value ?? "");
  return Number.isFinite(ts) ? ts : Number.NaN;
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

  const [sessions, legacyRow] = await Promise.all([
    db
      .prepare(
        `SELECT started_at, ended_at, last_seen_at, is_active, client_timezone
         FROM app_sessions
         WHERE ${IDENTITY_SQL} = ? AND session_id NOT LIKE 'install:%'
         ORDER BY started_at ASC
         LIMIT 20000`,
      )
      .bind(identity)
      .all<SessionRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS legacy_rows, MIN(started_at) AS first_seen, MAX(last_seen_at) AS last_seen
         FROM app_sessions
         WHERE ${IDENTITY_SQL} = ? AND session_id LIKE 'install:%'`,
      )
      .bind(identity)
      .first<{ legacy_rows: number; first_seen: string | null; last_seen: string | null }>(),
  ]);

  const rows = sessions.results;
  const timezone = pickTimezone(rows);
  const toLocal = createLocalPartsResolver(timezone);

  const nowMs = Date.now();
  const cutoffMs = rangeDays !== null ? nowMs - rangeDays * 86_400_000 : Number.NEGATIVE_INFINITY;

  const secondsByDate = new Map<string, number>();
  const sessionsByDate = new Map<string, number>();
  const hourOfWeek: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));

  let totalSeconds = 0;
  let sessionCount = 0;
  let rawSessionSeconds = 0;
  let firstSeenMs = Number.POSITIVE_INFINITY;
  let lastSeenMs = Number.NEGATIVE_INFINITY;

  const intervals: Array<[number, number]> = [];
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
      intervals.push([effectiveStart, endMs]);
    }
  }

  // Merge overlapping intervals first: a client relaunch while the previous
  // session row is still open (or a crash later revived by heartbeats) would
  // otherwise double-count the same wall-clock time — days showing "28h online".
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push([interval[0], interval[1]]);
    }
  }

  for (const [intervalStart, intervalEnd] of merged) {
    // Distribute the interval across hour-aligned slices in the user's timezone.
    let cursor = intervalStart;
    while (cursor < intervalEnd) {
      const nextHourBoundary = (Math.floor(cursor / 3_600_000) + 1) * 3_600_000;
      const sliceEnd = Math.min(intervalEnd, nextHourBoundary);
      const sliceSeconds = (sliceEnd - cursor) / 1000;
      const local = toLocal(cursor);

      secondsByDate.set(local.date, (secondsByDate.get(local.date) ?? 0) + sliceSeconds);
      hourOfWeek[local.weekday][local.hour] += sliceSeconds;
      totalSeconds += sliceSeconds;

      cursor = sliceEnd;
    }
  }

  // Zero-filled day series across the visible span so charts do not skip quiet days.
  const days: UserActivityDay[] = [];
  const spanStartMs =
    rangeDays !== null
      ? nowMs - (Math.min(rangeDays, MAX_SERIES_DAYS) - 1) * 86_400_000
      : Number.isFinite(firstSeenMs)
        ? Math.max(firstSeenMs, nowMs - (MAX_SERIES_DAYS - 1) * 86_400_000)
        : nowMs;
  for (let dayMs = spanStartMs; dayMs <= nowMs + 3_600_000; dayMs += 86_400_000) {
    const key = toLocal(dayMs).date;
    if (days.length > 0 && days[days.length - 1].date === key) {
      continue;
    }
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

  const legacyRows = legacyRow?.legacy_rows ?? 0;
  const legacyFirstMs = parseTimestamp(legacyRow?.first_seen ?? null);
  const legacyLastMs = parseTimestamp(legacyRow?.last_seen ?? null);
  if (Number.isFinite(legacyFirstMs)) {
    firstSeenMs = Math.min(firstSeenMs, legacyFirstMs);
  }
  if (Number.isFinite(legacyLastMs)) {
    lastSeenMs = Math.max(lastSeenMs, legacyLastMs);
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
    hourOfWeek,
    hourOfDay,
    weekdayTotals,
  };
}
