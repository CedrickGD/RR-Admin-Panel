import { resolveLicenseForVerification } from "../../_lib/discord";
import { ensureAccessSchema, type DiscordLinkRow } from "../../_lib/access";
import { error, json, readJsonBody, getBearerToken, timingSafeEqualText } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Called by the bot to learn whether a Discord user should currently hold the Verified role:
 * the link must exist, be active, AND its license must still validate (not revoked/expired/
 * suspended). The bot uses this on guildMemberAdd and in its periodic reconcile sweep to add or
 * strip the role. Authenticated with VERIFY_SHARED_SECRET.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const secret = context.env.VERIFY_SHARED_SECRET;
    if (!secret) return error(500, "Discord verification is not configured on the server.");

    const url = new URL(context.request.url);
    const provided = getBearerToken(context.request) ?? url.searchParams.get("secret") ?? "";
    if (!timingSafeEqualText(provided, secret)) {
      return error(401, "Unauthorized.");
    }

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const body = await readJsonBody<{ discord_id?: string }>(context.request);
    const discordId = (body.discord_id ?? "").trim();
    if (!discordId) return error(400, "discord_id is required.");

    await ensureAccessSchema(context.env);
    const link = await db
      .prepare("SELECT * FROM discord_links WHERE discord_id = ?")
      .bind(discordId)
      .first<DiscordLinkRow>();

    if (!link || link.is_active !== 1) {
      return json({ ok: true, linked: false, active: false });
    }

    // Staff manual grants (source = "manual") carry no license — they are permanent by design, so
    // report active without a license lookup. The reconcile sweep therefore never strips them.
    if (link.source === "manual") {
      return json({ ok: true, linked: true, active: true, license_key: link.license_key });
    }

    // Re-validate the underlying license so a later revoke/expiry/suspension flips active → false.
    const result = await resolveLicenseForVerification(context.env, link.license_key);
    const active = result.ok;

    return json({
      ok: true,
      linked: true,
      active,
      license_key: link.license_key,
      reason: active ? undefined : result.reason,
    });
  } catch (err) {
    return error(500, "Failed to resolve link status.", err instanceof Error ? err.message : null);
  }
}
