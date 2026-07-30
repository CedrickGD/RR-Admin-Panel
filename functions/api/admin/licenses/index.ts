import { ensureAccessSchema } from "../../../_lib/access";
import { requireDashboardAccess } from "../../../_lib/admin";
import { error, json, readJsonBody, nowIso } from "../../../_lib/http";
import { ensureLicenseOrderColumns, normalizeOrderField } from "../../../_lib/licenses";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");
    await ensureLicenseOrderColumns(db);
    // The join below reads discord_links — guarantee it exists (idempotent, probe-fast).
    await ensureAccessSchema(context.env);

    // verified_discord: the Discord account that verified with this key via the
    // bot/OAuth flow — an independent "who actually holds this license" signal
    // next to the storefront customer columns.
    const { results } = await db.prepare(`
      SELECT
        l.*,
        s.session_id,
        s.user_label,
        s.client_country,
        s.client_ip,
        s.app_version,
        s.last_seen_at AS session_last_seen,
        dl.discord_tag AS verified_discord
      FROM licenses l
      LEFT JOIN app_sessions s ON s.session_id = (
        SELECT session_id FROM app_sessions s2 WHERE s2.hwid = l.hwid ORDER BY s2.last_seen_at DESC LIMIT 1
      )
      LEFT JOIN discord_links dl ON dl.discord_id = (
        SELECT discord_id FROM discord_links d2
        WHERE d2.license_key = l.license_key AND d2.is_active = 1
        ORDER BY d2.verified_at DESC LIMIT 1
      )
      ORDER BY l.id DESC
    `).all();
    return json({ ok: true, licenses: results });
  } catch (err) {
    return error(500, "Failed to load licenses.", err instanceof Error ? err.message : null);
  }
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");
    await ensureLicenseOrderColumns(db);

    const body = await readJsonBody<{
      type?: string;
      duration_days?: number;
      custom_options?: object;
      count?: number;
      custom_key?: string;
      max_uses?: number;
      // Optional buyer/order attribution stamped on every generated key —
      // used when generating a key for a known manual sale.
      order_id?: string;
      customer_name?: string;
      customer_email?: string;
      customer_discord?: string;
      order_note?: string;
    }>(context.request);

    const type = body.type || 'lifetime';
    const durationDays = body.duration_days || null;
    const customOptions = body.custom_options ? JSON.stringify(body.custom_options) : '{}';
    const customKey = body.custom_key?.trim();
    const rawMaxUses = body.max_uses ?? 1;
    const maxUses = rawMaxUses === -1 ? -1 : Math.max(rawMaxUses, 1);
    // If a custom key is provided, we can only create 1 key exactly.
    const count = customKey ? 1 : Math.min(Math.max(body.count || 1, 1), 100);

    const orderId = normalizeOrderField("order_id", body.order_id);
    const customerName = normalizeOrderField("customer_name", body.customer_name);
    const customerEmail = normalizeOrderField("customer_email", body.customer_email);
    const customerDiscord = normalizeOrderField("customer_discord", body.customer_discord);
    const orderNote = normalizeOrderField("order_note", body.order_note);
    const hasOrderInfo = Boolean(orderId || customerName || customerEmail || customerDiscord || orderNote);

    const keys = [];
    const now = nowIso();

    for (let i = 0; i < count; i++) {
      // Generate a random key like XXXX-XXXX-XXXX-XXXX if customKey is not provided
      const key = customKey || crypto.randomUUID().toUpperCase().split('-').slice(1).join('-');

      await db.prepare(
        `INSERT INTO licenses (
           license_key, type, duration_days, custom_options, max_uses, created_at, status,
           order_id, customer_name, customer_email, customer_discord, order_note, order_source, purchased_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        key, type, durationDays, customOptions, maxUses, now,
        orderId, customerName, customerEmail, customerDiscord, orderNote,
        hasOrderInfo ? 'admin' : null,
        hasOrderInfo ? now : null
      ).run();

      keys.push(key);
    }

    return json({ ok: true, generated_keys: keys });
  } catch (err) {
    return error(500, "Failed to generate licenses.", err instanceof Error ? err.message : null);
  }
}
