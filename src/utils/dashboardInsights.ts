import type { AppSessionRecord, SummaryPayload } from "../types/telemetry";

const HOUR_MS = 60 * 60 * 1000;

export interface TrafficTimelinePoint {
  label: string;
  shortLabel: string;
  started: number;
  ended: number;
  errors: number;
  activity: number;
}

export interface BreakdownPoint {
  label: string;
  value: number;
}

function startOfHour(value: number): number {
  const date = new Date(value);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

export function buildTrafficTimeline(summary: SummaryPayload, hours = 24): TrafficTimelinePoint[] {
  const end = startOfHour(Date.now());
  const start = end - (hours - 1) * HOUR_MS;

  const points = Array.from({ length: hours }, (_, index) => {
    const timestamp = start + index * HOUR_MS;
    const date = new Date(timestamp);

    return {
      label: date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      shortLabel: date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      started: 0,
      ended: 0,
      errors: 0,
      activity: 0,
    };
  });

  const applyBucket = (value: string | null, key: "started" | "ended" | "errors") => {
    if (!value) {
      return;
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end + HOUR_MS) {
      return;
    }

    const bucketIndex = Math.floor((timestamp - start) / HOUR_MS);
    const point = points[Math.min(points.length - 1, Math.max(0, bucketIndex))];
    point[key] += 1;
  };

  for (const session of summary.recentSessions) {
    applyBucket(session.startedAt, "started");
    applyBucket(session.endedAt, "ended");
  }

  for (const event of summary.recentErrors) {
    applyBucket(event.timestamp, "errors");
  }

  return points.map((point) => ({
    ...point,
    activity: point.started + point.ended + point.errors,
  }));
}

export function buildCountryBreakdown(summary: SummaryPayload): BreakdownPoint[] {
  const source = summary.activeSessions.length > 0 ? summary.activeSessions : summary.recentSessions;
  const counts = new Map<string, number>();

  for (const session of source) {
    const label = session.clientCountry?.trim() || "Unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }));
}

export function buildDurationBreakdown(sessions: AppSessionRecord[]): BreakdownPoint[] {
  const buckets = [
    { label: "< 5m", min: 0, max: 5 * 60 },
    { label: "5-15m", min: 5 * 60, max: 15 * 60 },
    { label: "15-30m", min: 15 * 60, max: 30 * 60 },
    { label: "30-60m", min: 30 * 60, max: 60 * 60 },
    { label: "60m+", min: 60 * 60, max: Number.POSITIVE_INFINITY },
  ];

  const values = buckets.map((bucket) => ({ label: bucket.label, value: 0 }));

  for (const session of sessions) {
    const duration = session.durationSeconds;

    if (duration === null || !Number.isFinite(duration)) {
      continue;
    }

    const target = buckets.findIndex(
      (bucket) => duration >= bucket.min && duration < bucket.max,
    );

    if (target >= 0) {
      values[target].value += 1;
    }
  }

  return values;
}
