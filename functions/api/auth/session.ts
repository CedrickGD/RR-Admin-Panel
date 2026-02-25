import { getSessionTokenFromCookie, verifyAppSessionToken } from "../../_lib/auth";
import { error, json } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";
import { countUsers, ensureAuthSchema, findUserByEmail } from "../../_lib/users";

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

  try {
    await ensureAuthSchema(context.env);
    const hasUsers = (await countUsers(context.env)) > 0;
    const token = getSessionTokenFromCookie(context.request, context.env.AUTH_SESSION_COOKIE);
    const claims = await verifyAppSessionToken(token, context.env);

    if (!claims) {
      return json({
        ok: true,
        authenticated: false,
        hasUsers
      });
    }

    const user = await findUserByEmail(context.env, claims.email);
    if (!user) {
      return json({
        ok: true,
        authenticated: false,
        hasUsers
      });
    }

    return json({
      ok: true,
      authenticated: true,
      hasUsers: true,
      user: {
        email: user.email,
        role: user.role
      }
    });
  } catch (sessionError) {
    return error(500, "Failed to resolve auth session.", sessionError instanceof Error ? sessionError.message : null);
  }
}
