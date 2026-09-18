import { requireDashboardAccess, resolveAuthMode } from "../../_lib/admin";
import { error, json } from "../../_lib/http";
import { internalError } from "../../_lib/responses";
import { countUsers, ensureAuthSchema } from "../../_lib/users";
import type { RuntimeEnv } from "../../_lib/types";
/**
 * The gate's own words for a 403, or null. Status codes stay as they are (403 vs 401 is a
 * deliberate distinction, see the comment in _lib/admin.ts) — this only carries the sentence
 * out to a screen that can show it. A 401 means "not signed in", which the sign-in card
 * already says better than any server string.
 */
async function deniedReason(response: Response): Promise<string | null> {
  if (response.status !== 403) return null;
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    return typeof body.error === "string" && body.error ? body.error : null;
  } catch {
    return null;
  }
}
export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env: RuntimeEnv;
}): Promise<Response> {
  if (request.method !== "GET") return error(405, "Use GET.");
  const authMode = resolveAuthMode(env);
  try {
    let hasUsers = true;
    if (authMode === "app") {
      await ensureAuthSchema(env);
      hasUsers = (await countUsers(env)) > 0;
    }
    const access = await requireDashboardAccess(request, env);
    if (!access.ok) {
      if (access.response.status >= 500) return access.response;
      // Cloudflare Access signs the person in and the panel then refuses them: without this
      // the SPA only learned "not authenticated" and showed its generic sign-in card, so the
      // reason the gate had already written never reached the one person it was written for.
      const reason = await deniedReason(access.response);
      return json({ ok: true, authenticated: false, hasUsers, authMode, reason });
    }
    return json({ ok: true, authenticated: true, hasUsers, authMode, user: access.access.user });
  } catch (err) {
    return internalError(request, "Unable to verify panel access.", err);
  }
}
