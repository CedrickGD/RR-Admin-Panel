// Minimal Pages-compatible matcher over the generated route table. Patterns use `:name` for
// `[name]` segments and `:name*` for `[[name]]` catch-alls; params stay RAW (still URL-encoded),
// exactly like Pages — the handlers call `decodeKeyParam` themselves.
import type { RuntimeEnv } from "../../../../functions/_lib/types";

export type PagesParams = Record<string, string | string[]>;

/**
 * What rr-api hands to a Pages handler. Only request/env/params are required in the type so the
 * per-file `HandlerContext` shapes (`params: { id: string }` etc.) stay assignable through the
 * method-shorthand bivariance of `GeneratedRoute.handler`; the app always fills every field.
 */
export interface PagesFunctionContext {
  request: Request;
  env: RuntimeEnv;
  params: PagesParams;
  data?: Record<string, unknown>;
  functionPath?: string;
  waitUntil?(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  next?(input?: Request | string, init?: RequestInit): Promise<Response>;
}

export interface GeneratedRoute {
  /** `null` = `onRequest` (every method); otherwise the upper-case HTTP method. */
  method: string | null;
  pattern: string;
  /** Method shorthand keeps the per-file `HandlerContext` types assignable (bivariant params). */
  handler(context: PagesFunctionContext): Response | Promise<Response>;
}

export interface RouteMatch {
  route: GeneratedRoute;
  params: PagesParams;
}

function splitPath(pathname: string): string[] {
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return [];
  return trimmed.slice(1).split("/");
}

export function matchPattern(pattern: string, pathname: string): PagesParams | null {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  const params: PagesParams = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]!;
    if (expected.startsWith(":") && expected.endsWith("*")) {
      params[expected.slice(1, -1)] = pathSegments.slice(index);
      return params;
    }
    const actual = pathSegments[index];
    if (actual === undefined) return null;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = actual;
      continue;
    }
    if (expected !== actual) return null;
  }

  return patternSegments.length === pathSegments.length ? params : null;
}

/** First route (in generated precedence order) whose pattern + method match. HEAD falls back to GET. */
export function matchRoute(
  routes: readonly GeneratedRoute[],
  method: string,
  pathname: string,
): RouteMatch | null {
  const upper = method.toUpperCase();
  let headFallback: RouteMatch | null = null;
  for (const route of routes) {
    const params = matchPattern(route.pattern, pathname);
    if (!params) continue;
    if (route.method === null || route.method === upper) {
      return { route, params };
    }
    if (upper === "HEAD" && route.method === "GET" && !headFallback) {
      headFallback = { route, params };
    }
  }
  return headFallback;
}
