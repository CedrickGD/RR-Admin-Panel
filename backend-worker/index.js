const SERVICE_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
const STATUS_VALUES = new Set(["ok", "degraded", "down"]);
const MAX_HISTORY = 1000;
const RECENT_EVENT_LIMIT = 200;
const ACTIVE_SESSION_LIMIT = 100;
const RECENT_SESSION_LIMIT = 200;
const RECENT_ERROR_LIMIT = 50;
const ACTIVE_SESSION_TIMEOUT_MS = 6 * 60 * 1000;
const SESSION_SELECT_COLUMNS =
  "session_id, install_id, source, user_label, client_ip, client_country, client_city, client_region, client_latitude, client_longitude, client_timezone, client_geo_source, client_geo_signal_source, client_accuracy_meters, client_geo_captured_at, app_version, platform, started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at";
const MAX_METRICS_KEYS = 64;
const MAX_MESSAGE_LENGTH = 500;
const MAX_METRICS_BYTES = 8 * 1024;
const SESSION_START = "session_start";
const SESSION_ACTIVE = "session_active";
const SESSION_END = "session_end";
const APP_ERROR = "app_error";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/health") {
        return json(
          {
            ok: true,
            service: "backend",
            storage: "rr_admin_panel"
          },
          200,
          request
        );
      }

      if (request.method === "GET" && (path === "/api/health" || path === "/healthz")) {
        const health = await loadHealth(env);
        return json(health, 200, request);
      }

      if (request.method === "GET" && (path === "/api/summary" || path === "/summary")) {
        return disabledStandaloneRoute(request);
      }

      if (request.method === "GET" && path === "/api/auth/session") {
        return disabledStandaloneRoute(request);
      }

      if (request.method === "POST" && path === "/api/auth/logout") {
        return disabledStandaloneRoute(request);
      }

      if (request.method === "GET" && path === "/api/admin/data") {
        return disabledStandaloneRoute(request);
      }

      if (request.method === "POST" && (path === "/v1/telemetry/event" || path === "/api/ingest")) {
        return await handleIngest(request, env);
      }

      return json(
        {
          ok: false,
          error: "Route not found."
        },
        404,
        request
      );
    } catch (err) {
      return json(
        {
          ok: false,
          error: "Internal error.",
          details: err instanceof Error ? err.message : String(err)
        },
        500,
        request
      );
    }
  }
};

function disabledStandaloneRoute(request) {
  return json(
    {
      ok: false,
      error: "Dashboard routes are disabled on the standalone worker. Use the Cloudflare Pages app behind Zero Trust."
    },
    410,
    request
  );
}

async function handleIngest(request, env) {
  if (!env?.DB) {
    return json(
      {
        ok: false,
        error: "D1 binding DB is missing."
      },
      500,
      request
    );
  }

  const authError = validateAuthorization(request, env);
  if (authError) {
    return authError;
  }

  let raw;
  try {
    raw = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Request body must be valid JSON."
      },
      400,
      request
    );
  }

  const normalized = normalizePayload(raw);
  if (!normalized.valid) {
    return json(
      {
        ok: false,
        error: normalized.message
      },
      400,
      request
    );
  }

  const payload = normalized.payload;
  const validation = validatePayload(payload);
  if (!validation.valid) {
    return json(
      {
        ok: false,
        error: validation.message
      },
      400,
      request
    );
  }

  const now = nowIso();
  const requestContext = readRequestContext(request);
  const event = {
    id: crypto.randomUUID(),
    source: payload.source,
    service: payload.service,
    timestamp: new Date(payload.timestamp).toISOString(),
    status: payload.status,
    metrics: attachRequestContext(payload.metrics, requestContext),
    message: payload.message ?? null,
    receivedAt: now
  };

  try {
    await storeTelemetryD1(env, event);
  } catch (err) {
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to persist telemetry."
      },
      500,
      request
    );
  }

  return json(
    {
      ok: true,
      accepted: true,
      backend: "d1",
      eventId: event.id,
      receivedAt: event.receivedAt
    },
    202,
    request
  );
}

function buildSessionPayload(request) {
  const email = request.headers.get("cf-access-authenticated-user-email") ?? "dashboard@rr-admin-panel.local";

  return {
    ok: true,
    authenticated: true,
    hasUsers: true,
    authMode: "access",
    user: {
      email,
      role: "admin"
    }
  };
}

