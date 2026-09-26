import { json, error, nowIso } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { parseJsonObject, requireInstallAuth } from "../../_lib/install-auth";
import { enforceRateLimit } from "../../_lib/ratelimit";
import type { RuntimeEnv } from "../../_lib/types";

export async function onRequestPost(context: { request: Request; env: RuntimeEnv }) {
  const limited = enforceRateLimit(context.request, {
    route: "license/activate",
    limit: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  // Signature verified when present; unsigned stays allowed for legacy clients until
  // REQUIRE_INSTALL_SIGNATURE=true.
  const auth = await requireInstallAuth(context, "optional");
  if (!auth.ok) return auth.response;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  const body = parseJsonObject(auth.bodyText);
  if (!body) return error(400, "Request body must be a JSON object.");

  try {
    const licenseKey = typeof body.license_key === "string" ? body.license_key : "";
    const hwidRaw = typeof body.hwid === "string" ? body.hwid : "";
    if (!licenseKey || !hwidRaw) {
      return error(400, "license_key and hwid are required.");
    }

    const key = licenseKey.trim();
    const hwid = hwidRaw.trim();
    // licenses.hwid is a comma-separated seat list: "A,B,C" would take one seat and bind three PCs.
    if (!hwid || hwid.includes(",")) return error(400, "Invalid hwid.");

    // A second, per-key budget: one license may not be activated from many IPs in a loop.
    const keyLimited = enforceRateLimit(context.request, {
      route: "license/activate:key",
      key,
      limit: 20,
      windowSeconds: 3600,
    });
    if (keyLimited) return keyLimited;

    // Find license
    const license = await db
      .prepare("SELECT * FROM licenses WHERE license_key = ?")
      .bind(key)
      .first<{
        id: number;
        status: string;
        hwid: string | null;
        duration_days: number | null;
        activated_at: string | null;
        expires_at: string | null;
        type: string;
        max_uses: number;
      }>();

    if (!license) return error(404, "Invalid license key.");
    if (license.status === "revoked") return error(403, "License is revoked.");
    if (license.status === "expired") return error(403, "License is expired.");

    // Check expiration once the clock has started: bound, or activated before and released since.
    if (
      (license.hwid || license.activated_at) &&
      license.expires_at &&
      new Date(license.expires_at) < new Date()
    ) {
      await db
        .prepare("UPDATE licenses SET status = 'expired' WHERE id = ?")
        .bind(license.id)
        .run();
      return error(403, "License has expired.");
    }

    const now = nowIso();

    // Check if HWID is already bound
    const boundHwids = license.hwid ? license.hwid.split(",").map((h) => h.trim()) : [];

    if (!boundHwids.includes(hwid)) {
      // It's a new HWID, check limits
      if (license.max_uses !== -1 && boundHwids.length >= license.max_uses) {
        return error(403, "License has reached its maximum number of uses.");
      }

      // Bind the new HWID
      boundHwids.push(hwid);
      const newHwidsStr = boundHwids.join(",");
      const newUsageCount = boundHwids.length;

      let expiresAt = license.expires_at;
      // The clock starts on the very FIRST activation only. After an admin released the PC
      // (admin/licenses/:key/release) the key is unbound again, and re-activating it on the new PC
      // must keep the original end date, not grant a fresh term.
      if (
        boundHwids.length === 1 &&
        license.duration_days &&
        !(license.activated_at && license.expires_at)
      ) {
        const date = new Date();
        date.setTime(date.getTime() + license.duration_days * 24 * 60 * 60 * 1000);
        expiresAt = date.toISOString();
      }

      // Guarded on the list just read: a concurrent activation or an admin release in between must
      // not be overwritten (that could re-bind a released PC or slip past the seat limit).
      const update = await db
        .prepare(
          "UPDATE licenses SET hwid = ?, usage_count = ?, activated_at = COALESCE(activated_at, ?), expires_at = ?, status = 'active' WHERE id = ? AND COALESCE(hwid, '') = ?",
        )
        .bind(newHwidsStr, newUsageCount, now, expiresAt, license.id, license.hwid ?? "")
        .run();
      if ((update.meta?.changes ?? 0) !== 1) {
        return error(409, "The license changed while activating. Please try again.");
      }

      return json({
        ok: true,
        message: "License activated.",
        expires_at: expiresAt,
        type: license.type,
      });
    }

    return json({
      ok: true,
      message: "License is active.",
      expires_at: license.expires_at,
      type: license.type,
    });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
