import { requireDashboardAccess } from "../../../_lib/admin";
import {
  ACCESS_AUDIT_ACTIONS,
  accessAuditType,
  ensureAccessSchema,
  type AccessAuditDetail,
  type SuspensionRow,
} from "../../../_lib/access";
import { error, json, readJsonBody, nowIso } from "../../../_lib/http";
import { auditPanel, ensurePanelSchema } from "../../../_lib/panel-access";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Admin: lift a suspension/ban. Soft-clears the record (is_active = 0) so the history and the
 * had_paid_license snapshot survive; the app's next status poll sees no active suspension and
 * unlocks within one poll interval. Who lifted it is kept on the record and in panel_audit.
 *
 * Lifting a record that is already lifted is a no-op (`lifted: false`): it must not overwrite the
 * original lift time and author, nor write a second history entry.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAccessSchema(context.env);

    const body = await readJsonBody<{ identity?: string }>(context.request);
    const identity = (body.identity ?? "").trim();
    if (!identity) return error(400, "identity is required.");

    const existing = await db
      .prepare(`SELECT * FROM access_suspensions WHERE identity = ?`)
      .bind(identity)
      .first<SuspensionRow>();
    if (!existing) return error(404, "No suspension found for that identity.");

    const actor = access.access.user.email;
    const now = nowIso();
    const result = await db
      .prepare(
        `UPDATE access_suspensions SET is_active = 0, lifted_at = ?, lifted_by = ?, updated_at = ?
         WHERE identity = ? AND is_active = 1`,
      )
      .bind(now, actor, now, identity)
      .run();

    const changed = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (!changed) return json({ ok: true, lifted: false, identity });

    const detail: AccessAuditDetail = {
      customer: existing.user_label,
      type: accessAuditType(existing.mode),
      until: existing.banned_until,
      reason: existing.reason,
    };
    await recordAudit(context.env, actor, identity, detail);

    return json({ ok: true, lifted: true, identity, lifted_at: now, lifted_by: actor });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}

/**
 * The lift has already been written when this runs. A failing history insert is logged, not
 * returned: answering 500 would tell the admin the lift failed and invite a retry of a change that
 * is already in force.
 */
async function recordAudit(
  env: RuntimeEnv,
  actor: string,
  identity: string,
  detail: AccessAuditDetail,
): Promise<void> {
  try {
    await ensurePanelSchema(env);
    await auditPanel(env, actor, identity, ACCESS_AUDIT_ACTIONS.lift, JSON.stringify(detail));
  } catch (err) {
    console.error("access lift: audit row not written", err);
  }
}
