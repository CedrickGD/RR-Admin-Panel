import { ensureAccessSchema } from "../../../_lib/access";
import { requireAdminRole, requireDashboardAccess } from "../../../_lib/admin";
import { error, json } from "../../../_lib/http";
import { ensureLicenseOrderColumns, ORDER_FIELD_LIMITS } from "../../../_lib/licenses";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv };

const RESULT_LIMIT = 200;

/** Exact order lookup or literal (non-wildcard) buyer substring search. */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    const roleDenied = requireAdminRole(access.access);
    if (roleDenied) return roleDenied;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const url = new URL(context.request.url);
    const orderId = url.searchParams.get("order_id")?.trim() ?? "";
    const customer = url.searchParams.get("customer")?.trim() ?? "";
    if (!orderId && !customer) {
      return error(400, "order_id or customer is required.");
    }
    if (orderId.length > ORDER_FIELD_LIMITS.order_id || customer.length > 254) {
      return error(400, "Search value is too long.");
    }

    await ensureLicenseOrderColumns(db);
    await ensureAccessSchema(context.env);

    const conditions: string[] = [];
    const bindings: unknown[] = [];
    if (orderId) {
      conditions.push("l.order_id = ?");
      bindings.push(orderId);
    }
    if (customer) {
      // instr treats %, _ and \ literally, unlike LIKE, so buyer input cannot change the query.
      conditions.push(`(
        instr(lower(COALESCE(l.customer_name, '')), lower(?)) > 0 OR
        instr(lower(COALESCE(l.customer_email, '')), lower(?)) > 0 OR
        instr(lower(COALESCE(l.customer_discord, '')), lower(?)) > 0
      )`);
      bindings.push(customer, customer, customer);
    }
    const where = conditions.join(" AND ");

    const [rows, count] = await Promise.all([
      db
        .prepare(
          `SELECT
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
             SELECT s2.session_id FROM app_sessions s2
             WHERE s2.hwid IS NOT NULL
               AND instr(
                 ',' || replace(COALESCE(l.hwid, ''), ' ', '') || ',',
                 ',' || replace(s2.hwid, ' ', '') || ','
               ) > 0
             ORDER BY s2.last_seen_at DESC LIMIT 1
           )
           LEFT JOIN discord_links dl ON dl.discord_id = (
             SELECT d2.discord_id FROM discord_links d2
             WHERE d2.license_key = l.license_key AND d2.is_active = 1
             ORDER BY d2.verified_at DESC LIMIT 1
           )
           WHERE ${where}
           ORDER BY l.id DESC
           LIMIT ${RESULT_LIMIT}`,
        )
        .bind(...bindings)
        .all(),
      db
        .prepare(`SELECT COUNT(*) AS total FROM licenses l WHERE ${where}`)
        .bind(...bindings)
        .first<{ total: number | string }>(),
    ]);

    return json({
      ok: true,
      query: { order_id: orderId || null, customer: customer || null },
      licenses: rows.results,
      total: toInteger(count?.total),
    });
  } catch (cause) {
    return internalError(context.request, "Unable to search licenses.", cause);
  }
}

function toInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}
