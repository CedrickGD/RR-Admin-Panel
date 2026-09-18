import { requireDashboardAccess } from "../../_lib/admin";
import { hashPassword, isValidEmail, validatePasswordComplexity } from "../../_lib/auth";
import { ensureAuthSchema } from "../../_lib/users";
import {
  describePanelSessions,
  ensurePanelSchema,
  findPanelMember,
  groupPanelSessions,
  legacyPanelRole,
  publicMember,
  type PanelMember,
  type PanelSessionRow,
} from "../../_lib/panel-access";
import {
  PERMISSIONS,
  type PanelRole,
  type PermissionOverrides,
} from "../../../shared/panel-policy";
import { error, json, readJsonBody } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import type { RuntimeEnv, D1PreparedStatement } from "../../_lib/types";

type Context = { request: Request; env: RuntimeEnv };
const roles: PanelRole[] = ["admin", "support", "viewer"];
function expiry(value: unknown): string | null {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Enter a valid expiry date.");
  return new Date(value).toISOString();
}
export async function onRequest({ request, env }: Context): Promise<Response> {
  try {
    const auth = await requireDashboardAccess(request, env);
    if (!auth.ok) return auth.response;
    if (!env.DB) return error(503, "Panel user management requires the database.");
    const actor = auth.access.user.email;
    const current = await findPanelMember(env, actor);
    const actorRole = current?.role ?? (await legacyPanelRole(env, actor, auth.access.user.role));
    if (actorRole !== "owner") return error(403, "Only the panel owner can manage panel access.");
    await ensurePanelSchema(env);
    await ensureAuthSchema(env);
    const now = new Date().toISOString();
    // Import existing accounts without changing passwords or any customer/app data.
    const legacy =
      (
        await env.DB.prepare("SELECT email, role FROM admin_users").all<{
          email: string;
          role: string;
        }>()
      ).results ?? [];
    const configuredAdmins = (env.ACCESS_ADMIN_EMAIL ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase());
    if (auth.access.authMode === "access") {
      for (const email of (env.ACCESS_ALLOWED_EMAIL ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)) {
        legacy.push({
          email,
          role: configuredAdmins.includes(email) || email === actor ? "admin" : "viewer",
        });
      }
    }
    if (!legacy.some((u) => u.email === actor)) legacy.push({ email: actor, role: "admin" });
    // Seeding is import-only: an address that already has a row keeps whatever state the owner
    // gave it. Without this skip a removed member would be re-seeded from admin_users or
    // ACCESS_ALLOWED_EMAIL on the next page load — the "the test account is permanently in
    // there" bug. `INSERT OR IGNORE` alone already leaves existing rows alone; the explicit
    // set makes that a property of the code rather than of one SQL keyword.
    const known = new Set(
      (
        (await env.DB.prepare("SELECT email FROM panel_members").all<{ email: string }>())
          .results ?? []
      ).map((row) => row.email),
    );
    for (const u of legacy) {
      if (known.has(u.email)) continue;
      known.add(u.email);
      const role = u.email === actor ? "owner" : await legacyPanelRole(env, u.email, u.role);
      const overrides =
        role === "viewer"
          ? Object.fromEntries(
              ["customers.read", "licenses.read", "access.read"].map((key) => [
                key,
                { effect: "deny", expiresAt: null },
              ]),
            )
          : {};
      await env.DB.prepare(
        "INSERT OR IGNORE INTO panel_members (email,role,overrides_json,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
        .bind(u.email, role, JSON.stringify(overrides), now, now)
        .run();
    }
    if (request.method === "GET") {
      const [members, sessions, audit] = await Promise.all([
        // Owner first, then everyone who still has a row to manage, removed members last.
        env.DB.prepare(
          "SELECT * FROM panel_members ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, CASE WHEN removed_at IS NULL THEN 0 ELSE 1 END, email",
        ).all<PanelMember>(),
        env.DB.prepare(
          "SELECT * FROM panel_sessions WHERE expires_at > ? AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 300",
        )
          .bind(now)
          .all<PanelSessionRow>(),
        env.DB.prepare("SELECT * FROM panel_audit ORDER BY id DESC LIMIT 100").all(),
      ]);
      return json({
        ok: true,
        members: (members.results ?? []).map(publicMember),
        // One row per browser, not per Access JWT (a new token every few minutes), and each
        // one carrying when the panel really stops honouring it — which is the member's own
        // expiry whenever that is shorter than the month-long Cloudflare sign-in.
        sessions: describePanelSessions(
          groupPanelSessions(sessions.results ?? []),
          members.results ?? [],
        ),
        audit: audit.results ?? [],
        authMode: auth.access.authMode,
        actor,
      });
    }
    if (request.method !== "POST") return error(405, "Use GET or POST.");
    const body = await readJsonBody<Record<string, unknown>>(request, 16 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return error(400, "A member update is required.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isValidEmail(email)) return error(400, "A valid email is required.");
    const target = await findPanelMember(env, email);
    if (email === actor || target?.role === "owner")
      return error(403, "The owner account is protected from access changes.");
    const batch: D1PreparedStatement[] = [];
    let detail = "";
    if (body.action === "save") {
      if (!roles.includes(body.role as PanelRole)) return error(400, "Choose a valid role.");
      if (typeof body.enabled !== "boolean") return error(400, "Choose whether access is enabled.");
      const overrides: PermissionOverrides = {};
      if (
        body.overrides !== undefined &&
        (typeof body.overrides !== "object" || !body.overrides || Array.isArray(body.overrides))
      )
        return error(400, "Invalid permissions.");
      for (const [key, value] of Object.entries(body.overrides ?? {})) {
        if (!PERMISSIONS.some((p) => p.key === key) || !value || typeof value !== "object")
          return error(400, "Invalid permission.");
        const rule = value as Record<string, unknown>;
        if (rule.effect !== "allow" && rule.effect !== "deny")
          return error(400, "Invalid permission rule.");
        overrides[key as keyof PermissionOverrides] = {
          effect: rule.effect,
          expiresAt: expiry(rule.expiresAt),
        };
      }
      const expiresAt = expiry(body.expiresAt);
      const displayName =
        typeof body.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (auth.access.authMode === "app" && (!target || password)) {
        const invalid = validatePasswordComplexity(password);
        if (invalid) return error(400, invalid);
        const hash = await hashPassword(password);
        batch.push(
          env.DB.prepare(
            `INSERT INTO admin_users (email,role,password_hash,created_at,updated_at) VALUES (?,'viewer',?,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at`,
          ).bind(email, hash, now, now),
        );
      }
      batch.push(
        env.DB.prepare(
          `INSERT INTO panel_members (email,display_name,role,enabled,expires_at,overrides_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,enabled=excluded.enabled,expires_at=excluded.expires_at,overrides_json=excluded.overrides_json,updated_at=excluded.updated_at,removed_at=CASE WHEN excluded.enabled=1 THEN NULL ELSE panel_members.removed_at END`,
        ).bind(
          email,
          displayName,
          body.role,
          body.enabled ? 1 : 0,
          expiresAt,
          JSON.stringify(overrides),
          now,
          now,
        ),
      );
      if (!body.enabled || (password && target)) {
        batch.push(
          env.DB.prepare("UPDATE panel_members SET revoked_before = ? WHERE email = ?").bind(
            Math.floor(Date.now() / 1000),
            email,
          ),
        );
        batch.push(
          env.DB.prepare(
            "UPDATE panel_sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL",
          ).bind(now, email),
        );
      }
      detail = JSON.stringify({ role: body.role, enabled: body.enabled, expiresAt, overrides });
    } else if (body.action === "kick" && target) {
      batch.push(
        env.DB.prepare(
          "UPDATE panel_members SET revoked_before = ?, updated_at = ? WHERE email = ?",
        ).bind(Math.floor(Date.now() / 1000), now, email),
      );
      batch.push(
        env.DB.prepare(
          "UPDATE panel_sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL",
        ).bind(now, email),
      );
    } else if (body.action === "revoke" && target) {
      // "Remove access": the member keeps its row (so the re-seed cannot resurrect it as a
      // fresh, enabled member) but is disabled, marked removed and thrown out of every open
      // session. `revoked_before` additionally rejects tokens that were issued before now and
      // have not been seen yet.
      batch.push(
        env.DB.prepare(
          "UPDATE panel_members SET enabled = 0, revoked_before = ?, removed_at = ?, updated_at = ? WHERE email = ?",
        ).bind(Math.floor(Date.now() / 1000), now, now, email),
      );
      batch.push(
        env.DB.prepare(
          "UPDATE panel_sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL",
        ).bind(now, email),
      );
      detail = JSON.stringify({ removed: true, removedAt: now });
    } else if (body.action === "restore" && target) {
      batch.push(
        env.DB.prepare(
          "UPDATE panel_members SET enabled = 1, removed_at = NULL, updated_at = ? WHERE email = ?",
        ).bind(now, email),
      );
      detail = JSON.stringify({ removed: false, role: target.role });
    } else if (body.action === "end-session" && target) {
      // One browser owns many token rows, so the UI sends the whole group. A single
      // `sessionId` stays accepted for older clients.
      const ids = Array.isArray(body.sessionIds)
        ? body.sessionIds
        : typeof body.sessionId === "string"
          ? [body.sessionId]
          : [];
      if (!ids.length || !ids.every((id) => typeof id === "string" && id.length > 0))
        return error(400, "Select at least one session to end.");
      if (ids.length > 300) return error(400, "Too many sessions in one request.");
      // Scoped by email as well as id, so ids that belong to somebody else are no-ops.
      batch.push(
        env.DB.prepare(
          `UPDATE panel_sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
        ).bind(now, email, ...ids),
      );
      detail = JSON.stringify({ sessions: ids.length });
    } else return error(400, "Unknown action or member.");
    batch.push(
      env.DB.prepare(
        "INSERT INTO panel_audit (actor,target,action,detail,created_at) VALUES (?,?,?,?,?)",
      ).bind(actor, email, String(body.action), detail, now),
    );
    await env.DB.batch(batch);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Enter a valid expiry date.")
      return error(400, "Enter a valid expiry date.");
    return internalError(request, "Unable to update panel access.", err);
  }
}
