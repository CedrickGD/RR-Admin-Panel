import { nowIso } from "./http";
import type { HealthPayload, RuntimeEnv, StorageBackend, SummaryPayload, TelemetryEvent, TelemetryStatus } from "./types";

const EVENTS_KEY = "rr:events";
const LATEST_KEY = "rr:latest";
const MAX_HISTORY = 500;
const RECENT_LIMIT = MAX_HISTORY;

interface D1EventRow {
  event_id: string;
  source: string;
  service: string;
  ts: string;
  status: TelemetryStatus;
  metrics_json: string | null;
  message: string | null;
  received_at: string;
}

interface D1LatestRow {
  source: string;
  service: string;
  ts: string;
  status: TelemetryStatus;
  metrics_json: string | null;
  message: string | null;
  updated_at: string;
}

interface StatsRow {
  totalEvents: number | string;
  lastIngestAt: string | null;
  sources: number | string;
  services: number | string;
}

export function resolveStorageBackend(env: RuntimeEnv): StorageBackend {
  const preferred = (env.STORAGE_BACKEND ?? "d1").toLowerCase();

  if (preferred === "kv") {
    if (env.KV) {
      return "kv";
    }
    if (env.DB) {
      return "d1";
    }
    throw new Error("No storage binding available. Configure D1 or KV.");
  }

  if (env.DB) {
    return "d1";
  }
  if (env.KV) {
    return "kv";
  }

  throw new Error("No storage binding available. Configure D1 or KV.");
}

export async function storeTelemetry(env: RuntimeEnv, event: TelemetryEvent): Promise<StorageBackend> {
  const preferred = resolveStorageBackend(env);

  if (preferred === "d1") {
    try {
      await storeTelemetryD1(env, event);
      return "d1";
    } catch (error) {
      if (!env.KV) {
        throw error;
      }
      await storeTelemetryKv(env, event);
      return "kv";
    }
  }

  await storeTelemetryKv(env, event);
  return "kv";
}

export async function loadSummary(env: RuntimeEnv): Promise<SummaryPayload> {
  const preferred = resolveStorageBackend(env);

  if (preferred === "d1") {
    try {
      return await loadSummaryD1(env);
    } catch (error) {
      if (!env.KV) {
        throw error;
      }
      return loadSummaryKv(env);
    }
  }

  return loadSummaryKv(env);
}

export async function loadHealth(env: RuntimeEnv): Promise<HealthPayload> {
  const preferred = resolveStorageBackend(env);

  if (preferred === "d1") {
    try {
      return await loadHealthD1(env);
    } catch (error) {
      if (!env.KV) {
        throw error;
      }
      return loadHealthKv(env);
    }
  }

  return loadHealthKv(env);
}

async function storeTelemetryD1(env: RuntimeEnv, event: TelemetryEvent): Promise<void> {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  const metricsJson = JSON.stringify(event.metrics);
  await db
    .prepare(
      `INSERT INTO telemetry_events
        (event_id, source, service, ts, status, metrics_json, message, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(event.id, event.source, event.service, event.timestamp, event.status, metricsJson, event.message, event.receivedAt)
    .run();

  await db
    .prepare(
      `INSERT INTO latest_status
        (source, service, ts, status, metrics_json, message, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, service) DO UPDATE SET
         ts = excluded.ts,
         status = excluded.status,
         metrics_json = excluded.metrics_json,
         message = excluded.message,
         updated_at = excluded.updated_at`
    )
    .bind(event.source, event.service, event.timestamp, event.status, metricsJson, event.message, event.receivedAt)
    .run();

  await db
    .prepare(`DELETE FROM telemetry_events WHERE id NOT IN (SELECT id FROM telemetry_events ORDER BY id DESC LIMIT ?)`)
    .bind(MAX_HISTORY)
    .run();
}

async function loadSummaryD1(env: RuntimeEnv): Promise<SummaryPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  const latestRows = (
    await db
      .prepare(
        `SELECT source, service, ts, status, metrics_json, message, updated_at
         FROM latest_status
         ORDER BY updated_at DESC
         LIMIT 300`
      )
      .all<D1LatestRow>()
  ).results;

  const recentRows = (
    await db
      .prepare(
        `SELECT event_id, source, service, ts, status, metrics_json, message, received_at
         FROM telemetry_events
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(RECENT_LIMIT)
      .all<D1EventRow>()
  ).results;

  const stats = await db
    .prepare(
      `SELECT
        COUNT(*) AS totalEvents,
        MAX(ts) AS lastIngestAt,
        COUNT(DISTINCT source) AS sources,
        COUNT(DISTINCT service) AS services
       FROM telemetry_events`
    )
    .first<StatsRow>();

  const latest = latestRows.map(mapD1Latest);
  const recent = recentRows.map(mapD1Event);
  const summary = buildSummary("d1", latest, recent, stats);
  return summary;
}

