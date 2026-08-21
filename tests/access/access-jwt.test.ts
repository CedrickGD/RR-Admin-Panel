import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseAudiences,
  resetAccessJwksCacheForTests,
  resolveAccessIdentity,
  verifyAccessJwt,
  type AccessJwks,
} from "../../functions/_lib/access-jwt";
import {
  accessClaims,
  base64UrlEncodeJson,
  createAccessSigner,
  type AccessSigner,
} from "../helpers/access-token";

const TEAM_DOMAIN = "test.cloudflareaccess.com";
const AUDIENCE = "aud-test";
const NOW = 1_787_310_000;
const nowSeconds = () => NOW;

let signer: AccessSigner;
let otherSigner: AccessSigner;

beforeEach(async () => {
  signer ??= await createAccessSigner("kid-a");
  otherSigner ??= await createAccessSigner("kid-b");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAccessJwksCacheForTests();
});

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return accessClaims(
    { email: "Admin@Example.com", ...overrides },
    { teamDomain: TEAM_DOMAIN, audience: AUDIENCE, nowSeconds: NOW },
  );
}

async function verify(
  token: string,
  overrides: Partial<Parameters<typeof verifyAccessJwt>[1]> = {},
): Promise<Awaited<ReturnType<typeof verifyAccessJwt>>> {
  return verifyAccessJwt(token, {
    teamDomain: TEAM_DOMAIN,
    audiences: [AUDIENCE],
    nowSeconds,
    fetchJwks: async () => signer.jwks,
    ...overrides,
  });
}

describe("verifyAccessJwt", () => {
  it("accepts a valid RS256 token and returns email + sub untouched", async () => {
    const token = await signer.sign(claims());

    await expect(verify(token)).resolves.toEqual({
      ok: true,
      email: "Admin@Example.com",
      sub: "access-sub-1",
    });
  });

  it("accepts aud as a plain string and any overlap with the configured audiences", async () => {
    const stringAud = await signer.sign(claims({ aud: AUDIENCE }));
    const multiAud = await signer.sign(claims({ aud: ["other-aud", AUDIENCE] }));

    await expect(verify(stringAud)).resolves.toMatchObject({ ok: true });
    await expect(verify(multiAud, { audiences: ["preview-aud", AUDIENCE] })).resolves.toMatchObject(
      {
        ok: true,
      },
    );
  });

  it("returns sub: null when the token has no sub claim", async () => {
    const token = await signer.sign(claims({ sub: undefined }));

    await expect(verify(token)).resolves.toEqual({
      ok: true,
      email: "Admin@Example.com",
      sub: null,
    });
  });

  it("rejects an expired token", async () => {
    const expired = await signer.sign(claims({ exp: NOW - 1 }));
    const boundary = await signer.sign(claims({ exp: NOW }));

    await expect(verify(expired)).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(verify(boundary)).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token that is not yet valid", async () => {
    const token = await signer.sign(claims({ nbf: NOW + 30 }));

    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "not_yet_valid" });
  });

  it("rejects a wrong audience", async () => {
    const token = await signer.sign(claims({ aud: ["someone-else"] }));

    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "bad_audience" });
  });

  it("rejects a wrong issuer", async () => {
    const token = await signer.sign(claims({ iss: "https://evil.cloudflareaccess.com" }));

    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "bad_issuer" });
  });

  it("rejects a token without an email claim", async () => {
    const missing = await signer.sign(claims({ email: undefined }));
    const notText = await signer.sign(claims({ email: 42 }));

    await expect(verify(missing)).resolves.toEqual({ ok: false, reason: "no_email" });
    await expect(verify(notText)).resolves.toEqual({ ok: false, reason: "no_email" });
  });

  it("rejects an unknown kid", async () => {
    const token = await otherSigner.sign(claims());

    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "unknown_kid" });
  });

  it("rejects a tampered payload", async () => {
    const token = await signer.sign(claims());
    const [header, , signature] = token.split(".");
    const tampered = `${header}.${base64UrlEncodeJson(claims({ email: "attacker@example.com" }))}.${signature}`;

    await expect(verify(tampered)).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token signed by another key that reuses the kid", async () => {
    const token = await otherSigner.sign(claims(), { kid: signer.kid });

    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects alg none and any non-RS256 algorithm", async () => {
    const none = await signer.sign(claims(), { alg: "none", omitSignature: true });
    const hs256 = await signer.sign(claims(), { alg: "HS256" });

    await expect(verify(none)).resolves.toEqual({ ok: false, reason: "unsupported_alg" });
    await expect(verify(hs256)).resolves.toEqual({ ok: false, reason: "unsupported_alg" });
  });

  it.each([
    ["", "empty"],
    ["not-a-jwt", "single segment"],
    ["a.b", "two segments"],
    ["a.b.c.d", "four segments"],
    ["!!!.!!!.!!!", "non base64url segments"],
    [`${base64UrlEncodeJson("text")}.${base64UrlEncodeJson({})}.AAAA`, "header not an object"],
  ])("rejects the malformed token %j (%s)", async (token) => {
    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token whose header has no kid", async () => {
    const token = await signer.sign(claims(), { kid: undefined, header: { kid: undefined } });

    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token whose exp claim is not numeric", async () => {
    const token = await signer.sign(claims({ exp: "never" }));

    await expect(verify(token)).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("propagates a JWKS fetch failure instead of returning a verdict", async () => {
    const token = await signer.sign(claims());

    await expect(
      verify(token, {
        fetchJwks: async () => {
          throw new Error("upstream down");
        },
      }),
    ).rejects.toThrow("upstream down");
  });
});

