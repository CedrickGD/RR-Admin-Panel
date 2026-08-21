// Trusted forwarding (W3.7): the proxy shells (standalone worker, Pages middleware) reach rr-api
// on the tunnel hostname ORIGIN_HOST with `X-RR-Origin-Key` and hand over the real client's ip
// (`X-RR-Client-IP`) and geo (`X-RR-Client-CF`, base64url JSON of the whitelisted request.cf
// keys). A request that presents the right key is TRUSTED: its cf-connecting-ip and cf object
// become the forwarded client's. Everything else keeps the tunnel values, and the X-RR-*
// forwarding headers are always stripped so a handler never sees them.
// Contract: docs/superpowers/specs/2026-08-21-proxy-shells.md.
import { isIP } from "node:net";

import { timingSafeEqualText } from "../../../../functions/_lib/http";
import { base64UrlDecode } from "../../../../shared/install-auth";
import {
  CLIENT_CF_HEADER,
  CLIENT_CF_KEYS,
  CLIENT_IP_HEADER,
  FORWARDING_HEADERS,
  ORIGIN_KEY_HEADER,
} from "../../../../shared/origin-proxy";
import type { CloudflareRequestProperties } from "./cf-request";

export const UNAUTHORIZED_ORIGIN_MESSAGE = "Unauthorized origin request.";
/** The container healthcheck hits this path on ORIGIN_HOST without a key. */
export const HOST_CHECK_EXEMPT_PATHS: ReadonlySet<string> = new Set(["/health"]);
const MAX_CF_VALUE_LENGTH = 128;

const decoder = new TextDecoder();

export interface TrustedForwardingOptions {
  /** `ORIGIN_KEY`; empty/unset = trusted forwarding disabled (headers are still stripped). */
  originKey?: string | undefined;
  /** `ORIGIN_HOST`; when set, requests on that host must be trusted (except `/health`). */
  originHost?: string | undefined;
}

export type TrustedForwardingResult =
  | {
      ok: true;
      /** Same method/url/body; forwarding headers stripped, cf-connecting-ip overridden if trusted. */
      request: Request;
      trusted: boolean;
      /** Client geo to overlay on the tunnel-derived `cf` (empty unless trusted). */
      cf: CloudflareRequestProperties;
    }
  | { ok: false; response: Response };

function unauthorized(): Response {
  return Response.json({ ok: false, error: UNAUTHORIZED_ORIGIN_MESSAGE }, { status: 401 });
}

function trimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Hostname (no port, lower-case) the request arrived on: `Host` as the tunnel delivers it,
 * `X-Forwarded-Host`, else the request URL (which @hono/node-server builds from Host/:authority).
 */
export function readRequestHost(request: Request): string {
  const raw =
    request.headers.get("host") ??
    request.headers.get("x-forwarded-host") ??
    safeUrlHost(request.url);
  const first = raw.split(",")[0]?.trim() ?? "";
  const withoutPort = first.startsWith("[")
    ? first.replace(/\]:\d+$/, "]")
    : first.replace(/:\d+$/, "");
  return withoutPort.toLowerCase();
}

function safeUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function safeUrlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Decoded, whitelisted client geo from `X-RR-Client-CF`; `{}` when absent or malformed. */
export function decodeClientCf(header: string | null): CloudflareRequestProperties {
  if (header === null || header.trim().length === 0) {
    return {};
  }
  const bytes = base64UrlDecode(header.trim());
  if (bytes === null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const source = parsed as Record<string, unknown>;
  const cf: Record<string, string> = {};
  for (const key of CLIENT_CF_KEYS) {
    const value = source[key];
    const text =
      typeof value === "string"
        ? value
        : typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : null;
    if (text !== null && text.length > 0 && text.length <= MAX_CF_VALUE_LENGTH) {
      cf[key] = text;
    }
  }
  return cf as CloudflareRequestProperties;
}

function hasForwardingHeaders(request: Request): boolean {
  return FORWARDING_HEADERS.some((name) => request.headers.has(name));
}

/** Same request minus the X-RR-* forwarding headers, with `cf-connecting-ip` optionally replaced. */
function rebuildRequest(request: Request, clientIp: string | null): Request {
  const headers = new Headers(request.headers);
  for (const name of FORWARDING_HEADERS) {
    headers.delete(name);
  }
  if (clientIp !== null) {
    headers.set("cf-connecting-ip", clientIp);
  }
  return new Request(request, { headers });
}

/**
 * Applies the origin-key / origin-host policy to an incoming request. Never reads the body.
 *
 * - key configured + header equal (timing-safe) -> trusted; wrong key -> 401.
 * - `ORIGIN_HOST` set, request on that host, not trusted -> 401 (`/health` exempt).
 * - otherwise the request passes with the forwarding headers stripped.
 */
export function applyTrustedForwarding(
  request: Request,
  options: TrustedForwardingOptions,
): TrustedForwardingResult {
  const originKey = trimmed(options.originKey);
  const originHost = trimmed(options.originHost).toLowerCase();
  const presentedKey = request.headers.get(ORIGIN_KEY_HEADER);

  let trusted = false;
  if (originKey.length > 0 && presentedKey !== null) {
    if (!timingSafeEqualText(presentedKey, originKey)) {
      return { ok: false, response: unauthorized() };
    }
    trusted = true;
  }

  if (originHost.length > 0 && !trusted && readRequestHost(request) === originHost) {
    if (!HOST_CHECK_EXEMPT_PATHS.has(safeUrlPathname(request.url))) {
      return { ok: false, response: unauthorized() };
    }
  }

  if (!trusted) {
    return {
      ok: true,
      request: hasForwardingHeaders(request) ? rebuildRequest(request, null) : request,
      trusted: false,
      cf: {},
    };
  }

  const forwardedIp = request.headers.get(CLIENT_IP_HEADER)?.trim() ?? "";
  const clientIp = isIP(forwardedIp) !== 0 ? forwardedIp : null;
  return {
    ok: true,
    request: rebuildRequest(request, clientIp),
    trusted: true,
    cf: decodeClientCf(request.headers.get(CLIENT_CF_HEADER)),
  };
}
