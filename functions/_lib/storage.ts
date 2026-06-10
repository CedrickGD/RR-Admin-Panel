import { nowIso } from "./http";
import type {
  AppSessionRecord,
  HealthPayload,
  RuntimeEnv,
  StorageBackend,
  SummaryPayload,
  TelemetryEvent,
  TelemetryStatus,
} from "./types";

const EVENTS_KEY = "rr:events";
const SESSIONS_KEY = "rr:sessions";
const RECENT_EVENT_LIMIT = 200;
const ACTIVE_SESSION_LIMIT = 100;
const RECENT_SESSION_LIMIT = 200;
const RECENT_ERROR_LIMIT = 50;
const MAX_KV_SESSIONS = 500;
const MAX_KV_EVENTS = 1000;
const ACTIVE_SESSION_TIMEOUT_MS = 6 * 60 * 1000;
const EVENT_RETENTION_DAYS = 90;
// Legacy clients heartbeat every 30s; coalesce those into at most one session write per interval.
const HEARTBEAT_MIN_WRITE_MS = 75 * 1000;
const MAX_FEATURE_KEYS = 32;
export const SESSION_SELECT_COLUMNS =
  "session_id, install_id, hwid, source, user_label, client_ip, client_country, client_city, client_region, client_latitude, client_longitude, client_timezone, client_geo_source, client_geo_signal_source, client_accuracy_meters, client_geo_captured_at, app_version, display_version, platform, os_version, device_model, rpc_enabled, features_json, started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at";

const SESSION_START = "session_start";
const SESSION_ACTIVE = "session_active";
const SESSION_END = "session_end";
const APP_ERROR = "app_error";
// Per-service lifetime counters only for known event names — the ingest key ships inside
// the client binary, so an arbitrary service string must not mint unbounded counter rows.
const KNOWN_COUNTER_SERVICES = new Set([
  SESSION_START,
  SESSION_END,
  APP_ERROR,
  "process_start",
  "process_kill",
  "update_check",
  "ini_preset_add",
  "ini_preset_remove",
  "ini_preset_image_set",
  "ini_preset_image_reset",
  "custom_lab.sky_inject",
  "custom_lab.sky_restore",
  "discord_rpc_toggle",
  "crosshair_overlay",
]);

// Schema is idempotent but expensive (~20 statements); run it once per isolate, not per request.
let schemaReady = false;

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

export interface D1SessionRow {
  session_id: string;
  install_id: string;
  hwid: string | null;
  source: string;
  user_label: string | null;
  client_ip: string | null;
  client_country: string | null;
  client_city: string | null;
  client_region: string | null;
  client_latitude: number | string | null;
  client_longitude: number | string | null;
  client_timezone: string | null;
  client_geo_source: string | null;
  client_geo_signal_source: string | null;
  client_accuracy_meters: number | string | null;
  client_geo_captured_at: string | null;
  app_version: string | null;
  display_version: string | null;
  platform: string | null;
  os_version: string | null;
  device_model: string | null;
  rpc_enabled: number | string | null;
  features_json: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  duration_seconds: number | string | null;
  is_active: number | string;
  last_event: string | null;
  last_status: TelemetryStatus;
  error_count: number | string | null;
  updated_at: string;
}

interface EventStatsRow {
  totalEvents: number | string;
  errorsLast24Hours: number | string;
  lastIngestAt: string | null;
}

