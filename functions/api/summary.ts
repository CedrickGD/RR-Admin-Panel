import { error, json } from "../_lib/http";
import { loadSummary } from "../_lib/storage";
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
    const summary = await loadSummary(context.env);
    return json(summary);
  } catch (summaryError) {
    return error(500, "Failed to load summary.", summaryError instanceof Error ? summaryError.message : null);
  }
}
