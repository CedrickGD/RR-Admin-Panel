import { requireDashboardAccess } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { loadStats, parseStatsFilters } from "../../_lib/stats";
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

    const filters = parseStatsFilters(new URL(context.request.url));
    const stats = await loadStats(context.env, filters);

    return json({ ok: true, stats });
  } catch (statsError) {
    return error(
      500,
      "Failed to load stats.",
      statsError instanceof Error ? statsError.message : null,
    );
  }
}
