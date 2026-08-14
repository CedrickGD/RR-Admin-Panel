import { error, json } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";
import { FREE_LIMITS, currentPeriod, ensureUsageSchema, isPremiumHwid } from "../../_lib/usage";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * GET /api/usage/status?hwid=…
 *
 * Read-only view for the app's quota chips: every limited feature with used/limit for the
 * current month. Premium answers `unlimited` so the app can hide the chips entirely.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const hwid = new URL(context.request.url).searchParams.get("hwid")?.trim() ?? "";
    if (!hwid) return error(400, "hwid is required.");

    if (await isPremiumHwid(context.env, hwid)) {
      return json({ ok: true, unlimited: true, features: {} });
    }

    await ensureUsageSchema(db);
    const period = currentPeriod();
    const { results } = await db
      .prepare(`SELECT feature, count FROM feature_usage WHERE hwid = ? AND period = ?`)
      .bind(hwid, period)
      .all<{ feature: string; count: number }>();

    const used = new Map(results.map((r) => [r.feature, r.count]));
    const features: Record<string, { used: number; limit: number }> = {};
    for (const [feature, limit] of Object.entries(FREE_LIMITS)) {
      features[feature] = { used: Math.min(used.get(feature) ?? 0, limit), limit };
    }

    return json({ ok: true, unlimited: false, period, features });
  } catch (err) {
    return error(500, "Failed to read usage.", err instanceof Error ? err.message : null);
  }
}
