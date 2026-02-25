import { clearSessionCookie } from "../../_lib/auth";
import { error, json } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }

  return json(
    {
      ok: true,
      loggedOut: true
    },
    200,
    {
      "set-cookie": clearSessionCookie(context.request, context.env.AUTH_SESSION_COOKIE)
    }
  );
}
