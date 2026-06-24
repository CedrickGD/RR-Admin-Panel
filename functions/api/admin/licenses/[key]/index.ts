import { requireDashboardAccess } from "../../../../_lib/admin";
import { error, json } from "../../../../_lib/http";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: {
    key: string;
  };
};

export async function onRequestDelete(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const key = context.params.key;
    if (!key) return error(400, "License key is required.");

    await db.prepare("DELETE FROM licenses WHERE license_key = ?").bind(key).run();

    return json({ ok: true, message: "License permanently deleted." });
  } catch (err) {
    return error(500, "Failed to delete license.", err instanceof Error ? err.message : null);
  }
}
