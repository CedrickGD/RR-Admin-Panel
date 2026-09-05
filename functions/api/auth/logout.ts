import { clearSessionCookie, getSessionTokenFromCookie } from "../../_lib/auth";
import { requireDashboardAccess } from "../../_lib/admin";
import { tokenId } from "../../_lib/panel-access";
import { error, json } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";
export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: RuntimeEnv;
}): Promise<Response> {
  if (request.method !== "POST") return error(405, "Use POST.");
  const auth = await requireDashboardAccess(request, env);
  if (!auth.ok && auth.response.status !== 401) return auth.response;
  const token =
    (env.AUTH_MODE ?? "access") === "access"
      ? request.headers.get("cf-access-jwt-assertion")
      : getSessionTokenFromCookie(request, env.AUTH_SESSION_COOKIE);
  if (auth.ok && token && env.DB)
    await env.DB.prepare("UPDATE panel_sessions SET revoked_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), await tokenId(token))
      .run();
  return json({ ok: true, loggedOut: true }, 200, {
    "set-cookie": clearSessionCookie(request, env.AUTH_SESSION_COOKIE),
  });
}
