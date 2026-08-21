import type { AppSessionClaims, AppUserRole, RuntimeEnv, SessionClaims } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_SESSION_COOKIE = "rr_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_PBKDF2_ITERATIONS = 50_000;
const MAX_PBKDF2_ITERATIONS = 100_000;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 256;

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  digest: Uint8Array;
}

export function validatePasswordComplexity(password: string): string | null {
  if (typeof password !== "string") {
    return "Password must be a string.";
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export async function hashPassword(
  password: string,
  iterations = MAX_PBKDF2_ITERATIONS,
): Promise<string> {
  const complexityError = validatePasswordComplexity(password);
  if (complexityError) {
    throw new Error(complexityError);
  }

  const boundedIterations = clampIterations(iterations);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePbkdf2(password, salt, boundedIterations);
  return `pbkdf2$sha256$${boundedIterations}$${base64UrlEncodeBytes(salt)}$${base64UrlEncodeBytes(digest)}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | undefined,
): Promise<boolean> {
  if (!storedHash || !password) {
    return false;
  }

  const parsed = parseHash(storedHash.trim());
  if (!parsed) {
    return false;
  }

  try {
    const candidate = await derivePbkdf2(password, parsed.salt, parsed.iterations);
    return timingSafeEqualBytes(candidate, parsed.digest);
  } catch {
    return false;
  }
}

export async function createAppSessionToken(
  secret: string | undefined,
  email: string,
  role: AppUserRole,
): Promise<{ token: string; expiresAt: string }> {
  if (!secret) {
    throw new Error("JWT_SECRET is missing.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: AppSessionClaims = {
    sub: "rr-user",
    scope: "dashboard",
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
    email,
    role,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadEncoded = base64UrlEncode(JSON.stringify(claims));
  const signed = `${headerEncoded}.${payloadEncoded}`;
  const signature = await signHs256(signed, secret);
  const token = `${signed}.${base64UrlEncodeBytes(signature)}`;
  return {
    token,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export async function verifyAppSessionToken(
  token: string | null,
  env: RuntimeEnv,
): Promise<AppSessionClaims | null> {
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

  let payload: AppSessionClaims;
  try {
    payload = JSON.parse(payloadRaw) as AppSessionClaims;
  } catch {
    return null;
  }

  if (payload.sub !== "rr-user" || payload.scope !== "dashboard") {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (typeof payload.email !== "string" || payload.email.length === 0) {
    return null;
  }

  if (payload.role !== "admin" && payload.role !== "viewer") {
    return null;
  }

  return payload;
}

export function getSessionTokenFromCookie(request: Request, cookieName?: string): string | null {
  return getCookie(request, cookieName ?? DEFAULT_SESSION_COOKIE);
}

export function createSessionCookie(token: string, request: Request, cookieName?: string): string {
  const isSecure = new URL(request.url).protocol === "https:";
  const securePart = isSecure ? "; Secure" : "";
  const name = cookieName ?? DEFAULT_SESSION_COOKIE;
  return `${name}=${token}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${securePart}`;
}

export function clearSessionCookie(request: Request, cookieName?: string): string {
  const isSecure = new URL(request.url).protocol === "https:";
  const securePart = isSecure ? "; Secure" : "";
  const name = cookieName ?? DEFAULT_SESSION_COOKIE;
  return `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${securePart}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function verifyAdminKey(
  adminKey: string,
  storedHash: string | undefined,
): Promise<boolean> {
  return verifyPassword(adminKey, storedHash);
}

export async function createAdminSessionToken(
  secret: string | undefined,
  email: string | null,
): Promise<{ token: string; expiresAt: string }> {
  return createAppSessionToken(secret, email ?? "admin@example.invalid", "admin");
}

export async function verifyAdminSessionToken(
  token: string | null,
  env: RuntimeEnv,
): Promise<SessionClaims | null> {
  const claims = await verifyAppSessionToken(token, env);
  if (!claims || claims.role !== "admin") {
    return null;
  }

  return {
    sub: "admin",
    scope: "admin",
    iat: claims.iat,
    exp: claims.exp,
    email: claims.email,
  };
}

function getCookie(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const segments = cookieHeader.split(";");
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const name = trimmed.slice(0, index);
    if (name !== cookieName) {
      continue;
    }

    const value = trimmed.slice(index + 1);
    return value || null;
  }

  return null;
}

function clampIterations(iterations: number): number {
  if (!Number.isFinite(iterations)) {
    return MAX_PBKDF2_ITERATIONS;
  }
  return Math.min(MAX_PBKDF2_ITERATIONS, Math.max(MIN_PBKDF2_ITERATIONS, Math.floor(iterations)));
}

function parseHash(raw: string): ParsedHash | null {
  const parts = raw.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
    return null;
  }

  const iterations = Number.parseInt(parts[2], 10);
  if (
    !Number.isFinite(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    return null;
  }

  const salt = base64UrlDecode(parts[3]);
  const digest = base64UrlDecode(parts[4]);
  if (!salt || !digest) {
    return null;
  }

  if (salt.length < 8 || digest.length !== 32) {
    return null;
  }

  return { iterations, salt, digest };
}

async function derivePbkdf2(
  value: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(value),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      iterations,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

async function signHs256(message: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
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

function base64UrlDecode(raw: string): Uint8Array | null {
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

function base64UrlDecodeToString(raw: string): string | null {
  const bytes = base64UrlDecode(raw);
  if (!bytes) {
    return null;
  }

  return decoder.decode(bytes);
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
