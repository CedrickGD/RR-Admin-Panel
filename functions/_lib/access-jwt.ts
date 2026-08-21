import type { RuntimeEnv } from "./types";

/**
 * Cloudflare Access application-token verification.
 *
 * Access puts a signed JWT into `cf-access-jwt-assertion` on every request it lets through.
 * Verifying it in code (signature against the team JWKS, issuer, audience, validity window)
 * means a misconfigured Access policy or a bypass path can never turn a spoofed
 * `cf-access-authenticated-user-email` header into dashboard access.
 */

export interface AccessJwks {
  keys: Array<{ kid: string; kty: "RSA"; n: string; e: string; alg?: string }>;
}

export type AccessJwtFailureReason =
  | "malformed"
  | "unsupported_alg"
  | "unknown_kid"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "bad_issuer"
  | "bad_audience"
  | "no_email";

export type AccessJwtVerdict =
  | { ok: true; email: string; sub: string | null }
  | { ok: false; reason: AccessJwtFailureReason };

export type AccessJwksFetcher = (teamDomain: string) => Promise<AccessJwks>;

export interface VerifyAccessJwtOptions {
  /** Team domain without scheme, e.g. `rr-adminpanel.cloudflareaccess.com`. */
  teamDomain: string;
  /** AUD tags of every Access application that may front this deployment. */
  audiences: string[];
  nowSeconds?: () => number;
  /** Replace the network JWKS lookup (tests); the default fetcher caches per isolate. */
  fetchJwks?: AccessJwksFetcher;
}

export interface AccessIdentityDeps {
  nowSeconds?: () => number;
  fetchJwks?: AccessJwksFetcher;
}

export type AccessIdentityResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 500; message: string };

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
/** An unknown `kid` triggers one early re-fetch, but never more often than this. */
const JWKS_REFRESH_COOLDOWN_MS = 60 * 1000;
const RSA_VERIFY_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface JwksCacheEntry {
  jwks: AccessJwks;
  fetchedAt: number;
}

const jwksCache = new Map<string, JwksCacheEntry>();

export function parseAudiences(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export async function verifyAccessJwt(
  token: string,
  opts: VerifyAccessJwtOptions,
): Promise<AccessJwtVerdict> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return fail("malformed");
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = decodeJsonObject(headerPart);
  if (!header) {
    return fail("malformed");
  }
  if (header.alg !== "RS256") {
    return fail("unsupported_alg");
  }
  const kid = header.kid;
  if (typeof kid !== "string" || kid.length === 0) {
    return fail("malformed");
  }

  const payload = decodeJsonObject(payloadPart);
  if (!payload) {
    return fail("malformed");
  }
  const signature = base64UrlDecode(signaturePart);
  if (!signature || signature.length === 0) {
    return fail("malformed");
  }

  const nowSeconds = opts.nowSeconds ?? defaultNowSeconds;
  const now = nowSeconds();
  const signingKey = await resolveSigningKey(opts.teamDomain, kid, opts.fetchJwks, now * 1000);
  if (!signingKey) {
    return fail("unknown_kid");
  }

  if (!(await verifyRs256(signingKey, signature, `${headerPart}.${payloadPart}`))) {
    return fail("bad_signature");
  }

  if (payload.iss !== `https://${opts.teamDomain}`) {
    return fail("bad_issuer");
  }
  if (!audienceMatches(payload.aud, opts.audiences)) {
    return fail("bad_audience");
  }
  if (!isFiniteNumber(payload.exp)) {
    return fail("malformed");
  }
  if (payload.exp <= now) {
    return fail("expired");
  }
  if (payload.nbf !== undefined) {
    if (!isFiniteNumber(payload.nbf)) {
      return fail("malformed");
    }
    if (payload.nbf > now) {
      return fail("not_yet_valid");
    }
  }
  if (typeof payload.email !== "string" || payload.email.trim().length === 0) {
    return fail("no_email");
  }

  return {
    ok: true,
    email: payload.email,
    sub: typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null,
  };
}

/**
 * Resolves the verified Access identity for a dashboard request.
 * 500 when the deployment is not configured for verification, 401 when the token is missing or
 * does not verify; the returned email is trimmed and lower-cased.
 */
