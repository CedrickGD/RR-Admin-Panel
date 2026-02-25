import { getSessionTokenFromCookie, verifyAppSessionToken } from "../../_lib/auth";
import { error, getAccessIdentity, isAllowedAccessIdentity, json } from "../../_lib/http";
import type { AppUserRole, RuntimeEnv } from "../../_lib/types";
import { countUsers, ensureAuthSchema, findUserByEmail } from "../../_lib/users";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  const authMode = resolveAuthMode(context.env);

  if (authMode === "access") {
    const accessIdentity = getAccessIdentity(context.request, context.env);
    if (!accessIdentity) {
      return json({
        ok: true,
        authenticated: false,
        hasUsers: true,
        authMode
      });
    }

    if (!isAllowedAccessIdentity(accessIdentity, context.env)) {
      return error(403, "Access identity is not allowed.");
    }

    return json({
      ok: true,
      authenticated: true,
      hasUsers: true,
      authMode,
      user: {
        email: accessIdentity,
        role: resolveAccessRole(accessIdentity, context.env)
      }
    });
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
        hasUsers,
        authMode
      });
    }

    const user = await findUserByEmail(context.env, claims.email);
    if (!user) {
      return json({
        ok: true,
        authenticated: false,
        hasUsers,
        authMode
      });
    }

    return json({
      ok: true,
      authenticated: true,
      hasUsers: true,
      authMode,
      user: {
        email: user.email,
        role: user.role
      }
    });
  } catch (sessionError) {
    return error(500, "Failed to resolve auth session.", sessionError instanceof Error ? sessionError.message : null);
  }
}

function resolveAuthMode(env: RuntimeEnv): "app" | "access" {
  return (env.AUTH_MODE ?? "access").toLowerCase() === "app" ? "app" : "access";
}

function resolveAccessRole(identity: string, env: RuntimeEnv): AppUserRole {
  const normalizedIdentity = identity.trim().toLowerCase();
  const adminEmails = parseEmailList(env.ACCESS_ADMIN_EMAIL);
  if (adminEmails.length > 0) {
    return adminEmails.includes(normalizedIdentity) ? "admin" : "viewer";
  }

  const allowedEmails = parseEmailList(env.ACCESS_ALLOWED_EMAIL);
  if (allowedEmails.length === 1 && allowedEmails[0] === normalizedIdentity) {
    return "admin";
  }

  return "viewer";
}

function parseEmailList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}
