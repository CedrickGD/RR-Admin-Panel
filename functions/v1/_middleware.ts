// Runs before every functions/v1/** route (legacy telemetry). Same proxy-mode switch as
// functions/api/_middleware.ts.
import { proxyOrNext, type ProxyMiddlewareContext } from "../_lib/proxy-middleware";

export async function onRequest(context: ProxyMiddlewareContext): Promise<Response> {
  return proxyOrNext(context);
}
