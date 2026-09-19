import { requireDashboardAccess } from "../../../../_lib/admin";
import { loadDiscordTicketTranscript } from "../../../../_lib/discord-tickets";
import { error } from "../../../../_lib/http";
import { internalError } from "../../../../_lib/responses";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv; params: { id: string } };

/**
 * The ticket transcript, as a DOWNLOAD — never rendered inside the panel.
 *
 * The HTML was written by a third party (the bot, from message content members typed), so it is
 * served with `Content-Disposition: attachment`, `nosniff` and a sandbox CSP: the browser saves it
 * instead of executing it in the panel's origin. The panel has no inline renderer for foreign HTML
 * and this endpoint is deliberately not the place to grow one.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    if (!context.env.DB) return error(500, "Database not available");

    const id = Number(context.params.id);
    if (!Number.isInteger(id) || id <= 0) return error(400, "A numeric ticket id is required.");

    const ticket = await loadDiscordTicketTranscript(context.env, id);
    if (!ticket) return error(404, "Ticket not found.");

    const name = ticket.ticket_no ? `ticket-${ticket.ticket_no}` : `ticket-${id}`;
    return new Response(ticket.transcript_html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="rr-${name}.html"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
