import { requireDashboardAccess, resolveAuthMode } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { countUsers, ensureAuthSchema } from "../../_lib/users";
import type { RuntimeEnv } from "../../_lib/types";
export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: RuntimeEnv;
}): Promise<Response> {
  if (request.method !== "GET") return error(405, "Use GET.");
  const authMode = resolveAuthMode(env);
  try {
    let hasUsers = true;
    if (authMode === "app") {
      await ensureAuthSchema(env);
      hasUsers = (await countUsers(env)) > 0;
    }
    const access = await requireDashboardAccess(request, env);
    if (!access.ok) {
      if (access.response.status >= 500) return access.response;
      return json({ ok: true, authenticated: false, hasUsers, authMode });
    }
    return json({ ok: true, authenticated: true, hasUsers, authMode, user: access.access.user });
  } catch (err) {
    return internalError(request, "Unable to verify panel access.", err);
  }
}
