// Proxy mode (W3.7): the standalone worker and the Pages Functions keep their URLs but forward
// API traffic to rr-api on the NAS over the Cloudflare Tunnel hostname and return its response.
// Runtime-agnostic (Web platform only): imported by backend-worker/index.js, the Pages
// middlewares (functions/api/_middleware.ts, functions/v1/_middleware.ts), rr-api and tests.
// Contract: docs/superpowers/specs/2026-08-21-proxy-shells.md.

import { base64UrlEncode } from "./install-auth";

export interface OriginProxyConfig {
  /** e.g. `https://origin.razorreaper.app` (trailing slashes are ignored). */
  originBase: string;
  /** Shared secret rr-api checks on the origin hostname (`X-RR-Origin-Key`). */
  originKey: string;
  /** Upstream timeout; default {@link DEFAULT_ORIGIN_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export const DEFAULT_ORIGIN_TIMEOUT_MS = 15_000;

export const ORIGIN_KEY_HEADER = "x-rr-origin-key";
export const CLIENT_IP_HEADER = "x-rr-client-ip";
export const CLIENT_CF_HEADER = "x-rr-client-cf";
export const FORWARDED_HOST_HEADER = "x-rr-forwarded-host";
export const FORWARDED_PROTO_HEADER = "x-rr-forwarded-proto";

/** Every header the proxy adds; rr-api strips them all before a handler runs. */
export const FORWARDING_HEADERS: readonly string[] = [
  ORIGIN_KEY_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_CF_HEADER,
  FORWARDED_HOST_HEADER,
  FORWARDED_PROTO_HEADER,
];

/** `request.cf` keys that travel to rr-api inside `X-RR-Client-CF` (base64url JSON). */
export const CLIENT_CF_KEYS: readonly string[] = [
  "country",
  "city",
  "region",
  "regionCode",
  "postalCode",
  "latitude",
  "longitude",
  "timezone",
  "continent",
  "colo",
  "asn",
  "asOrganization",
];

export const ORIGIN_UNAVAILABLE_MESSAGE = "Backend temporarily unavailable.";

// Request headers that never cross to the origin: connection/hop-by-hop headers, everything the
// edge derived for THIS hop (cf-*, x-forwarded-*, x-real-ip, host) and the forwarding headers
// themselves (a client must not be able to pre-fill them). `cf-access-*` is the exception: Access
// sets those on the Pages request and rr-api verifies the JWT itself.
const DROPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "x-real-ip",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-connection",
  ...FORWARDING_HEADERS,
]);
const DROPPED_REQUEST_HEADER_PREFIXES: readonly string[] = ["cf-", "x-forwarded-"];
const KEPT_REQUEST_HEADER_PREFIXES: readonly string[] = ["cf-access-"];

// Response headers the runtime owns (hop-by-hop) or recomputes (length/encoding).
const DROPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "content-length",
  "content-encoding",
]);

type RequestWithCf = Request & { cf?: Record<string, unknown> | null };

const encoder = new TextEncoder();

function readNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Proxy mode is ON iff `ORIGIN_BASE` and `ORIGIN_KEY` are both non-empty strings. */
export function isProxyModeEnabled(env: { ORIGIN_BASE?: unknown; ORIGIN_KEY?: unknown }): boolean {
  return readOriginProxyConfig(env) !== null;
}

/** The proxy config read from the runtime env, or `null` when proxy mode is OFF. */
export function readOriginProxyConfig(env: {
  ORIGIN_BASE?: unknown;
  ORIGIN_KEY?: unknown;
}): OriginProxyConfig | null {
  const originBase = readNonEmpty(env?.ORIGIN_BASE);
  const originKey = readNonEmpty(env?.ORIGIN_KEY);
  if (originBase === null || originKey === null) {
    return null;
  }
  return { originBase: originBase.replace(/\/+$/, ""), originKey };
}

/** True when the proxy must not forward this request header to the origin. */
export function isDroppedRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (KEPT_REQUEST_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return false;
  }
  if (DROPPED_REQUEST_HEADERS.has(lower)) {
    return true;
  }
  return DROPPED_REQUEST_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** `{}` when `request.cf` is absent; otherwise the whitelisted keys that are present. */
export function readClientCf(request: Request): Record<string, unknown> {
  const cf = (request as RequestWithCf).cf;
  const picked: Record<string, unknown> = {};
  if (typeof cf !== "object" || cf === null) {
    return picked;
  }
  for (const key of CLIENT_CF_KEYS) {
    const value = cf[key];
    if (value !== undefined && value !== null) {
      picked[key] = value;
    }
  }
  return picked;
}

export function encodeClientCf(cf: Record<string, unknown>): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(cf)));
}

/**
 * Pure: the outgoing origin request for `request` — same path + query (byte-for-byte), same
 * method and body, filtered headers plus the `X-RR-*` forwarding headers.
 */
export function buildOriginRequest(request: Request, cfg: OriginProxyConfig): Request {
  const url = new URL(request.url);
  const target = `${cfg.originBase.replace(/\/+$/, "")}${url.pathname}${url.search}`;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!isDroppedRequestHeader(name)) {
      headers.append(name, value);
    }
  }
  headers.set(ORIGIN_KEY_HEADER, cfg.originKey);
  headers.set(CLIENT_IP_HEADER, request.headers.get("cf-connecting-ip")?.trim() ?? "");
  headers.set(CLIENT_CF_HEADER, encodeClientCf(readClientCf(request)));
  headers.set(FORWARDED_HOST_HEADER, url.host);
  headers.set(FORWARDED_PROTO_HEADER, "https");

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  // `duplex` is what Node's fetch needs for a streamed body; the Workers runtime ignores it.
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(target, init);
}

/** The origin response re-wrapped for the client: status + body, minus runtime-owned headers. */
export function buildClientResponse(upstream: Response): Response {
  const headers = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) {
    headers.delete(name);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

function unavailableResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: ORIGIN_UNAVAILABLE_MESSAGE }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function redactedMessage(err: unknown, cfg: OriginProxyConfig): string {
  let message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  for (const secret of [cfg.originKey, cfg.originBase]) {
    if (secret) {
      message = message.split(secret).join("[redacted]");
    }
  }
  return message;
}

/**
 * Forwards `request` to the origin and returns its response (any status, including 4xx/5xx).
 * Network errors and the timeout answer `503 { ok: false, error: "Backend temporarily
 * unavailable." }`; the log line never contains the origin URL or key. Never adds CORS headers.
 */
export async function proxyToOrigin(
  request: Request,
  cfg: OriginProxyConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_ORIGIN_TIMEOUT_MS;
  try {
    const upstream = await fetchImpl(buildOriginRequest(request, cfg), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return buildClientResponse(upstream);
  } catch (err) {
    console.error("origin_proxy_failed", { message: redactedMessage(err, cfg) });
    return unavailableResponse();
  }
}
