import { nowIso } from "./http";
import type { AppUserRole, AuthUser, D1Database, RuntimeEnv } from "./types";

interface UserRow {
  id: number | string;
  email: string;
  role: AppUserRole;
  password_hash: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

interface CountRow {
  count: number | string;
}

const AUTH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')) DEFAULT 'admin',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email)`
];

export async function ensureAuthSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);

  for (const query of AUTH_SCHEMA_STATEMENTS) {
    await db.prepare(query).run();
  }
}

export async function countUsers(env: RuntimeEnv): Promise<number> {
  const db = requireDb(env);
  const row = await db.prepare("SELECT COUNT(*) AS count FROM admin_users").first<CountRow>();
  return toNumber(row?.count);
}

export async function findUserByEmail(env: RuntimeEnv, email: string): Promise<AuthUser | null> {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT id, email, role, password_hash, created_at, updated_at, last_login_at
       FROM admin_users
       WHERE email = ?
       LIMIT 1`
    )
    .bind(email)
    .first<UserRow>();

  if (!row) {
    return null;
  }

  return mapUser(row);
}

export async function createUser(env: RuntimeEnv, email: string, role: AppUserRole, passwordHash: string): Promise<AuthUser> {
  const db = requireDb(env);
  const now = nowIso();

  await db
    .prepare(
      `INSERT INTO admin_users (email, role, password_hash, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    .bind(email, role, passwordHash, now, now)
    .run();

  const created = await findUserByEmail(env, email);
  if (!created) {
    throw new Error("Failed to load created user.");
  }

  return created;
}

export async function updateUserPassword(env: RuntimeEnv, userId: number, passwordHash: string): Promise<void> {
  const db = requireDb(env);
  const now = nowIso();

  await db
    .prepare(
      `UPDATE admin_users
       SET password_hash = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(passwordHash, now, userId)
    .run();
}

export async function touchUserLastLogin(env: RuntimeEnv, userId: number): Promise<void> {
  const db = requireDb(env);

  await db
    .prepare(
      `UPDATE admin_users
       SET last_login_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(nowIso(), nowIso(), userId)
    .run();
}

function requireDb(env: RuntimeEnv): D1Database {
  if (!env.DB) {
    throw new Error("D1 binding DB is required for app authentication.");
  }

  return env.DB;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: toNumber(row.id),
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}
