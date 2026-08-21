import type { AccessJwks } from "../../functions/_lib/access-jwt";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { accessClaims, createAccessSigner, type AccessSigner } from "./access-token";

export interface SyntheticRequestOptions {
  method?: string;
  path?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: HeadersInit;
  json?: unknown;
}

const SYNTHETIC_ORIGIN = "https://admin.test";

export const TEST_ACCESS_TEAM_DOMAIN = "test.cloudflareaccess.com";
export const TEST_ACCESS_AUD = "aud-test";

let sharedSigner: Promise<AccessSigner> | null = null;

/** One RSA signer shared by every test file (key generation is the slow part). */
export function getTestAccessSigner(): Promise<AccessSigner> {
  sharedSigner ??= createAccessSigner("test-access-kid");
  return sharedSigner;
}

/** Env vars that make `requireDashboardAccess` trust tokens minted by the shared test signer. */
export function testAccessEnv(email: string, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return {
    ACCESS_TEAM_DOMAIN: TEST_ACCESS_TEAM_DOMAIN,
    ACCESS_AUD: TEST_ACCESS_AUD,
    ACCESS_ALLOWED_EMAIL: email,
    ...overrides,
  };
}

/** JWKS fetcher that serves the shared test signer's public key instead of calling Cloudflare. */
export function testAccessDeps(nowSeconds?: () => number): {
  nowSeconds?: () => number;
  fetchJwks: (teamDomain: string) => Promise<AccessJwks>;
} {
  return {
    nowSeconds,
    fetchJwks: async () => (await getTestAccessSigner()).jwks,
  };
}

export async function mintAccessToken(
  email: string,
  claimOverrides: Record<string, unknown> = {},
): Promise<string> {
  const signer = await getTestAccessSigner();
  return signer.sign(
    accessClaims(
      { email, ...claimOverrides },
      { teamDomain: TEST_ACCESS_TEAM_DOMAIN, audience: TEST_ACCESS_AUD },
    ),
  );
}

/**
 * Headers Cloudflare Access would add for `email`: the identity header plus a JWT assertion
 * signed by the shared test signer (verify it with `testAccessEnv` + `testAccessDeps`).
 */
export async function accessIdentityHeaders(
  email: string,
  initialHeaders?: HeadersInit,
  claimOverrides: Record<string, unknown> = {},
): Promise<Headers> {
  const headers = new Headers(initialHeaders);
  headers.set("cf-access-authenticated-user-email", email);
  headers.set("cf-access-jwt-assertion", await mintAccessToken(email, claimOverrides));
  return headers;
}

export function createSyntheticRequest(options: SyntheticRequestOptions = {}): Request {
  const url = new URL(options.path ?? "/", SYNTHETIC_ORIGIN);
  if (url.origin !== SYNTHETIC_ORIGIN) {
    throw new Error(`Synthetic requests must use the fixed ${SYNTHETIC_ORIGIN} origin.`);
  }

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers(options.headers);
  const hasJson = options.json !== undefined;
  if (hasJson && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    method: options.method ?? (hasJson ? "POST" : "GET"),
    headers,
    body: hasJson ? JSON.stringify(options.json) : undefined,
  });
}