function validateAuthorization(request, env) {
  const sharedKey = (env.APP_SHARED_KEY ?? env.INGEST_TOKEN ?? "").trim();
  if (!sharedKey) {
    return json(
      {
        ok: false,
        error: "Ingest key is missing (APP_SHARED_KEY or INGEST_TOKEN)."
      },
      500,
      request
    );
  }

  const headerValue = request.headers.get("x-app-key")?.trim() ?? "";
  const bearer = readBearerToken(request);

  const authorized =
    (headerValue.length > 0 && timingSafeEqual(headerValue, sharedKey)) ||
    (bearer !== null && timingSafeEqual(bearer, sharedKey));

  if (!authorized) {
    return json(
      {
        ok: false,
        error: "Invalid ingest credentials."
      },
      401,
      request
    );
  }

  return null;
}

async function storeTelemetryD1(env, event) {
  const db = env.DB;
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

async function loadSummary(env) {
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
      .all(),
    db
      .prepare(
        `SELECT ${SESSION_SELECT_COLUMNS}
         FROM app_sessions
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .bind(RECENT_SESSION_LIMIT)
      .all(),
    db
      .prepare(
        `SELECT event_id, source, service, ts, status, metrics_json, message, received_at
         FROM telemetry_events
         WHERE service = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(APP_ERROR, RECENT_ERROR_LIMIT)
      .all(),
    db
      .prepare(
        `SELECT event_id, source, service, ts, status, metrics_json, message, received_at
         FROM telemetry_events
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(RECENT_EVENT_LIMIT)
      .all(),
    db
      .prepare(
        `SELECT
           COUNT(*) AS totalEvents,
           SUM(CASE WHEN service = ? AND ts >= ? THEN 1 ELSE 0 END) AS errorsLast24Hours,
           MAX(ts) AS lastIngestAt
         FROM telemetry_events`
      )
      .bind(APP_ERROR, hoursAgoIso(24))
      .first(),
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
      .first()
  ]);

  return {
    generatedAt: nowIso(),
    storage: "d1",
    activeSessions: activeRows.results.map(mapSessionRow),
    recentSessions: recentSessionRows.results.map(mapSessionRow),
    recentErrors: recentErrorRows.results.map(mapEventRow),
    recentEvents: recentEventRows.results.map(mapEventRow),
    stats: {
      totalEvents: toNumber(eventStats?.totalEvents),
      totalSessions: toNumber(sessionStats?.totalSessions),
      activeUsers: toNumber(sessionStats?.activeUsers),
      sessionsStartedToday: toNumber(sessionStats?.sessionsStartedToday),
      sessionsEndedToday: toNumber(sessionStats?.sessionsEndedToday),
      averageSessionDurationSeconds: toRoundedNumber(sessionStats?.averageSessionDurationSeconds),
      errorsLast24Hours: toNumber(eventStats?.errorsLast24Hours),
      lastIngestAt: eventStats?.lastIngestAt ?? null
    }
  };
}

async function loadHealth(env) {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

  await ensureTelemetrySchema(db);
  await expireStaleSessionsD1(db);
  await db.prepare("SELECT 1").first();
  const stats = await db.prepare("SELECT COUNT(*) AS totalEvents, MAX(ts) AS lastIngestAt FROM telemetry_events").first();

  return {
    ok: true,
    api: "alive",
    storage: {
      backend: "d1",
      available: true
    },
    lastIngestAt: stats?.lastIngestAt ?? null,
    count: toNumber(stats?.totalEvents),
    build: {
      commit: "backend",
      branch: "production",
      environment: "workers",
      generatedAt: nowIso()
    }
  };
}

function mapEventRow(row) {
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

function safeParseMetrics(raw) {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function mapSessionRow(row) {
  return {
    id: row.session_id,
    installId: row.install_id,
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
    platform: row.platform ?? null,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at ?? null,
    durationSeconds: toNullableNumber(row.duration_seconds),
    isActive: toNumber(row.is_active) === 1,
    lastEvent: row.last_event ?? null,
    lastStatus: row.last_status,
    errorCount: toNumber(row.error_count)
  };
}

async function ensureTelemetrySchema(db) {
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
    `CREATE TABLE IF NOT EXISTS latest_status (
      source TEXT NOT NULL,
      service TEXT NOT NULL,
      ts TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
      metrics_json TEXT NOT NULL DEFAULT '{}',
      message TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source, service)
    )`,
    `CREATE TABLE IF NOT EXISTS app_sessions (
      session_id TEXT PRIMARY KEY,
      install_id TEXT NOT NULL,
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
    `CREATE INDEX IF NOT EXISTS idx_sessions_install ON app_sessions(install_id, updated_at DESC)`
  ];
  const alterStatements = [
    `ALTER TABLE app_sessions ADD COLUMN client_city TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_region TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_latitude REAL`,
    `ALTER TABLE app_sessions ADD COLUMN client_longitude REAL`,
    `ALTER TABLE app_sessions ADD COLUMN client_timezone TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_geo_source TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_geo_signal_source TEXT`,
    `ALTER TABLE app_sessions ADD COLUMN client_accuracy_meters REAL`,
    `ALTER TABLE app_sessions ADD COLUMN client_geo_captured_at TEXT`
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
}

async function expireStaleSessionsD1(db) {
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

async function upsertSessionD1(db, event) {
  const sessionId = readSessionId(event);
  if (!db || !sessionId) {
    return;
  }

  const existingRow = await db
    .prepare(
      `SELECT ${SESSION_SELECT_COLUMNS}
       FROM app_sessions
       WHERE session_id = ?`
    )
    .bind(sessionId)
    .first();

  const next = mergeSessionRecord(existingRow ? mapSessionRow(existingRow) : undefined, event);
  if (!next) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO app_sessions
        (session_id, install_id, source, user_label, client_ip, client_country, client_city, client_region, client_latitude, client_longitude, client_timezone, client_geo_source, client_geo_signal_source, client_accuracy_meters, client_geo_captured_at, app_version, platform,
         started_at, last_seen_at, ended_at, duration_seconds, is_active, last_event, last_status, error_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         install_id = excluded.install_id,
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
      next.platform,
      next.startedAt,
      next.lastSeenAt,
      next.endedAt,
      next.durationSeconds,
      next.isActive ? 1 : 0,
      next.lastEvent,
      next.lastStatus,
      next.errorCount,
      nowIso()
    )
    .run();
}

function mergeSessionRecord(existing, event) {
  const sessionId = readSessionId(event);
  const installId = readMetricText(event.metrics, ["install_id"]) ?? existing?.installId ?? null;
  if (!sessionId || !installId) {
    return null;
  }

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
    durationSeconds = readMetricNumber(event.metrics, ["session_duration_seconds"]) ?? durationBetween(startedAt, endedAt);
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
    platform,
    startedAt,
    lastSeenAt,
    endedAt,
    durationSeconds,
    isActive,
    lastEvent: event.service,
    lastStatus: event.status,
    errorCount
  };
}

function readBearerToken(request) {
  const auth = request.headers.get("authorization");
  if (!auth) {
    return null;
  }

  const [scheme, token] = auth.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token.trim();
}

function timingSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftByte = index < leftBytes.length ? leftBytes[index] : 0;
    const rightByte = index < rightBytes.length ? rightBytes[index] : 0;
    mismatch |= leftByte ^ rightByte;
  }

  return mismatch === 0;
}

function readRequestContext(request) {
  const cf = request.cf ?? null;
  const directIp = toText(request.headers.get("cf-connecting-ip"));
  const forwarded = toText(request.headers.get("x-forwarded-for"));
  const fallbackIp = forwarded ? toText(forwarded.split(",")[0]) : null;
  const country = toText(cf?.country) ?? toText(request.headers.get("cf-ipcountry"));

  return {
    clientIp: directIp || fallbackIp,
    country,
    city: toText(cf?.city),
    region: toText(cf?.region),
    latitude: normalizeCoordinate(toFiniteNumber(cf?.latitude), -90, 90),
    longitude: normalizeCoordinate(toFiniteNumber(cf?.longitude), -180, 180),
    timezone: toText(cf?.timezone)
  };
}

function attachRequestContext(metricsRaw, context) {
  const metrics = isObject(metricsRaw) ? { ...metricsRaw } : {};

  // Keep client IP visible per active session in Live view.
  if (context.clientIp && toText(metrics.client_ip) === null) {
    metrics.client_ip = context.clientIp;
  }

  if (context.clientIp && toText(metrics.client_ip_version) === null) {
    metrics.client_ip_version = ipVersion(context.clientIp);
  }

  if (context.country && toText(metrics.client_country) === null) {
    metrics.client_country = context.country;
  }

  if (
    toText(metrics.client_geo_source) === null &&
    (context.country || context.city || context.region || context.latitude !== null || context.longitude !== null)
  ) {
    metrics.client_geo_source = "edge_ip";
  }

  if (toText(metrics.client_geo_signal_source) === null && context.country) {
    metrics.client_geo_signal_source = "ip";
  }

  if (context.city && toText(metrics.client_city) === null) {
    metrics.client_city = context.city;
  }

  if (context.region && toText(metrics.client_region) === null) {
    metrics.client_region = context.region;
  }

  if (context.latitude !== null && readMetricFloat(metrics, ["client_latitude"]) === null) {
    metrics.client_latitude = context.latitude;
  }

  if (context.longitude !== null && readMetricFloat(metrics, ["client_longitude"]) === null) {
    metrics.client_longitude = context.longitude;
  }

  if (context.timezone && toText(metrics.client_timezone) === null) {
    metrics.client_timezone = context.timezone;
  }

  return metrics;
}

function ipVersion(value) {
  if (value.includes(":")) {
    return "ipv6";
  }

  if (value.includes(".")) {
    return "ipv4";
  }

  return "unknown";
}

function normalizePayload(raw) {
  if (!isObject(raw)) {
    return { valid: false, message: "Payload must be a JSON object." };
  }

  const canonical = tryNormalizeCanonicalPayload(raw);
  if (canonical.valid) {
    return canonical;
  }

  const legacy = tryNormalizeLegacyPayload(raw);
  if (legacy.valid) {
    return legacy;
  }

  return {
    valid: false,
    message:
      "Payload does not match supported schemas: canonical { source, service, timestamp, status, metrics, message? } or legacy { install_id, event_name, app_version?, timestamp_utc, platform?, properties? }."
  };
}

function tryNormalizeCanonicalPayload(raw) {
  const source = raw.source;
  const service = raw.service;
  const timestamp = raw.timestamp;
  const status = raw.status;
  const metrics = raw.metrics;
  const message = raw.message;

  if (
    typeof source !== "string" ||
    typeof service !== "string" ||
    typeof timestamp !== "string" ||
    typeof status !== "string" ||
    !isObject(metrics)
  ) {
    return { valid: false };
  }

  if (message !== undefined && typeof message !== "string") {
    return { valid: false };
  }

  return {
    valid: true,
    payload: {
      source,
      service,
      timestamp,
      status,
      metrics,
      message
    }
  };
}

function tryNormalizeLegacyPayload(raw) {
  const installId = raw.install_id;
  const eventName = raw.event_name;
  const timestampUtc = raw.timestamp_utc;
  const appVersion = raw.app_version;
  const platform = raw.platform;
  const propertiesRaw = raw.properties;

  if (typeof installId !== "string" || typeof eventName !== "string" || typeof timestampUtc !== "string") {
    return { valid: false };
  }

  if (appVersion !== undefined && typeof appVersion !== "string") {
    return { valid: false };
  }

  if (platform !== undefined && typeof platform !== "string") {
    return { valid: false };
  }

  const properties = isObject(propertiesRaw) ? propertiesRaw : {};
  const sourceFromProperties = toText(properties.worker_name) || toText(properties.source);

  const source = sanitizeIdentifier(sourceFromProperties || installId, "unknown-source");
  const service = normalizeLegacyService(eventName);
  const status = deriveLegacyStatus(eventName, properties);
  const message = deriveLegacyMessage(properties);
  const sessionId = deriveLegacySessionId(installId, properties);

  const metrics = {
    install_id: installId,
    session_id: sessionId
  };

  if (appVersion) {
    metrics.app_version = appVersion;
  }
  if (platform) {
    metrics.platform = platform;
  }

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string") {
      metrics[key] = coerceLegacyScalar(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      metrics[key] = value;
    } else if (value !== null && value !== undefined) {
      metrics[key] = String(value);
    }
  }

  return {
    valid: true,
    payload: {
      source,
      service,
      timestamp: timestampUtc,
      status,
      metrics,
      message: message ?? undefined
    }
  };
}

