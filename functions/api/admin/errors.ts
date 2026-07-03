import { requireDashboardAccess } from "../../_lib/admin";
import { loadErrorsByUser, parseErrorsRange } from "../../_lib/errors";
import { error, json } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) {
      return access.response;
    }

    const range = parseErrorsRange(new URL(context.request.url));
    const errors = await loadErrorsByUser(context.env, range);

    return json({ ok: true, errors });
  } catch (errorsError) {
    return error(500, "Failed to load the errors rollup.", errorsError instanceof Error ? errorsError.message : null);
  }
}
