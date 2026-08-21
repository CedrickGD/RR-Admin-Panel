import { requireDashboardAccess } from "../../../_lib/admin";
import { ensureAccessSchema, findPaidLicensesForHwid } from "../../../_lib/access";
import { toIsoOrNull } from "../../../_lib/content";
import { error, json, readJsonBody, nowIso } from "../../../_lib/http";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Admin: suspend or permanently ban a user's access. Keyed by `identity` (the telemetry rollup
 * key = hwid ?? install_id); hwid/install_id are stored alongside so the app's status poll resolves
 * it however it identifies itself. Upsert-by-identity, so re-suspending simply updates the row and
 * re-activates it. `had_paid_license` is snapshotted at write time from the licenses bound to the
 * hwid — the warning the admin already saw, frozen onto the record.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    await ensureAccessSchema(context.env);

    const body = await readJsonBody<{
      identity?: string;
      hwid?: string;
      install_id?: string;
      user_label?: string;
      mode?: string;
      reason?: string;
      banned_until?: string;
    }>(context.request);

    const hwid = (body.hwid ?? "").trim() || null;
    const installId = (body.install_id ?? "").trim() || null;
    const identity = (body.identity ?? "").trim() || hwid || installId;
    if (!identity) {
      return error(400, "identity, hwid or install_id is required.");
    }

    const mode = body.mode === "suspend" ? "suspend" : "ban";
    const bannedUntil = mode === "suspend" ? toIsoOrNull(body.banned_until) : null;
    if (mode === "suspend" && !bannedUntil) {
      return error(400, "A timed suspension requires a valid banned_until date.");
    }
    if (bannedUntil && bannedUntil <= nowIso()) {
      return error(400, "banned_until must be in the future.");
    }

    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 500) || null : null;
    const userLabel =
      typeof body.user_label === "string" ? body.user_label.trim().slice(0, 120) || null : null;

    // Snapshot the paid-license state at suspend time (this is the warning the admin acted against).
    const paidLicenses = await findPaidLicensesForHwid(context.env, hwid ?? identity);
    const hadPaid = paidLicenses.length > 0 ? 1 : 0;
    const paidKeys =
      paidLicenses.length > 0 ? paidLicenses.map((l) => l.license_key).join(",") : null;

    const now = nowIso();
    await db
      .prepare(
        `INSERT INTO access_suspensions
          (identity, hwid, install_id, user_label, mode, reason, banned_until, is_active,
           had_paid_license, paid_license_keys, created_by, created_at, updated_at, lifted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(identity) DO UPDATE SET
           hwid = COALESCE(excluded.hwid, access_suspensions.hwid),
           install_id = COALESCE(excluded.install_id, access_suspensions.install_id),
           user_label = COALESCE(excluded.user_label, access_suspensions.user_label),
           mode = excluded.mode,
           reason = excluded.reason,
           banned_until = excluded.banned_until,
           is_active = 1,
           had_paid_license = excluded.had_paid_license,
           paid_license_keys = excluded.paid_license_keys,
           created_by = excluded.created_by,
           updated_at = excluded.updated_at,
           lifted_at = NULL`,
      )
      .bind(
        identity,
        hwid,
        installId,
        userLabel,
        mode,
        reason,
        bannedUntil,
        hadPaid,
        paidKeys,
        access.access.user.email,
        now,
        now,
      )
      .run();

    return json({
      ok: true,
      suspended: true,
      identity,
      mode,
      banned_until: bannedUntil,
      had_paid_license: hadPaid === 1,
      paid_license_keys: paidLicenses.map((l) => l.license_key),
    });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
