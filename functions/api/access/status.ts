import { ensureAccessSchema, findActiveSuspension, isSuspensionActive } from "../../_lib/access";
import { error, json, nowIso } from "../../_lib/http";
import { parseJsonObject, requireInstallAuth } from "../../_lib/install-auth";
import { enforceRateLimit } from "../../_lib/ratelimit";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Public endpoint the desktop app polls to learn whether this machine's access has been
 * suspended or banned — same access model as /api/license/validate: an install signature is
 * verified when present, unsigned calls stay allowed for legacy clients until
 * REQUIRE_INSTALL_SIGNATURE=true. Keyed by hwid (+ install_id fallback) so it covers FREE users
 * too, not just license holders. A clear-access response is `{ ok: true, suspended: false }`;
 * the app fails open on any network/5xx error, so this must only ever report a suspension it is
 * certain of. POST only: the identifiers travel in the (signed) body, never in the URL.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  return handle(context);
}

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }
  return handle(context);
}

async function handle(context: HandlerContext): Promise<Response> {
  const limited = enforceRateLimit(context.request, {
    route: "access/status",
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const auth = await requireInstallAuth(context, "optional");
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  try {
    const body = parseJsonObject(auth.bodyText) ?? {};
    const hwid = typeof body.hwid === "string" ? body.hwid.trim() : "";
    const installId = typeof body.install_id === "string" ? body.install_id.trim() : "";

    if (!hwid && !installId) {
      return error(400, "hwid or install_id is required.");
    }

    await ensureAccessSchema(context.env);

    const now = nowIso();
    const suspension = await findActiveSuspension(context.env, { hwid, installId });

    if (!isSuspensionActive(suspension, now)) {
      return json({ ok: true, suspended: false });
    }

    return json({
      ok: true,
      suspended: true,
      mode: suspension!.mode,
      reason: suspension!.reason,
      banned_until: suspension!.banned_until,
    });
  } catch (err) {
    return error(
      500,
      "Failed to resolve access status.",
      err instanceof Error ? err.message : null,
    );
  }
}
