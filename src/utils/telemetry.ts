import type {
  ChartPoint,
  MetricKeyCount,
  PieSlice,
  TelemetryEvent,
  Timeframe,
  WorkerRow,
} from "../types/telemetry";

export function readMetric(
  metrics: Record<string, unknown>,
  keys: string[],
  fallback: string
): string {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

export function normalizeEventName(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return "event";
  return v.replaceAll(" ", "_");
}

export function resolvedEventName(event: TelemetryEvent): string {
  const raw = readMetric(event.metrics, ["event_name"], event.service);
  return normalizeEventName(raw);
}

export function isUpdateCheckEvent(event: TelemetryEvent): boolean {
  return resolvedEventName(event) === "update_check";
}

export function isHeartbeatEvent(event: TelemetryEvent): boolean {
  return resolvedEventName(event) === "heartbeat";
}

export function resolveEventTone(
  eventName: string
): "badge-success" | "badge-primary" | "badge-danger" | "badge-default" {
  if (eventName.includes("app_start") || eventName.includes("install"))
    return "badge-success";
  if (eventName.includes("heartbeat")) return "badge-primary";
  if (eventName.includes("error") || eventName.includes("down"))
    return "badge-danger";
  return "badge-default";
}

function getWindow(timeframe: Timeframe): { start: number; end: number } {
  const end = Date.now();
  const day = 86_400_000;
  if (timeframe === "1D") return { start: end - day, end };
  if (timeframe === "5D") return { start: end - 5 * day, end };
  if (timeframe === "1M") return { start: end - 30 * day, end };
  if (timeframe === "6M") return { start: end - 180 * day, end };
  if (timeframe === "1Y") {
    const endDate = new Date(end);
    return { start: new Date(endDate.getFullYear(), endDate.getMonth() - 11, 1).getTime(), end };
  }
  return { start: new Date(new Date(end).getFullYear(), 0, 1).getTime(), end };
}

export function filterEvents(
  events: TelemetryEvent[],
  timeframe: Timeframe
): TelemetryEvent[] {
  const { start, end } = getWindow(timeframe);
  return events.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return Number.isFinite(ts) && ts >= start && ts <= end;
  });
}

export function filterPrevious(
  events: TelemetryEvent[],
  timeframe: Timeframe
): TelemetryEvent[] {
  const { start, end } = getWindow(timeframe);
  const span = end - start;
  return events.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return Number.isFinite(ts) && ts >= start - span && ts < start;
  });
}

type TimeBucket = {
  start: number;
  end: number;
  label: string;
  value: number;
};

function createRangeBuckets(
  start: number,
  end: number,
  count: number,
  format: Intl.DateTimeFormatOptions
): TimeBucket[] {
  if (count <= 0) {
    return [];
  }

  const safeEnd = Math.max(end, start + 1);
  const step = (safeEnd - start) / count;

  return Array.from({ length: count }, (_, index) => {
    const bucketStart = start + index * step;
    const bucketEnd = index === count - 1 ? safeEnd + 1 : start + (index + 1) * step;
    return {
      start: bucketStart,
      end: bucketEnd,
      label: new Date(bucketStart).toLocaleString(undefined, format),
      value: 0,
    };
  });
}

function createMonthlyBuckets(start: number, end: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const first = new Date(start);
  let cursor = new Date(first.getFullYear(), first.getMonth(), 1);

  while (cursor.getTime() <= end) {
    const bucketStart = cursor.getTime();
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    buckets.push({
      start: bucketStart,
      end: next.getTime(),
      label: cursor.toLocaleString(undefined, { month: "short" }),
      value: 0,
    });
    cursor = next;
  }

  if (buckets.length === 0) {
    buckets.push({
      start,
      end: end + 1,
      label: new Date(start).toLocaleString(undefined, { month: "short" }),
      value: 0,
    });
  } else {
    buckets[buckets.length - 1].end = end + 1;
  }

  return buckets;
}

