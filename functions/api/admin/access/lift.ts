import { requireDashboardAccess } from "../../../_lib/admin";
import { ensureAccessSchema } from "../../../_lib/access";
import { error, json, readJsonBody, nowIso } from "../../../_lib/http";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Admin: lift a suspension/ban. Soft-clears the record (is_active = 0) so the history and the
 * had_paid_license snapshot survive; the app's next status poll sees no active suspension and
 * unlocks within one poll interval.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAccessSchema(context.env);

    const body = await readJsonBody<{ identity?: string }>(context.request);
    const identity = (body.identity ?? "").trim();
    if (!identity) return error(400, "identity is required.");

    const now = nowIso();
    const result = await db
      .prepare(
        `UPDATE access_suspensions SET is_active = 0, lifted_at = ?, updated_at = ? WHERE identity = ?`,
      )
      .bind(now, now, identity)
      .run();

    const changed = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (!changed) return error(404, "No suspension found for that identity.");

    return json({ ok: true, lifted: true, identity });
  } catch (err) {
    return error(500, "Failed to lift suspension.", err instanceof Error ? err.message : null);
  }
}
