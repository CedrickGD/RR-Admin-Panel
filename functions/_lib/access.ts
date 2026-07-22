import { nowIso } from "./http";
import type { RuntimeEnv, D1Database } from "./types";

/**
 * Self-healing schema for the access-control (suspension/ban) + Discord-verification features.
 * The repo has no migration framework, so — exactly like ensureAnnouncementsSchema in content.ts —
 * every handler that touches these tables runs these idempotent CREATE statements up front. The
 * same DDL also lives in schema.sql.
 *
 * A user is identified the same way the telemetry rollup keys them: `identity = COALESCE(hwid,
 * install_id)`. A suspension therefore reaches BOTH paid users (who have an hwid-bound license)
 * and free users (who only ever report telemetry), which the license-revoke path could never do.
 */

export type SuspensionMode = "ban" | "suspend";

export interface SuspensionRow {
  id: number;
  identity: string;
  hwid: string | null;
  install_id: string | null;
  user_label: string | null;
  mode: SuspensionMode;
  reason: string | null;
  banned_until: string | null;
  is_active: number;
  had_paid_license: number;
  paid_license_keys: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lifted_at: string | null;
}

export interface DiscordLinkRow {
  discord_id: string;
  discord_tag: string | null;
  license_key: string;
  hwid: string | null;
  verified_at: string;
  revoked_at: string | null;
  is_active: number;
  source: string | null;
}

export interface PaidLicenseSummary {
  license_key: string;
  type: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

const ACCESS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS access_suspensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity TEXT NOT NULL UNIQUE,
    hwid TEXT,
    install_id TEXT,
    user_label TEXT,
    mode TEXT NOT NULL DEFAULT 'ban' CHECK (mode IN ('ban','suspend')),
    reason TEXT,
    banned_until TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    had_paid_license INTEGER NOT NULL DEFAULT 0,
    paid_license_keys TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    lifted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_access_suspensions_active ON access_suspensions(is_active, identity)`,
  `CREATE INDEX IF NOT EXISTS idx_access_suspensions_hwid ON access_suspensions(hwid)`,
  `CREATE TABLE IF NOT EXISTS discord_links (
    discord_id TEXT PRIMARY KEY,
    discord_tag TEXT,
    license_key TEXT NOT NULL,
    hwid TEXT,
    verified_at TEXT NOT NULL,
    revoked_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    source TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discord_links_license ON discord_links(license_key)`,
];

let accessSchemaReady = false;

export async function ensureAccessSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);
  if (accessSchemaReady) return;

  // Cold-start fast path: probe the two tables once and skip the DDL storm when current.
  try {
    await db.prepare("SELECT identity FROM access_suspensions LIMIT 1").first();
    await db.prepare("SELECT discord_id FROM discord_links LIMIT 1").first();
    accessSchemaReady = true;
    return;
  } catch {
    // Missing table — fall through to the idempotent DDL run.
  }

  for (const query of ACCESS_SCHEMA_STATEMENTS) {
    await db.prepare(query).run();
  }
  accessSchemaReady = true;
}

/** A suspension is in force when active and either permanent or its timed window hasn't passed. */
export function isSuspensionActive(row: SuspensionRow | null | undefined, now: string = nowIso()): boolean {
  if (!row || row.is_active !== 1) return false;
  if (!row.banned_until) return true; // permanent ban
  return row.banned_until > now; // timed suspend still within its window
}

/**
 * Find the active suspension covering any of the supplied identifiers. Matches an identity/hwid/
 * install_id against every stored key column so an admin can suspend by rollup identity and the
 * app's status poll (which sends hwid + install_id) still resolves it.
 */
export async function findActiveSuspension(
  env: RuntimeEnv,
  identifiers: { identity?: string | null; hwid?: string | null; installId?: string | null },
): Promise<SuspensionRow | null> {
  const db = requireDb(env);
  const values = [identifiers.identity, identifiers.hwid, identifiers.installId]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  if (values.length === 0) return null;

  const unique = [...new Set(values)];
  const placeholders = unique.map(() => "?").join(", ");
  // A machine can match more than one row (e.g. one keyed by hwid, one by install_id). Fetch ALL
  // active candidates and pick the one that is actually in force — NOT the most-recently-updated,
  // which could be an already-expired timed suspension that would otherwise mask a still-in-force
  // permanent ban on the same machine.
  const { results } = await db
    .prepare(
      `SELECT * FROM access_suspensions
       WHERE is_active = 1
         AND (identity IN (${placeholders}) OR hwid IN (${placeholders}) OR install_id IN (${placeholders}))`,
    )
    .bind(...unique, ...unique, ...unique)
    .all<SuspensionRow>();

  const now = nowIso();
  const inForce = results.filter((row) => isSuspensionActive(row, now));
  if (inForce.length === 0) return null;

  // Prefer a permanent ban; otherwise the one that lasts longest.
  inForce.sort((a, b) => {
    if (!a.banned_until && b.banned_until) return -1;
    if (a.banned_until && !b.banned_until) return 1;
    if (!a.banned_until || !b.banned_until) return 0;
    return a.banned_until > b.banned_until ? -1 : 1;
  });

  return inForce[0];
}

/**
 * Active paid licenses bound to a given hwid. `licenses.hwid` is a comma-separated list for
 * multi-seat/master keys, so match the hwid as an exact single value OR any element of the CSV.
 * Returns [] for a free user (no license row bound to the machine).
 */
export async function findPaidLicensesForHwid(env: RuntimeEnv, hwid: string | null | undefined): Promise<PaidLicenseSummary[]> {
  const db = requireDb(env);
  const trimmed = typeof hwid === "string" ? hwid.trim() : "";
  if (!trimmed) return [];

  const { results } = await db
    .prepare(
      `SELECT license_key, type, status, expires_at, created_at
       FROM licenses
       WHERE status = 'active'
         AND hwid IS NOT NULL
         AND (
           hwid = ?
           OR hwid LIKE ? OR hwid LIKE ? OR hwid LIKE ?
         )`,
    )
    // exact | leading "hwid,%" | middle "%,hwid,%" | trailing "%,hwid"
    .bind(trimmed, `${trimmed},%`, `%,${trimmed},%`, `%,${trimmed}`)
    .all<PaidLicenseSummary>();

  return results;
}

/** Count active Discord links bound to a license, excluding one Discord id (the caller re-verifying). */
export async function countActiveLinksForLicense(env: RuntimeEnv, licenseKey: string, excludeDiscordId: string): Promise<number> {
  const db = requireDb(env);
  await ensureAccessSchema(env);
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM discord_links WHERE license_key = ? AND is_active = 1 AND discord_id <> ?`)
    .bind(licenseKey, excludeDiscordId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

function requireDb(env: RuntimeEnv): D1Database {
  if (!env.DB) {
    throw new Error("D1 binding DB is required.");
  }
  return env.DB;
}