async function loadHealthD1(env: RuntimeEnv): Promise<HealthPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  await db.prepare("SELECT 1 AS ok").first();
  const stats = await db.prepare("SELECT COUNT(*) AS totalEvents, MAX(ts) AS lastIngestAt FROM telemetry_events").first<{
    totalEvents: number | string;
    lastIngestAt: string | null;
  }>();

  return {
    ok: true,
    api: "alive",
    storage: {
      backend: "d1",
      available: true
    },
    lastIngestAt: stats?.lastIngestAt ?? null,
    count: toNumber(stats?.totalEvents),
    build: buildInfo(env)
  };
}

async function storeTelemetryKv(env: RuntimeEnv, event: TelemetryEvent): Promise<void> {
  const kv = env.KV;
  if (!kv) {
    throw new Error("KV binding KV is missing.");
  }

  const [events, latestMap] = await Promise.all([
    kvGetJson<TelemetryEvent[]>(kv, EVENTS_KEY, []),
    kvGetJson<Record<string, TelemetryEvent>>(kv, LATEST_KEY, {})
  ]);

  const nextEvents = [event, ...events].slice(0, MAX_HISTORY);
  latestMap[buildLatestKey(event)] = event;

  await Promise.all([kv.put(EVENTS_KEY, JSON.stringify(nextEvents)), kv.put(LATEST_KEY, JSON.stringify(latestMap))]);
}

async function loadSummaryKv(env: RuntimeEnv): Promise<SummaryPayload> {
  const kv = env.KV;
  if (!kv) {
    throw new Error("KV binding KV is missing.");
  }

  const [events, latestMap] = await Promise.all([
    kvGetJson<TelemetryEvent[]>(kv, EVENTS_KEY, []),
    kvGetJson<Record<string, TelemetryEvent>>(kv, LATEST_KEY, {})
  ]);

  const latest = Object.values(latestMap).sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  const recent = events.slice(0, RECENT_LIMIT);
  const sourceSet = new Set((latest.length ? latest : recent).map((event) => event.source));
  const serviceSet = new Set((latest.length ? latest : recent).map((event) => event.service));
  const stats = {
    totalEvents: events.length,
    lastIngestAt: events[0]?.timestamp ?? null,
    sources: sourceSet.size,
    services: serviceSet.size
  };

  return {
    generatedAt: nowIso(),
    storage: "kv",
    overallStatus: calculateOverall(latest),
    latest,
    recent,
    stats
  };
}

async function loadHealthKv(env: RuntimeEnv): Promise<HealthPayload> {
  const kv = env.KV;
  if (!kv) {
    throw new Error("KV binding KV is missing.");
  }

  await kv.list({ prefix: "rr:", limit: 1 });
  const events = await kvGetJson<TelemetryEvent[]>(kv, EVENTS_KEY, []);

  return {
    ok: true,
    api: "alive",
    storage: {
      backend: "kv",
      available: true
    },
    lastIngestAt: events[0]?.timestamp ?? null,
    count: events.length,
    build: buildInfo(env)
  };
}

function buildSummary(storage: StorageBackend, latest: TelemetryEvent[], recent: TelemetryEvent[], stats: StatsRow | null): SummaryPayload {
  return {
    generatedAt: nowIso(),
    storage,
    overallStatus: calculateOverall(latest),
    latest,
    recent,
    stats: {
      totalEvents: toNumber(stats?.totalEvents),
      lastIngestAt: stats?.lastIngestAt ?? null,
      sources: toNumber(stats?.sources),
      services: toNumber(stats?.services)
    }
  };
}

function mapD1Latest(row: D1LatestRow): TelemetryEvent {
  return {
    id: `${row.source}:${row.service}:${row.ts}`,
    source: row.source,
    service: row.service,
    timestamp: row.ts,
    status: row.status,
    metrics: safeParseMetrics(row.metrics_json),
    message: row.message ?? null,
    receivedAt: row.updated_at
  };
}

function mapD1Event(row: D1EventRow): TelemetryEvent {
  return {
    id: row.event_id,
    source: row.source,
    service: row.service,
    timestamp: row.ts,
    status: row.status,
    metrics: safeParseMetrics(row.metrics_json),
    message: row.message ?? null,
    receivedAt: row.received_at
  };
}

function safeParseMetrics(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function calculateOverall(events: TelemetryEvent[]): SummaryPayload["overallStatus"] {
  if (events.length === 0) {
    return "unknown";
  }

  if (events.some((event) => event.status === "down")) {
    return "down";
  }

  if (events.some((event) => event.status === "degraded")) {
    return "degraded";
  }

  return "ok";
}

function buildLatestKey(event: TelemetryEvent): string {
  return `${event.source}::${event.service}`;
}

async function kvGetJson<T>(kv: RuntimeEnv["KV"], key: string, fallback: T): Promise<T> {
  if (!kv) {
    return fallback;
  }

  try {
    const loaded = await kv.get<T>(key, "json");
    return loaded ?? fallback;
  } catch {
    return fallback;
  }
}

function buildInfo(env: RuntimeEnv): HealthPayload["build"] {
  return {
    commit: env.BUILD_SHA ?? env.CF_PAGES_COMMIT_SHA ?? "unknown",
    branch: env.CF_PAGES_BRANCH ?? "unknown",
    environment: env.CF_PAGES ? "pages" : "local",
    generatedAt: nowIso()
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}