interface SessionStatsRow {
  totalSessions: number | string;
  activeUsers: number | string;
  lifetimeUsers: number | string;
  sessionsStartedToday: number | string;
  sessionsEndedToday: number | string;
  averageSessionDurationSeconds: number | string | null;
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

export async function loadSessionExportText(env: RuntimeEnv): Promise<string> {
  const preferred = resolveStorageBackend(env);

  if (preferred === "d1") {
    try {
      return await loadSessionExportTextD1(env);
    } catch (error) {
      if (!env.KV) {
        throw error;
      }
      return loadSessionExportTextKv(env);
    }
  }

  return loadSessionExportTextKv(env);
}

async function storeTelemetryD1(env: RuntimeEnv, event: TelemetryEvent): Promise<void> {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  await ensureTelemetrySchema(db);

  const existing = await readSessionRowD1(db, readSessionId(event));

  // Heartbeats are liveness pings, not history: they only bump the session row.
  // No event row, no counters — and at most one write per HEARTBEAT_MIN_WRITE_MS
  // so legacy 30s-interval clients don't burn the D1 write budget.
  if (event.service === SESSION_ACTIVE) {
    if (existing && isFreshHeartbeat(existing, event)) {
      return;
    }
    await upsertSessionD1(db, event, existing);
    return;
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

  const counterService = KNOWN_COUNTER_SERVICES.has(event.service) ? event.service : "other";
  await bumpCounters(db, ["events_total", `events:${counterService}`], event.receivedAt);
  await upsertSessionD1(db, event, existing);

  // Time-based retention, piggybacked on the rare session_end events instead of
  // running a DELETE on every ingest.
  if (event.service === SESSION_END) {
    const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(`DELETE FROM telemetry_events WHERE ts < ?`).bind(cutoff).run();
  }
}

function isFreshHeartbeat(existing: D1SessionRow, event: TelemetryEvent): boolean {
  if (toNumber(existing.is_active) !== 1) {
    return false;
  }

  const lastSeenTs = Date.parse(existing.last_seen_at);
  const eventTs = Date.parse(event.timestamp);
  if (!Number.isFinite(lastSeenTs) || !Number.isFinite(eventTs)) {
    return false;
  }

  return eventTs - lastSeenTs < HEARTBEAT_MIN_WRITE_MS;
}

async function readSessionRowD1(db: NonNullable<RuntimeEnv["DB"]>, sessionId: string | null): Promise<D1SessionRow | null> {
  if (!sessionId) {
    return null;
  }

  return db
    .prepare(
      `SELECT ${SESSION_SELECT_COLUMNS}
       FROM app_sessions
       WHERE session_id = ?`
    )
    .bind(sessionId)
    .first<D1SessionRow>();
}

async function bumpCounters(db: NonNullable<RuntimeEnv["DB"]>, keys: string[], updatedAt: string): Promise<void> {
  for (const key of keys) {
    await db
      .prepare(
        `INSERT INTO telemetry_counters (counter_key, counter_value, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(counter_key) DO UPDATE SET
           counter_value = counter_value + 1,
           updated_at = excluded.updated_at`
      )
      .bind(key, updatedAt)
      .run();
  }
}

async function loadSummaryD1(env: RuntimeEnv): Promise<SummaryPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  await ensureTelemetrySchema(db);
  await expireStaleSessionsD1(db);

  const [activeRows, recentSessionRows, recentErrorRows, recentEventRows, eventStats, sessionStats] = await Promise.all([
    db
      .prepare(
        `SELECT ${SESSION_SELECT_COLUMNS}
         FROM app_sessions
         WHERE is_active = 1
         ORDER BY last_seen_at DESC
         LIMIT ?`
      )
      .bind(ACTIVE_SESSION_LIMIT)
      .all<D1SessionRow>(),
    db
      .prepare(
        `SELECT ${SESSION_SELECT_COLUMNS}
         FROM app_sessions
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .bind(RECENT_SESSION_LIMIT)
      .all<D1SessionRow>(),
    db
      .prepare(
        `SELECT event_id, source, service, ts, status, metrics_json, message, received_at
         FROM telemetry_events
         WHERE service = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(APP_ERROR, RECENT_ERROR_LIMIT)
      .all<D1EventRow>(),
    db
      .prepare(
        `SELECT event_id, source, service, ts, status, metrics_json, message, received_at
         FROM telemetry_events
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(RECENT_EVENT_LIMIT)
      .all<D1EventRow>(),
    db
      .prepare(
        `SELECT
           COUNT(*) AS totalEvents,
           SUM(CASE WHEN service = ? AND ts >= ?
               AND COALESCE(json_extract(metrics_json, '$.error_kind'), '') != 'background'
               THEN 1 ELSE 0 END) AS errorsLast24Hours,
           MAX(ts) AS lastIngestAt
         FROM telemetry_events`
      )
      .bind(APP_ERROR, hoursAgoIso(24))
      .first<EventStatsRow>(),
    db
      .prepare(
        `SELECT
           COUNT(*) AS totalSessions,
           SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS activeUsers,
           COUNT(DISTINCT COALESCE(hwid, install_id)) AS lifetimeUsers,
           SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS sessionsStartedToday,
           SUM(CASE WHEN ended_at IS NOT NULL AND ended_at >= ? THEN 1 ELSE 0 END) AS sessionsEndedToday,
           AVG(CASE WHEN duration_seconds IS NOT NULL AND duration_seconds BETWEEN 1 AND 172800
                    AND session_id NOT LIKE 'install:%' THEN duration_seconds END) AS averageSessionDurationSeconds
         FROM app_sessions`
      )
      .bind(startOfUtcDayIso(), startOfUtcDayIso())
      .first<SessionStatsRow>(),
  ]);

  const lifetimeEvents = await db
    .prepare(`SELECT counter_value FROM telemetry_counters WHERE counter_key = 'events_total'`)
    .first<{ counter_value: number | string }>();

  return {
    generatedAt: nowIso(),
    storage: "d1",
    activeSessions: activeRows.results.map(mapD1Session),
    recentSessions: recentSessionRows.results.map(mapD1Session),
    recentErrors: recentErrorRows.results.map(mapD1Event),
    recentEvents: recentEventRows.results.map(mapD1Event),
    stats: {
      totalEvents: toNumber(eventStats?.totalEvents),
      lifetimeEvents: Math.max(toNumber(lifetimeEvents?.counter_value), toNumber(eventStats?.totalEvents)),
      totalSessions: toNumber(sessionStats?.totalSessions),
      activeUsers: toNumber(sessionStats?.activeUsers),
      lifetimeUsers: toNumber(sessionStats?.lifetimeUsers),
      sessionsStartedToday: toNumber(sessionStats?.sessionsStartedToday),
      sessionsEndedToday: toNumber(sessionStats?.sessionsEndedToday),
      averageSessionDurationSeconds: toRoundedNumber(sessionStats?.averageSessionDurationSeconds),
      errorsLast24Hours: toNumber(eventStats?.errorsLast24Hours),
      lastIngestAt: eventStats?.lastIngestAt ?? null,
    },
  };
}

async function loadHealthD1(env: RuntimeEnv): Promise<HealthPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  await ensureTelemetrySchema(db);
  await expireStaleSessionsD1(db);

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
      available: true,
    },
    lastIngestAt: stats?.lastIngestAt ?? null,
    count: toNumber(stats?.totalEvents),
    build: buildInfo(env),
  };
}

async function storeTelemetryKv(env: RuntimeEnv, event: TelemetryEvent): Promise<void> {
  const kv = env.KV;
  if (!kv) {
    throw new Error("KV binding KV is missing.");
  }

  const [events, sessionsMap] = await Promise.all([
    kvGetJson<TelemetryEvent[]>(kv, EVENTS_KEY, []),
    kvGetJson<Record<string, AppSessionRecord>>(kv, SESSIONS_KEY, {}),
  ]);

  // Match the D1 path: heartbeats only touch the session map, and the event log is
  // bounded (this is a fallback store, not history).
  const nextEvents = event.service === SESSION_ACTIVE ? events : [event, ...events].slice(0, MAX_KV_EVENTS);
  const session = mergeSessionRecord(sessionsMap[readSessionId(event) ?? ""], event);
  if (session) {
    sessionsMap[session.id] = session;
  }

  const trimmedSessions = trimSessionMap(sessionsMap);

  await Promise.all([
    kv.put(EVENTS_KEY, JSON.stringify(nextEvents)),
    kv.put(SESSIONS_KEY, JSON.stringify(trimmedSessions)),
  ]);
}

async function loadSummaryKv(env: RuntimeEnv): Promise<SummaryPayload> {
  const kv = env.KV;
  if (!kv) {
    throw new Error("KV binding KV is missing.");
  }

  const [events, sessionsMap] = await Promise.all([
    kvGetJson<TelemetryEvent[]>(kv, EVENTS_KEY, []),
    kvGetJson<Record<string, AppSessionRecord>>(kv, SESSIONS_KEY, {}),
  ]);

  const sessions = Object.values(sessionsMap).map(normalizeSessionRecord);
  return buildSummaryFromCollections("kv", sessions, events);
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
      available: true,
    },
    lastIngestAt: events[0]?.timestamp ?? null,
    count: events.length,
    build: buildInfo(env),
  };
}

async function loadSessionExportTextD1(env: RuntimeEnv): Promise<string> {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  await ensureTelemetrySchema(db);
  await expireStaleSessionsD1(db);

  const rows = await db
    .prepare(
      `SELECT ${SESSION_SELECT_COLUMNS}
       FROM app_sessions
       ORDER BY updated_at DESC`
    )
    .all<D1SessionRow>();

  return buildSessionExportText(rows.results.map(mapD1Session), "d1");
}

async function loadSessionExportTextKv(env: RuntimeEnv): Promise<string> {
  const kv = env.KV;
  if (!kv) {
    throw new Error("KV binding KV is missing.");
  }

  const sessionsMap = await kvGetJson<Record<string, AppSessionRecord>>(kv, SESSIONS_KEY, {});
  const sessions = Object.values(sessionsMap).map(normalizeSessionRecord);
  return buildSessionExportText(sessions, "kv");
}

function buildSummaryFromCollections(storage: StorageBackend, sessions: AppSessionRecord[], events: TelemetryEvent[]): SummaryPayload {
  const activeSessions = [...sessions]
    .filter((session) => session.isActive)
    .sort((left, right) => compareIso(right.lastSeenAt, left.lastSeenAt))
    .slice(0, ACTIVE_SESSION_LIMIT);
  const activeCount = sessions.filter((session) => session.isActive).length;

  const recentSessions = [...sessions]
    .sort((left, right) => compareIso(sessionRecency(right), sessionRecency(left)))
    .slice(0, RECENT_SESSION_LIMIT);

  const recentEvents = events.slice(0, RECENT_EVENT_LIMIT);
  const recentErrors = recentEvents.filter((event) => event.service === APP_ERROR).slice(0, RECENT_ERROR_LIMIT);
  const startOfDay = startOfUtcDayIso();
  const errorCutoff = hoursAgoIso(24);
  const durations = sessions
    .map((session) => session.durationSeconds)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);

  return {
    generatedAt: nowIso(),
    storage,
    activeSessions,
    recentSessions,
    recentErrors,
    recentEvents,
    stats: {
      totalEvents: events.length,
      lifetimeEvents: events.length,
      totalSessions: sessions.length,
      activeUsers: activeCount,
      lifetimeUsers: new Set(sessions.map((s) => (s.hwid ?? s.installId).trim().toLowerCase())).size,
      sessionsStartedToday: sessions.filter((session) => compareIso(session.startedAt, startOfDay) >= 0).length,
      sessionsEndedToday: sessions.filter((session) => session.endedAt && compareIso(session.endedAt, startOfDay) >= 0).length,
      averageSessionDurationSeconds:
        durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      errorsLast24Hours: events.filter((event) => event.service === APP_ERROR && compareIso(event.timestamp, errorCutoff) >= 0 && String(event.metrics["error_kind"] ?? "") !== "background").length,
      lastIngestAt: events[0]?.timestamp ?? null,
    },
  };
}

function buildSessionExportText(sessions: AppSessionRecord[], storage: StorageBackend): string {
  const ordered = [...sessions]
    .map(normalizeSessionRecord)
    .sort((left, right) => compareIso(sessionRecency(right), sessionRecency(left)));

  const lines = [
    "# RazorReaper session export",
    `Generated: ${nowIso()}`,
    `Storage: ${storage.toUpperCase()}`,
    `Total sessions: ${ordered.length}`,
    "",
  ];

  if (ordered.length === 0) {
    lines.push("No sessions available.");
    return lines.join("\n");
  }

  ordered.forEach((session, index) => {
    lines.push(formatSessionExportBlock(session, index + 1));
  });

  return lines.join("\n");
}

export async function ensureTelemetrySchema(db: RuntimeEnv["DB"]): Promise<void> {
  if (!db || schemaReady) {
    return;
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      service TEXT NOT NULL,
      ts TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
      metrics_json TEXT NOT NULL DEFAULT '{}',
      message TEXT,
      received_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_events_ts ON telemetry_events(ts DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_events_source_service ON telemetry_events(source, service, ts DESC)`,
    `CREATE TABLE IF NOT EXISTS app_sessions (
      session_id TEXT PRIMARY KEY,
      install_id TEXT NOT NULL,
      hwid TEXT,
      source TEXT NOT NULL,
      user_label TEXT,
      client_ip TEXT,
      client_country TEXT,
      client_city TEXT,
      client_region TEXT,
      client_latitude REAL,
      client_longitude REAL,
      client_timezone TEXT,
      client_geo_source TEXT,
      client_geo_signal_source TEXT,
      client_accuracy_meters REAL,
      client_geo_captured_at TEXT,
      app_version TEXT,
      platform TEXT,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_event TEXT,
      last_status TEXT NOT NULL CHECK (last_status IN ('ok', 'degraded', 'down')),
      error_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_active_last_seen ON app_sessions(is_active, last_seen_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_updated ON app_sessions(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_install ON app_sessions(install_id, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS telemetry_counters (
      counter_key TEXT PRIMARY KEY,
      counter_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
  ];
  const alterStatements = [
    `ALTER TABLE app_sessions ADD COLUMN hwid TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_city TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_region TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_latitude REAL`,
    `ALTER TABLE app_sessions ADD COLUMN client_longitude REAL`,
    `ALTER TABLE app_sessions ADD COLUMN client_timezone TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_geo_source TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_geo_signal_source TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_accuracy_meters REAL`,
    `ALTER TABLE app_sessions ADD COLUMN client_geo_captured_at TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN display_version TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN os_version TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN device_model TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN rpc_enabled INTEGER`,
    `ALTER TABLE app_sessions ADD COLUMN features_json TEXT`,
  ];

  for (const statement of statements) {
    await db.prepare(statement).run();
  }

  for (const statement of alterStatements) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("duplicate column name") && !message.includes("already exists")) {
        throw error;
      }
    }
  }

  schemaReady = true;
}

async function expireStaleSessionsD1(db: RuntimeEnv["DB"]): Promise<void> {
  if (!db) {
    return;
  }

  const cutoff = new Date(Date.now() - ACTIVE_SESSION_TIMEOUT_MS).toISOString();

  await db
    .prepare(
      `UPDATE app_sessions
       SET
         is_active = 0,
         ended_at = COALESCE(ended_at, last_seen_at),
         duration_seconds = COALESCE(
           duration_seconds,
           CASE
             WHEN strftime('%s', last_seen_at) >= strftime('%s', started_at)
             THEN CAST(strftime('%s', last_seen_at) - strftime('%s', started_at) AS INTEGER)
             ELSE duration_seconds
           END
         ),
         updated_at = ?
       WHERE is_active = 1
         AND last_seen_at < ?`
    )
    .bind(nowIso(), cutoff)
    .run();
}

async function upsertSessionD1(db: RuntimeEnv["DB"], event: TelemetryEvent, existingRow: D1SessionRow | null): Promise<void> {
  const sessionId = readSessionId(event);
  if (!db || !sessionId) {
    return;
  }

  const next = mergeSessionRecord(existingRow ? mapD1Session(existingRow) : undefined, event);
  if (!next) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO app_sessions
        (session_id, install_id, hwid, source, user_label, client_ip, client_country, client_city, client_region, client_latitude, client_longitude, client_timezone, client_geo_source, client_geo_signal_source, client_accuracy_meters, client_geo_captured_at, app_version, display_version, platform, os_version, device_model, rpc_enabled, features_json,
         started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         install_id = excluded.install_id,
         hwid = COALESCE(excluded.hwid, app_sessions.hwid),
         source = excluded.source,
         user_label = excluded.user_label,
         client_ip = excluded.client_ip,
         client_country = excluded.client_country,
         client_city = excluded.client_city,
         client_region = excluded.client_region,
         client_latitude = excluded.client_latitude,
         client_longitude = excluded.client_longitude,
         client_timezone = excluded.client_timezone,
         client_geo_source = excluded.client_geo_source,
         client_geo_signal_source = excluded.client_geo_signal_source,
         client_accuracy_meters = excluded.client_accuracy_meters,
         client_geo_captured_at = excluded.client_geo_captured_at,
         app_version = excluded.app_version,
         display_version = excluded.display_version,
         platform = excluded.platform,
         os_version = excluded.os_version,
         device_model = excluded.device_model,
         rpc_enabled = COALESCE(excluded.rpc_enabled, app_sessions.rpc_enabled),
         features_json = excluded.features_json,
         started_at = excluded.started_at,
         last_seen_at = excluded.last_seen_at,
         ended_at = excluded.ended_at,
         duration_seconds = excluded.duration_seconds,
         is_active = excluded.is_active,
         last_event = excluded.last_event,
         last_status = excluded.last_status,
         error_count = excluded.error_count,
         updated_at = excluded.updated_at`
    )
    .bind(
      next.id,
      next.installId,
      next.hwid,
      next.source,
      next.userLabel,
      next.clientIp,
      next.clientCountry,
      next.clientCity,
      next.clientRegion,
      next.clientLatitude,
      next.clientLongitude,
      next.clientTimezone,
      next.clientGeoSource,
      next.clientGeoSignalSource,
      next.clientAccuracyMeters,
      next.clientGeoCapturedAt,
      next.appVersion,
      next.displayVersion,
      next.platform,
      next.osVersion,
      next.deviceModel,
      next.rpcEnabled === null ? null : next.rpcEnabled ? 1 : 0,
      next.featuresJson,
      next.startedAt,
      next.lastSeenAt,
      next.endedAt,
      next.durationSeconds,
      next.isActive ? 1 : 0,
      next.lastEvent,
      next.lastStatus,
      next.errorCount,
      nowIso(),
    )
    .run();
}

function mergeSessionRecord(existing: AppSessionRecord | undefined, event: TelemetryEvent): AppSessionRecord | null {
  const sessionId = readSessionId(event);
  const installId = readMetricText(event.metrics, ["install_id"]) ?? existing?.installId ?? null;
  if (!sessionId || !installId) {
    return null;
  }

  const hwid = readMetricText(event.metrics, ["hwid"]) ?? existing?.hwid ?? null;
  const source = readMetricText(event.metrics, ["app_name"]) ?? event.source ?? existing?.source ?? "razorreaper";
  const userLabel = readMetricText(event.metrics, ["user_label", "machine_name"]) ?? existing?.userLabel ?? null;
  const clientIp = readMetricText(event.metrics, ["client_ip", "ip"]) ?? existing?.clientIp ?? null;
  const clientCountry = readMetricText(event.metrics, ["client_country", "country"]) ?? existing?.clientCountry ?? null;
  const clientCity = readMetricText(event.metrics, ["client_city", "city"]) ?? existing?.clientCity ?? null;
  const clientRegion = readMetricText(event.metrics, ["client_region", "region"]) ?? existing?.clientRegion ?? null;
  const clientLatitude = readMetricFloat(event.metrics, ["client_latitude", "latitude"]) ?? existing?.clientLatitude ?? null;
  const clientLongitude = readMetricFloat(event.metrics, ["client_longitude", "longitude"]) ?? existing?.clientLongitude ?? null;
  const clientTimezone = readMetricText(event.metrics, ["client_timezone", "timezone"]) ?? existing?.clientTimezone ?? null;
  const clientGeoSource = readMetricText(event.metrics, ["client_geo_source", "geo_source"]) ?? existing?.clientGeoSource ?? null;
  const clientGeoSignalSource = readMetricText(event.metrics, ["client_geo_signal_source", "geo_signal_source"]) ?? existing?.clientGeoSignalSource ?? null;
  const clientAccuracyMeters = readMetricFloat(event.metrics, ["client_accuracy_meters", "accuracy_meters"]) ?? existing?.clientAccuracyMeters ?? null;
  const clientGeoCapturedAt = readMetricText(event.metrics, ["client_geo_captured_at", "geo_captured_at"]) ?? existing?.clientGeoCapturedAt ?? null;
  const appVersion = readMetricText(event.metrics, ["app_version", "version"]) ?? existing?.appVersion ?? null;
  const displayVersion =
    readMetricText(event.metrics, ["app_display_version"]) ?? normalizeDisplayVersion(appVersion) ?? existing?.displayVersion ?? null;
  const platform = readMetricText(event.metrics, ["platform", "os_platform", "os"]) ?? existing?.platform ?? null;
  const osVersion = readMetricText(event.metrics, ["os_version"]) ?? existing?.osVersion ?? null;
  const deviceModel = readMetricText(event.metrics, ["device_model"]) ?? existing?.deviceModel ?? null;
  const rpcEnabled = readMetricBool(event.metrics, ["rpc_enabled", "discord_rpc_enabled", "discord_rpc"]) ?? existing?.rpcEnabled ?? null;
  const metricStartedAt = readMetricText(event.metrics, ["session_started_at"]);
  const eventTimestamp = event.timestamp;

  let featuresJson = existing?.featuresJson ?? null;
  let startedAt = existing?.startedAt ?? metricStartedAt ?? eventTimestamp;
  let lastSeenAt = newerIso(existing?.lastSeenAt, eventTimestamp) ? eventTimestamp : existing?.lastSeenAt ?? eventTimestamp;
  let endedAt = existing?.endedAt ?? null;
  let durationSeconds = existing?.durationSeconds ?? null;
  let isActive = existing?.isActive ?? true;
  let errorCount = existing?.errorCount ?? 0;

  // Client events are fire-and-forget HTTP calls, so a start/heartbeat/feature event can
  // land AFTER the session_end it logically preceded. Only events strictly newer than the
  // recorded end may reopen a closed session.
  const closedAt = existing && !existing.isActive ? existing.endedAt ?? existing.lastSeenAt : null;
  const mayReopenClosedSession = closedAt === null || compareIso(eventTimestamp, closedAt) > 0;

  if (event.service === SESSION_START) {
    if (!(existing?.endedAt && compareIso(existing.endedAt, eventTimestamp) >= 0)) {
      startedAt = metricStartedAt ?? eventTimestamp;
      lastSeenAt = eventTimestamp;
      endedAt = null;
      durationSeconds = null;
      isActive = true;
      featuresJson = null;
    }
    // else: stale start racing in after session_end — keep the closed state.
  } else if (event.service === SESSION_ACTIVE) {
    startedAt = existing?.startedAt ?? metricStartedAt ?? eventTimestamp;
    if (mayReopenClosedSession) {
      isActive = true;
      // Reopening a closed session (legacy install-scoped rows, lazy-expired sessions).
      if (existing && !existing.isActive) {
        endedAt = null;
        durationSeconds = null;
      }
    }
  } else if (event.service === SESSION_END) {
    lastSeenAt = eventTimestamp;
    endedAt = eventTimestamp;
    durationSeconds =
      readMetricNumber(event.metrics, ["session_duration_seconds"]) ??
      durationBetween(startedAt, endedAt);
    isActive = false;
  } else if (event.service === APP_ERROR) {
    errorCount += 1;
  } else {
    // Feature usage event: tally it and treat it as liveness like a heartbeat.
    if (mayReopenClosedSession) {
      isActive = true;
      if (existing && !existing.isActive) {
        endedAt = null;
        durationSeconds = null;
      }
    }
    featuresJson = incrementFeature(featuresJson, event.service);
  }

  return {
    id: sessionId,
    installId,
    hwid,
    source,
    userLabel,
    clientIp,
    clientCountry,
    clientCity,
    clientRegion,
    clientLatitude,
    clientLongitude,
    clientTimezone,
    clientGeoSource,
    clientGeoSignalSource,
    clientAccuracyMeters,
    clientGeoCapturedAt,
    appVersion,
    displayVersion,
    platform,
    osVersion,
    deviceModel,
    rpcEnabled,
    featuresJson,
    startedAt,
    lastSeenAt,
    endedAt,
    durationSeconds,
    isActive,
    lastEvent: event.service,
    lastStatus: event.status,
    errorCount,
  };
}

// "1.4.7.10" (display version + build counter) -> "1.4.7"; builds that never set
// ApplicationDisplayVersion report the MAUI default "1.0.0.x" -> "legacy".
export function normalizeDisplayVersion(appVersion: string | null): string | null {
  if (!appVersion) {
    return null;
  }

  const parts = appVersion.trim().split(".");
  const display = parts.length >= 4 ? parts.slice(0, 3).join(".") : appVersion.trim();
  return display === "1.0.0" ? "legacy" : display;
}

function incrementFeature(featuresJson: string | null, service: string): string {
  let features: Record<string, unknown> = {};
  if (featuresJson) {
    try {
      const parsed = JSON.parse(featuresJson) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        features = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt tally; start fresh.
    }
  }

  if (!(service in features) && Object.keys(features).length >= MAX_FEATURE_KEYS) {
    return JSON.stringify(features);
  }

  features[service] = toNumber(features[service]) + 1;
  return JSON.stringify(features);
}

function readMetricBool(metrics: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (lowered === "true" || lowered === "1" || lowered === "on" || lowered === "enabled") {
        return true;
      }
      if (lowered === "false" || lowered === "0" || lowered === "off" || lowered === "disabled") {
        return false;
      }
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value !== 0;
    }
  }

  return null;
}

function trimSessionMap(sessionsMap: Record<string, AppSessionRecord>): Record<string, AppSessionRecord> {
  const sorted = Object.values(sessionsMap)
    .sort((left, right) => compareIso(sessionRecency(right), sessionRecency(left)))
    .slice(0, MAX_KV_SESSIONS);

  return Object.fromEntries(sorted.map((session) => [session.id, session]));
}

function normalizeSessionRecord(session: AppSessionRecord): AppSessionRecord {
  const normalized = {
    ...session,
    clientCity: session.clientCity ?? null,
    clientRegion: session.clientRegion ?? null,
    clientLatitude: session.clientLatitude ?? null,
    clientLongitude: session.clientLongitude ?? null,
    clientTimezone: session.clientTimezone ?? null,
    clientGeoSource: session.clientGeoSource ?? null,
    clientGeoSignalSource: session.clientGeoSignalSource ?? null,
    clientAccuracyMeters: session.clientAccuracyMeters ?? null,
    clientGeoCapturedAt: session.clientGeoCapturedAt ?? null,
    displayVersion: session.displayVersion ?? normalizeDisplayVersion(session.appVersion ?? null),
    osVersion: session.osVersion ?? null,
    deviceModel: session.deviceModel ?? null,
    rpcEnabled: session.rpcEnabled ?? null,
    featuresJson: session.featuresJson ?? null,
  };

  if (!normalized.isActive || !isSessionStale(normalized.lastSeenAt)) {
    return normalized;
  }

  return {
    ...normalized,
    isActive: false,
    endedAt: normalized.endedAt ?? normalized.lastSeenAt,
    durationSeconds: normalized.durationSeconds ?? durationBetween(normalized.startedAt, normalized.lastSeenAt),
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
    receivedAt: row.received_at,
  };
}

function mapD1Session(row: D1SessionRow): AppSessionRecord {
  return {
    id: row.session_id,
    installId: row.install_id,
    hwid: row.hwid ?? null,
    source: row.source,
    userLabel: row.user_label ?? null,
    clientIp: row.client_ip ?? null,
    clientCountry: row.client_country ?? null,
    clientCity: row.client_city ?? null,
    clientRegion: row.client_region ?? null,
    clientLatitude: toNullableFloat(row.client_latitude),
    clientLongitude: toNullableFloat(row.client_longitude),
    clientTimezone: row.client_timezone ?? null,
    clientGeoSource: row.client_geo_source ?? null,
    clientGeoSignalSource: row.client_geo_signal_source ?? null,
    clientAccuracyMeters: toNullableFloat(row.client_accuracy_meters),
    clientGeoCapturedAt: row.client_geo_captured_at ?? null,
    appVersion: row.app_version ?? null,
    displayVersion: row.display_version ?? null,
    platform: row.platform ?? null,
    osVersion: row.os_version ?? null,
    deviceModel: row.device_model ?? null,
    rpcEnabled: row.rpc_enabled === null || row.rpc_enabled === undefined ? null : toNumber(row.rpc_enabled) === 1,
    featuresJson: row.features_json ?? null,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at ?? null,
    durationSeconds: toNullableNumber(row.duration_seconds),
    isActive: toNumber(row.is_active) === 1,
    lastEvent: row.last_event ?? null,
    lastStatus: row.last_status,
    errorCount: toNumber(row.error_count),
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

function buildInfo(env: RuntimeEnv): HealthPayload["build"] {
  return {
    commit: env.BUILD_SHA ?? env.CF_PAGES_COMMIT_SHA ?? "unknown",
    branch: env.CF_PAGES_BRANCH ?? "unknown",
    environment: env.CF_PAGES ? "pages" : "local",
    generatedAt: nowIso(),
  };
}

function readSessionId(event: TelemetryEvent): string | null {
  return readMetricText(event.metrics, ["session_id"]);
}

function readMetricText(metrics: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function readMetricNumber(metrics: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return Math.round(parsed);
      }
    }
  }

  return null;
}

function readMetricFloat(metrics: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function startOfUtcDayIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isSessionStale(lastSeenAt: string): boolean {
  const lastSeenTs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenTs)) {
    return false;
  }

  return Date.now() - lastSeenTs > ACTIVE_SESSION_TIMEOUT_MS;
}

function sessionRecency(session: AppSessionRecord): string {
  return session.endedAt ?? session.lastSeenAt;
}

function newerIso(left: string | undefined, right: string): boolean {
  return compareIso(right, left ?? "") > 0;
}

function compareIso(left: string, right: string): number {
  const leftTs = Date.parse(left);
  const rightTs = Date.parse(right);

  if (Number.isFinite(leftTs) && Number.isFinite(rightTs)) {
    return leftTs - rightTs;
  }

  return left.localeCompare(right);
}

function durationBetween(startedAt: string, endedAt: string): number | null {
  const startTs = Date.parse(startedAt);
  const endTs = Date.parse(endedAt);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) {
    return null;
  }

