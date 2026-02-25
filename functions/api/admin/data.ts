import { error, getAccessIdentity, isAllowedAccessIdentity, json } from "../../_lib/http";
import { loadHealth, loadSummary } from "../../_lib/storage";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  const accessIdentity = getAccessIdentity(context.request, context.env);
  if (!accessIdentity) {
    return error(401, "Cloudflare Access identity is required.");
  }
  if (!isAllowedAccessIdentity(accessIdentity, context.env)) {
    return error(403, "Access identity is not allowed.");
  }

  try {
    const [summary, health] = await Promise.all([loadSummary(context.env), loadHealth(context.env)]);

    return json({
      ok: true,
      summary,
      health,
      accessIdentity,
      sessionExpiresAt: null
    });
  } catch (dataError) {
    return error(500, "Failed to load protected admin data.", dataError instanceof Error ? dataError.message : null);
  }
}
