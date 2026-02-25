import { verifyAdminSessionToken } from "../../_lib/auth";
import { error, getAccessIdentity, getBearerToken, isAllowedAccessIdentity, json } from "../../_lib/http";
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

  if (!context.env.JWT_SECRET) {
    return error(500, "Server is missing JWT_SECRET.");
  }

  const accessIdentity = getAccessIdentity(context.request, context.env);
  if (!accessIdentity) {
    return error(401, "Cloudflare Access identity is required.");
  }
  if (!isAllowedAccessIdentity(accessIdentity, context.env)) {
    return error(403, "Access identity is not allowed.");
  }

  const token = getBearerToken(context.request);
  const claims = await verifyAdminSessionToken(token, context.env);
  if (!claims) {
    return error(401, "Invalid or expired admin session token.");
  }

  if (claims.email && claims.email !== "access-jwt-assertion" && claims.email !== "access-bypass-local-dev" && accessIdentity !== claims.email) {
    return error(401, "Session identity mismatch.");
  }

  try {
    const [summary, health] = await Promise.all([loadSummary(context.env), loadHealth(context.env)]);

    return json({
      ok: true,
      summary,
      health,
      accessIdentity,
      sessionExpiresAt: new Date(claims.exp * 1000).toISOString()
    });
  } catch (dataError) {
    return error(500, "Failed to load protected admin data.", dataError instanceof Error ? dataError.message : null);
  }
}
