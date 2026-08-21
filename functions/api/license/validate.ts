import { json, error, readJsonBody } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

export async function onRequestPost(context: { request: Request; env: RuntimeEnv }) {
  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  try {
    const body = await readJsonBody<{ license_key: string; hwid: string }>(context.request);
    if (!body.license_key || !body.hwid) {
      return error(400, "license_key and hwid are required.");
    }

    const key = body.license_key.trim();
    const hwid = body.hwid.trim();

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
