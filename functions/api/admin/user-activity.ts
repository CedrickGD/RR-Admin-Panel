import { requireDashboardAccess } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { loadUserActivity } from "../../_lib/activity";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

function parseRangeDays(url: URL): number | null {
  const raw = (url.searchParams.get("range") ?? "7d").trim().toLowerCase();
  if (raw === "all") {
    return null;
  }
  if (raw === "today") {
    return 1;
  }
  const days = Number.parseInt(raw.replace(/d$/, ""), 10);
  return Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 7;
}

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) {
      return access.response;
    }

    const url = new URL(context.request.url);
    const identity = url.searchParams.get("identity")?.trim() ?? "";
    if (identity.length === 0 || identity.length > 128) {
      return error(400, "Missing or invalid identity parameter.");
    }

    const activity = await loadUserActivity(context.env, identity, parseRangeDays(url));

    return json({ ok: true, generatedAt: new Date().toISOString(), activity });
  } catch (activityError) {
    return error(500, "Failed to load user activity.", activityError instanceof Error ? activityError.message : null);
  }
}
