import {
  effectivePermissions,
  type PanelRole,
  type PermissionOverrides,
} from "../../shared/panel-policy";
import type { RuntimeEnv } from "./types";

export interface PanelMember {
  email: string;
  display_name: string;
  role: PanelRole;
  enabled: number;
  expires_at: string | null;
  overrides_json: string;
  revoked_before: number;
  created_at: string;
  updated_at: string;
}
export const PANEL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS panel_members (email TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('owner','admin','support','viewer')), enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, overrides_json TEXT NOT NULL DEFAULT '{}', revoked_before INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS panel_sessions (id TEXT PRIMARY KEY, email TEXT NOT NULL, auth_mode TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_panel_sessions_email ON panel_sessions(email, expires_at)`,
  `CREATE TABLE IF NOT EXISTS panel_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
];
const schemaReady = new WeakMap<object, Promise<void>>();
export async function ensurePanelSchema(env: RuntimeEnv) {
  if (!env.DB) throw new Error("Panel access requires a database.");
  const db = env.DB;
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = (async () => {
      for (const sql of PANEL_SCHEMA) await db.prepare(sql).run();
    })();
    schemaReady.set(db, ready);
    ready.catch(() => schemaReady.delete(db));
  }
  await ready;
}
export async function findPanelMember(env: RuntimeEnv, email: string) {
  if (!env.DB) return null;
  await ensurePanelSchema(env);
  return env.DB.prepare("SELECT * FROM panel_members WHERE email = ?")
    .bind(email.toLowerCase())
    .first<PanelMember>();
}
export function memberOverrides(member: PanelMember): PermissionOverrides {
  try {
    return JSON.parse(member.overrides_json);
  } catch {
    return {};
  }
}
export function publicMember(member: PanelMember) {
  return {
    ...member,
    overrides: memberOverrides(member),
    permissions: effectivePermissions(member.role, memberOverrides(member)),
    overrides_json: undefined,
  };
}
export function memberDenied(member: PanelMember | null, now = Date.now()) {
  return Boolean(
    member && (!member.enabled || (member.expires_at && Date.parse(member.expires_at) <= now)),
  );
}
export async function tokenId(token: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
// Only call with a token that has already passed the app/Access signature verifier.
export function verifiedTokenTimes(token: string) {
  const raw = token.split(".")[1];
  const data = JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))) as {
    iat?: number;
    exp: number;
  };
  return { issued: Number(data.iat) || 0, expires: Number(data.exp) };
}
export async function trackPanelSession(
  env: RuntimeEnv,
  request: Request,
  email: string,
  token: string,
  authMode: string,
  member: PanelMember | null,
): Promise<boolean> {
  if (!env.DB) return true; // Static Access-only deployments have no mutable panel accounts.
  await ensurePanelSchema(env);
  const times = verifiedTokenTimes(token);
  if (!Number.isFinite(times.expires) || times.expires * 1000 <= Date.now()) return false;
  if (member && member.revoked_before && times.issued <= member.revoked_before) return false;
  const id = await tokenId(token);
  const session = await env.DB.prepare("SELECT revoked_at FROM panel_sessions WHERE id = ?")
    .bind(id)
    .first<{ revoked_at: string | null }>();
  if (session?.revoked_at) return false;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO panel_sessions (id,email,auth_mode,user_agent,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at WHERE panel_sessions.last_seen_at < ?`,
  )
    .bind(
      id,
      email,
      authMode,
      (request.headers.get("user-agent") ?? "Unknown browser").slice(0, 300),
      now,
      now,
      new Date(times.expires * 1000).toISOString(),
      new Date(Date.now() - 60000).toISOString(),
    )
    .run();
  return true;
}
export async function auditPanel(
  env: RuntimeEnv,
  actor: string,
  target: string,
  action: string,
  detail = "",
) {
  await env
    .DB!.prepare(
      "INSERT INTO panel_audit (actor,target,action,detail,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(actor, target, action, detail, new Date().toISOString())
    .run();
}
export async function legacyPanelRole(
  env: RuntimeEnv,
  email: string,
  role: string,
): Promise<PanelRole> {
  if (role !== "admin") return "viewer";
  if ((env.AUTH_MODE ?? "access") === "app") {
    const first = await env.DB?.prepare(
      "SELECT email FROM admin_users WHERE role = 'admin' ORDER BY id LIMIT 1",
    ).first<{ email: string }>();
    return first?.email === email ? "owner" : "admin";
  }
  const admins = (env.ACCESS_ADMIN_EMAIL || env.ACCESS_ALLOWED_EMAIL || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins[0] === email ? "owner" : "admin";
}
