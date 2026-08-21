import { requireDashboardAccess } from "../../../../_lib/admin";
import { decodeKeyParam, error, json } from "../../../../_lib/http";
import { internalError } from "../../../../_lib/responses";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: {
    key: string;
  };
};

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const key = decodeKeyParam(context.params.key);
    if (!key) return error(400, "License key is required.");

    const license = await db
      .prepare("SELECT hwid FROM licenses WHERE license_key = ?")
      .bind(key)
      .first();
    if (!license) return error(404, "License not found.");

    if (!license.hwid) {
      // Unbound: Delete completely
      await db.prepare("DELETE FROM licenses WHERE license_key = ?").bind(key).run();
      return json({ ok: true, message: "Unbound license deleted successfully.", deleted: true });
    }

    const result = await db
      .prepare("UPDATE licenses SET status = 'revoked' WHERE license_key = ?")
      .bind(key)
      .run();

    return json({ ok: true, message: "License revoked successfully." });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
