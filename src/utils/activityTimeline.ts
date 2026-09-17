import type { UserActivityDay, UserActivityInterval } from "../types/telemetry";

export interface ActivityTimelineSegment {
  id: string;
  startedAt: string;
  endedAt: string;
  approximateEnd: boolean;
  durationSeconds: number;
  leftPercent: number;
  widthPercent: number;
}

export interface ActivityTimelineRow extends UserActivityDay {
  segments: ActivityTimelineSegment[];
}

function parseDate(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

export function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

/** Resolve local midnight to UTC without assuming a fixed offset or 24-hour DST day. */
export function localDateStartEpoch(date: string, timezone: string): number {
  const [year, month, day] = parseDate(date);
  const target = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const localDateAt = (epochMs: number): string => {
    const values: Record<string, string> = {};
    for (const part of formatter.formatToParts(epochMs)) {
      values[part.type] = part.value;
    }
    return `${values.year}-${values.month}-${values.day}`;
  };

  // Find the first instant belonging to this local calendar date. Searching
  // the date boundary also handles zones that move their clocks at 00:00,
  // where local midnight itself does not exist and offset iteration oscillates.
  let low = target - 36 * 3_600_000;
  let high = target + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDateAt(middle) < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Clip exact UTC intervals into the visible local-calendar rows. Percentages
 * use each day's real 23/24/25-hour duration, so DST never distorts duration.
 */
export function buildActivityTimelineRows(
  days: UserActivityDay[],
  intervals: UserActivityInterval[],
  timezone: string,
): ActivityTimelineRow[] {
  const parsedIntervals = intervals
    .map((interval, index) => ({
      ...interval,
      index,
      startMs: Date.parse(interval.startedAt),
      endMs: Date.parse(interval.endedAt),
    }))
    .filter(
      (interval) =>
        Number.isFinite(interval.startMs) &&
        Number.isFinite(interval.endMs) &&
        interval.endMs > interval.startMs,
    );

  return days.map((day) => {
    const dayStart = localDateStartEpoch(day.date, timezone);
    const dayEnd = localDateStartEpoch(addCalendarDays(day.date, 1), timezone);
    const dayDuration = Math.max(1, dayEnd - dayStart);
    const segments: ActivityTimelineSegment[] = [];

    for (const interval of parsedIntervals) {
      if (interval.endMs <= dayStart || interval.startMs >= dayEnd) continue;
      const startMs = Math.max(interval.startMs, dayStart);
      const endMs = Math.min(interval.endMs, dayEnd);
      const leftPercent = ((startMs - dayStart) / dayDuration) * 100;
      const widthPercent = ((endMs - startMs) / dayDuration) * 100;

      segments.push({
        id: `${interval.index}:${day.date}`,
        startedAt: new Date(startMs).toISOString(),
        endedAt: new Date(endMs).toISOString(),
        approximateEnd: interval.approximateEnd && endMs === interval.endMs,
        durationSeconds: Math.round((endMs - startMs) / 1000),
        leftPercent,
        widthPercent,
      });
    }

    return { ...day, segments };
  });
}

export interface ActivityAxisTick {
  hour: number;
  /** "06:00" where the track has room for it, "06" where it does not. */
  label: string;
}

/* An 11px monospace digit is ~6.6px wide; a full "06:00" label is five of them,
   a short "06" two. The gap keeps neighbouring labels from reading as one.
   The first and last labels sit flush with the track's ends instead of centred
   on their tick (index.css), so the step beside them has to hold a whole edge
   label, the gap and half of its centred neighbour — one and a half labels,
   not one. That edge step is the tightest of the set, so it sets the budget:
   at 164px five "HH:00" labels centred would fit, anchored they overlap. */
const TICK_CHAR_PX = 6.6;
const TICK_MIN_GAP_PX = 8;
const EDGE_LABELS = 1.5;
const FULL_TICK_PX = EDGE_LABELS * 5 * TICK_CHAR_PX + TICK_MIN_GAP_PX;
const SHORT_TICK_PX = EDGE_LABELS * 2 * TICK_CHAR_PX + TICK_MIN_GAP_PX;

const hourLabel = (hour: number, short: boolean) =>
  `${String(hour).padStart(2, "0")}${short ? "" : ":00"}`;

/**
 * Hour ticks for the day-row axis, chosen from the measured track width so the
 * labels never collide: every 2 h on a wide track (13 ticks), every 4 h on a
 * tablet-wide one (7), every 6 h on a phone (00, 06, 12, 18, 24) — with the
 * ":00" dropped once even those five would touch. `null` (not measured yet, or
 * no layout engine) keeps the full 2-hour axis.
 */
export function activityAxisTicks(trackWidth: number | null): ActivityAxisTick[] {
  const build = (stepHours: number, short: boolean) =>
    Array.from({ length: 24 / stepHours + 1 }, (_, index) => {
      const hour = index * stepHours;
      return { hour, label: hourLabel(hour, short) };
    });
  if (trackWidth === null) return build(2, false);
  for (const stepHours of [2, 4, 6]) {
    if (trackWidth / (24 / stepHours) >= FULL_TICK_PX) return build(stepHours, false);
  }
  return build(6, trackWidth / 4 >= SHORT_TICK_PX);
}

/** Grid-line spacing for the track background, in step with the axis ticks. */
export function activityGridStep(ticks: readonly ActivityAxisTick[]): string {
  return `${100 / Math.max(1, ticks.length - 1)}%`;
}

/**
 * Whether a bar is wide enough to carry its "HH:MM" start label. Percent alone
 * (the old `>= 9%` rule) let a 10px bar on a phone clip the digits; the pixel
 * width decides once the track is measured.
 */
export function activitySegmentLabelFits(widthPercent: number, trackWidth: number | null): boolean {
  if (trackWidth === null) return widthPercent >= 9;
  return (widthPercent / 100) * trackWidth >= 5 * TICK_CHAR_PX + 6;
}

/**
 * Where a bar hangs on its track. A bar keeps a minimum width (index.css) that
 * a short session cannot fill, and that floor grows away from the anchor: a
 * 23:30–00:00 bar anchored on the left grew 2px past the track's rounded end.
 * A bar in the right half hangs from the right edge instead, so the floor
 * grows towards the middle of the day and never past either end.
 */
export function activitySegmentPlacement(
  segment: Pick<ActivityTimelineSegment, "leftPercent" | "widthPercent">,
): { left?: string; right?: string; width: string } {
  const width = `${segment.widthPercent}%`;
  const centre = segment.leftPercent + segment.widthPercent / 2;
  if (centre > 50) {
    // Snapped: 100 − 97.916 − 2.084 is 9.8e-15 in floating point, not 0.
    const right = Math.max(
      0,
      Number((100 - segment.leftPercent - segment.widthPercent).toFixed(6)),
    );
    return { right: `${right}%`, width };
  }
  return { left: `${segment.leftPercent}%`, width };
}

/**
 * Row label for a local calendar date: "Thu, 17 Sept 2026", or "Thu 17" where
 * the date column has to stay narrow (the full date goes on the title).
 */
export function formatActivityDate(date: string, compact = false): string {
  const [year, month, day] = parseDate(date);
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat(
    "en-GB",
    compact
      ? { timeZone: "UTC", weekday: "short", day: "2-digit" }
      : { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" },
  ).format(at);
}

/** "09:07" (or "09:07:30") of a UTC instant in the customer's local zone. */
export function formatActivityClock(value: string, timezone: string, seconds = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  }).format(new Date(value));
}

/**
 * "1h 20m", "27m", "40s" — the list's clock values are minutes, so its
 * durations are too; formatDuration's "27m 0s" would only add noise.
 */
export function formatActivityDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${whole}s`;
}

export interface ActivityIntervalLine {
  /** The strip segment's id, so a tapped bar can find its line. */
  id: string;
  startedAt: string;
  endedAt: string;
  /** Local "HH:MM"; the end reads "24:00" where the run continues past midnight. */
  start: string;
  end: string;
  approximateEnd: boolean;
  durationSeconds: number;
  /** Clipped at local midnight: the run began the day before / goes on into the next. */
  fromPreviousDay: boolean;
  intoNextDay: boolean;
}

export interface ActivityIntervalDay {
  date: string;
  seconds: number;
  lines: ActivityIntervalLine[];
}

/**
 * The exact-interval list for the day rows on one timeline page: the same
 * clipped segments the strip draws (so the two never disagree), in clock
 * order within each day, with days that have no online time left out.
 * A run that crosses local midnight appears on both days, "22:40–24:00" and
 * "00:00–01:55", and each half says so.
 */
export function buildActivityIntervalDays(
  rows: ActivityTimelineRow[],
  timezone: string,
): ActivityIntervalDay[] {
  const days: ActivityIntervalDay[] = [];
  for (const row of rows) {
    if (row.segments.length === 0) continue;
    const dayStart = localDateStartEpoch(row.date, timezone);
    const dayEnd = localDateStartEpoch(addCalendarDays(row.date, 1), timezone);
    const lines = [...row.segments]
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      .map((segment): ActivityIntervalLine => {
        const fromPreviousDay = Date.parse(segment.startedAt) === dayStart;
        const intoNextDay = Date.parse(segment.endedAt) === dayEnd;
        return {
          id: segment.id,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          start: formatActivityClock(segment.startedAt, timezone),
          end: intoNextDay ? "24:00" : formatActivityClock(segment.endedAt, timezone),
          approximateEnd: segment.approximateEnd,
          durationSeconds: segment.durationSeconds,
          fromPreviousDay,
          intoNextDay,
        };
      });
    days.push({ date: row.date, seconds: row.seconds, lines });
  }
  return days;
}