function validatePayload(payload) {
  if (!isObject(payload)) {
    return { valid: false, message: "Payload must be a JSON object." };
  }

  if (typeof payload.source !== "string" || !SERVICE_PATTERN.test(payload.source)) {
    return { valid: false, message: "Invalid source. Use 1-64 chars [a-zA-Z0-9._:-]." };
  }

  if (typeof payload.service !== "string" || !SERVICE_PATTERN.test(payload.service)) {
    return { valid: false, message: "Invalid service. Use 1-64 chars [a-zA-Z0-9._:-]." };
  }

  if (typeof payload.timestamp !== "string" || !Number.isFinite(Date.parse(payload.timestamp))) {
    return { valid: false, message: "timestamp must be a valid ISO string." };
  }

  if (!STATUS_VALUES.has(payload.status)) {
    return { valid: false, message: "status must be one of: ok, degraded, down." };
  }

  if (!isObject(payload.metrics)) {
    return { valid: false, message: "metrics must be a JSON object." };
  }

  const metricKeys = Object.keys(payload.metrics);
  if (metricKeys.length > MAX_METRICS_KEYS) {
    return { valid: false, message: `metrics has too many keys (max ${MAX_METRICS_KEYS}).` };
  }

  let metricBytes = 0;
  try {
    metricBytes = new TextEncoder().encode(JSON.stringify(payload.metrics)).byteLength;
  } catch {
    return { valid: false, message: "metrics contains non-serializable values." };
  }
  if (metricBytes > MAX_METRICS_BYTES) {
    return { valid: false, message: `metrics payload exceeds ${MAX_METRICS_BYTES} bytes.` };
  }

  if (!metricKeys.every((key) => key.length > 0 && key.length <= 64)) {
    return { valid: false, message: "metrics keys must be between 1 and 64 characters." };
  }

  if (payload.message !== undefined && (typeof payload.message !== "string" || payload.message.length > MAX_MESSAGE_LENGTH)) {
    return { valid: false, message: `message must be <= ${MAX_MESSAGE_LENGTH} characters.` };
  }

  return { valid: true };
}

