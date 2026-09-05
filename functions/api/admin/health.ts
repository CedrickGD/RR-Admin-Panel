import { requireDashboardAccess } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { loadHealth } from "../../_lib/storage";
import type { RuntimeEnv } from "../../_lib/types";

/** Authenticated storage health, distinct from the worker's public liveness route. */
export async function onRequest(context: { request: Request; env: RuntimeEnv }): Promise<Response> {
  if (context.request.method !== "GET") return error(405, "Method not allowed. Use GET.");
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    return json(await loadHealth(context.env));
  } catch (healthError) {
    return internalError(context.request, "Unable to check backend health.", healthError);
  }
}
