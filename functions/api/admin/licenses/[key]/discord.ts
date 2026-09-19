import { requireDashboardAccess } from "../../../../_lib/admin";
import { ensureAccessSchema, type DiscordLinkRow } from "../../../../_lib/access";
import {
  isDiscordSnowflake,
  revokeDiscordLinks,
  upsertDiscordLink,
} from "../../../../_lib/discord";
import {
  decodeKeyParam,
  error,
  json,
  jsonBodyErrorMessage,
  readJsonBody,
} from "../../../../_lib/http";
import { auditPanel, ensurePanelSchema } from "../../../../_lib/panel-access";
import { internalError } from "../../../../_lib/responses";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { key: string };
};

/** `panel_audit.action` values; `src/utils/auditEntry.ts` labels these three. */
export const DISCORD_LINK_AUDIT_ACTIONS = {
  link: "discord-link",
  rebind: "discord-rebind",
  unlink: "discord-unlink",
} as const;

/**
 * Admin: which Discord accounts a license may use.
 *
 *   GET    — the license's links, active ones first (revoked rows stay as history).
 *   POST   — link an account (`source = "manual"`). `replace: true` revokes the license's other
 *            active links first: that is the rebind for "I bought this on my old account".
 *            Without it the account is ADDED even past `max_uses` — the owner's explicit override,
 *            which is why this path never calls the seat check `/verify` runs.
 *   DELETE — revoke one link.
 *
 * No idempotency reservation like issue/activate/bind: both writes are an upsert and a conditional
 * UPDATE, so a retried request lands on the same row and changes nothing twice.
 *
 * Roles follow within the bot's next sync (≤ 30 min) or immediately when the member runs /verify —
 * nothing here talks to Discord.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const key = decodeKeyParam(context.params.key);
    if (!key) return error(400, "License key is required.");

    return json({ ok: true, license_key: key, links: await listLinks(context.env, key) });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const key = decodeKeyParam(context.params.key);
    if (!key) return error(400, "License key is required.");

    let body: { discord_id?: unknown; discord_tag?: unknown; replace?: unknown };
    try {
      body = await readJsonBody(context.request);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }

    const discordId = typeof body.discord_id === "string" ? body.discord_id.trim() : "";
    if (!isDiscordSnowflake(discordId)) {
      return error(400, "discord_id must be a Discord user id (17-20 digits).");
    }
    const discordTag =
      typeof body.discord_tag === "string" ? body.discord_tag.trim().slice(0, 64) || null : null;

    const license = await db
      .prepare("SELECT license_key, hwid FROM licenses WHERE license_key = ?")
      .bind(key)
      .first<{ license_key: string; hwid: string | null }>();
    if (!license) return error(404, "License not found.");

    await ensureAccessSchema(context.env);
    // Read before the upsert: an id that already sits on another license is being moved, and the
    // history entry should say where from.
    const existing = await db
      .prepare("SELECT license_key, is_active FROM discord_links WHERE discord_id = ?")
      .bind(discordId)
      .first<{ license_key: string; is_active: number }>();

    const replace = body.replace === true;
    const replaced = replace
      ? await revokeDiscordLinks(context.env, { licenseKey: key, exceptDiscordId: discordId })
      : 0;

    await upsertDiscordLink(context.env, {
      discordId,
      discordTag,
      licenseKey: key,
      hwid: license.hwid,
      source: "manual",
    });

    await recordAudit(
      context.env,
      access.access.user.email,
      key,
      replace ? DISCORD_LINK_AUDIT_ACTIONS.rebind : DISCORD_LINK_AUDIT_ACTIONS.link,
      {
        discord_id: discordId,
        discord_tag: discordTag,
        replaced,
        moved_from:
          existing && existing.license_key !== key && existing.is_active === 1
            ? existing.license_key
            : null,
      },
    );

    return json({
      ok: true,
      license_key: key,
      discord_id: discordId,
      replaced,
      links: await listLinks(context.env, key),
    });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}

export async function onRequestDelete(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const key = decodeKeyParam(context.params.key);
    if (!key) return error(400, "License key is required.");

    let body: { discord_id?: unknown };
    try {
      body = await readJsonBody(context.request);
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }
    const discordId = typeof body.discord_id === "string" ? body.discord_id.trim() : "";
    if (!discordId) return error(400, "discord_id is required.");

    const revoked = await revokeDiscordLinks(context.env, { licenseKey: key, discordId });
    // Never report success on a no-op: the account may belong to a different license.
    if (!revoked) return error(404, "No active Discord link for that account on this license.");

    await recordAudit(
      context.env,
      access.access.user.email,
      key,
      DISCORD_LINK_AUDIT_ACTIONS.unlink,
      { discord_id: discordId },
    );

    return json({
      ok: true,
      license_key: key,
      discord_id: discordId,
      links: await listLinks(context.env, key),
    });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}

async function listLinks(env: RuntimeEnv, licenseKey: string): Promise<DiscordLinkRow[]> {
  await ensureAccessSchema(env);
  const rows = await env
    .DB!.prepare(
      `SELECT discord_id, discord_tag, license_key, hwid, verified_at, revoked_at, is_active, source
       FROM discord_links WHERE license_key = ? ORDER BY is_active DESC, verified_at DESC`,
    )
    .bind(licenseKey)
    .all<DiscordLinkRow>();
  return rows.results;
}

/**
 * The link change has already been written when this runs. A failing history insert is logged, not
 * returned: a 500 would tell the admin nothing happened while the row is already there.
 */
async function recordAudit(
  env: RuntimeEnv,
  actor: string,
  licenseKey: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await ensurePanelSchema(env);
    await auditPanel(env, actor, licenseKey, action, JSON.stringify(detail));
  } catch (err) {
    console.error("license discord link: audit row not written", err);
  }
}
