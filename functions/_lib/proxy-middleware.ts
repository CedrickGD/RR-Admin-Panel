import { proxyToOrigin, readOriginProxyConfig } from "../../shared/origin-proxy";
import type { RuntimeEnv } from "./types";

/**
 * Pages middleware context (`functions/api/_middleware.ts`, `functions/v1/_middleware.ts`):
 * `next()` continues to the file route that matched.
 */
export interface ProxyMiddlewareContext {
  request: Request;
  env: RuntimeEnv;
  next: () => Promise<Response>;
}

/** Paths the Pages app keeps answering itself even in proxy mode. */
const LOCAL_PATHS: ReadonlySet<string> = new Set(["/api/health"]);

/**
 * Proxy mode (docs/superpowers/specs/2026-08-21-proxy-shells.md): with `ORIGIN_BASE` +
 * `ORIGIN_KEY` set, the request is forwarded to rr-api as-is — `cf-access-jwt-assertion` and
 * `cookie` travel with it, rr-api verifies the Access JWT itself. Otherwise (or for
 * `/api/health`) the matching file route runs exactly as before.
 */
export async function proxyOrNext(context: ProxyMiddlewareContext): Promise<Response> {
  const config = readOriginProxyConfig(context.env);
  if (config && !LOCAL_PATHS.has(new URL(context.request.url).pathname)) {
    return proxyToOrigin(context.request, config);
  }
  return context.next();
}
