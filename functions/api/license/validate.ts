import { json, error } from "../../_lib/http";
import { parseJsonObject, requireInstallAuth } from "../../_lib/install-auth";
import { enforceRateLimit } from "../../_lib/ratelimit";
import type { RuntimeEnv } from "../../_lib/types";

export async function onRequestPost(context: { request: Request; env: RuntimeEnv }) {
  const limited = enforceRateLimit(context.request, {
    route: "license/validate",
    limit: 30,
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

    // Find license
    const license = await db
      .prepare("SELECT * FROM licenses WHERE license_key = ?")
      .bind(key)
      .first<{
        id: number;
        status: string;
        hwid: string | null;
        expires_at: string | null;
        type: string;
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

    // Must be activated first to use validate, or we can just say not activated.
    if (!license.hwid) {
      return error(403, "License not activated yet.");
    }

    // Verify HWID
    const boundHwids = license.hwid ? license.hwid.split(",").map((h) => h.trim()) : [];
    if (!boundHwids.includes(hwid)) {
      return error(403, "License is bound to another hardware ID.");
    }

    return json({
      ok: true,
      message: "License is valid.",
      expires_at: license.expires_at,
      type: license.type,
    });
  } catch (err) {
    return error(500, "Failed to validate license.", err instanceof Error ? err.message : null);
  }
}