function sanitizeIdentifier(value, fallback) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "_")
    .replaceAll(/[^a-z0-9._:-]/g, "_")
    .replaceAll(/_+/g, "_")
    .slice(0, 64);

  return normalized.length > 0 ? normalized : fallback;
}

function normalizeLegacyService(eventName) {
  const normalizedEvent = sanitizeIdentifier(eventName, "event");

  switch (normalizedEvent) {
    case "heartbeat":
      return SESSION_ACTIVE;
    case "app_start":
      return SESSION_START;
    case "app_exit":
    case "app_stop":
    case "shutdown":
      return SESSION_END;
    default:
      return normalizedEvent;
  }
}

function deriveLegacySessionId(installId, properties) {
  const explicitSessionId = toText(properties.session_id);
  if (explicitSessionId) {
    return explicitSessionId;
  }

  return `install:${installId}`;
}

function deriveLegacyStatus(eventName, properties) {
  const normalizedEvent = eventName.trim().toLowerCase();
  const result = toText(properties.result)?.toLowerCase() ?? "";

  if (normalizedEvent.includes("error")) {
    return "down";
  }

  if (["error", "fail", "failed", "failure", "fatal"].includes(result)) {
    return "down";
  }

  if (["degraded", "warn", "warning", "timeout", "slow"].includes(result)) {
    return "degraded";
  }

  return "ok";
}

