import { requireDashboardAccess } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { loadHealth, loadSummary } from "../../_lib/storage";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) {
      return access.response;
    }

    const [summary, health] = await Promise.all([
      loadSummary(context.env),
      loadHealth(context.env),
    ]);

    return json({
      ok: true,
      summary,
      health,
      user: access.access.user,
      accessIdentity: access.access.accessIdentity,
      authMode: access.access.authMode,
      sessionExpiresAt: access.access.sessionExpiresAt,
    });
  } catch (dataError) {
    return error(
      500,
      "Failed to load protected admin data.",
      dataError instanceof Error ? dataError.message : null,
    );
  }
}
