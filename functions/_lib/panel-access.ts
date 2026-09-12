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
  /** ISO timestamp of an explicit "Remove access"; null while the member is a normal member. */
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}
/** One tracked panel session row (one row per bearer token hash). */
export interface PanelSessionRow {
  id: string;
  email: string;
  auth_mode: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at?: string | null;
}
/**
 * Sessions as a person would count them. Cloudflare Access mints a new JWT every few
 * minutes and every JWT hashes to its own `panel_sessions` row, so one open browser
 * produces a pile of rows. A group is one (email, auth_mode, user_agent) triple.
 */
export interface PanelSessionGroup {
  key: string;
  email: string;
  auth_mode: string;
  user_agent: string;
  /** How many token rows the group covers. */
  tokens: number;
  first_seen_at: string;
  last_seen_at: string;
  /** The furthest expiry in the group — when the group dies without a new token. */
  expires_at: string;
  ids: string[];
}
export const PANEL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS panel_preferences (email TEXT PRIMARY KEY, appearance_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS panel_members (email TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('owner','admin','support','viewer')), enabled INTEGER NOT NULL DEFAULT 1, expires_at TEXT, overrides_json TEXT NOT NULL DEFAULT '{}', revoked_before INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS panel_sessions (id TEXT PRIMARY KEY, email TEXT NOT NULL, auth_mode TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_panel_sessions_email ON panel_sessions(email, expires_at)`,
  `CREATE TABLE IF NOT EXISTS panel_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
];
/**
 * Columns added after `panel_members` shipped. SQLite has no `ADD COLUMN IF NOT EXISTS`,
 * and on every database that already migrated the statement fails with "duplicate column
 * name" — that is the success case, not an error. Anything else is rethrown.
 */
export const PANEL_MIGRATIONS = [`ALTER TABLE panel_members ADD COLUMN removed_at TEXT`];
const schemaReady = new WeakMap<object, Promise<void>>();
export async function ensurePanelSchema(env: RuntimeEnv) {
  if (!env.DB) throw new Error("Panel access requires a database.");
  const db = env.DB;
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = (async () => {
      for (const sql of PANEL_SCHEMA) await db.prepare(sql).run();
      for (const sql of PANEL_MIGRATIONS) {
        try {
          await db.prepare(sql).run();
        } catch (err) {
          if (!/duplicate column/i.test(err instanceof Error ? err.message : String(err)))
            throw err;
        }
      }
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
/** True once the owner pressed "Remove access" — a state that outlives any re-seed. */
export function memberRemoved(member: PanelMember | null) {
  return Boolean(member?.removed_at);
}
export function memberDenied(member: PanelMember | null, now = Date.now()) {
  return Boolean(
    member &&
    (memberRemoved(member) ||
      !member.enabled ||
      (member.expires_at && Date.parse(member.expires_at) <= now)),
  );
}
/**
 * Collapses token rows into one group per (email, auth_mode, user_agent), newest activity
 * first. `expires_at` is the furthest expiry in the group, `ids` every row the group covers
 * so "End session" can revoke all of them in one call.
 */
export function groupPanelSessions(rows: readonly PanelSessionRow[]): PanelSessionGroup[] {
  const groups = new Map<string, PanelSessionGroup>();
  for (const row of rows) {
    const key = `${row.email}|${row.auth_mode}|${row.user_agent}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        key,
        email: row.email,
        auth_mode: row.auth_mode,
        user_agent: row.user_agent,
        tokens: 1,
        first_seen_at: row.created_at,
        last_seen_at: row.last_seen_at,
        expires_at: row.expires_at,
        ids: [row.id],
      });
      continue;
    }
    group.tokens += 1;
    group.ids.push(row.id);
    if (row.created_at < group.first_seen_at) group.first_seen_at = row.created_at;
    if (row.last_seen_at > group.last_seen_at) group.last_seen_at = row.last_seen_at;
    if (row.expires_at > group.expires_at) group.expires_at = row.expires_at;
  }
  return [...groups.values()].sort((a, b) =>
    a.last_seen_at === b.last_seen_at
      ? a.email.localeCompare(b.email)
      : a.last_seen_at < b.last_seen_at
        ? 1
        : -1,
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
