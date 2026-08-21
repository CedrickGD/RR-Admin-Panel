import {
  attachRequestContext,
  clampTimestamp,
  normalizePayload,
  readRequestContext,
  validatePayload,
} from "../../shared/telemetry-contract";
import { error, getBearerToken, json, timingSafeEqualText } from "../_lib/http";
import { requireInstallAuth } from "../_lib/install-auth";
import { enforceRateLimit } from "../_lib/ratelimit";
import { internalError } from "../_lib/responses";
import { SessionOwnershipError, storeTelemetry, type IngestAuthMode } from "../_lib/storage";
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

  // Per-install signature first; the shared key is the legacy fallback until the operator
  // flips LEGACY_INGEST_KEY_ENABLED to "false".
  const auth = await requireInstallAuth(context, "optional");
  if (!auth.ok) {
    return auth.response;
  }

  let authMode: IngestAuthMode;
  if (auth.installId) {
    authMode = "signed";
  } else {
    if (!isLegacyIngestKeyEnabled(context.env)) {
      return error(401, "Install signature required.");
    }
    const authorizationFailure = validateIngestAuthorization(context.request, context.env);
    if (authorizationFailure) {
      return authorizationFailure;
    }
    authMode = "legacy_key";
  }

  if (!auth.bodyText.trim()) {
    return error(400, "Request body is required.");
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(auth.bodyText);
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

  const metrics = attachRequestContext(payload.metrics, readRequestContext(context.request));
  if (auth.installId) {
    // The verified identity wins over whatever the client claimed.
    metrics.install_id = auth.installId;
  }

  const nowMs = Date.now();
  const event: TelemetryEvent = {
    id: crypto.randomUUID(),
    source: payload.source,
    service: payload.service,
    timestamp: clampTimestamp(payload.timestamp, nowMs).iso,
    status: payload.status,
    metrics,
    message: payload.message ?? null,
    receivedAt: new Date(nowMs).toISOString(),
  };

  try {
    const backend = await storeTelemetry(context.env, event, {
      ownerInstallId: auth.installId,
      authMode,
    });
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
    if (storageError instanceof SessionOwnershipError) {
      return error(403, "Session belongs to another install.");
    }
    return internalError(context.request, "Unable to save the operation.", storageError);
  }
}

/** The shared ingest key stays accepted until the operator sets LEGACY_INGEST_KEY_ENABLED=false. */
function isLegacyIngestKeyEnabled(env: RuntimeEnv): boolean {
  return (env.LEGACY_INGEST_KEY_ENABLED ?? "true").trim().toLowerCase() !== "false";
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
