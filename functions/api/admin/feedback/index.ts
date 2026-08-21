import { requireDashboardAccess } from "../../../_lib/admin";
import { ensureFeedbackSchema, type FeedbackRow } from "../../../_lib/content";
import { error, json } from "../../../_lib/http";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureFeedbackSchema(context.env);

    const { results } = await db
      .prepare(`SELECT * FROM feedback ORDER BY id DESC`)
      .all<FeedbackRow>();

    const unread = results.filter((row) => row.status === "new").length;

    return json({ ok: true, feedback: results, unread });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
