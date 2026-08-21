import { error, json } from "../_lib/http";
import { internalError } from "../_lib/responses";
import { loadHealth } from "../_lib/storage";
import type { RuntimeEnv } from "../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  try {
    const health = await loadHealth(context.env);
    return json(health);
  } catch (healthError) {
    return internalError(context.request, "Unable to complete the request.", healthError);
  }
}
