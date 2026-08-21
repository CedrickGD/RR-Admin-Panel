import { getSessionTokenFromCookie, verifyAppSessionToken } from "../../_lib/auth";
import { resolveAccessIdentity } from "../../_lib/access-jwt";
import { enforceAccessAllowList, error, json } from "../../_lib/http";
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
    const identity = await resolveAccessIdentity(context.request, context.env);
    if (!identity.ok) {
      if (identity.status === 500) {
        return error(500, identity.message);
      }
      return json({
        ok: true,
        authenticated: false,
        hasUsers: true,
        authMode,
      });
    }

    const denied = enforceAccessAllowList(identity.email, context.env);
    if (denied) {
      return denied;
    }

    return json({
      ok: true,
      authenticated: true,
      hasUsers: true,
      authMode,
      user: {
        email: identity.email,
        role: resolveAccessRole(identity.email, context.env),
      },
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
        authMode,
      });
    }

    const user = await findUserByEmail(context.env, claims.email);
    if (!user) {
      return json({
        ok: true,
        authenticated: false,
        hasUsers,
        authMode,
      });
    }

    return json({
      ok: true,
      authenticated: true,
      hasUsers: true,
      authMode,
      user: {
        email: user.email,
        role: user.role,
      },
    });
  } catch (sessionError) {
    return error(
      500,
      "Failed to resolve auth session.",
      sessionError instanceof Error ? sessionError.message : null,
    );
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
