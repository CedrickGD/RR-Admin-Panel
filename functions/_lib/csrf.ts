import { error } from "./http";

/**
 * Same-origin guard for state-changing dashboard requests.
 *
 * The dashboard talks to its own origin with JSON bodies, so a cross-site request (classic CSRF
 * via a form post or a fetch from another site) is recognisable by `Sec-Fetch-Site`, by an
 * `Origin` that does not match, or by a body that is not JSON (HTML forms cannot send one).
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

/** Returns a 403/415 response when the mutation must be refused, `null` when it may proceed. */
export function enforceSameOriginMutation(request: Request): Response | null {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    return error(403, "Cross-site request blocked.");
  }

  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    const originHost = parseHost(origin);
    const requestHost = parseHost(request.url);
    if (!originHost || !requestHost || originHost !== requestHost) {
      return error(403, "Cross-site request blocked.");
    }
  }

  if (hasRequestBody(request) && !isJsonContentType(request.headers.get("content-type"))) {
    return error(415, "Content-Type must be application/json.");
  }

  return null;
}

function parseHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function hasRequestBody(request: Request): boolean {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const contentLength = Number.parseInt(declared, 10);
    if (Number.isFinite(contentLength)) {
      return contentLength > 0;
    }
  }
  if (request.headers.has("transfer-encoding")) {
    return true;
  }
  // Runtimes that do not synthesize content-length (Node's Request) still expose the body stream.
  return request.body !== null;
}

function isJsonContentType(contentType: string | null): boolean {
  return (contentType ?? "").trim().toLowerCase().startsWith("application/json");
}
