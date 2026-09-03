import { requireDashboardAccess } from "../../../_lib/admin";
import { ensureFeedbackSchema, type FeedbackRow } from "../../../_lib/content";
import { error, json } from "../../../_lib/http";
import { internalError } from "../../../_lib/responses";
import {
  ensureFeedbackDiagnosticsSchema,
  fallbackFeedbackReportId,
  loadFeedbackDiagnostics,
  loadFeedbackReportMeta,
} from "../../../_lib/feedback-diagnostics";
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
    let diagnostics = new Map();
    let metadata = new Map();
    try {
      await ensureFeedbackDiagnosticsSchema(db);
      [diagnostics, metadata] = await Promise.all([
        loadFeedbackDiagnostics(
          db,
          results.map((row) => row.id),
        ),
        loadFeedbackReportMeta(
          db,
          results.map((row) => row.id),
        ),
      ]);
    } catch {
      // Additive diagnostics must never make the established feedback inbox unavailable.
    }
    const enriched = results.map((row) => ({
      ...row,
      report_id: metadata.get(row.id)?.report_id ?? fallbackFeedbackReportId(row.id),
      auth_mode: metadata.get(row.id)?.auth_mode ?? null,
      verified_install_id: metadata.get(row.id)?.verified_install_id ?? null,
      diagnostics: diagnostics.get(row.id) ?? null,
    }));

    return json({ ok: true, feedback: enriched, unread });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
