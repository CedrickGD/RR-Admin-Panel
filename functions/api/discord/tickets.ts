import { requireBotSecret } from "../../_lib/discord";
import {
  MAX_TICKET_BODY_BYTES,
  normalizeTicketInput,
  upsertDiscordTicket,
} from "../../_lib/discord-tickets";
import { error, json, JsonBodyError, jsonBodyErrorMessage, readJsonBody } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv };

/**
 * The bot's ticket archive: one upload per closed ticket, carrying the rendered transcript.
 *
 * Idempotent on `channel_id` — the bot retries a failed upload, and a ticket that is later deleted
 * arrives a second time with `status = "deleted"`. An over-sized body answers 413 so the bot can
 * retry once with the oldest messages dropped; anything else would lose the whole archive entry
 * over a long conversation.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const denied = requireBotSecret(context.request, context.env);
    if (denied) return denied;

    if (!context.env.DB) return error(500, "Database not available");

    let body: unknown;
    try {
      body = await readJsonBody(context.request, MAX_TICKET_BODY_BYTES);
    } catch (cause) {
      const tooLarge = cause instanceof JsonBodyError && cause.message.includes("exceeds");
      return error(tooLarge ? 413 : 400, jsonBodyErrorMessage(cause));
    }

    const input = normalizeTicketInput(body);
    if (!input.ok) return error(400, input.message);

    return json({ ok: true, id: await upsertDiscordTicket(context.env, input.value) });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
