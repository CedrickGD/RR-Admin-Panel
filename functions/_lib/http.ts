import type { RuntimeEnv } from "./types";

const encoder = new TextEncoder();

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(headers ?? {}),
    },
  });
}

export function error(
  status: number,
  message: string,
  details?: unknown,
  headers?: HeadersInit,
): Response {
  return json(
    {
      ok: false,
      error: message,
      details: details ?? null,
    },
    status,
    headers,
  );
}

export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token.trim();
}

export function timingSafeEqualText(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftByte = index < leftBytes.length ? leftBytes[index] : 0;
    const rightByte = index < rightBytes.length ? rightBytes[index] : 0;
    mismatch |= leftByte ^ rightByte;
  }

  return mismatch === 0;
}

export async function readJsonBody<T>(request: Request, maxBytes = 16 * 1024): Promise<T> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const contentLength = Number.parseInt(declared, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Payload exceeds ${maxBytes} bytes.`);
    }
  }

  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maxBytes) {
    throw new Error(`Payload exceeds ${maxBytes} bytes.`);
  }

  if (!raw.trim()) {
    throw new Error("Request body is required.");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Invalid JSON.");
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Cloudflare Pages hands dynamic route params ([key]) through still URL-encoded, so a master
// key like "owner license key" arrives as "owner%20license%20key" and never matches the value
// stored in D1. Decode before querying. decodeURIComponent is a safe no-op for already-decoded
// values (a literal space stays a space); the try/catch tolerates a stray "%" in a key.
export function decodeKeyParam(raw: string | undefined | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Unverified identity taken from the Access headers. Only the app-auth mode
 * (`ACCESS_ENFORCEMENT`) may use this as a best-effort signal; `AUTH_MODE=access` must go
 * through `resolveAccessIdentity` (verified JWT) instead.
 */
export function getAccessIdentity(request: Request, env: RuntimeEnv): string | null {
  const emailHeader = request.headers.get("cf-access-authenticated-user-email");
  const jwtHeader = request.headers.get("cf-access-jwt-assertion");
  void env;

  if (emailHeader) {
    return emailHeader;
  }

  if (jwtHeader) {
    return "access-jwt-assertion";
  }

  return null;
}

export function parseAccessAllowList(env: RuntimeEnv): string[] {
  const rawAllowed = env.ACCESS_ALLOWED_EMAIL?.trim();
  if (!rawAllowed) {
    return [];
  }

  return rawAllowed
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

/** Fails closed: an empty allow-list allows nobody. */
export function isAllowedAccessIdentity(identity: string, env: RuntimeEnv): boolean {
  const allowedIdentities = parseAccessAllowList(env);
  if (allowedIdentities.length === 0) {
    return false;
  }

  return allowedIdentities.includes(identity.trim().toLowerCase());
}

/** 403 response when `identity` may not use the dashboard, `null` when it may. */
export function enforceAccessAllowList(identity: string, env: RuntimeEnv): Response | null {
  if (parseAccessAllowList(env).length === 0) {
    return error(403, "Access allow-list is empty.");
  }
  if (!isAllowedAccessIdentity(identity, env)) {
    return error(403, "Access identity is not allowed.");
  }
  return null;
}
