import { error, json } from "../../_lib/http";
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
 * Unauthenticated by design, like /api/license/validate: the HWID is the identity, and the
 * worst abuse is someone burning their own quota.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const body = (await context.request.json().catch(() => null)) as { hwid?: string; feature?: string } | null;
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
    return error(500, "Failed to consume usage.", err instanceof Error ? err.message : null);
  }
}
