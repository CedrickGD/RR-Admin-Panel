import { getSessionTokenFromCookie, verifyAppSessionToken } from "../../_lib/auth";
import { error, getAccessIdentity, isAllowedAccessIdentity, json } from "../../_lib/http";
import { loadHealth, loadSummary } from "../../_lib/storage";
import type { RuntimeEnv } from "../../_lib/types";
import { ensureAuthSchema, findUserByEmail } from "../../_lib/users";

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

  const sessionToken = getSessionTokenFromCookie(context.request, context.env.AUTH_SESSION_COOKIE);
  const claims = await verifyAppSessionToken(sessionToken, context.env);
  if (!claims) {
    return error(401, "Login required.");
  }

  try {
    await ensureAuthSchema(context.env);
    const user = await findUserByEmail(context.env, claims.email);
    if (!user) {
      return error(401, "Login required.");
    }

    const accessEnforcement = (context.env.ACCESS_ENFORCEMENT ?? "off").toLowerCase();
    const accessRequired = accessEnforcement !== "off";
    const accessIdentity = getAccessIdentity(context.request, context.env);

    if (accessRequired) {
      if (!accessIdentity) {
        return error(401, "Cloudflare Access identity is required.");
      }
      if (!isAllowedAccessIdentity(accessIdentity, context.env)) {
        return error(403, "Access identity is not allowed.");
      }
    }

    const [summary, health] = await Promise.all([loadSummary(context.env), loadHealth(context.env)]);

    return json({
      ok: true,
      summary,
      health,
      user: {
        email: user.email,
        role: user.role
      },
      accessIdentity: accessIdentity ?? null,
      sessionExpiresAt: new Date(claims.exp * 1000).toISOString()
    });
  } catch (dataError) {
    return error(500, "Failed to load protected admin data.", dataError instanceof Error ? dataError.message : null);
  }
}
