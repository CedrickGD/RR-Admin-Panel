import { error } from "../_lib/http";
import type { RuntimeEnv } from "../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return error(405, "Method not allowed. Use GET.");
  }

  void context.env;
  return error(410, "Public summary endpoint is disabled. Use /api/admin/data.");
}
