import { ensureAccessSchema, findActiveSuspension, isSuspensionActive } from "../../_lib/access";
import { error, json, readJsonBody, nowIso } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Public, unauthenticated endpoint the desktop app polls to learn whether this machine's access
 * has been suspended or banned — same access model as /api/license/validate and
 * /api/announcements/active. Keyed by hwid (+ install_id fallback) so it covers FREE users too,
 * not just license holders. A clear-access response is `{ ok: true, suspended: false }`; the app
 * fails open on any network/5xx error, so this must only ever report a suspension it is certain of.
 */
export async function onRequestPost(context: HandlerContext): Promise<Response> {
  return handle(context);
}

// Accept GET too so the endpoint is trivially probeable and works from constrained callers.
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  return handle(context);
}

async function handle(context: HandlerContext): Promise<Response> {
  const db = context.env.DB;
  if (!db) return error(500, "Database not available");

  try {
    let hwid = "";
    let installId = "";

    if (context.request.method === "POST") {
      const body = await readJsonBody<{ hwid?: string; install_id?: string }>(context.request).catch(
        () => ({}) as { hwid?: string; install_id?: string },
      );
      hwid = (body.hwid ?? "").trim();
      installId = (body.install_id ?? "").trim();
    } else {
      const url = new URL(context.request.url);
      hwid = (url.searchParams.get("hwid") ?? "").trim();
      installId = (url.searchParams.get("install_id") ?? "").trim();
    }

    if (!hwid && !installId) {
      return error(400, "hwid or install_id is required.");
    }

    await ensureAccessSchema(context.env);

    const now = nowIso();
    const suspension = await findActiveSuspension(context.env, { hwid, installId });

    if (!isSuspensionActive(suspension, now)) {
      return json({ ok: true, suspended: false });
    }

    return json({
      ok: true,
      suspended: true,
      mode: suspension!.mode,
      reason: suspension!.reason,
      banned_until: suspension!.banned_until,
    });
  } catch (err) {
    return error(500, "Failed to resolve access status.", err instanceof Error ? err.message : null);
  }
}