describe("verifyAccessJwt default JWKS fetcher", () => {
  function stubCerts(keysProvider: () => AccessJwks) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify(keysProvider()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("fetches the team certs once, caches them, and re-fetches once on an unknown kid", async () => {
    let published = signer.jwks;
    let clock = NOW;
    const fetchMock = stubCerts(() => published);
    const verifyDefault = (token: string) =>
      verifyAccessJwt(token, {
        teamDomain: TEAM_DOMAIN,
        audiences: [AUDIENCE],
        nowSeconds: () => clock,
      });

    const tokenA = await signer.sign(claims());
    await expect(verifyDefault(tokenA)).resolves.toMatchObject({ ok: true });
    await expect(verifyDefault(tokenA)).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Key rotation (outside the 60 s refresh cooldown): the cached set does not know kid-b,
    // so one early refresh is allowed.
    clock += 120;
    published = { keys: [...signer.jwks.keys, ...otherSigner.jwks.keys] };
    const tokenB = await otherSigner.sign(claims());
    await expect(verifyDefault(tokenB)).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Same instant, inside the cooldown: a flood of bogus kids must not become a flood of fetches.
    const tokenC = await otherSigner.sign(claims(), { kid: "kid-unknown" });
    await expect(verifyDefault(tokenC)).resolves.toEqual({ ok: false, reason: "unknown_kid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the certs endpoint does not answer 200 with a keys array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 503 })),
    );
    const token = await signer.sign(claims());

    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM_DOMAIN, audiences: [AUDIENCE], nowSeconds }),
    ).rejects.toThrow();
  });
});

describe("parseAudiences", () => {
  it("splits on commas, trims and drops empties", () => {
    expect(parseAudiences(undefined)).toEqual([]);
    expect(parseAudiences("")).toEqual([]);
    expect(parseAudiences(" , ")).toEqual([]);
    expect(parseAudiences(" aud-a , aud-b,,aud-c ")).toEqual(["aud-a", "aud-b", "aud-c"]);
  });
});

describe("resolveAccessIdentity", () => {
  const deps = { nowSeconds, fetchJwks: async () => signer.jwks };
  const env = { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUDIENCE };

  it("returns 500 when ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing", async () => {
    const token = await signer.sign(claims());
    const request = new Request("https://admin.test/api/admin/data", {
      headers: { "cf-access-jwt-assertion": token },
    });

    await expect(resolveAccessIdentity(request, {}, deps)).resolves.toEqual({
      ok: false,
      status: 500,
      message: "Access verification is not configured.",
    });
    await expect(
      resolveAccessIdentity(request, { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: " , " }, deps),
    ).resolves.toEqual({
      ok: false,
      status: 500,
      message: "Access verification is not configured.",
    });
  });

  it("returns 401 when the JWT header is missing, even if the email header is set", async () => {
    const request = new Request("https://admin.test/api/admin/data", {
      headers: { "cf-access-authenticated-user-email": "admin@example.com" },
    });

    await expect(resolveAccessIdentity(request, env, deps)).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("returns 401 when the JWT does not verify", async () => {
    const token = await signer.sign(claims({ exp: NOW - 10 }));
    const request = new Request("https://admin.test/api/admin/data", {
      headers: { "cf-access-jwt-assertion": token },
    });

    await expect(resolveAccessIdentity(request, env, deps)).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("returns the lower-cased email for a valid token", async () => {
    const token = await signer.sign(claims({ email: "  Admin@Example.COM " }));
    const request = new Request("https://admin.test/api/admin/data", {
      headers: { "cf-access-jwt-assertion": token },
    });

    await expect(resolveAccessIdentity(request, env, deps)).resolves.toEqual({
      ok: true,
      email: "admin@example.com",
    });
  });

  it("returns 500 when the JWKS cannot be fetched", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const token = await signer.sign(claims());
    const request = new Request("https://admin.test/api/admin/data", {
      headers: { "cf-access-jwt-assertion": token },
    });

    await expect(
      resolveAccessIdentity(request, env, {
        nowSeconds,
        fetchJwks: async () => {
          throw new Error("certs unavailable");
        },
      }),
    ).resolves.toMatchObject({ ok: false, status: 500 });
  });
});
