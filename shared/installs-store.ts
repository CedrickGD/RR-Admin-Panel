// D1 store for registered installs (rr.install.v1). Runtime-agnostic: only touches the
// `D1Database` surface from functions/_lib/types, so the worker, Pages Functions and rr-api
// share it. Callers run `ensureInstallsSchema` once before the other helpers.

import type { D1Database } from "../functions/_lib/types";
import { isValidPublicKeyJwk, type InstallRecord, type PublicKeyJwk } from "./install-auth";

export const INSTALLS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS installs (
    install_id TEXT PRIMARY KEY,
    public_key_jwk TEXT NOT NULL,
    hwid TEXT,
    app_version TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    revoke_reason TEXT,
    license_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_installs_hwid ON installs(hwid)`,
];

export interface StoredInstall extends InstallRecord {
  hwid: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  licenseId: number | null;
}

export interface InstallSummary {
  installId: string;
  hwid: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  licenseId: number | null;
}

export interface RegisterInstallInput {
  installId: string;
  hwid: string;
  publicKeyJwk: PublicKeyJwk;
  appVersion: string | null;
  licenseKey: string | null;
  nowIso: string;
}

export type RegisterInstallOutcome = "created" | "same" | "conflict" | "revoked";

export interface RegisterInstallResult {
  outcome: RegisterInstallOutcome;
  registeredAt: string | null;
}

interface InstallRow {
  install_id: string;
  public_key_jwk: string;
  hwid: string | null;
  app_version: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  license_id: number | null;
}

interface InstallSummaryRow {
  install_id: string;
  hwid: string | null;
  app_version: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  license_id: number | null;
}

interface RegistrationLookupRow {
  public_key_jwk: string;
  revoked_at: string | null;
  created_at: string;
}

const INSTALL_LOOKUP_SQL = `SELECT install_id, public_key_jwk, hwid, app_version, created_at, last_seen_at, revoked_at, license_id
  FROM installs WHERE install_id = ? LIMIT 1`;
const REGISTRATION_LOOKUP_SQL = `SELECT public_key_jwk, revoked_at, created_at
  FROM installs WHERE install_id = ? LIMIT 1`;
const ACTIVE_LICENSE_SQL = `SELECT id FROM licenses WHERE license_key = ? AND status = 'active' LIMIT 1`;
const INSERT_INSTALL_SQL = `INSERT OR IGNORE INTO installs (install_id, public_key_jwk, hwid, app_version, created_at, license_id)
  VALUES (?, ?, ?, ?, ?, ?)`;
const COUNT_FOR_HWID_SQL = `SELECT COUNT(*) AS count FROM installs WHERE hwid = ? AND created_at >= ?`;
// Compared via strftime('%s') because last_seen_at is stored as an ISO-8601 string.
const TOUCH_SQL = `UPDATE installs SET last_seen_at = ?
  WHERE install_id = ?
    AND (last_seen_at IS NULL OR strftime('%s', last_seen_at) < strftime('%s', ?, '-5 minutes'))`;
// COALESCE keeps the first revocation; a second call is idempotent but still matches the row.
const REVOKE_SQL = `UPDATE installs SET revoked_at = COALESCE(revoked_at, ?), revoke_reason = COALESCE(revoke_reason, ?)
  WHERE install_id = ?`;
const LIST_FOR_HWID_SQL = `SELECT install_id, hwid, app_version, created_at, last_seen_at, revoked_at, revoke_reason, license_id
  FROM installs WHERE hwid = ? ORDER BY created_at DESC`;

let schemaReady = false;

export async function ensureInstallsSchema(db: D1Database): Promise<void> {
  if (schemaReady) {
    return;
  }
  for (const statement of INSTALLS_DDL) {
    await db.prepare(statement).run();
  }
  schemaReady = true;
}

export function resetInstallsSchemaStateForTests(): void {
  schemaReady = false;
}

export async function findInstall(
  db: D1Database,
  installId: string,
): Promise<StoredInstall | null> {
  const row = await db
    .prepare(INSTALL_LOOKUP_SQL)
    .bind(normalizeInstallId(installId))
    .first<InstallRow>();
  if (!row) {
    return null;
  }
  const publicKeyJwk = parseStoredJwk(row.public_key_jwk);
  if (!publicKeyJwk) {
    return null;
  }
  return {
    installId: row.install_id,
    publicKeyJwk,
    revokedAt: row.revoked_at ?? null,
    hwid: row.hwid ?? null,
    appVersion: row.app_version ?? null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    licenseId: toNullableInteger(row.license_id),
  };
}

export async function registerInstall(
  db: D1Database,
  input: RegisterInstallInput,
): Promise<RegisterInstallResult> {
  const installId = normalizeInstallId(input.installId);
  const publicKeyJwk = canonicalJwk(input.publicKeyJwk);

  const existing = await lookupForRegistration(db, installId);
  if (existing) {
    return classifyExisting(existing, publicKeyJwk);
  }

  const licenseId = input.licenseKey ? await findActiveLicenseId(db, input.licenseKey) : null;
  const insert = await db
    .prepare(INSERT_INSTALL_SQL)
    .bind(
      installId,
      JSON.stringify(publicKeyJwk),
      input.hwid,
      input.appVersion,
      input.nowIso,
      licenseId,
    )
    .run();

  if (insert?.meta?.changes === 0) {
    // A concurrent registration for the same install_id won the race — classify against it.
    const winner = await lookupForRegistration(db, installId);
    if (winner) {
      return classifyExisting(winner, publicKeyJwk);
    }
  }

  return { outcome: "created", registeredAt: input.nowIso };
}

export async function countInstallsForHwidSince(
  db: D1Database,
  hwid: string,
  sinceIso: string,
): Promise<number> {
  const row = await db.prepare(COUNT_FOR_HWID_SQL).bind(hwid, sinceIso).first<{ count: unknown }>();
  const count = Number(row?.count ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

export async function touchInstall(
  db: D1Database,
  installId: string,
  nowIso: string,
): Promise<void> {
  await db.prepare(TOUCH_SQL).bind(nowIso, normalizeInstallId(installId), nowIso).run();
}

/** Returns true when an install with that id exists (revoked now or earlier), false otherwise. */
export async function revokeInstall(
  db: D1Database,
  installId: string,
  reason: string | null,
  nowIso: string,
): Promise<boolean> {
  const result = await db
    .prepare(REVOKE_SQL)
    .bind(nowIso, reason, normalizeInstallId(installId))
    .run();
  return (result?.meta?.changes ?? 1) > 0;
}

export async function listInstallsForHwid(db: D1Database, hwid: string): Promise<InstallSummary[]> {
  const result = await db.prepare(LIST_FOR_HWID_SQL).bind(hwid).all<InstallSummaryRow>();
  return (result.results ?? []).map((row) => ({
    installId: row.install_id,
    hwid: row.hwid ?? null,
    appVersion: row.app_version ?? null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    revokedAt: row.revoked_at ?? null,
    revokeReason: row.revoke_reason ?? null,
    licenseId: toNullableInteger(row.license_id),
  }));
}

async function lookupForRegistration(
  db: D1Database,
  installId: string,
): Promise<RegistrationLookupRow | null> {
  return db.prepare(REGISTRATION_LOOKUP_SQL).bind(installId).first<RegistrationLookupRow>();
}

function classifyExisting(
  existing: RegistrationLookupRow,
  publicKeyJwk: PublicKeyJwk,
): RegisterInstallResult {
  if (existing.revoked_at !== null && existing.revoked_at !== undefined) {
    return { outcome: "revoked", registeredAt: null };
  }
  const stored = parseStoredJwk(existing.public_key_jwk);
  if (stored && stored.x === publicKeyJwk.x && stored.y === publicKeyJwk.y) {
    return { outcome: "same", registeredAt: existing.created_at ?? null };
  }
  return { outcome: "conflict", registeredAt: null };
}

async function findActiveLicenseId(db: D1Database, licenseKey: string): Promise<number | null> {
  try {
    const row = await db.prepare(ACTIVE_LICENSE_SQL).bind(licenseKey).first<{ id: unknown }>();
    return toNullableInteger(row?.id);
  } catch {
    // Best effort: a missing licenses table or a D1 hiccup must not block registration.
    return null;
  }
}

function parseStoredJwk(text: string): PublicKeyJwk | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isValidPublicKeyJwk(parsed) ? canonicalJwk(parsed) : null;
  } catch {
    return null;
  }
}

function canonicalJwk(jwk: PublicKeyJwk): PublicKeyJwk {
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

function normalizeInstallId(installId: string): string {
  return installId.trim().toLowerCase();
}

function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}
