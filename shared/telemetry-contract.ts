// Telemetry ingest contract shared by the Pages Functions (functions/api/ingest.ts), the
// standalone worker (backend-worker/index.js) and, later, rr-api. Runtime-agnostic: only Web
// platform APIs (Request, TextEncoder, Date) — no Cloudflare or Node imports.
//
// The normalize/validate/context helpers are a verbatim move of the copies that used to live in
// functions/api/ingest.ts and backend-worker/index.js; they define *what* is accepted and how
// legacy (≤ 1.3) heartbeats are mapped, and must not change what ends up stored.

export type TelemetryStatus = "ok" | "degraded" | "down";

export interface CanonicalPayload {
  source: string;
  service: string;
  timestamp: string;
  status: TelemetryStatus;
  metrics: Record<string, unknown>;
  message?: string;
}

export interface RequestContext {
  clientIp: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

type RequestWithCf = Request & {
  cf?: {
    city?: string | null;
    region?: string | null;
    country?: string | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
    timezone?: string | null;
  } | null;
};

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_METRICS_KEYS = 64;
export const MAX_METRICS_BYTES = 8 * 1024;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_TIMESTAMP_SKEW_MS = 10 * 60 * 1000;

const SESSION_START = "session_start";
const SESSION_ACTIVE = "session_active";
const SESSION_END = "session_end";
const SERVICE_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
const STATUS_VALUES = new Set<TelemetryStatus>(["ok", "degraded", "down"]);

const encoder = new TextEncoder();

export function normalizePayload(
  raw: unknown,
):
  | { valid: true; payload: CanonicalPayload }
  | { valid: false; message: string; details?: unknown } {
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
        "legacy: { install_id, event_name, app_version?, timestamp_utc, platform?, properties? }",
      ],
    },
  };
}

function tryNormalizeCanonicalPayload(
  raw: Record<string, unknown>,
): { valid: true; payload: CanonicalPayload } | { valid: false } {
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
      message,
    },
  };
}

function tryNormalizeLegacyPayload(
  raw: Record<string, unknown>,
): { valid: true; payload: CanonicalPayload } | { valid: false } {
  const installId = raw.install_id;
  const eventName = raw.event_name;
  const timestampUtc = raw.timestamp_utc;
  const appVersion = raw.app_version;
  const platform = raw.platform;
  const propertiesRaw = raw.properties;

  if (
    typeof installId !== "string" ||
    typeof eventName !== "string" ||
    typeof timestampUtc !== "string"
  ) {
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
      message: message ?? undefined,
    },
  };
}

export function validatePayload(
  payload: CanonicalPayload,
): { valid: true } | { valid: false; message: string; details?: unknown } {
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
      message: `metrics has too many keys (max ${MAX_METRICS_KEYS}).`,
    };
  }

  let metricBytes = 0;
  try {
    metricBytes = encoder.encode(JSON.stringify(payload.metrics)).byteLength;
  } catch {
    return { valid: false, message: "metrics contains non-serializable values." };
  }
  if (metricBytes > MAX_METRICS_BYTES) {
    return { valid: false, message: `metrics payload exceeds ${MAX_METRICS_BYTES} bytes.` };
  }

  if (!metricKeys.every((key) => key.length > 0 && key.length <= 64)) {
    return { valid: false, message: "metrics keys must be between 1 and 64 characters." };
  }

  if (
    payload.message !== undefined &&
    (typeof payload.message !== "string" || payload.message.length > MAX_MESSAGE_LENGTH)
  ) {
    return { valid: false, message: `message must be <= ${MAX_MESSAGE_LENGTH} characters.` };
  }

  return { valid: true };
}

export function readRequestContext(request: Request): RequestContext {
  const requestWithCf = request as RequestWithCf;
  const cf = requestWithCf.cf ?? null;
  const directIp = toText(request.headers.get("cf-connecting-ip"));
  const forwarded = toText(request.headers.get("x-forwarded-for"));
  const fallbackIp = forwarded ? toText(forwarded.split(",")[0]) : null;

  return {
    clientIp: directIp || fallbackIp,
    country: toText(cf?.country) ?? toText(request.headers.get("cf-ipcountry")),
    city: toText(cf?.city),
    region: toText(cf?.region),
    latitude: normalizeCoordinate(toFiniteNumber(cf?.latitude), -90, 90),
    longitude: normalizeCoordinate(toFiniteNumber(cf?.longitude), -180, 180),
    timezone: toText(cf?.timezone),
  };
}

export function attachRequestContext(
  metricsRaw: Record<string, unknown>,
  context: RequestContext,
): Record<string, unknown> {
  const metrics = isObject(metricsRaw) ? { ...metricsRaw } : {};

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
    (context.country ||
      context.city ||
      context.region ||
      context.latitude !== null ||
      context.longitude !== null)
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

  if (context.latitude !== null && toFiniteNumber(metrics.client_latitude) === null) {
    metrics.client_latitude = context.latitude;
  }

  if (context.longitude !== null && toFiniteNumber(metrics.client_longitude) === null) {
    metrics.client_longitude = context.longitude;
  }

  if (context.timezone && toText(metrics.client_timezone) === null) {
    metrics.client_timezone = context.timezone;
  }

  return metrics;
}

export function clampTimestamp(
  clientIso: string,
  nowMs: number,
  maxSkewMs: number = MAX_TIMESTAMP_SKEW_MS,
): { iso: string; adjusted: boolean } {
  const clientMs = typeof clientIso === "string" ? Date.parse(clientIso) : Number.NaN;

  if (!Number.isFinite(clientMs) || Math.abs(clientMs - nowMs) > maxSkewMs) {
    return { iso: new Date(nowMs).toISOString(), adjusted: true };
  }

  return { iso: new Date(clientMs).toISOString(), adjusted: false };
}

export async function readBodyTextLimited(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413; message: string }> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const contentLength = Number.parseInt(declared, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, status: 413, message: `Payload exceeds ${maxBytes} bytes.` };
    }
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, message: "Unable to read request body." };
  }

  if (encoder.encode(text).byteLength > maxBytes) {
    return { ok: false, status: 413, message: `Payload exceeds ${maxBytes} bytes.` };
  }

  return { ok: true, text };
}

export function sanitizeIdentifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "_")
    .replaceAll(/[^a-z0-9._:-]/g, "_")
    .replaceAll(/_+/g, "_")
    .slice(0, 64);

  return normalized.length > 0 ? normalized : fallback;
}

function ipVersion(value: string): string {
  if (value.includes(":")) {
    return "ipv6";
  }

  if (value.includes(".")) {
    return "ipv4";
  }

  return "unknown";
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

function deriveLegacyStatus(
  eventName: string,
  properties: Record<string, unknown>,
): TelemetryStatus {
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

function toFiniteNumber(value: unknown): number | null {
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

function normalizeCoordinate(value: number | null, min: number, max: number): number | null {
  if (value === null || value < min || value > max) {
    return null;
  }

  return Math.round(value * 1_000_000) / 1_000_000;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