export function buildChart(
  events: TelemetryEvent[],
  timeframe: Timeframe
): ChartPoint[] {
  const { end } = getWindow(timeframe);
  const day = 86_400_000;
  let windowStart: number;
  let buckets: TimeBucket[];

  if (timeframe === "1D") {
    windowStart = end - day;
    buckets = createRangeBuckets(windowStart, end, 24, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } else if (timeframe === "5D") {
    windowStart = end - 5 * day;
    buckets = createRangeBuckets(windowStart, end, 60, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
    });
  } else if (timeframe === "1M") {
    windowStart = end - 30 * day;
    buckets = createRangeBuckets(windowStart, end, 30, {
      month: "short",
      day: "numeric",
    });
  } else if (timeframe === "6M") {
    windowStart = end - 180 * day;
    buckets = createRangeBuckets(windowStart, end, 26, {
      month: "short",
      day: "numeric",
    });
  } else if (timeframe === "YTD") {
    windowStart = new Date(new Date(end).getFullYear(), 0, 1).getTime();
    buckets = createMonthlyBuckets(windowStart, end);
  } else {
    const endDate = new Date(end);
    windowStart = new Date(endDate.getFullYear(), endDate.getMonth() - 11, 1).getTime();
    buckets = createMonthlyBuckets(windowStart, end);
  }

  for (const event of events) {
    const ts = Date.parse(event.timestamp);
    if (!Number.isFinite(ts) || ts < windowStart || ts > end) {
      continue;
    }

    const bucket = buckets.find((candidate) => ts >= candidate.start && ts < candidate.end);
    if (bucket) {
      bucket.value += 1;
    }
  }

  return buckets.map((bucket) => ({ label: bucket.label, value: bucket.value }));
}

export function buildTopSlices(
  events: TelemetryEvent[],
  keySelector: (e: TelemetryEvent) => string,
  limit: number
): PieSlice[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = keySelector(e).trim() || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));
}

export function buildWorkers(events: TelemetryEvent[]): WorkerRow[] {
  const sorted = [...events].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
  );
  const map = new Map<string, WorkerRow & { serviceSet: Set<string> }>();

  for (const e of sorted) {
    const key = e.source || "unknown";
    const platform = readMetric(
      e.metrics,
      ["platform", "os_platform", "os"],
      "unknown"
    );
    const version = readMetric(
      e.metrics,
      ["app_version", "version", "client_version"],
      "unknown"
    );
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        name: key,
        events: 1,
        lastSeen: e.timestamp,
        status: e.status,
        platform,
        version,
        services: 1,
        serviceSet: new Set([e.service]),
      });
      continue;
    }

    existing.events += 1;
    existing.serviceSet.add(e.service);
    existing.services = existing.serviceSet.size;
  }

  return [...map.values()]
    .map((w) => ({
      name: w.name,
      events: w.events,
      lastSeen: w.lastSeen,
      status: w.status,
      platform: w.platform,
      version: w.version,
      services: w.services,
    }))
    .sort((a, b) => b.events - a.events);
}

export function computeRate(
  events: TelemetryEvent[],
  windowMs: number,
  offsetMs = 0
): number {
  const end = Date.now() - offsetMs;
  const start = end - windowMs;
  const count = events.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return Number.isFinite(ts) && ts >= start && ts <= end;
  }).length;
  return count / (windowMs / 1000);
}

export function mostCommonMetric(
  events: TelemetryEvent[],
  keys: string[],
  fallback: string
): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    const v = readMetric(e.metrics, keys, "");
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function collectMetricKeys(
  events: TelemetryEvent[],
  limit: number
): MetricKeyCount[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    for (const key of Object.keys(e.metrics)) {
      const n = key.trim();
      if (!n) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

export function describeScope(timeframe: Timeframe): string {
  if (timeframe === "1D") return "Last 24h";
  if (timeframe === "5D") return "Last 5 days";
  if (timeframe === "1M") return "Last 30 days";
  if (timeframe === "6M") return "Last 6 months";
  if (timeframe === "YTD") return "Year to date";
  return "Last 12 months";
}

export const CHART_COLORS = [
  "hsl(265 89% 62%)",
  "hsl(170 75% 48%)",
  "hsl(38 92% 52%)",
  "hsl(280 65% 62%)",
  "hsl(200 80% 52%)",
  "hsl(340 75% 58%)",
];

export const TIMEFRAMES: Timeframe[] = ["1D", "5D", "1M", "6M", "YTD", "1Y"];
