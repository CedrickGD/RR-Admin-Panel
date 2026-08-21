import {
  hasSignatureHeaders,
  verifySignedRequest,
  type SignedRequestVerdict,
} from "../../shared/install-auth";
import { ensureInstallsSchema, findInstall, touchInstall } from "../../shared/installs-store";
import { MAX_BODY_BYTES, readBodyTextLimited } from "../../shared/telemetry-contract";
import { error, isObject, nowIso } from "./http";
import { internalError } from "./responses";
import type { RuntimeEnv } from "./types";

/**
 * rr.install.v1 request authentication for the app-facing Pages routes
 * (contract: docs/superpowers/specs/2026-08-21-install-signing-contract.md).
 *
 * - `required`: the request must carry a valid install signature.
 * - `optional`: unsigned requests pass (legacy clients) until the operator sets
 *   `REQUIRE_INSTALL_SIGNATURE=true`; a signature that IS present is always verified.
 *
 * The middleware reads the body once (bounded) because the signature covers the raw bytes;
 * handlers parse `bodyText` themselves instead of touching the request body again.
 */
export type InstallAuthMode = "required" | "optional";

export type InstallAuthResult =
  | { ok: true; installId: string | null; bodyText: string }
  | { ok: false; response: Response };

const SIGNATURE_REQUIRED = "Install signature required.";
const SIGNATURE_INVALID = "Invalid install signature.";

export async function requireInstallAuth(
  context: { request: Request; env: RuntimeEnv },
  mode: InstallAuthMode,
): Promise<InstallAuthResult> {
  const { request, env } = context;

  const body = await readBodyTextLimited(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return deny(error(body.status, body.message));
  }

  if (!hasSignatureHeaders(request)) {
    if (mode === "required" || isSignatureRequiredByConfig(env)) {
      return deny(error(401, SIGNATURE_REQUIRED));
    }
    return { ok: true, installId: null, bodyText: body.text };
  }

  const db = env.DB;
  if (!db) {
    return deny(error(500, "Database not available"));
  }

  let verdict: SignedRequestVerdict;
  try {
    await ensureInstallsSchema(db);
    verdict = await verifySignedRequest(request, body.text, {
      lookupInstall: (installId) => findInstall(db, installId),
    });
  } catch (cause) {
    return deny(internalError(request, "Unable to complete the request.", cause));
  }

  if (!verdict.ok) {
    // One public message for every failure mode — the reason is not the caller's business.
    return deny(error(401, SIGNATURE_INVALID));
  }

  // Liveness bookkeeping only (at most one write per 5 min inside the store); a failed bump
  // must never fail an otherwise valid request.
  try {
    await touchInstall(db, verdict.installId, nowIso());
  } catch {
    // ignore
  }

  return { ok: true, installId: verdict.installId, bodyText: body.text };
}

/** `REQUIRE_INSTALL_SIGNATURE=true` makes every `optional` route behave as `required`. */
export function isSignatureRequiredByConfig(env: RuntimeEnv): boolean {
  return (env.REQUIRE_INSTALL_SIGNATURE ?? "").trim().toLowerCase() === "true";
}

/**
 * Parses the body text the middleware already read. Returns `null` for a blank body, invalid
 * JSON, or a JSON value that is not an object — callers decide whether that is a 400 or
 * "treat as empty".
 */
export function parseJsonObject(bodyText: string): Record<string, unknown> | null {
  if (!bodyText.trim()) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function deny(response: Response): InstallAuthResult {
  return { ok: false, response };
}