  return Math.round((endTs - startTs) / 1000);
}

function toNullableFloat(value: number | string | null): number | null {
  if (value === null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSessionExportBlock(session: AppSessionRecord, index: number): string {
  const duration =
    session.durationSeconds ??
    durationBetween(session.startedAt, session.isActive ? session.lastSeenAt : session.endedAt ?? session.lastSeenAt);

  const state = formatExportState(session);

  return [
    "========================================================================",
    `Session ${index}`,
    `User: ${sanitizeExportValue(session.userLabel ?? "-")}`,
    `Install ID: ${sanitizeExportValue(session.installId)}`,
    `HWID: ${sanitizeExportValue(session.hwid ?? "-")}`,
    `Session ID: ${sanitizeExportValue(session.id)}`,
    `State: ${state}`,
    `Telemetry status: ${sanitizeExportValue(session.lastStatus)}`,
    `Last event: ${sanitizeExportValue(formatExportEventName(session.lastEvent))}`,
    `Errors: ${session.errorCount}`,
    `Source: ${sanitizeExportValue(session.source)}`,
    `Version: ${sanitizeExportValue(session.appVersion ?? "-")}`,
    `Platform: ${sanitizeExportValue(session.platform ?? "-")}`,
    `Location: ${sanitizeExportValue(formatExportLocation(session))}`,
    `Country: ${sanitizeExportValue(session.clientCountry ?? "-")}`,
    `Timezone: ${sanitizeExportValue(session.clientTimezone ?? "-")}`,
    `Geo source: ${sanitizeExportValue(session.clientGeoSource ?? "-")}`,
    `Geo signal: ${sanitizeExportValue(session.clientGeoSignalSource ?? "-")}`,
    `Geo accuracy: ${sanitizeExportValue(formatExportAccuracy(session.clientAccuracyMeters))}`,
    `Geo captured: ${sanitizeExportValue(session.clientGeoCapturedAt ?? "-")}`,
    `IP: ${sanitizeExportValue(session.clientIp ?? "-")}`,
    `Started: ${sanitizeExportValue(session.startedAt)}`,
    `Last seen: ${sanitizeExportValue(session.lastSeenAt)}`,
    `Ended: ${sanitizeExportValue(session.endedAt ?? "open")}`,
    `Duration: ${sanitizeExportValue(formatExportDuration(duration))}`,
    "",
  ].join("\n");
}

function formatExportLocation(session: AppSessionRecord): string {
  const parts = [session.clientCity, session.clientRegion, session.clientCountry]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);

  return parts.length > 0 ? parts.join(", ") : "-";
}

function formatExportState(session: AppSessionRecord): string {
  if (session.isActive) {
    return session.errorCount > 0 ? "active (flagged)" : "active";
  }

  return session.errorCount > 0 ? "closed (flagged)" : "closed";
}

function formatExportEventName(value: string | null): string {
  if (!value) {
    return "-";
  }

  switch (value) {
    case SESSION_START:
      return "Started";
    case SESSION_ACTIVE:
      return "Heartbeat";
    case SESSION_END:
      return "Ended";
    case APP_ERROR:
      return "App error";
    default:
      return value.replaceAll("_", " ");
  }
}

function formatExportDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "open";
  }

  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function formatExportAccuracy(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "-";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km`;
  }

  return `${Math.round(value)} m`;
}

function sanitizeExportValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\|/g, "/").trim() || "-";
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

function toRoundedNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return null;
}
