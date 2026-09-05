import { requireDashboardAccess } from "../../_lib/admin";
import { error, json, readJsonBody } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { ensurePanelSchema } from "../../_lib/panel-access";
import type { RuntimeEnv } from "../../_lib/types";
import { validateAppearance } from "../../../shared/appearance";
export async function onRequest({ request, env }: { request: Request; env: RuntimeEnv }) {
  if (!["GET", "PUT"].includes(request.method)) return error(405, "Use GET or PUT.");
  const auth = await requireDashboardAccess(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return error(503, "Account settings storage is unavailable.");
  try {
    await ensurePanelSchema(env);
    const email = auth.access.user.email.toLowerCase();
    if (request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT appearance_json FROM panel_preferences WHERE email = ?",
      )
        .bind(email)
        .first<{ appearance_json: string }>();
      return json({ ok: true, appearance: row ? JSON.parse(row.appearance_json) : null });
    }
    let appearance;
    try {
      appearance = validateAppearance(await readJsonBody(request, 1900000));
    } catch {
      return error(400, "Invalid appearance settings or background image.");
    }
    await env.DB.prepare(
      "INSERT INTO panel_preferences (email,appearance_json,updated_at) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET appearance_json=excluded.appearance_json,updated_at=excluded.updated_at",
    )
      .bind(email, JSON.stringify(appearance), new Date().toISOString())
      .run();
    return json({ ok: true });
  } catch (err) {
    return internalError(request, "Unable to save account appearance.", err);
  }
}
