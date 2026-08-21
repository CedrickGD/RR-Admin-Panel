import type { AccessJwks } from "../../functions/_lib/access-jwt";

const encoder = new TextEncoder();

export interface AccessSignOptions {
  /** Override the `kid` written into the JOSE header (the key used for signing stays the same). */
  kid?: string;
  /** Override the `alg` written into the JOSE header (e.g. `"none"`); signing still uses RS256. */
  alg?: string;
  /** Extra JOSE header members. */
  header?: Record<string, unknown>;
  /** Emit `header.payload.` with an empty signature segment (for `alg: "none"` style tokens). */
  omitSignature?: boolean;
}

export interface AccessSigner {
  kid: string;
  jwks: AccessJwks;
  privateKey: CryptoKey;
  sign(claims: Record<string, unknown>, options?: AccessSignOptions): Promise<string>;
}

export async function createAccessSigner(kid = "test-kid-1"): Promise<AccessSigner> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  if (!publicJwk.n || !publicJwk.e) {
    throw new Error("RSA public JWK export is missing n/e.");
  }

  const jwks: AccessJwks = {
    keys: [{ kid, kty: "RSA", n: publicJwk.n, e: publicJwk.e, alg: "RS256" }],
  };

  return {
    kid,
    jwks,
    privateKey: keyPair.privateKey,
    async sign(claims, options = {}) {
      const header = {
        alg: options.alg ?? "RS256",
        kid: options.kid ?? kid,
        typ: "JWT",
        ...(options.header ?? {}),
      };
      const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(claims)}`;
      if (options.omitSignature) {
        return `${signingInput}.`;
      }
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keyPair.privateKey,
        encoder.encode(signingInput),
      );
      return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
    },
  };
}

/** Claims shaped like a real Cloudflare Access application token. */
export function accessClaims(
  overrides: Record<string, unknown> = {},
  options: { teamDomain?: string; audience?: string; nowSeconds?: number } = {},
): Record<string, unknown> {
  const teamDomain = options.teamDomain ?? "test.cloudflareaccess.com";
  const audience = options.audience ?? "aud-test";
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  return {
    iss: `https://${teamDomain}`,
    aud: [audience],
    email: "admin@example.com",
    sub: "access-sub-1",
    type: "app",
    iat: now - 30,
    nbf: now - 30,
    exp: now + 600,
    ...overrides,
  };
}

export function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncodeBytes(encoder.encode(JSON.stringify(value)));
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
