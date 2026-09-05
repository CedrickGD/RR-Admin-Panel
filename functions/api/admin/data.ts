import { requireDashboardAccess } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
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

    const [loadedSummary, health] = await Promise.all([
      loadSummary(context.env),
      loadHealth(context.env),
    ]);
    const summary = structuredClone(loadedSummary);

    const permissions = access.access.user.permissions;
    if (permissions) {
      if (!permissions.includes("monitoring.read")) {
        summary.activeSessions = [];
        summary.recentSessions = [];
        summary.recentEvents = [];
      }
      if (!permissions.includes("support.read")) summary.recentErrors = [];
      if (!permissions.includes("overview.read") && !permissions.includes("monitoring.read")) {
        summary.stats = {
          totalEvents: 0,
          lifetimeEvents: 0,
          totalSessions: 0,
          activeUsers: 0,
          lifetimeUsers: 0,
          sessionsStartedToday: 0,
          sessionsEndedToday: 0,
          averageSessionDurationSeconds: 0,
          errorsLast24Hours: 0,
          lastIngestAt: null,
        };
      }
    }

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
    return internalError(context.request, "Unable to complete the request.", dataError);
  }
}
