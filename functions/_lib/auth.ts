import type { RuntimeEnv, SessionClaims } from "./types";

const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface ParsedAdminHash {
  iterations: number;
  salt: Uint8Array;
  digest: Uint8Array;
}

export async function verifyAdminKey(adminKey: string, storedHash: string | undefined): Promise<boolean> {
  if (!storedHash || !adminKey) {
    return false;
  }

  const parsed = parseAdminHash(storedHash);
  if (!parsed) {
    return false;
  }

  const candidate = await derivePbkdf2(adminKey, parsed.salt, parsed.iterations);
  return timingSafeEqualBytes(candidate, parsed.digest);
}

export async function createAdminSessionToken(secret: string | undefined, email: string | null): Promise<{ token: string; expiresAt: string }> {
  if (!secret) {
    throw new Error("JWT_SECRET is missing.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: "admin",
    scope: "admin",
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
    email
  };

  const headerEncoded = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadEncoded = base64UrlEncode(JSON.stringify(claims));
  const signed = `${headerEncoded}.${payloadEncoded}`;
  const signature = await signHs256(signed, secret);
  const token = `${signed}.${base64UrlEncodeBytes(signature)}`;
  return {
    token,
    expiresAt: new Date(claims.exp * 1000).toISOString()
  };
}

export async function verifyAdminSessionToken(token: string | null, env: RuntimeEnv): Promise<SessionClaims | null> {
  if (!token || !env.JWT_SECRET) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const signed = `${headerPart}.${payloadPart}`;
  const expected = await signHs256(signed, env.JWT_SECRET);
  const actual = base64UrlDecode(signaturePart);
  if (!actual || !timingSafeEqualBytes(expected, actual)) {
    return null;
  }

  const payloadRaw = base64UrlDecodeToString(payloadPart);
  if (!payloadRaw) {
    return null;
  }

  let payload: SessionClaims;
  try {
    payload = JSON.parse(payloadRaw) as SessionClaims;
  } catch {
    return null;
  }

  if (payload.sub !== "admin" || payload.scope !== "admin") {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function parseAdminHash(raw: string): ParsedAdminHash | null {
  const parts = raw.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
    return null;
  }

  const iterations = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(iterations) || iterations < 50_000) {
    return null;
  }

  const salt = base64Decode(parts[3]);
  const digest = base64Decode(parts[4]);
  if (!salt || !digest) {
    return null;
  }

  return { iterations, salt, digest };
}

async function derivePbkdf2(value: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(value), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      iterations
    },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

async function signHs256(message: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(signature);
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftByte = index < left.length ? left[index] : 0;
    const rightByte = index < right.length ? right[index] : 0;
    mismatch |= leftByte ^ rightByte;
  }
  return mismatch === 0;
}

function base64Decode(raw: string): Uint8Array | null {
  try {
    const normalized = raw.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    return output;
  } catch {
    return null;
  }
}

function base64UrlDecode(raw: string): Uint8Array | null {
  return base64Decode(raw);
}

function base64UrlDecodeToString(raw: string): string | null {
  const bytes = base64UrlDecode(raw);
  if (!bytes) {
    return null;
  }
  return new TextDecoder().decode(bytes);
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(encoder.encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
