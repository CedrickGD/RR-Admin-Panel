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
const MAX_HISTORY = 1000;
const RECENT_EVENT_LIMIT = 200;
const ACTIVE_SESSION_LIMIT = 100;
const RECENT_SESSION_LIMIT = 200;
const RECENT_ERROR_LIMIT = 50;
const MAX_KV_SESSIONS = 500;
const ACTIVE_SESSION_TIMEOUT_MS = 12 * 60 * 1000;

const SESSION_START = "session_start";
const SESSION_ACTIVE = "session_active";
const SESSION_END = "session_end";
const APP_ERROR = "app_error";

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

interface D1SessionRow {
  session_id: string;
  install_id: string;
  source: string;
  user_label: string | null;
  client_ip: string | null;
  client_country: string | null;
  app_version: string | null;
  platform: string | null;
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

  const metricsJson = JSON.stringify(event.metrics);
  await db
    .prepare(
      `INSERT INTO telemetry_events
        (event_id, source, service, ts, status, metrics_json, message, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(event.id, event.source, event.service, event.timestamp, event.status, metricsJson, event.message, event.receivedAt)
    .run();

  await upsertSessionD1(db, event);

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

  await ensureTelemetrySchema(db);
  await expireStaleSessionsD1(db);

  const [activeRows, recentSessionRows, recentErrorRows, recentEventRows, eventStats, sessionStats] = await Promise.all([
    db
      .prepare(
        `SELECT session_id, install_id, source, user_label, client_ip, client_country, app_version, platform,
                started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at
         FROM app_sessions
         WHERE is_active = 1
         ORDER BY last_seen_at DESC
         LIMIT ?`
      )
      .bind(ACTIVE_SESSION_LIMIT)
      .all<D1SessionRow>(),
    db
      .prepare(
        `SELECT session_id, install_id, source, user_label, client_ip, client_country, app_version, platform,
                started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at
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
           SUM(CASE WHEN service = ? AND ts >= ? THEN 1 ELSE 0 END) AS errorsLast24Hours,
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
           SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS sessionsStartedToday,
           SUM(CASE WHEN ended_at IS NOT NULL AND ended_at >= ? THEN 1 ELSE 0 END) AS sessionsEndedToday,
           AVG(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds END) AS averageSessionDurationSeconds
         FROM app_sessions`
      )
      .bind(startOfUtcDayIso(), startOfUtcDayIso())
      .first<SessionStatsRow>(),
  ]);

  return {
    generatedAt: nowIso(),
    storage: "d1",
    activeSessions: activeRows.results.map(mapD1Session),
    recentSessions: recentSessionRows.results.map(mapD1Session),
    recentErrors: recentErrorRows.results.map(mapD1Event),
    recentEvents: recentEventRows.results.map(mapD1Event),
    stats: {
      totalEvents: toNumber(eventStats?.totalEvents),
      totalSessions: toNumber(sessionStats?.totalSessions),
      activeUsers: toNumber(sessionStats?.activeUsers),
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

  const nextEvents = [event, ...events].slice(0, MAX_HISTORY);
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
      `SELECT session_id, install_id, source, user_label, client_ip, client_country, app_version, platform,
              started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at
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
      totalSessions: sessions.length,
      activeUsers: activeCount,
      sessionsStartedToday: sessions.filter((session) => compareIso(session.startedAt, startOfDay) >= 0).length,
      sessionsEndedToday: sessions.filter((session) => session.endedAt && compareIso(session.endedAt, startOfDay) >= 0).length,
      averageSessionDurationSeconds:
        durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      errorsLast24Hours: events.filter((event) => event.service === APP_ERROR && compareIso(event.timestamp, errorCutoff) >= 0).length,
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

async function ensureTelemetrySchema(db: RuntimeEnv["DB"]): Promise<void> {
  if (!db) {
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
      source TEXT NOT NULL,
      user_label TEXT,
      client_ip TEXT,
      client_country TEXT,
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
  ];

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
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

async function upsertSessionD1(db: RuntimeEnv["DB"], event: TelemetryEvent): Promise<void> {
  const sessionId = readSessionId(event);
  if (!db || !sessionId) {
    return;
  }

  const existingRow = await db
    .prepare(
      `SELECT session_id, install_id, source, user_label, client_ip, client_country, app_version, platform,
              started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at
       FROM app_sessions
       WHERE session_id = ?`
    )
    .bind(sessionId)
    .first<D1SessionRow>();

  const next = mergeSessionRecord(existingRow ? mapD1Session(existingRow) : undefined, event);
  if (!next) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO app_sessions
        (session_id, install_id, source, user_label, client_ip, client_country, app_version, platform,
         started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         install_id = excluded.install_id,
         source = excluded.source,
         user_label = excluded.user_label,
         client_ip = excluded.client_ip,
         client_country = excluded.client_country,
         app_version = excluded.app_version,
         platform = excluded.platform,
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
      next.source,
      next.userLabel,
      next.clientIp,
      next.clientCountry,
      next.appVersion,
      next.platform,
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

  const source = readMetricText(event.metrics, ["app_name"]) ?? event.source ?? existing?.source ?? "razorreaper";
  const userLabel = readMetricText(event.metrics, ["user_label", "machine_name"]) ?? existing?.userLabel ?? null;
  const clientIp = readMetricText(event.metrics, ["client_ip", "ip"]) ?? existing?.clientIp ?? null;
  const clientCountry = readMetricText(event.metrics, ["client_country", "country"]) ?? existing?.clientCountry ?? null;
  const appVersion = readMetricText(event.metrics, ["app_version", "version"]) ?? existing?.appVersion ?? null;
  const platform = readMetricText(event.metrics, ["platform", "os_platform", "os"]) ?? existing?.platform ?? null;
  const metricStartedAt = readMetricText(event.metrics, ["session_started_at"]);
  const eventTimestamp = event.timestamp;

  let startedAt = existing?.startedAt ?? metricStartedAt ?? eventTimestamp;
  let lastSeenAt = newerIso(existing?.lastSeenAt, eventTimestamp) ? eventTimestamp : existing?.lastSeenAt ?? eventTimestamp;
  let endedAt = existing?.endedAt ?? null;
  let durationSeconds = existing?.durationSeconds ?? null;
  let isActive = existing?.isActive ?? true;
  let errorCount = existing?.errorCount ?? 0;

  if (event.service === SESSION_START) {
    startedAt = metricStartedAt ?? eventTimestamp;
    lastSeenAt = eventTimestamp;
    endedAt = null;
    durationSeconds = null;
    isActive = true;
  } else if (event.service === SESSION_ACTIVE) {
    startedAt = existing?.startedAt ?? metricStartedAt ?? eventTimestamp;
    lastSeenAt = eventTimestamp;
    endedAt = existing?.endedAt ?? null;
    isActive = true;
  } else if (event.service === SESSION_END) {
    lastSeenAt = eventTimestamp;
    endedAt = eventTimestamp;
    durationSeconds =
      readMetricNumber(event.metrics, ["session_duration_seconds"]) ??
      durationBetween(startedAt, endedAt);
    isActive = false;
  } else if (event.service === APP_ERROR) {
    lastSeenAt = eventTimestamp;
    errorCount += 1;
  }

  return {
    id: sessionId,
    installId,
    source,
    userLabel,
    clientIp,
    clientCountry,
    appVersion,
    platform,
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

function trimSessionMap(sessionsMap: Record<string, AppSessionRecord>): Record<string, AppSessionRecord> {
  const sorted = Object.values(sessionsMap)
    .sort((left, right) => compareIso(sessionRecency(right), sessionRecency(left)))
    .slice(0, MAX_KV_SESSIONS);

  return Object.fromEntries(sorted.map((session) => [session.id, session]));
}

function normalizeSessionRecord(session: AppSessionRecord): AppSessionRecord {
  if (!session.isActive || !isSessionStale(session.lastSeenAt)) {
    return session;
  }

  return {
    ...session,
    isActive: false,
    endedAt: session.endedAt ?? session.lastSeenAt,
    durationSeconds: session.durationSeconds ?? durationBetween(session.startedAt, session.lastSeenAt),
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
    source: row.source,
    userLabel: row.user_label ?? null,
    clientIp: row.client_ip ?? null,
    clientCountry: row.client_country ?? null,
    appVersion: row.app_version ?? null,
    platform: row.platform ?? null,
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
    `Session ID: ${sanitizeExportValue(session.id)}`,
    `State: ${state}`,
    `Telemetry status: ${sanitizeExportValue(session.lastStatus)}`,
    `Last event: ${sanitizeExportValue(formatExportEventName(session.lastEvent))}`,
    `Errors: ${session.errorCount}`,
    `Source: ${sanitizeExportValue(session.source)}`,
    `Version: ${sanitizeExportValue(session.appVersion ?? "-")}`,
    `Platform: ${sanitizeExportValue(session.platform ?? "-")}`,
    `Country: ${sanitizeExportValue(session.clientCountry ?? "-")}`,
    `IP: ${sanitizeExportValue(session.clientIp ?? "-")}`,
    `Started: ${sanitizeExportValue(session.startedAt)}`,
    `Last seen: ${sanitizeExportValue(session.lastSeenAt)}`,
    `Ended: ${sanitizeExportValue(session.endedAt ?? "open")}`,
    `Duration: ${sanitizeExportValue(formatExportDuration(duration))}`,
    "",
  ].join("\n");
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
