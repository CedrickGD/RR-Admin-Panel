import { requireDashboardAccess } from "../../../../_lib/admin";
import { decodeKeyParam, error, isObject, json, nowIso } from "../../../../_lib/http";
import { internalError } from "../../../../_lib/responses";
import type { RuntimeEnv } from "../../../../_lib/types";
import { INSTALL_ID_PATTERN } from "../../../../../shared/install-auth";
import { ensureInstallsSchema, revokeInstall } from "../../../../../shared/installs-store";
import { readBodyTextLimited } from "../../../../../shared/telemetry-contract";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: {
    id: string;
  };
};

const MAX_BODY_BYTES = 4 * 1024;
const MAX_REASON_LENGTH = 500;

/**
 * Admin: revoke one install's signing key. Every later signed request from that install is
 * refused (401) and re-registration under the same install_id is rejected, so the client has
 * to start over with a fresh identity. Idempotent — the store keeps the first revocation and a
 * repeat call still answers 200.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const installId = decodeKeyParam(context.params.id).trim().toLowerCase();
    if (!INSTALL_ID_PATTERN.test(installId)) {
      return error(400, "Install id must be an RFC-4122 GUID.");
    }

    const reason = await readReason(context.request);
    if (!reason.ok) return error(reason.status, reason.message);

    await ensureInstallsSchema(db);
    const found = await revokeInstall(db, installId, reason.value, nowIso());
    if (!found) return error(404, "Install not found.");

    return json({ ok: true, installId, revoked: true });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}

/** Optional `{ reason?: string }` body; an empty body means "no reason". */
async function readReason(
  request: Request,
): Promise<{ ok: true; value: string | null } | { ok: false; status: 400 | 413; message: string }> {
  const body = await readBodyTextLimited(request, MAX_BODY_BYTES);
  if (!body.ok) return { ok: false, status: body.status, message: body.message };
  if (!body.text.trim()) return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON." };
  }
  if (!isObject(parsed)) {
    return { ok: false, status: 400, message: "Request body must be a JSON object." };
  }

  const raw = parsed.reason;
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string")
    return { ok: false, status: 400, message: "reason must be a string." };

  const trimmed = raw.trim().slice(0, MAX_REASON_LENGTH);
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}
