import { getSessionTokenFromCookie, verifyAppSessionToken } from "../../_lib/auth";
import { error, getAccessIdentity, isAllowedAccessIdentity, json } from "../../_lib/http";
import { loadHealth, loadSummary } from "../../_lib/storage";
import type { AppUserRole, RuntimeEnv } from "../../_lib/types";
import { ensureAuthSchema, findUserByEmail } from "../../_lib/users";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  const authMode = resolveAuthMode(context.env);

  try {
    const accessIdentity = getAccessIdentity(context.request, context.env);
    if (authMode === "access") {
      if (!accessIdentity) {
        return error(401, "Cloudflare Access identity is required.");
      }
      if (!isAllowedAccessIdentity(accessIdentity, context.env)) {
        return error(403, "Access identity is not allowed.");
      }

      const [summary, health] = await Promise.all([loadSummary(context.env), loadHealth(context.env)]);
      return json({
        ok: true,
        summary,
        health,
        user: {
          email: accessIdentity,
          role: resolveAccessRole(accessIdentity, context.env)
        },
        accessIdentity,
        authMode,
        sessionExpiresAt: null
      });
    }

    if (!context.env.JWT_SECRET) {
      return error(500, "Server is missing JWT_SECRET.");
    }

    const sessionToken = getSessionTokenFromCookie(context.request, context.env.AUTH_SESSION_COOKIE);
    const claims = await verifyAppSessionToken(sessionToken, context.env);
    if (!claims) {
      return error(401, "Login required.");
    }

    await ensureAuthSchema(context.env);
    const user = await findUserByEmail(context.env, claims.email);
    if (!user) {
      return error(401, "Login required.");
    }

    const accessEnforcement = (context.env.ACCESS_ENFORCEMENT ?? "off").toLowerCase();
    if (accessEnforcement !== "off") {
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
      authMode,
      sessionExpiresAt: new Date(claims.exp * 1000).toISOString()
    });
  } catch (dataError) {
    return error(500, "Failed to load protected admin data.", dataError instanceof Error ? dataError.message : null);
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
