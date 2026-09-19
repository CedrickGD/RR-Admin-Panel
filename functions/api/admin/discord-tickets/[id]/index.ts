import { requireAdminRole, requireDashboardAccess } from "../../../../_lib/admin";
import { deleteDiscordTicket } from "../../../../_lib/discord-tickets";
import { error, json } from "../../../../_lib/http";
import { auditPanel, ensurePanelSchema } from "../../../../_lib/panel-access";
import { internalError } from "../../../../_lib/responses";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv; params: { id: string } };

/** `panel_audit.action`; `src/utils/auditEntry.ts` labels it. */
export const TICKET_DELETE_AUDIT_ACTION = "discord-ticket-delete";

/**
 * Remove one archived ticket, transcript included. The row is gone for good — the audit entry is
 * what is left, so it is written even though the delete already happened (a failing history insert
 * is logged, never returned; a 500 would claim nothing was deleted while the row is gone).
 */
export async function onRequestDelete(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    const roleDenied = requireAdminRole(access.access);
    if (roleDenied) return roleDenied;
    if (!context.env.DB) return error(500, "Database not available");

    const id = Number(context.params.id);
    if (!Number.isInteger(id) || id <= 0) return error(400, "A numeric ticket id is required.");

    const channelId = await deleteDiscordTicket(context.env, id);
    if (!channelId) return error(404, "Ticket not found.");

    try {
      await ensurePanelSchema(context.env);
      await auditPanel(
        context.env,
        access.access.user.email,
        channelId,
        TICKET_DELETE_AUDIT_ACTION,
        JSON.stringify({ ticket_id: id }),
      );
    } catch (err) {
      console.error("discord ticket delete: audit row not written", err);
    }

    return json({ ok: true, id });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
