import { requireDashboardAccess } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { buildSystemStatus } from "../../_lib/system-status";
import type { RuntimeEnv } from "../../_lib/types";

/** System health: rr-api, database, events, backups, Discord bot and NAS containers. */
export async function onRequest(context: { request: Request; env: RuntimeEnv }): Promise<Response> {
  if (context.request.method !== "GET") return error(405, "Method not allowed. Use GET.");
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    return json(await buildSystemStatus(context.env));
  } catch (systemError) {
    return internalError(context.request, "Unable to complete the request.", systemError);
  }
}
