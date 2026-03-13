import { getSessionTokenFromCookie, verifyAppSessionToken } from "./auth";
import { error, getAccessIdentity, isAllowedAccessIdentity } from "./http";
import type { AppUserRole, RuntimeEnv } from "./types";
import { ensureAuthSchema, findUserByEmail } from "./users";

export interface DashboardRequestUser {
  email: string;
  role: AppUserRole;
}

export interface DashboardAccessContext {
  authMode: "app" | "access";
  user: DashboardRequestUser;
  accessIdentity: string | null;
  sessionExpiresAt: string | null;
}

export async function requireDashboardAccess(
  request: Request,
  env: RuntimeEnv,
): Promise<{ ok: true; access: DashboardAccessContext } | { ok: false; response: Response }> {
  const authMode = resolveAuthMode(env);
  const accessIdentity = getAccessIdentity(request, env);

  if (authMode === "access") {
    if (!accessIdentity) {
      return { ok: false, response: error(401, "Cloudflare Access identity is required.") };
    }
    if (!isAllowedAccessIdentity(accessIdentity, env)) {
      return { ok: false, response: error(403, "Access identity is not allowed.") };
    }

    return {
      ok: true,
      access: {
        authMode,
        user: {
          email: accessIdentity,
          role: resolveAccessRole(accessIdentity, env),
        },
        accessIdentity,
        sessionExpiresAt: null,
      },
    };
  }

  if (!env.JWT_SECRET) {
    return { ok: false, response: error(500, "Server is missing JWT_SECRET.") };
  }

  const sessionToken = getSessionTokenFromCookie(request, env.AUTH_SESSION_COOKIE);
  const claims = await verifyAppSessionToken(sessionToken, env);
  if (!claims) {
    return { ok: false, response: error(401, "Login required.") };
  }

  await ensureAuthSchema(env);
  const user = await findUserByEmail(env, claims.email);
  if (!user) {
    return { ok: false, response: error(401, "Login required.") };
  }

  const accessEnforcement = (env.ACCESS_ENFORCEMENT ?? "off").toLowerCase();
  if (accessEnforcement !== "off") {
    if (!accessIdentity) {
      return { ok: false, response: error(401, "Cloudflare Access identity is required.") };
    }
    if (!isAllowedAccessIdentity(accessIdentity, env)) {
      return { ok: false, response: error(403, "Access identity is not allowed.") };
    }
  }

  return {
    ok: true,
    access: {
      authMode,
      user: {
        email: user.email,
        role: user.role,
      },
      accessIdentity: accessIdentity ?? null,
      sessionExpiresAt: new Date(claims.exp * 1000).toISOString(),
    },
  };
}

export function resolveAuthMode(env: RuntimeEnv): "app" | "access" {
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
