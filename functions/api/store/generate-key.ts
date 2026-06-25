import { error, nowIso } from "../../_lib/http";
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

    // Generate a secure 16-character key (XXXX-XXXX-XXXX-XXXX)
    const key = crypto.randomUUID().toUpperCase().split('-').slice(1).join('-');
    const now = nowIso();
    
    // Default to lifetime, 1 PC (max_uses = 1), standard tier
    await db.prepare(
        "INSERT INTO licenses (license_key, type, duration_days, custom_options, max_uses, created_at, status) VALUES (?, ?, ?, ?, ?, ?, 'active')"
    ).bind(key, 'lifetime', null, '{}', 1, now).run();

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
