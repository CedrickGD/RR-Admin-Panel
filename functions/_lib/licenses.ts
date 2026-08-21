import { isObject } from "./http";
import type { D1Database } from "./types";

/* ═══════════════════════════════════════════════════════════════
   License order/customer tracking
   Every license row can carry WHO bought it and WHICH order it
   belongs to. Store-issued keys capture this automatically from
   the storefront's delivery call; admin-issued keys can be stamped
   at generation or edited later from the Licenses page.
   ═══════════════════════════════════════════════════════════════ */

/** Bound field lengths — storage caps, generous for real-world values. */
export const ORDER_FIELD_LIMITS = {
  order_id: 120,
  customer_name: 160,
  customer_email: 254,
  customer_discord: 120,
  order_source: 40,
  order_note: 2000,
  order_meta: 4000,
} as const;

export type OrderField = keyof typeof ORDER_FIELD_LIMITS;

/** Admin-editable subset of the order columns (meta/source stay machine-owned). */
export const EDITABLE_ORDER_FIELDS: readonly OrderField[] = [
  "order_id",
  "customer_name",
  "customer_email",
  "customer_discord",
  "order_note",
];

// Same self-migration pattern as ensureSchema in storage.ts: run the ALTERs,
// swallow "duplicate column" so an already-migrated database is a no-op. The
// deploy needs no manual D1 step — the first licenses/store request heals prod.
const ORDER_COLUMN_STATEMENTS = [
  `ALTER TABLE licenses ADD COLUMN order_id TEXT`,
  `ALTER TABLE licenses ADD COLUMN customer_name TEXT`,
  `ALTER TABLE licenses ADD COLUMN customer_email TEXT`,
  `ALTER TABLE licenses ADD COLUMN customer_discord TEXT`,
  `ALTER TABLE licenses ADD COLUMN order_source TEXT`,
  `ALTER TABLE licenses ADD COLUMN order_note TEXT`,
  `ALTER TABLE licenses ADD COLUMN order_meta TEXT`,
  `ALTER TABLE licenses ADD COLUMN purchased_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_licenses_order ON licenses(order_id)`,
];

let orderColumnsReady = false;

export async function ensureLicenseOrderColumns(db: D1Database): Promise<void> {
  if (orderColumnsReady) return;
  for (const statement of ORDER_COLUMN_STATEMENTS) {
    try {
      await db.prepare(statement).run();
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (!message.includes("duplicate column name") && !message.includes("already exists")) {
        throw err;
      }
    }
  }
  orderColumnsReady = true;
}

/** Trim + cap a candidate value for one of the order columns; empty → null. */
export function normalizeOrderField(field: OrderField, value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, ORDER_FIELD_LIMITS[field]);
}

/* ── Storefront payload extraction ──────────────────────────────
   Storefront delivery calls (SellHub / Sellix / SellAuth style dynamic
   serials + webhooks) differ wildly in shape. Rather than hardcoding one
   vendor, search the query string and JSON/form body for the usual field
   names, case-insensitively and up to 3 object levels deep (webhooks nest
   under data/order/customer). First match per field wins, in the priority
   order below. */

const ORDER_ID_KEYS = [
  "order_id",
  "orderid",
  "order_number",
  "ordernumber",
  "invoice_id",
  "invoiceid",
  "invoice",
  "uniqid",
  "order_uniqid",
  "transaction_id",
  "transactionid",
  "txn_id",
  "payment_id",
  "reference",
  "order",
];
const EMAIL_KEYS = ["customer_email", "customeremail", "buyer_email", "user_email", "email"];
const NAME_KEYS = [
  "customer_name",
  "customername",
  "buyer_name",
  "full_name",
  "username",
  "customer",
  "name",
  "buyer",
];
const DISCORD_KEYS = [
  "customer_discord",
  "discord_username",
  "discord_user",
  "discord_tag",
  "discord_id",
  "discord",
];

// Never persist call credentials in order_meta.
const SECRET_PARAM_NAMES = new Set([
  "secret",
  "token",
  "key",
  "api_key",
  "apikey",
  "authorization",
]);

function findKeyDeep(node: unknown, wanted: string, depth: number): string | null {
  if (!isObject(node) || depth > 3) return null;
  for (const [rawKey, value] of Object.entries(node)) {
    if (rawKey.toLowerCase() === wanted) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  for (const value of Object.values(node)) {
    if (isObject(value)) {
      const nested = findKeyDeep(value, wanted, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function findField(sources: unknown[], keys: string[]): string | null {
  for (const key of keys) {
    for (const source of sources) {
      const found = findKeyDeep(source, key, 0);
      if (found !== null) return found;
    }
  }
  return null;
}

export interface ExtractedOrderInfo {
  order_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_discord: string | null;
  /** Sanitized snapshot of what the storefront sent (secrets stripped). */
  order_meta: string | null;
}

/**
 * Pull buyer + order identifiers out of a storefront delivery request.
 * Must never throw — key delivery is sacred; on any surprise it returns
 * an all-null record and the key still ships.
 */
export function extractOrderInfo(url: URL, body: unknown): ExtractedOrderInfo {
  try {
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (SECRET_PARAM_NAMES.has(key.toLowerCase())) continue;
      if (value.trim()) query[key] = value.trim();
    }

    const sources: unknown[] = [query, body];
    const info: ExtractedOrderInfo = {
      order_id: normalizeOrderField("order_id", findField(sources, ORDER_ID_KEYS)),
      customer_name: normalizeOrderField("customer_name", findField(sources, NAME_KEYS)),
      customer_email: normalizeOrderField("customer_email", findField(sources, EMAIL_KEYS)),
      customer_discord: normalizeOrderField("customer_discord", findField(sources, DISCORD_KEYS)),
      order_meta: null,
    };

    // Keep the raw (sanitized) payload for tracking/debugging what the shop
    // actually sent — only when it contains anything beyond the secret.
    const meta: Record<string, unknown> = {};
    if (Object.keys(query).length > 0) meta.query = query;
    if (isObject(body) && Object.keys(body).length > 0) meta.body = body;
    if (Object.keys(meta).length > 0) {
      info.order_meta = normalizeOrderField("order_meta", JSON.stringify(meta));
    }

    return info;
  } catch {
    return {
      order_id: null,
      customer_name: null,
      customer_email: null,
      customer_discord: null,
      order_meta: null,
    };
  }
}

/**
 * Best-effort body read for storefront calls: JSON first, then form-encoded.
 * Returns null for empty/unparseable bodies instead of throwing.
 */
export async function readStorePayload(request: Request, maxBytes = 32 * 1024): Promise<unknown> {
  try {
    const raw = await request.text();
    if (!raw.trim() || raw.length > maxBytes) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isObject(parsed) ? parsed : null;
    } catch {
      // Not JSON — try classic form encoding (key=value&…).
      if (!raw.includes("=")) return null;
      const form: Record<string, string> = {};
      for (const [key, value] of new URLSearchParams(raw).entries()) {
        if (SECRET_PARAM_NAMES.has(key.toLowerCase())) continue;
        if (value.trim()) form[key] = value.trim();
      }
      return Object.keys(form).length > 0 ? form : null;
    }
  } catch {
    return null;
  }
}
