const SERVICE_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
const STATUS_VALUES = new Set(["ok", "degraded", "down"]);
const MAX_HISTORY = 500;
const RECENT_LIMIT = MAX_HISTORY;
const MAX_METRICS_KEYS = 64;
const MAX_MESSAGE_LENGTH = 500;
const MAX_METRICS_BYTES = 8 * 1024;

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
        const summary = await loadSummary(env);
        return json(summary, 200, request);
      }

      if (request.method === "GET" && path === "/api/auth/session") {
        return json(buildSessionPayload(request), 200, request);
      }

      if (request.method === "POST" && path === "/api/auth/logout") {
        return json({ ok: true }, 200, request);
      }

      if (request.method === "GET" && path === "/api/admin/data") {
        const summary = await loadSummary(env);
        const health = await loadHealth(env);
        const session = buildSessionPayload(request);

        return json(
          {
            ok: true,
            summary,
            health,
            user: session.user,
            authMode: "access",
            accessIdentity: session.user.email,
            sessionExpiresAt: null
          },
          200,
          request
        );
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
  const event = {
    id: crypto.randomUUID(),
    source: payload.source,
    service: payload.service,
    timestamp: new Date(payload.timestamp).toISOString(),
    status: payload.status,
    metrics: payload.metrics,
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

async function loadSummary(env) {
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
      .all()
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
      .all()
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
    .first();

  const latest = latestRows.map(mapLatestRow);
  const recent = recentRows.map(mapEventRow);

  return {
    generatedAt: nowIso(),
    storage: "d1",
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

async function loadHealth(env) {
  const db = env.DB;
  if (!db) {
    throw new Error("D1 binding DB is missing.");
  }

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

function mapLatestRow(row) {
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

function calculateOverall(events) {
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
  const service = sanitizeIdentifier(eventName, "event");
  const status = deriveLegacyStatus(eventName, properties);
  const message = deriveLegacyMessage(properties);

  const metrics = {
    install_id: installId
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
