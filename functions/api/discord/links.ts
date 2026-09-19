import { resolveLinkAccess } from "../../_lib/discord";
import { ensureAccessSchema } from "../../_lib/access";
import { error, json, getBearerToken, timingSafeEqualText } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Every active Discord link with the state of its license, in ONE call. The bot's reconcile sweep
 * used to ask `/api/discord/status` once per known member; this replaces that fan-out, and it also
 * reports accounts the panel linked by hand, which the sweep could not discover before.
 *
 * Auth is identical to `/api/discord/status`: VERIFY_SHARED_SECRET as a Bearer token, no `?secret=`.
 * License keys deliberately never appear in the response — the bot only needs ids and entitlements.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const secret = context.env.VERIFY_SHARED_SECRET;
    if (!secret) return error(500, "Discord verification is not configured on the server.");

    const provided = getBearerToken(context.request) ?? "";
    if (!timingSafeEqualText(provided, secret)) {
      return error(401, "Unauthorized.");
    }

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAccessSchema(context.env);
    const rows = await db
      .prepare("SELECT discord_id, license_key FROM discord_links WHERE is_active = 1")
      .all<{ discord_id: string; license_key: string }>();

    // ponytail: one license resolve per link instead of a single JOIN — reusing
    // resolveLinkAccess keeps the validity rules (revoked/expired/suspended) in one place, and the
    // sweep runs twice an hour against local SQLite. Batch it if the link table ever grows large.
    const links = [];
    for (const row of rows.results) {
      const access = await resolveLinkAccess(context.env, row);
      links.push({
        discord_id: row.discord_id,
        active: access.active,
        lifetime: access.lifetime,
        plan: access.plan,
        expiresAt: access.expiresAt,
        reason: access.reason,
      });
    }

    return json({ ok: true, links });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
