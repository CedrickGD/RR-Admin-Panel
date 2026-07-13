import { requireDashboardAccess } from "../../../../_lib/admin";
import { ensureFeedbackSchema, type FeedbackStatus } from "../../../../_lib/content";
import { decodeKeyParam, error, json, readJsonBody } from "../../../../_lib/http";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: {
    id: string;
  };
};

const STATUSES: FeedbackStatus[] = ["new", "read", "archived"];

function parseId(raw: string | undefined | null): number | null {
  const id = Number.parseInt(decodeKeyParam(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function onRequestPut(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureFeedbackSchema(context.env);

    const id = parseId(context.params.id);
    if (id === null) return error(400, "A valid feedback id is required.");

    const body = await readJsonBody<{ status?: string }>(context.request);
    const status = body.status;
    if (typeof status !== "string" || !STATUSES.includes(status as FeedbackStatus)) {
      return error(400, "status must be one of: new, read, archived.");
    }

    const result = await db
      .prepare(`UPDATE feedback SET status = ? WHERE id = ?`)
      .bind(status, id)
      .run();
    if (!result.meta?.changes) {
      return error(404, "Feedback not found.");
    }

    return json({ ok: true });
  } catch (err) {
    return error(500, "Failed to update feedback.", err instanceof Error ? err.message : null);
  }
}

export async function onRequestDelete(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureFeedbackSchema(context.env);

    const id = parseId(context.params.id);
    if (id === null) return error(400, "A valid feedback id is required.");

    const result = await db.prepare(`DELETE FROM feedback WHERE id = ?`).bind(id).run();
    if (!result.meta?.changes) {
      return error(404, "Feedback not found — nothing was deleted.");
    }

    return json({ ok: true, message: "Feedback deleted." });
  } catch (err) {
    return error(500, "Failed to delete feedback.", err instanceof Error ? err.message : null);
  }
}
