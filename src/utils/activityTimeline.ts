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