function deriveLegacyMessage(properties) {
  const directMessage = toText(properties.message);
  if (directMessage) {
    return directMessage;
  }

  const result = toText(properties.result);
  if (result) {
    return `result:${result}`;
  }

  const route = toText(properties.route);
  if (route) {
    return `route:${route}`;
  }

  const type = toText(properties.type);
  if (type) {
    return `type:${type}`;
  }

  return null;
}

function coerceLegacyScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === "true") {
    return true;
  }
  if (lowered === "false") {
    return false;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return numeric;
  }

  return trimmed;
}

function toText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSessionId(event) {
  return readMetricText(event.metrics, ["session_id"]);
}

function readMetricText(metrics, keys) {
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

function readMetricNumber(metrics, keys) {
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

function readMetricFloat(metrics, keys) {
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

function startOfUtcDayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function newerIso(left, right) {
  return compareIso(right, left ?? "") > 0;
}

function compareIso(left, right) {
  const leftTs = Date.parse(left);
  const rightTs = Date.parse(right);

  if (Number.isFinite(leftTs) && Number.isFinite(rightTs)) {
    return leftTs - rightTs;
  }

  return left.localeCompare(right);
}

function durationBetween(startedAt, endedAt) {
  const startTs = Date.parse(startedAt);
  const endTs = Date.parse(endedAt);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) {
    return null;
  }

  return Math.round((endTs - startTs) / 1000);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value) {
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

function toRoundedNumber(value) {
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

function toNullableNumber(value) {
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

function toNullableFloat(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeCoordinate(value, min, max) {
  if (value === null) {
    return null;
  }

  return value >= min && value <= max ? value : null;
}

function nowIso() {
  return new Date().toISOString();
}

function json(data, status = 200, request) {
  const response = new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
  return withCors(response, request);
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request?.headers?.get("origin") ?? "*";

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization,x-app-key");
  headers.set("access-control-max-age", "86400");
  headers.set("vary", "origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
