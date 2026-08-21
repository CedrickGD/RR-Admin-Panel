import { requireDashboardAccess } from "../../../_lib/admin";
import { error, json } from "../../../_lib/http";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";
import { ensureInstallsSchema, listInstallsForHwid } from "../../../../shared/installs-store";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

// Same bounds the registration endpoint enforces on `hwid` (shared/install-auth):
// 1-64 characters, no whitespace, no control characters.
const HWID_PATTERN = /^[^\s\p{Cc}]{1,64}$/u;

/**
 * Admin: every registered install (rr.install.v1) of one device, newest first — the
 * "Installs" list inside an expanded user row. Keyed by `hwid` because that is the
 * identity the users rollup and the suspension records share.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const hwid = new URL(context.request.url).searchParams.get("hwid")?.trim() ?? "";
    if (!HWID_PATTERN.test(hwid)) {
      return error(400, "Missing or invalid hwid parameter.");
    }

    await ensureInstallsSchema(db);
    const installs = await listInstallsForHwid(db, hwid);

    return json({ ok: true, hwid, installs });
  } catch (err) {
    return internalError(context.request, "Unable to complete the request.", err);
  }
}
