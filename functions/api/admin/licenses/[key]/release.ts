import { ensureInstallsSchema } from "../../../../../shared/installs-store";
import { requireAdminRole, requireDashboardAccess } from "../../../../_lib/admin";
import {
  decodeKeyParam,
  error,
  isObject,
  json,
  jsonBodyErrorMessage,
  readJsonBody,
} from "../../../../_lib/http";
import { ensureLicenseOperationsSchema } from "../../../../_lib/license-operations";
import { auditPanel, ensurePanelSchema } from "../../../../_lib/panel-access";
import { internalError } from "../../../../_lib/responses";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: { key: string };
};

/** `panel_audit.action`; `src/utils/auditEntry.ts` labels it. */
export const LICENSE_RELEASE_AUDIT_ACTION = "license-release";

const REASON_MAX_LENGTH = 500;

/**
 * Admin: release one PC (hardware ID) from a license, freeing its seat.
 *
 * The customer then activates the key on the new PC in the app; `expires_at` and `activated_at`
 * stay as they are, so a 3-month key keeps its end date (api/license/activate only starts the
 * clock on the very first activation).
 *
 * Not needed after a Windows reinstall on the same hardware — the hardware ID survives that and
 * re-entering the key is enough. This is for a changed drive/board/CPU or a different PC.
 *
 * POST body: { hwid, reason? }. A retry after success answers 404 (nothing bound to release), so
 * no idempotency reservation is needed.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    const roleDenied = requireAdminRole(access.access);
    if (roleDenied) return roleDenied;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const key = decodeKeyParam(context.params.key);
    if (!key || key.length > 128) return error(400, "License key is required.");

    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonBody<unknown>(context.request);
      if (!isObject(parsed)) return error(400, "Request body must be a JSON object.");
      body = parsed;
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }

    // Any stored entry must be releasable, including legacy values the public activate accepted
    // without a format check — so only "non-empty, no comma" here, not HWID_PATTERN.
    const hwid = typeof body.hwid === "string" ? body.hwid.trim() : "";
    if (!hwid || hwid.length > 256 || hwid.includes(",")) {
      return error(400, "A valid hwid is required.");
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > REASON_MAX_LENGTH) {
      return error(400, `reason must be <= ${REASON_MAX_LENGTH} characters.`);
    }

    await ensureLicenseOperationsSchema(db);
    await ensureInstallsSchema(db);

    const license = await db
      .prepare("SELECT id, hwid FROM licenses WHERE license_key = ? LIMIT 1")
      .bind(key)
      .first<{ id: number; hwid: string | null }>();
    if (!license) return error(404, "License not found.");

    // The raw list, exactly as stored: only the released PC leaves it, every other seat stays as is.
    const bound = (license.hwid ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const released = bound.find((entry) => entry.toLowerCase() === hwid.toLowerCase());
    if (!released) return error(404, "That hardware ID is not bound to this license.");
    const remaining = bound.filter((entry) => entry.toLowerCase() !== hwid.toLowerCase());

    const claims = await db
      .prepare(
        `SELECT id FROM license_binding_claims WHERE license_id = ? AND lower(hwid) <> lower(?)
         ORDER BY slot_number ASC, id ASC`,
      )
      .bind(license.id, released)
      .all<{ id: number }>();

    // ONE batch (a transaction on D1 and on the rr-api adapter), every statement guarded on the
    // hwid list just read: a concurrent bind/activation makes all of it a no-op and this answers
    // 409; a failure rolls all of it back, so a retry simply repeats the release.
    const guard = `EXISTS (SELECT 1 FROM licenses WHERE id = ? AND COALESCE(hwid, '') = ?)`;
    const guardArgs = [license.id, license.hwid ?? ""];
    const results = await db.batch([
      db
        .prepare(
          `DELETE FROM license_binding_claims
           WHERE license_id = ? AND lower(hwid) = lower(?) AND ${guard}`,
        )
        .bind(license.id, released, ...guardArgs),
      // Admin bind numbers the next seat `bound count + 1` under UNIQUE(license_id, slot_number):
      // close the gap the released seat left, via negatives so no step collides.
      db
        .prepare(
          `UPDATE license_binding_claims SET slot_number = -slot_number
           WHERE license_id = ? AND ${guard}`,
        )
        .bind(license.id, ...guardArgs),
      ...claims.results.map((claim, index) =>
        db
          .prepare(`UPDATE license_binding_claims SET slot_number = ? WHERE id = ? AND ${guard}`)
          .bind(index + 1, claim.id, ...guardArgs),
      ),
      db
        .prepare(
          `DELETE FROM license_install_claims WHERE license_id = ?
           AND install_id IN (SELECT install_id FROM installs WHERE lower(hwid) = lower(?))
           AND ${guard}`,
        )
        .bind(license.id, released, ...guardArgs),
      db
        .prepare(
          `UPDATE installs SET license_id = NULL
           WHERE license_id = ? AND lower(hwid) = lower(?) AND ${guard}`,
        )
        .bind(license.id, released, ...guardArgs),
      // Last, so the guard above still sees the old list in every earlier statement.
      db
        .prepare(
          `UPDATE licenses SET hwid = ?, usage_count = ?
           WHERE id = ? AND COALESCE(hwid, '') = ?`,
        )
        .bind(
          remaining.length ? remaining.join(",") : null,
          remaining.length,
          license.id,
          license.hwid ?? "",
        ),
    ]);
    if ((results[results.length - 1]?.meta?.changes ?? 0) !== 1) {
      return error(409, "The license changed while releasing. Reload and try again.");
    }

    try {
      await ensurePanelSchema(context.env);
      await auditPanel(
        context.env,
        access.access.user.email,
        key,
        LICENSE_RELEASE_AUDIT_ACTION,
        JSON.stringify({ hwid: released, remaining: remaining.length, reason: reason || null }),
      );
    } catch (err) {
      // The seat is already free; a 500 here would claim nothing happened.
      console.error("license release: audit row not written", err);
    }

    const updated = await db
      .prepare("SELECT * FROM licenses WHERE id = ? LIMIT 1")
      .bind(license.id)
      .first<Record<string, unknown>>();
    return json({ ok: true, released_hwid: released, license: updated });
  } catch (err) {
    return internalError(context.request, "Unable to release the device.", err);
  }
}
