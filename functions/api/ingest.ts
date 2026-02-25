import { error, getBearerToken, isObject, json, nowIso, readJsonBody, timingSafeEqualText } from "../_lib/http";
import { storeTelemetry } from "../_lib/storage";
import type { RuntimeEnv, TelemetryEvent, TelemetryStatus } from "../_lib/types";

type IngestPayload = {
  source: string;
  timestamp: string;
  service: string;
  status: TelemetryStatus;
  metrics: Record<string, unknown>;
  message?: string;
};

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

const SERVICE_PATTERN = /^[a-zA-Z0-9._:-]{1,64}$/;
const STATUS_VALUES = new Set<TelemetryStatus>(["ok", "degraded", "down"]);
const MAX_METRICS_KEYS = 64;
const MAX_MESSAGE_LENGTH = 500;
const MAX_METRICS_BYTES = 8 * 1024;

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }

  const expectedToken = context.env.INGEST_TOKEN;
  if (!expectedToken) {
    return error(500, "Server is missing INGEST_TOKEN.");
  }

  const providedToken = getBearerToken(context.request);
  if (!providedToken || !timingSafeEqualText(providedToken, expectedToken)) {
    return error(401, "Unauthorized ingestion token.");
  }

  let payload: IngestPayload;
  try {
    payload = await readJsonBody<IngestPayload>(context.request, 16 * 1024);
  } catch (bodyError) {
    return error(400, bodyError instanceof Error ? bodyError.message : "Invalid request payload.");
  }

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