export async function resolveAccessIdentity(
  request: Request,
  env: RuntimeEnv,
  deps: AccessIdentityDeps = {},
): Promise<AccessIdentityResult> {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audiences = parseAudiences(env.ACCESS_AUD);
  if (!teamDomain || audiences.length === 0) {
    return { ok: false, status: 500, message: "Access verification is not configured." };
  }

  const token = request.headers.get(ACCESS_JWT_HEADER)?.trim();
  if (!token) {
    return { ok: false, status: 401, message: "Cloudflare Access identity is required." };
  }

  let verdict: AccessJwtVerdict;
  try {
    verdict = await verifyAccessJwt(token, {
      teamDomain,
      audiences,
      nowSeconds: deps.nowSeconds,
      fetchJwks: deps.fetchJwks,
    });
  } catch (cause) {
    console.error("access_jwks_unavailable", {
      teamDomain,
      message: cause instanceof Error ? cause.message : String(cause),
    });
    return {
      ok: false,
      status: 500,
      message: "Unable to verify the Cloudflare Access identity.",
    };
  }

  if (!verdict.ok) {
    return { ok: false, status: 401, message: "Cloudflare Access token is invalid." };
  }

  return { ok: true, email: verdict.email.trim().toLowerCase() };
}

export function resetAccessJwksCacheForTests(): void {
  jwksCache.clear();
}

function fail(reason: AccessJwtFailureReason): AccessJwtVerdict {
  return { ok: false, reason };
}

function defaultNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeTeamDomain(raw: string | undefined): string {
  return (raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function audienceMatches(claim: unknown, audiences: string[]): boolean {
  if (audiences.length === 0) {
    return false;
  }
  const tokenAudiences = typeof claim === "string" ? [claim] : Array.isArray(claim) ? claim : [];
  return tokenAudiences.some(
    (candidate) => typeof candidate === "string" && audiences.includes(candidate),
  );
}

async function verifyRs256(
  key: AccessJwks["keys"][number],
  signature: Uint8Array,
  signingInput: string,
): Promise<boolean> {
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: key.n, e: key.e },
      RSA_VERIFY_ALGORITHM,
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      RSA_VERIFY_ALGORITHM.name,
      cryptoKey,
      signature as unknown as BufferSource,
      encoder.encode(signingInput) as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}

async function resolveSigningKey(
  teamDomain: string,
  kid: string,
  fetchJwks: AccessJwksFetcher | undefined,
  nowMs: number,
): Promise<AccessJwks["keys"][number] | null> {
  if (fetchJwks) {
    return findKey(await fetchJwks(teamDomain), kid);
  }

  const cached = await loadCachedJwks(teamDomain, nowMs);
  const found = findKey(cached.jwks, kid);
  if (found) {
    return found;
  }

  // Key rotation: allow one early refresh, but rate-limit it so a flood of bogus kids cannot
  // turn into a flood of JWKS sub-requests.
  if (nowMs - cached.fetchedAt < JWKS_REFRESH_COOLDOWN_MS) {
    return null;
  }
  const refreshed = await storeFetchedJwks(teamDomain, nowMs);
  return findKey(refreshed.jwks, kid);
}

function findKey(jwks: AccessJwks, kid: string): AccessJwks["keys"][number] | null {
  return jwks.keys.find((key) => key.kid === kid) ?? null;
}

async function loadCachedJwks(teamDomain: string, nowMs: number): Promise<JwksCacheEntry> {
  const entry = jwksCache.get(teamDomain);
  if (entry && nowMs - entry.fetchedAt < JWKS_CACHE_TTL_MS && nowMs >= entry.fetchedAt) {
    return entry;
  }
  return storeFetchedJwks(teamDomain, nowMs);
}

async function storeFetchedJwks(teamDomain: string, nowMs: number): Promise<JwksCacheEntry> {
  const entry: JwksCacheEntry = { jwks: await fetchTeamJwks(teamDomain), fetchedAt: nowMs };
  jwksCache.set(teamDomain, entry);
  return entry;
}

async function fetchTeamJwks(teamDomain: string): Promise<AccessJwks> {
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Access JWKS request failed with status ${response.status}.`);
  }

  const body = (await response.json()) as { keys?: unknown };
  if (!body || !Array.isArray(body.keys)) {
    throw new Error("Access JWKS response has no keys array.");
  }

  const keys: AccessJwks["keys"] = [];
  for (const candidate of body.keys) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { kty?: unknown }).kty === "RSA" &&
      typeof (candidate as { kid?: unknown }).kid === "string" &&
      typeof (candidate as { n?: unknown }).n === "string" &&
      typeof (candidate as { e?: unknown }).e === "string"
    ) {
      const key = candidate as { kid: string; n: string; e: string; alg?: unknown };
      keys.push({
        kid: key.kid,
        kty: "RSA",
        n: key.n,
        e: key.e,
        alg: typeof key.alg === "string" ? key.alg : undefined,
      });
    }
  }
  return { keys };
}

function decodeJsonObject(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlDecode(segment);
  if (!bytes) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlDecode(raw: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(raw)) {
    return null;
  }
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
