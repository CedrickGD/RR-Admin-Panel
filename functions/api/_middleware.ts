// Runs before every functions/api/** route. Proxy mode forwards the request to rr-api; otherwise
// the file route handles it unchanged. See functions/_lib/proxy-middleware.ts.
import { proxyOrNext, type ProxyMiddlewareContext } from "../_lib/proxy-middleware";

export async function onRequest(context: ProxyMiddlewareContext): Promise<Response> {
  return proxyOrNext(context);
}
