import { upsertDiscordLink } from "../../_lib/discord";
import { error, json, readJsonBody, getBearerToken, timingSafeEqualText } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Staff manual grant: record a PERMANENT Verified link for a Discord user that is not tied to any
 * license. Called by the bot's `/verify user:@member` (staff-only) command. Authenticated with the
 * shared VERIFY_SHARED_SECRET like /verify and /status.
 *
 * The link is stored with source = "manual" and a sentinel license_key so /api/discord/status
 * reports it active forever — the periodic reconcile sweep therefore never strips the role. The bot
 * assigns the actual Discord role; this endpoint only persists the durable grant.
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

    const body = await readJsonBody<{ discord_id?: string; discord_tag?: string; granted_by?: string }>(context.request);
    const discordId = (body.discord_id ?? "").trim();
    const discordTag = typeof body.discord_tag === "string" ? body.discord_tag.trim().slice(0, 64) || null : null;
    if (!discordId) return error(400, "discord_id is required.");

    await upsertDiscordLink(context.env, {
      discordId,
      discordTag,
      licenseKey: "MANUAL",
      hwid: null,
      source: "manual",
    });

    return json({ ok: true, granted: true, discord_id: discordId });
  } catch (err) {
    return error(500, "Failed to grant.", err instanceof Error ? err.message : null);
  }
}
