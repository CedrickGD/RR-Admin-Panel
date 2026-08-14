import { error, nowIso } from "../../_lib/http";
import { ensureLicenseOrderColumns, extractOrderInfo, readStorePayload } from "../../_lib/licenses";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

// Accept both POST and GET to be maximally compatible with various storefront webhooks and dynamic serial APIs
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  return handleRequest(context);
}

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  return handleRequest(context);
}

async function handleRequest(context: HandlerContext): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const secretKey = context.env.STORE_SECRET_KEY;

    if (!secretKey) {
        return error(500, "Store integration is not configured on the server.");
    }

    // Check query param first
    let providedSecret = url.searchParams.get("secret");

    // Check Authorization header if not in query param
    if (!providedSecret) {
        const authHeader = context.request.headers.get("Authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            providedSecret = authHeader.substring(7);
        }
    }

    if (providedSecret !== secretKey) {
        return error(401, "Unauthorized store request.");
    }

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");
    await ensureLicenseOrderColumns(db);

    // Order tracking: capture whatever buyer/order identifiers the storefront
    // sends (query params or JSON/form body — SellHub/Sellix/SellAuth style)
    // so the admin panel can show who purchased each key and under which
    // order number. Extraction is best-effort and can never fail delivery.
    const payload = context.request.method === "POST" ? await readStorePayload(context.request) : null;
    const order = extractOrderInfo(url, payload);

    // Which plan was bought. Each SellHub variant carries its plan in its own delivery
    // URL (?plan=1m|3m|6m|12m|lifetime); the duration itself starts counting at first
    // activation (license/activate.ts), not at purchase — a key in a drawer loses nothing.
    // No/unknown plan falls back to lifetime so the pre-existing product link keeps
    // issuing exactly what it always issued.
    const PLANS: Record<string, { type: string; durationDays: number | null }> = {
        "1m":       { type: "1-month",   durationDays: 30 },
        "3m":       { type: "3-months",  durationDays: 90 },
        "6m":       { type: "6-months",  durationDays: 180 },
        "12m":      { type: "12-months", durationDays: 365 },
        "lifetime": { type: "lifetime",  durationDays: null },
    };
    const planParam = (url.searchParams.get("plan") ?? "lifetime").toLowerCase();
    const plan = PLANS[planParam] ?? PLANS["lifetime"];

    // Generate a secure 16-character key (XXXX-XXXX-XXXX-XXXX)
    const key = crypto.randomUUID().toUpperCase().split('-').slice(1).join('-');
    const now = nowIso();

    await db.prepare(
        `INSERT INTO licenses (
           license_key, type, duration_days, custom_options, max_uses, created_at, status,
           order_id, customer_name, customer_email, customer_discord, order_source, order_meta, purchased_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'store', ?, ?)`
    ).bind(
        key, plan.type, plan.durationDays, '{}', 1, now,
        order.order_id, order.customer_name, order.customer_email, order.customer_discord,
        order.order_meta, now
    ).run();

    // Return plain text so Dynamic Serials (API Delivery) systems like SellHub can easily read and forward it
    return new Response(key, {
        status: 200,
        headers: {
            "Content-Type": "text/plain"
        }
    });
  } catch (err) {
    return error(500, "Failed to generate store license.", err instanceof Error ? err.message : null);
  }
}
