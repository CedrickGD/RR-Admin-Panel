import { error, getBearerToken, isObject, json, nowIso, readJsonBody, timingSafeEqualText } from "../_lib/http";
import { storeTelemetry } from "../_lib/storage";
import type { RuntimeEnv, TelemetryEvent, TelemetryStatus } from "../_lib/types";

type CanonicalIngestPayload = {
  source: string;
  timestamp: string;
  service: string;
  status: TelemetryStatus;
  metrics: Record<string, unknown>;
  message?: string;
};

type LegacyIngestPayload = {
  install_id: string;
  event_name: string;
  app_version?: string;
  timestamp_utc: string;
  platform?: string;
  properties?: Record<string, unknown>;
};

type IngestPayload = CanonicalIngestPayload;

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const SESSION_START = "session_start";
const SESSION_ACTIVE = "session_active";
const SESSION_END = "session_end";
const SERVICE_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
const STATUS_VALUES = new Set<TelemetryStatus>(["ok", "degraded", "down"]);
const MAX_METRICS_KEYS = 64;
const MAX_MESSAGE_LENGTH = 500;
const MAX_METRICS_BYTES = 8 * 1024;

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }

  const authorizationFailure = validateIngestAuthorization(context.request, context.env);
  if (authorizationFailure) {
    return authorizationFailure;
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = await readJsonBody<unknown>(context.request, 16 * 1024);
  } catch (bodyError) {
    return error(400, bodyError instanceof Error ? bodyError.message : "Invalid request payload.");
  }

  const normalized = normalizePayload(payloadRaw);
  if (!normalized.valid) {
    return error(400, normalized.message, normalized.details ?? null);
  }

  const payload = normalized.payload;
  const validation = validatePayload(payload);
  if (!validation.valid) {
    return error(400, validation.message, validation.details);
  }

  const event: TelemetryEvent = {
    id: crypto.randomUUID(),
    source: payload.source,
    service: payload.service,
    timestamp: new Date(payload.timestamp).toISOString(),
    status: payload.status,
    metrics: payload.metrics,
    message: payload.message ?? null,
    receivedAt: nowIso()
  };

  try {
    const backend = await storeTelemetry(context.env, event);
    return json(
      {
        ok: true,
        backend,
        eventId: event.id,
        receivedAt: event.receivedAt
      },
      202
    );
  } catch (storageError) {
    return error(500, "Failed to persist telemetry.", storageError instanceof Error ? storageError.message : null);
  }
}

function validateIngestAuthorization(request: Request, env: RuntimeEnv): Response | null {
  const bearerToken = getBearerToken(request);
  const appKey = request.headers.get("x-app-key")?.trim() ?? "";

  const ingestToken = env.INGEST_TOKEN?.trim() ?? "";
  const legacyAppKey = env.TELEMETRY_APP_KEY?.trim() ?? ingestToken;

  if (!ingestToken && !legacyAppKey) {
    return error(500, "Server is missing ingest credentials (INGEST_TOKEN or TELEMETRY_APP_KEY).");
  }

  const bearerAuthorized = ingestToken ? Boolean(bearerToken && timingSafeEqualText(bearerToken, ingestToken)) : false;
  const appKeyAuthorized = legacyAppKey ? Boolean(appKey && timingSafeEqualText(appKey, legacyAppKey)) : false;

  if (!bearerAuthorized && !appKeyAuthorized) {
    return error(401, "Unauthorized ingestion credentials.");
  }

  return null;
}

function normalizePayload(raw: unknown): { valid: true; payload: IngestPayload } | { valid: false; message: string; details?: unknown } {
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
    message: "Payload does not match supported schemas.",
    details: {
      acceptedSchemas: [
        "canonical: { source, service, timestamp, status, metrics, message? }",
        "legacy: { install_id, event_name, app_version?, timestamp_utc, platform?, properties? }"
      ]
    }
  };
}

function tryNormalizeCanonicalPayload(raw: Record<string, unknown>): { valid: true; payload: IngestPayload } | { valid: false } {
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
      status: status as TelemetryStatus,
      metrics,
      message
    }
  };
}

function tryNormalizeLegacyPayload(raw: Record<string, unknown>): { valid: true; payload: IngestPayload } | { valid: false } {
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

  const metrics: Record<string, unknown> = {
    install_id: installId,
    session_id: sessionId,
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

function validatePayload(payload: IngestPayload): { valid: true } | { valid: false; message: string; details?: unknown } {
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
    return {
      valid: false,
      message: `metrics has too many keys (max ${MAX_METRICS_KEYS}).`
    };
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

function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "_")
    .replaceAll(/[^a-z0-9._:-]/g, "_")
    .replaceAll(/_+/g, "_")
    .slice(0, 64);

  return normalized.length > 0 ? normalized : fallback;
}

function normalizeLegacyService(eventName: string): string {
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

function deriveLegacySessionId(installId: string, properties: Record<string, unknown>): string {
  const explicitSessionId = toText(properties.session_id);
  if (explicitSessionId) {
    return explicitSessionId;
  }

  return `install:${installId}`;
}

function deriveLegacyStatus(eventName: string, properties: Record<string, unknown>): TelemetryStatus {
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

function deriveLegacyMessage(properties: Record<string, unknown>): string | null {
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

function coerceLegacyScalar(value: string): string | number | boolean {
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

function toText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
