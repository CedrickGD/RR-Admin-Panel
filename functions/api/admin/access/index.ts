import { requireDashboardAccess } from "../../../_lib/admin";
import { ensureAccessSchema, type SuspensionRow } from "../../../_lib/access";
import { error, json } from "../../../_lib/http";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/** Admin: list every suspension record (active first), for the Access page's "Suspensions" table. */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAccessSchema(context.env);

    const { results } = await db
      .prepare(`SELECT * FROM access_suspensions ORDER BY is_active DESC, updated_at DESC`)
      .all<SuspensionRow>();

    return json({ ok: true, suspensions: results });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
