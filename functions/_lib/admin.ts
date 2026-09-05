import {
  ACCESS_JWT_HEADER,
  isAccessVerificationConfigured,
  resolveAccessIdentity,
  type AccessIdentityDeps,
} from "./access-jwt";
import { getSessionTokenFromCookie, verifyAppSessionToken } from "./auth";
import { enforceSameOriginMutation } from "./csrf";
import { enforceAccessAllowList, error, getAccessIdentity } from "./http";
import type { AppUserRole, RuntimeEnv } from "./types";
import { ensureAuthSchema, findUserByEmail } from "./users";
import {
  effectivePermissions,
  routePermissions,
  type PanelRole,
  type Permission,
} from "../../shared/panel-policy";
import { findPanelMember, memberDenied, memberOverrides, trackPanelSession } from "./panel-access";

export interface DashboardRequestUser {
  email: string;
  role: AppUserRole;
  panelRole?: PanelRole;
  permissions?: Permission[];
}

export interface DashboardAccessContext {
  authMode: "app" | "access";
  user: DashboardRequestUser;
  accessIdentity: string | null;
  sessionExpiresAt: string | null;
  permissionChecked?: boolean;
}

/** Role guard for sensitive reads and state-changing operator workflows. */
export function requireAdminRole(access: DashboardAccessContext): Response | null {
  if (access.permissionChecked) return null;
  return access.user.role === "admin" ? null : error(403, "Administrator role required.");
}

/** Test seams for the Access JWT check (clock + JWKS source); production uses the defaults. */
export type DashboardAccessDeps = AccessIdentityDeps;

export type DashboardAccessResult =
  | { ok: true; access: DashboardAccessContext }
  | { ok: false; response: Response };

export async function requireDashboardAccess(
  request: Request,
  env: RuntimeEnv,
  deps?: DashboardAccessDeps,
): Promise<DashboardAccessResult> {
  const result =
    resolveAuthMode(env) === "access"
      ? await requireVerifiedAccess(request, env, deps)
      : await requireAppSession(request, env, deps);
  if (!result.ok) return result;
  const member = await findPanelMember(env, result.access.user.email);
  if (memberDenied(member)) return deny(error(401, "Panel access is disabled or expired."));
  if (!member) {
    const required = routePermissions(
      new URL(request.url).pathname.replace(/\/$/, ""),
      request.method,
    );
    if (
      required === null ||
      (Array.isArray(required) &&
        result.access.user.role !== "admin" &&
        required.some((p) => p.endsWith(".write") || p === "exports.read"))
    )
      return deny(error(403, "You do not have permission for this action."));
  }
  const token =
    result.access.authMode === "access"
      ? request.headers.get(ACCESS_JWT_HEADER)
      : getSessionTokenFromCookie(request, env.AUTH_SESSION_COOKIE);
  if (
    !token ||
    !(await trackPanelSession(
      env,
      request,
      result.access.user.email,
      token,
      result.access.authMode,
      member,
    ))
  )
    return deny(error(401, "This panel session has ended. Sign in again."));
  if (member) {
    const permissions = effectivePermissions(member.role, memberOverrides(member));
    result.access.user = { ...result.access.user, panelRole: member.role, permissions };
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    const required = routePermissions(path, request.method);
    const alternativeRead =
      request.method === "GET" &&
      ((path === "/api/admin/stats" && permissions.includes("overview.read")) ||
        (path === "/api/admin/users" &&
          (permissions.includes("monitoring.read") || permissions.includes("access.read"))) ||
        (path === "/api/admin/user-activity" && permissions.includes("customers.read")));
    const allowed =
      alternativeRead ||
      (required === "team.manage"
        ? member.role === "owner"
        : required !== null && required.every((p) => permissions.includes(p)));
    if (!allowed) return deny(error(403, "You do not have permission for this action."));
    result.access.permissionChecked = true;
  }
  return result;
}

/**
 * `AUTH_MODE=access`: verified Access JWT → allow-list (fail closed) → same-origin guard for
 * mutations → role. The unverified `cf-access-authenticated-user-email` header plays no part.
 */
async function requireVerifiedAccess(
  request: Request,
  env: RuntimeEnv,
  deps: DashboardAccessDeps | undefined,
): Promise<DashboardAccessResult> {
  const identity = await resolveAccessIdentity(request, env, deps);
  if (!identity.ok) {
    return deny(error(identity.status, identity.message));
  }

  const denied = enforceAccessAllowList(identity.email, env);
  if (denied && !(await findPanelMember(env, identity.email))) {
    return deny(denied);
  }

  const csrf = enforceSameOriginMutation(request);
  if (csrf) {
    return deny(csrf);
  }

  return {
    ok: true,
    access: {
      authMode: "access",
      user: {
        email: identity.email,
        role: resolveAccessRole(identity.email, env),
      },
      accessIdentity: identity.email,
      sessionExpiresAt: null,
    },
  };
}

/**
 * `AUTH_MODE=app`: signed cookie session as before, plus the same-origin guard for mutations.
 * With `ACCESS_ENFORCEMENT` on, the Access identity comes from the verified JWT whenever the
 * deployment can verify it (behind the proxy shells only the assertion travels, never the
 * unverified email header); the header stays the best-effort fallback for deployments without
 * `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`.
 */
async function requireAppSession(
  request: Request,
  env: RuntimeEnv,
  deps: DashboardAccessDeps | undefined,
): Promise<DashboardAccessResult> {
  if (!env.JWT_SECRET) {
    return deny(error(500, "Server is missing JWT_SECRET."));
  }

  const sessionToken = getSessionTokenFromCookie(request, env.AUTH_SESSION_COOKIE);
  const claims = await verifyAppSessionToken(sessionToken, env);
  if (!claims) {
    return deny(error(401, "Login required."));
  }

  await ensureAuthSchema(env);
  const user = await findUserByEmail(env, claims.email);
  if (!user) {
    return deny(error(401, "Login required."));
  }

  let accessIdentity = getAccessIdentity(request, env);
  const accessEnforcement = (env.ACCESS_ENFORCEMENT ?? "off").toLowerCase();
  if (accessEnforcement !== "off") {
    if (request.headers.get(ACCESS_JWT_HEADER)?.trim() && isAccessVerificationConfigured(env)) {
      const verified = await resolveAccessIdentity(request, env, deps);
      if (!verified.ok) {
        return deny(error(verified.status, verified.message));
      }
      accessIdentity = verified.email;
    }
    if (!accessIdentity) {
      return deny(error(401, "Cloudflare Access identity is required."));
    }
    const denied = enforceAccessAllowList(accessIdentity, env);
    if (denied) {
      return deny(denied);
    }
  }

  const csrf = enforceSameOriginMutation(request);
  if (csrf) {
    return deny(csrf);
  }

  return {
    ok: true,
    access: {
      authMode: "app",
      user: {
        email: user.email,
        role: user.role,
      },
      accessIdentity: accessIdentity ?? null,
      sessionExpiresAt: new Date(claims.exp * 1000).toISOString(),
    },
  };
}

function deny(response: Response): DashboardAccessResult {
  return { ok: false, response };
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
