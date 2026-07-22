import { resolveLicenseForVerification, upsertDiscordLink, verifyReasonMessage } from "../../_lib/discord";
import { error, json, readJsonBody, getBearerToken, timingSafeEqualText } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Called by the Discord bot's /verify command. Authenticated with the shared VERIFY_SHARED_SECRET
 * (Bearer token or ?secret=). Validates the supplied license key, records the Discord↔license link,
 * and returns ok — the BOT then grants the Verified role to the caller. Deliberately does not touch
 * Discord itself, so this path needs no bot token on the Pages side.
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

    const body = await readJsonBody<{ discord_id?: string; discord_tag?: string; license_key?: string }>(context.request);
    const discordId = (body.discord_id ?? "").trim();
    const licenseKey = (body.license_key ?? "").trim();
    const discordTag = typeof body.discord_tag === "string" ? body.discord_tag.trim().slice(0, 64) || null : null;

    if (!discordId) return error(400, "discord_id is required.");
    if (!licenseKey) return json({ ok: true, verified: false, reason: "missing_key", message: verifyReasonMessage("missing_key") });

    const result = await resolveLicenseForVerification(context.env, licenseKey, discordId);
    if (!result.ok || !result.license) {
      return json({ ok: true, verified: false, reason: result.reason, message: verifyReasonMessage(result.reason) });
    }

    await upsertDiscordLink(context.env, {
      discordId,
      discordTag,
      licenseKey: result.license.license_key,
      hwid: result.license.hwid,
      source: "slash",
    });

    return json({ ok: true, verified: true, discord_id: discordId, license_key: result.license.license_key });
  } catch (err) {
    return error(500, "Failed to verify.", err instanceof Error ? err.message : null);
  }
}
