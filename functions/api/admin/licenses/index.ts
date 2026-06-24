import { requireDashboardAccess } from "../../../_lib/admin";
import { error, json, readJsonBody, nowIso } from "../../../_lib/http";
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

    const { results } = await db.prepare(`
      SELECT 
        l.*, 
        s.session_id,
        s.user_label,
        s.client_country,
        s.client_ip,
        s.app_version,
        s.last_seen_at AS session_last_seen
      FROM licenses l
      LEFT JOIN app_sessions s ON s.session_id = (
        SELECT session_id FROM app_sessions s2 WHERE s2.hwid = l.hwid ORDER BY s2.last_seen_at DESC LIMIT 1
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

    const body = await readJsonBody<{
      type?: string;
      duration_days?: number;
      custom_options?: object;
      count?: number;
      custom_key?: string;
      max_uses?: number;
    }>(context.request);

    const type = body.type || 'lifetime';
    const durationDays = body.duration_days || null;
    const customOptions = body.custom_options ? JSON.stringify(body.custom_options) : '{}';
    const customKey = body.custom_key?.trim();
    const maxUses = Math.max(body.max_uses || 1, 1);
    // If a custom key is provided, we can only create 1 key exactly.
    const count = customKey ? 1 : Math.min(Math.max(body.count || 1, 1), 100);

    const keys = [];
    const now = nowIso();

    for (let i = 0; i < count; i++) {
      // Generate a random key like XXXX-XXXX-XXXX-XXXX if customKey is not provided
      const key = customKey || crypto.randomUUID().toUpperCase().split('-').slice(1).join('-');
      
      await db.prepare(
        "INSERT INTO licenses (license_key, type, duration_days, custom_options, max_uses, created_at, status) VALUES (?, ?, ?, ?, ?, ?, 'active')"
      ).bind(key, type, durationDays, customOptions, maxUses, now).run();
      
      keys.push(key);
    }

    return json({ ok: true, generated_keys: keys });
  } catch (err) {
    return error(500, "Failed to generate licenses.", err instanceof Error ? err.message : null);
  }
}
