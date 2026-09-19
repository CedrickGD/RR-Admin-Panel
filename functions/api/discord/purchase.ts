import { ensureAccessSchema } from "../../_lib/access";
import { loadInstalls, loadLicenses, resolveAnchor } from "../../_lib/customer-anchor";
import { isDiscordSnowflake, requireBotSecret } from "../../_lib/discord";
import { buildPurchases } from "../../_lib/discord-support";
import { error, json, jsonBodyErrorMessage, readJsonBody } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv };

/**
 * "What did I buy?" answered from the order data the SellHub webhook already stamped onto the
 * license row (`functions/_lib/licenses.ts`) — no third-party API is called from here.
 *
 * `buildPurchases` is the allow-list: plan, dates, seats, a masked order reference and the last
 * four characters of the key. Never the buyer's name or e-mail, never the full key or order id,
 * never a machine id. This path never touches an AI model.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const denied = requireBotSecret(context.request, context.env);
    if (denied) return denied;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    let body: { discord_id?: unknown };
    try {
      body = await readJsonBody(context.request);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    const discordId = typeof body.discord_id === "string" ? body.discord_id.trim() : "";
    if (!isDiscordSnowflake(discordId)) {
      return error(400, "discord_id must be a Discord user id (17-20 digits).");
    }

    await ensureAccessSchema(context.env);
    const link = await db
      .prepare(
        `SELECT license_key FROM discord_links WHERE discord_id = ? AND is_active = 1 LIMIT 1`,
      )
      .bind(discordId)
      .first<{ license_key: string }>();
    if (!link) return json({ ok: true, linked: false, purchases: [] });

    const anchor = await resolveAnchor(context.env, "discord_id", discordId);
    if (!anchor) return json({ ok: true, linked: true, purchases: [] });

    const installs = await loadInstalls(db, anchor);
    const licenses = await loadLicenses(db, anchor, installs);
    return json({ ok: true, linked: true, purchases: buildPurchases(licenses) });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
