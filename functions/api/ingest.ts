import {
  MAX_BODY_BYTES,
  attachRequestContext,
  normalizePayload,
  readBodyTextLimited,
  readRequestContext,
  validatePayload,
} from "../../shared/telemetry-contract";
import { error, getBearerToken, json, nowIso, timingSafeEqualText } from "../_lib/http";
import { enforceRateLimit } from "../_lib/ratelimit";
import { storeTelemetry } from "../_lib/storage";
import type { RuntimeEnv, TelemetryEvent } from "../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }

  const limited = enforceRateLimit(context.request, {
    route: "ingest",
    limit: 60,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const authorizationFailure = validateIngestAuthorization(context.request, context.env);
  if (authorizationFailure) {
    return authorizationFailure;
  }

  const body = await readBodyTextLimited(context.request, MAX_BODY_BYTES);
  if (!body.ok) {
    return error(body.status, body.message);
  }

  if (!body.text.trim()) {
    return error(400, "Request body is required.");
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(body.text);
  } catch {
    return error(400, "Invalid JSON.");
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

  const requestContext = readRequestContext(context.request);

  const event: TelemetryEvent = {
    id: crypto.randomUUID(),
    source: payload.source,
    service: payload.service,
    timestamp: new Date(payload.timestamp).toISOString(),
    status: payload.status,
    metrics: attachRequestContext(payload.metrics, requestContext),
    message: payload.message ?? null,
    receivedAt: nowIso(),
  };

  try {
    const backend = await storeTelemetry(context.env, event);
    return json(
      {
        ok: true,
        backend,
        eventId: event.id,
        receivedAt: event.receivedAt,
      },
      202,
    );
  } catch (storageError) {
    return error(
      500,
      "Failed to persist telemetry.",
      storageError instanceof Error ? storageError.message : null,
    );
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

  const bearerAuthorized = ingestToken
    ? Boolean(bearerToken && timingSafeEqualText(bearerToken, ingestToken))
    : false;
  const appKeyAuthorized = legacyAppKey
    ? Boolean(appKey && timingSafeEqualText(appKey, legacyAppKey))
    : false;

  if (!bearerAuthorized && !appKeyAuthorized) {
    return error(401, "Unauthorized ingestion credentials.");
  }

  return null;
}
