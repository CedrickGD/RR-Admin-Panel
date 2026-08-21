import type { D1Database, RuntimeEnv } from "./types";
import { findPaidLicensesForHwid } from "./access";

/**
 * Free-tier monthly quotas, counted per HWID per calendar month. This table is the single
 * authority — the app never decides limits, it only asks. Features absent here are
 * unlimited for everyone, so adding a row is how a feature becomes quota'd.
 *
 * Design rule from the product side: no hard locks anywhere. Free users get a taste of
 * everything each month; a license (any active plan) removes every limit.
 */
export const FREE_LIMITS: Record<string, number> = {
  sky_changer: 5, // injects only — restores are never counted
  loading_screen: 5, // replacements only — restores are never counted
  fonts: 2, // applying a non-default preset; the default is always free
  desync: 20,
  stretched_res: 20, // applying; the auto-revert is never counted
  fed_suit: 10, // starts
  input_scripts: 20, // combined pot across the nine input-only automation scripts
};

export type ConsumeResult =
  | { ok: true; unlimited: true }
  | { ok: true; unlimited: false; allowed: boolean; remaining: number; limit: number };

/** "2026-08" — quotas reset on the calendar month, which is easy to reason about for users. */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

let usageSchemaReady = false;

export async function ensureUsageSchema(db: D1Database): Promise<void> {
  if (usageSchemaReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS feature_usage (
         hwid TEXT NOT NULL,
         feature TEXT NOT NULL,
         period TEXT NOT NULL,
         count INTEGER NOT NULL DEFAULT 0,
         updated_at TEXT,
         PRIMARY KEY (hwid, feature, period)
       )`,
    )
    .run();
  usageSchemaReady = true;
}

/** True when the HWID sits in any active, unexpired license — those users are never counted. */
export async function isPremiumHwid(env: RuntimeEnv, hwid: string): Promise<boolean> {
  const licenses = await findPaidLicensesForHwid(env, hwid);
  const now = Date.now();
  return licenses.some((l) => !l.expires_at || Date.parse(l.expires_at) > now);
}

/**
 * Atomically consume one use. The UPSERT increments first and the caller reads the result —
 * two racing requests can therefore never both land on "last one free".
 */
export async function consumeUse(
  db: D1Database,
  hwid: string,
  feature: string,
  limit: number,
): Promise<ConsumeResult> {
  const period = currentPeriod();
  const now = new Date().toISOString();

  const row = await db
    .prepare(
      `INSERT INTO feature_usage (hwid, feature, period, count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(hwid, feature, period)
       DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
       RETURNING count`,
    )
    .bind(hwid, feature, period, now)
    .first<{ count: number }>();

  const used = row?.count ?? 1;
  const allowed = used <= limit;

  if (!allowed) {
    // The increment past the limit is informational only — roll it back so the stored
    // count equals real usage and the status endpoint never reports 7/5.
    await db
      .prepare(`UPDATE feature_usage SET count = ? WHERE hwid = ? AND feature = ? AND period = ?`)
      .bind(limit, hwid, feature, period)
      .run();
  }

  return {
    ok: true,
    unlimited: false,
    allowed,
    remaining: allowed ? limit - used : 0,
    limit,
  };
}
