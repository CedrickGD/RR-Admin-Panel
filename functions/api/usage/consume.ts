import { error, json } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { parseJsonObject, requireInstallAuth } from "../../_lib/install-auth";
import { enforceRateLimit } from "../../_lib/ratelimit";
import type { RuntimeEnv } from "../../_lib/types";
import { FREE_LIMITS, consumeUse, ensureUsageSchema, isPremiumHwid } from "../../_lib/usage";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * POST /api/usage/consume  { hwid, feature }
 *
 * One call = one use of a quota'd feature. Premium HWIDs (any active, unexpired license)
 * short-circuit to `unlimited` without touching a counter. Unknown features are unlimited
 * by definition — the limits table is the product decision, not the client.
 *
 * Requires an install signature (no legacy client calls this route): the HWID is the identity,
 * the signature proves the call comes from a registered, non-revoked install.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  const limited = enforceRateLimit(context.request, {
    route: "usage/consume",
    limit: 60,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const auth = await requireInstallAuth(context, "required");
  if (!auth.ok) return auth.response;

  try {
    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const body = parseJsonObject(auth.bodyText);
    const hwid = typeof body?.hwid === "string" ? body.hwid.trim() : "";
    const feature = typeof body?.feature === "string" ? body.feature.trim().toLowerCase() : "";
    if (!hwid || !feature) return error(400, "hwid and feature are required.");

    if (await isPremiumHwid(context.env, hwid)) {
      return json({ ok: true, unlimited: true });
    }

    const limit = FREE_LIMITS[feature];
    if (limit === undefined) {
      return json({ ok: true, unlimited: true });
    }

    await ensureUsageSchema(db);
    return json(await consumeUse(db, hwid, feature, limit));
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
