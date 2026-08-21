import { requireDashboardAccess } from "../../../../_lib/admin";
import { decodeKeyParam, error, json, readJsonBody } from "../../../../_lib/http";
import {
  EDITABLE_ORDER_FIELDS,
  ensureLicenseOrderColumns,
  normalizeOrderField,
} from "../../../../_lib/licenses";
import type { RuntimeEnv } from "../../../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
  params: {
    key: string;
  };
};

/**
 * PATCH /api/admin/licenses/:key — edit the buyer/order attribution of a
 * license (order number, customer name/email/Discord, note). Only fields
 * present in the body are touched; sending an empty string clears a field.
 */
export async function onRequestPatch(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");
    await ensureLicenseOrderColumns(db);

    const key = decodeKeyParam(context.params.key);
    if (!key) return error(400, "License key is required.");

    const body = await readJsonBody<Record<string, unknown>>(context.request);

    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const field of EDITABLE_ORDER_FIELDS) {
      if (!(field in body)) continue;
      assignments.push(`${field} = ?`);
      values.push(normalizeOrderField(field, body[field]));
    }
    if (assignments.length === 0) {
      return error(400, "No editable fields provided.");
    }

    const result = await db
      .prepare(`UPDATE licenses SET ${assignments.join(", ")} WHERE license_key = ?`)
      .bind(...values, key)
      .run();
    if (!result.meta?.changes) {
      return error(404, "License not found — nothing was updated.");
    }

    const updated = await db
      .prepare("SELECT * FROM licenses WHERE license_key = ?")
      .bind(key)
      .first();
    return json({ ok: true, license: updated });
  } catch (err) {
    return error(500, "Failed to update license.", err instanceof Error ? err.message : null);
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

    const result = await db.prepare("DELETE FROM licenses WHERE license_key = ?").bind(key).run();
    // Never report success on a no-op delete — that is what made a failed master-key delete look
    // like it worked while the row stayed in the table.
    if (!result.meta?.changes) {
      return error(404, "License not found — nothing was deleted.");
    }

    return json({ ok: true, message: "License permanently deleted." });
  } catch (err) {
    return error(500, "Failed to delete license.", err instanceof Error ? err.message : null);
  }
}
