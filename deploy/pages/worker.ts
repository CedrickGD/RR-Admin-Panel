import {
  ORIGIN_UNAVAILABLE_MESSAGE,
  proxyToOrigin,
  readOriginProxyConfig,
} from "../../shared/origin-proxy";

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface PagesProxyEnv {
  ASSETS: AssetsBinding;
  ORIGIN_BASE?: string;
  ORIGIN_KEY?: string;
}

function isBackendPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/v1" ||
    pathname.startsWith("/v1/")
  );
}

function originUnavailable(): Response {
  return Response.json(
    { ok: false, error: ORIGIN_UNAVAILABLE_MESSAGE },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

/**
 * Cloudflare Pages advanced-mode entry point.
 *
 * The Pages project is a thin shell after the NAS cut-over: backend routes are
 * forwarded to rr-api and everything else is served from the immutable asset
 * binding. Missing proxy configuration fails closed instead of silently serving
 * index.html for an API request (which otherwise looks like a logged-out user).
 */
export async function handlePagesRequest(
  request: Request,
  env: PagesProxyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!isBackendPath(pathname)) {
    return env.ASSETS.fetch(request);
  }

  const config = readOriginProxyConfig(env);
  if (!config) {
    return originUnavailable();
  }

  return proxyToOrigin(request, config, fetchImpl);
}

export default {
  fetch(request: Request, env: PagesProxyEnv): Promise<Response> {
    return handlePagesRequest(request, env);
  },
};
