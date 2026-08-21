import { json, error, readJsonBody, nowIso } from "../../_lib/http";
import { enforceRateLimit } from "../../_lib/ratelimit";
import type { RuntimeEnv } from "../../_lib/types";

export async function onRequestPost(context: { request: Request; env: RuntimeEnv }) {
  const limited = enforceRateLimit(context.request, {
    route: "license/activate",
    limit: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  try {
    const body = await readJsonBody<{ license_key: string; hwid: string }>(context.request);
    if (!body.license_key || !body.hwid) {
      return error(400, "license_key and hwid are required.");
    }

    const key = body.license_key.trim();
    const hwid = body.hwid.trim();

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
        expires_at: string | null;
        type: string;
        max_uses: number;
      }>();

    if (!license) return error(404, "Invalid license key.");
    if (license.status === "revoked") return error(403, "License is revoked.");
    if (license.status === "expired") return error(403, "License is expired.");

    // Check expiration if already bound and has expiry
    if (license.hwid && license.expires_at && new Date(license.expires_at) < new Date()) {
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
      // If this is the FIRST binding, set expiration date if applicable
      if (boundHwids.length === 1 && license.duration_days) {
        const date = new Date();
        date.setTime(date.getTime() + license.duration_days * 24 * 60 * 60 * 1000);
        expiresAt = date.toISOString();
      }

      await db
        .prepare(
          "UPDATE licenses SET hwid = ?, usage_count = ?, activated_at = COALESCE(activated_at, ?), expires_at = ?, status = 'active' WHERE id = ?",
        )
        .bind(newHwidsStr, newUsageCount, now, expiresAt, license.id)
        .run();

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
    return error(500, "Failed to activate license.", err instanceof Error ? err.message : null);
  }
}
