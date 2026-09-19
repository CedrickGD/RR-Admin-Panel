import { requireDashboardAccess } from "../../../_lib/admin";
import { listDiscordTickets } from "../../../_lib/discord-tickets";
import { error, json } from "../../../_lib/http";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv };

/**
 * Archived Discord tickets for one customer — by license key (through `discord_links`) or straight
 * by Discord account. Without a filter: the newest 100 overall, with the real total beside them so
 * the card can say "Discord tickets (N)" without loading every row.
 *
 * The transcript itself is never in this answer; it is a download of its own.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    if (!context.env.DB) return error(500, "Database not available");

    const url = new URL(context.request.url);
    const result = await listDiscordTickets(context.env, {
      licenseKey: url.searchParams.getAll("license_key"),
      discordId: url.searchParams.getAll("discord_id"),
    });
    return json({ ok: true, total: result.total, tickets: result.tickets });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
