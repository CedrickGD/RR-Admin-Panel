import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INSTALL_HEADER,
  INSTALL_ID_PATTERN,
  MAX_CLOCK_SKEW_SECONDS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  base64UrlDecode,
  base64UrlEncode,
  buildSigningString,
  hasSignatureHeaders,
  importP256PublicKey,
  isValidPublicKeyJwk,
  sha256Hex,
  validateRegistrationBody,
  verifySignedRequest,
  type InstallRecord,
  type PublicKeyJwk,
} from "../../shared/install-auth";
import {
  exportPrivateKeyPkcs8Base64,
  generateInstallKeyPair,
  importPrivateKeyPkcs8Base64,
  signRequest,
  signedHeaders,
} from "../helpers/install-signer";

const ORIGIN = "https://backend.test";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const NOW_SECONDS = 1_787_310_000;
const VECTORS_PATH = fileURLToPath(new URL("./fixtures/vectors.json", import.meta.url));

interface SignedRequestOptions {
  installId?: string;
  method?: string;
  pathname?: string;
  query?: string;
  timestamp?: string;
  bodyText?: string;
  signedBodyText?: string;
  signedPathname?: string;
  signedMethod?: string;
  omitHeader?: string;
  overrideSignature?: string;
}

async function makeSignedRequest(
  privateKey: CryptoKey,
  options: SignedRequestOptions = {},
): Promise<{ request: Request; bodyText: string }> {
  const method = options.method ?? "POST";
  const pathname = options.pathname ?? "/api/ingest";
  const bodyText = options.bodyText ?? JSON.stringify({ source: "app", service: "ping" });
  const headers = await signedHeaders(privateKey, {
    installId: options.installId ?? INSTALL_ID,
    method: options.signedMethod ?? method,
    pathname: options.signedPathname ?? pathname,
    timestamp: options.timestamp ?? String(NOW_SECONDS),
    bodyText: options.signedBodyText ?? bodyText,
  });
  if (options.omitHeader) {
    headers.delete(options.omitHeader);
  }
  if (options.overrideSignature !== undefined) {
    headers.set(SIGNATURE_HEADER, options.overrideSignature);
  }
  const request = new Request(`${ORIGIN}${pathname}${options.query ?? ""}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : bodyText,
  });
  return { request, bodyText };
}

function lookupFor(
  record: InstallRecord | null,
): (installId: string) => Promise<InstallRecord | null> {
  return async (installId: string) => (record && installId === record.installId ? record : null);
}

describe("constants and primitives", () => {
  it("exposes the contract header names and limits", () => {
    expect(INSTALL_HEADER).toBe("x-rr-install");
    expect(TIMESTAMP_HEADER).toBe("x-rr-timestamp");
    expect(SIGNATURE_HEADER).toBe("x-rr-signature");
    expect(MAX_CLOCK_SKEW_SECONDS).toBe(300);
    expect(INSTALL_ID_PATTERN.test(INSTALL_ID)).toBe(true);
    expect(INSTALL_ID_PATTERN.test(INSTALL_ID.toUpperCase())).toBe(true);
    expect(INSTALL_ID_PATTERN.test("not-a-guid")).toBe(false);
  });

  it("builds the signing string as METHOD\\npath\\ntimestamp\\nhash without a trailing newline", () => {
    expect(buildSigningString("post", "/api/ingest", "1787310000", "abc")).toBe(
      "POST\n/api/ingest\n1787310000\nabc",
    );
  });

  it("hashes UTF-8 text to lowercase hex SHA-256", async () => {
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("round-trips base64url without padding and rejects invalid input", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(encoded)).toEqual(bytes);
    expect(base64UrlDecode(`${encoded}=`)).toEqual(bytes);
    expect(base64UrlDecode("")).toEqual(new Uint8Array(0));
    expect(base64UrlDecode("a+b/")).toBeNull();
    expect(base64UrlDecode("a b")).toBeNull();
    expect(base64UrlDecode("a")).toBeNull();
  });

  it("detects signature headers when any of the three is present", () => {
    expect(hasSignatureHeaders(new Request(`${ORIGIN}/api/ingest`))).toBe(false);
    expect(
      hasSignatureHeaders(
        new Request(`${ORIGIN}/api/ingest`, { headers: { [INSTALL_HEADER]: INSTALL_ID } }),
      ),
    ).toBe(true);
    expect(
      hasSignatureHeaders(
        new Request(`${ORIGIN}/api/ingest`, {
          headers: {
            [INSTALL_HEADER]: INSTALL_ID,
            [TIMESTAMP_HEADER]: "1",
            [SIGNATURE_HEADER]: "x",
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("isValidPublicKeyJwk / importP256PublicKey", () => {
  it("accepts a P-256 JWK with 32-byte coordinates and imports it", async () => {
    const { publicKeyJwk } = await generateInstallKeyPair();
    expect(isValidPublicKeyJwk(publicKeyJwk)).toBe(true);
    const key = await importP256PublicKey(publicKeyJwk);
    expect(key.type).toBe("public");
  });

  it("rejects wrong kty/crv, short coordinates and non-base64url text", async () => {
    const { publicKeyJwk } = await generateInstallKeyPair();
    expect(isValidPublicKeyJwk(null)).toBe(false);
    expect(isValidPublicKeyJwk({ ...publicKeyJwk, kty: "RSA" })).toBe(false);
    expect(isValidPublicKeyJwk({ ...publicKeyJwk, crv: "P-384" })).toBe(false);
    expect(isValidPublicKeyJwk({ ...publicKeyJwk, x: base64UrlEncode(new Uint8Array(31)) })).toBe(
      false,
    );
    expect(isValidPublicKeyJwk({ ...publicKeyJwk, y: base64UrlEncode(new Uint8Array(33)) })).toBe(
      false,
    );
    expect(isValidPublicKeyJwk({ ...publicKeyJwk, x: "not base64url!" })).toBe(false);
    expect(isValidPublicKeyJwk({ kty: "EC", crv: "P-256", x: publicKeyJwk.x })).toBe(false);
  });
});

describe("verifySignedRequest", () => {
  it("accepts a correctly signed request and returns the install id", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const { request, bodyText } = await makeSignedRequest(privateKey, { query: "?x=1" });

    const verdict = await verifySignedRequest(request, bodyText, {
      lookupInstall: lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null }),
      nowSeconds: () => NOW_SECONDS,
    });

    expect(verdict).toEqual({ ok: true, installId: INSTALL_ID });
  });

  it("accepts an empty-body GET and lower-cases the install id", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const { request } = await makeSignedRequest(privateKey, {
      method: "GET",
      pathname: "/api/usage/status",
      bodyText: "",
      installId: INSTALL_ID.toUpperCase(),
    });

    const verdict = await verifySignedRequest(request, "", {
      lookupInstall: lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null }),
      nowSeconds: () => NOW_SECONDS,
    });

    expect(verdict).toEqual({ ok: true, installId: INSTALL_ID });
  });

  it("tolerates a timestamp exactly at the skew limit in both directions", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const lookupInstall = lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null });

    for (const offset of [MAX_CLOCK_SKEW_SECONDS, -MAX_CLOCK_SKEW_SECONDS]) {
      const { request, bodyText } = await makeSignedRequest(privateKey, {
        timestamp: String(NOW_SECONDS + offset),
      });
      await expect(
        verifySignedRequest(request, bodyText, { lookupInstall, nowSeconds: () => NOW_SECONDS }),
      ).resolves.toEqual({ ok: true, installId: INSTALL_ID });
    }
  });

  it("rejects a tampered body, path or method with bad_signature", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const lookupInstall = lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null });
    const deps = { lookupInstall, nowSeconds: () => NOW_SECONDS };

    const tamperedBody = await makeSignedRequest(privateKey, {
      signedBodyText: '{"source":"app","service":"other"}',
    });
    await expect(
      verifySignedRequest(tamperedBody.request, tamperedBody.bodyText, deps),
    ).resolves.toEqual({ ok: false, status: 401, reason: "bad_signature" });

    const changedPath = await makeSignedRequest(privateKey, { signedPathname: "/api/other" });
    await expect(
      verifySignedRequest(changedPath.request, changedPath.bodyText, deps),
    ).resolves.toEqual({ ok: false, status: 401, reason: "bad_signature" });

    const changedMethod = await makeSignedRequest(privateKey, {
      method: "PUT",
      signedMethod: "POST",
    });
    await expect(
      verifySignedRequest(changedMethod.request, changedMethod.bodyText, deps),
    ).resolves.toEqual({ ok: false, status: 401, reason: "bad_signature" });
  });

  it("rejects a signature made with another install's key", async () => {
    const { publicKeyJwk } = await generateInstallKeyPair();
    const other = await generateInstallKeyPair();
    const { request, bodyText } = await makeSignedRequest(other.privateKey);

    await expect(
      verifySignedRequest(request, bodyText, {
        lookupInstall: lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null }),
        nowSeconds: () => NOW_SECONDS,
      }),
    ).resolves.toEqual({ ok: false, status: 401, reason: "bad_signature" });
  });

  it("rejects a timestamp 301 s old as stale_timestamp", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const { request, bodyText } = await makeSignedRequest(privateKey, {
      timestamp: String(NOW_SECONDS - 301),
    });

    await expect(
      verifySignedRequest(request, bodyText, {
        lookupInstall: lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null }),
        nowSeconds: () => NOW_SECONDS,
      }),
    ).resolves.toEqual({ ok: false, status: 401, reason: "stale_timestamp" });
  });

  it("rejects non-numeric, negative or oversized timestamps as bad_timestamp", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const lookupInstall = lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null });

    for (const timestamp of ["yesterday", "-5", "1787310000.5", "1".repeat(13), ""]) {
      const { request, bodyText } = await makeSignedRequest(privateKey, { timestamp });
      await expect(
        verifySignedRequest(request, bodyText, { lookupInstall, nowSeconds: () => NOW_SECONDS }),
      ).resolves.toEqual({ ok: false, status: 400, reason: "bad_timestamp" });
    }
  });

  it("rejects a malformed install id as bad_install_id", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const { request, bodyText } = await makeSignedRequest(privateKey, {
      installId: "not-a-guid",
    });

    await expect(
      verifySignedRequest(request, bodyText, {
        lookupInstall: lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null }),
        nowSeconds: () => NOW_SECONDS,
      }),
    ).resolves.toEqual({ ok: false, status: 400, reason: "bad_install_id" });
  });

  it("reports missing_headers when any of the three headers is absent", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const lookupInstall = lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null });

    for (const omitHeader of [INSTALL_HEADER, TIMESTAMP_HEADER, SIGNATURE_HEADER]) {
      const { request, bodyText } = await makeSignedRequest(privateKey, { omitHeader });
      await expect(
        verifySignedRequest(request, bodyText, { lookupInstall, nowSeconds: () => NOW_SECONDS }),
      ).resolves.toEqual({ ok: false, status: 401, reason: "missing_headers" });
    }

    const unsigned = new Request(`${ORIGIN}/api/ingest`, { method: "POST", body: "{}" });
    await expect(
      verifySignedRequest(unsigned, "{}", { lookupInstall, nowSeconds: () => NOW_SECONDS }),
    ).resolves.toEqual({ ok: false, status: 401, reason: "missing_headers" });
  });

  it("reports unknown_install when the lookup finds nothing", async () => {
    const { privateKey } = await generateInstallKeyPair();
    const { request, bodyText } = await makeSignedRequest(privateKey);

    await expect(
      verifySignedRequest(request, bodyText, {
        lookupInstall: lookupFor(null),
        nowSeconds: () => NOW_SECONDS,
      }),
    ).resolves.toEqual({ ok: false, status: 401, reason: "unknown_install" });
  });

  it("reports revoked for a revoked install even with a valid signature", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const { request, bodyText } = await makeSignedRequest(privateKey);

    await expect(
      verifySignedRequest(request, bodyText, {
        lookupInstall: lookupFor({
          installId: INSTALL_ID,
          publicKeyJwk,
          revokedAt: "2026-08-20T00:00:00.000Z",
        }),
        nowSeconds: () => NOW_SECONDS,
      }),
    ).resolves.toEqual({ ok: false, status: 401, reason: "revoked" });
  });

  it("reports bad_signature_encoding for non-base64url or wrong-length signatures", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const lookupInstall = lookupFor({ installId: INSTALL_ID, publicKeyJwk, revokedAt: null });
    const lookups: string[] = [];
    const trackingLookup = async (installId: string) => {
      lookups.push(installId);
      return lookupInstall(installId);
    };

    for (const overrideSignature of [
      "not base64url!!",
      base64UrlEncode(new Uint8Array(63)),
      base64UrlEncode(new Uint8Array(65)),
      "",
    ]) {
      const { request, bodyText } = await makeSignedRequest(privateKey, { overrideSignature });
      await expect(
        verifySignedRequest(request, bodyText, {
          lookupInstall: trackingLookup,
          nowSeconds: () => NOW_SECONDS,
        }),
      ).resolves.toEqual({ ok: false, status: 400, reason: "bad_signature_encoding" });
    }

    expect(lookups).toEqual([]);
  });

  it("does not hit the lookup before the cheap header checks pass", async () => {
    const { privateKey } = await generateInstallKeyPair();
    let lookups = 0;
    const { request, bodyText } = await makeSignedRequest(privateKey, {
      timestamp: String(NOW_SECONDS - 10_000),
    });

    await verifySignedRequest(request, bodyText, {
      lookupInstall: async () => {
        lookups += 1;
        return null;
      },
      nowSeconds: () => NOW_SECONDS,
    });

    expect(lookups).toBe(0);
  });

  it("treats an unimportable stored key as bad_signature", async () => {
    const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
    const { request, bodyText } = await makeSignedRequest(privateKey);

    await expect(
      verifySignedRequest(request, bodyText, {
        lookupInstall: lookupFor({
          installId: INSTALL_ID,
          publicKeyJwk: { ...publicKeyJwk, y: publicKeyJwk.x } as PublicKeyJwk,
          revokedAt: null,
        }),
        nowSeconds: () => NOW_SECONDS,
      }),
    ).resolves.toEqual({ ok: false, status: 401, reason: "bad_signature" });
  });
});

describe("validateRegistrationBody", () => {
  async function validBody(): Promise<Record<string, unknown>> {
    const { publicKeyJwk } = await generateInstallKeyPair();
    return {
      install_id: INSTALL_ID.toUpperCase(),
      hwid: "A1B2C3D4E5F60718293A4B5C6D7E8F90",
      public_key: publicKeyJwk,
      app_version: "1.4.9",
      license_key: "RR-TEST-KEY",
    };
  }

  it("accepts a well-formed body and normalizes the install id to lowercase", async () => {
    const body = await validBody();
    const result = validateRegistrationBody(body);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      installId: INSTALL_ID,
      hwid: "A1B2C3D4E5F60718293A4B5C6D7E8F90",
      publicKeyJwk: body.public_key,
      appVersion: "1.4.9",
      licenseKey: "RR-TEST-KEY",
    });
  });

  it("treats app_version and license_key as optional", async () => {
    const body = await validBody();
    delete body.app_version;
    body.license_key = "";
    const result = validateRegistrationBody(body);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appVersion).toBeNull();
    expect(result.value.licenseKey).toBeNull();
  });

  it("strips unknown JWK members so only kty/crv/x/y are kept", async () => {
    const body = await validBody();
    body.public_key = { ...(body.public_key as PublicKeyJwk), ext: true, key_ops: ["verify"] };
    const result = validateRegistrationBody(body);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.publicKeyJwk).sort()).toEqual(["crv", "kty", "x", "y"]);
  });

  it("rejects non-object bodies and bad GUIDs", async () => {
    expect(validateRegistrationBody(null).ok).toBe(false);
    expect(validateRegistrationBody("x").ok).toBe(false);
    expect(validateRegistrationBody([]).ok).toBe(false);

    const body = await validBody();
    body.install_id = "6f1d2c9a-9b2e-4a5d-8d77";
    const result = validateRegistrationBody(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/install_id/i);
  });

  it("rejects hwid that is missing, longer than 64 chars or contains control chars", async () => {
    const base = await validBody();

    for (const hwid of [undefined, "", "x".repeat(65), "abc def", "abc\ndef", 42]) {
      const body = { ...base, hwid };
      if (hwid === undefined) delete body.hwid;
      const result = validateRegistrationBody(body);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/hwid/i);
    }

    const maxLength = validateRegistrationBody({ ...base, hwid: "h".repeat(64) });
    expect(maxLength.ok).toBe(true);
  });

  it("rejects a JWK with a 31-byte x coordinate or a missing public_key", async () => {
    const base = await validBody();
    const shortX = validateRegistrationBody({
      ...base,
      public_key: { ...(base.public_key as PublicKeyJwk), x: base64UrlEncode(new Uint8Array(31)) },
    });
    expect(shortX.ok).toBe(false);
    if (shortX.ok) return;
    expect(shortX.message).toMatch(/public_key/i);

    const missing = { ...base };
    delete missing.public_key;
    expect(validateRegistrationBody(missing).ok).toBe(false);
  });

  it("rejects non-string or oversized app_version / license_key", async () => {
    const base = await validBody();
    expect(validateRegistrationBody({ ...base, app_version: 149 }).ok).toBe(false);
    expect(validateRegistrationBody({ ...base, app_version: "v".repeat(65) }).ok).toBe(false);
    expect(validateRegistrationBody({ ...base, license_key: { k: 1 } }).ok).toBe(false);
    expect(validateRegistrationBody({ ...base, license_key: "k".repeat(129) }).ok).toBe(false);
  });
});

interface VectorFile {
  version: "rr.install.v1";
  install_id: string;
  private_key_pkcs8_base64: string;
  public_key_jwk: PublicKeyJwk;
  vectors: Array<{
    name: string;
    method: string;
    url: string;
    pathname: string;
    timestamp: string;
    body: string;
    body_sha256: string;
    signing_string: string;
    signature: string;
  }>;
}

describe("rr.install.v1 test vectors", () => {
  const cases: Array<{
    name: string;
    method: string;
    pathname: string;
    query: string;
    body: string;
  }> = [
    {
      name: "ingest-post",
      method: "POST",
      pathname: "/api/ingest",
      query: "",
      body: JSON.stringify({
        source: "razorreaper",
        service: "session_active",
        timestamp: "2026-08-21T12:00:00.000Z",
        status: "ok",
        metrics: { session_id: "s-1", install_id: INSTALL_ID, event_id: "e-1" },
      }),
    },
    {
      name: "usage-status-get-empty-body",
      method: "GET",
      pathname: "/api/usage/status",
      query: "?feature=desync",
      body: "",
    },
    {
      name: "feedback-post-unicode",
      method: "POST",
      pathname: "/api/feedback",
      query: "",
      body: JSON.stringify({ message: "Grüße – ✓ works", rating: 5 }),
    },
  ];

  it("generates or replays the signed request vectors", async () => {
    if (process.env.GENERATE_VECTORS === "1") {
      const { privateKey, publicKeyJwk } = await generateInstallKeyPair();
      const vectors: VectorFile["vectors"] = [];
      let timestamp = NOW_SECONDS;
      for (const testCase of cases) {
        const ts = String(timestamp);
        timestamp += 60;
        const bodyHash = await sha256Hex(testCase.body);
        vectors.push({
          name: testCase.name,
          method: testCase.method,
          url: `${ORIGIN}${testCase.pathname}${testCase.query}`,
          pathname: testCase.pathname,
          timestamp: ts,
          body: testCase.body,
          body_sha256: bodyHash,
          signing_string: buildSigningString(testCase.method, testCase.pathname, ts, bodyHash),
          signature: await signRequest(privateKey, {
            method: testCase.method,
            pathname: testCase.pathname,
            timestamp: ts,
            bodyText: testCase.body,
          }),
        });
      }
      const file: VectorFile = {
        version: "rr.install.v1",
        install_id: INSTALL_ID,
        private_key_pkcs8_base64: await exportPrivateKeyPkcs8Base64(privateKey),
        public_key_jwk: publicKeyJwk,
        vectors,
      };
      mkdirSync(fileURLToPath(new URL("./fixtures/", import.meta.url)), { recursive: true });
      writeFileSync(VECTORS_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    }

    expect(existsSync(VECTORS_PATH)).toBe(true);
    const file = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as VectorFile;
    expect(file.version).toBe("rr.install.v1");
    expect(file.vectors).toHaveLength(3);
    expect(file.vectors.some((vector) => vector.method === "GET" && vector.body === "")).toBe(true);
    expect(isValidPublicKeyJwk(file.public_key_jwk)).toBe(true);

    const lookupInstall = lookupFor({
      installId: file.install_id,
      publicKeyJwk: file.public_key_jwk,
      revokedAt: null,
    });

    for (const vector of file.vectors) {
      expect(await sha256Hex(vector.body)).toBe(vector.body_sha256);
      expect(
        buildSigningString(vector.method, vector.pathname, vector.timestamp, vector.body_sha256),
      ).toBe(vector.signing_string);

      const request = new Request(vector.url, {
        method: vector.method,
        headers: {
          [INSTALL_HEADER]: file.install_id,
          [TIMESTAMP_HEADER]: vector.timestamp,
          [SIGNATURE_HEADER]: vector.signature,
        },
        body: vector.method === "GET" ? undefined : vector.body,
      });
      await expect(
        verifySignedRequest(request, vector.body, {
          lookupInstall,
          nowSeconds: () => Number(vector.timestamp),
        }),
      ).resolves.toEqual({ ok: true, installId: file.install_id });
    }

    // The PKCS#8 private key in the fixture belongs to the JWK: a fresh signature verifies.
    const privateKey = await importPrivateKeyPkcs8Base64(file.private_key_pkcs8_base64);
    const first = file.vectors[0];
    const freshSignature = await signRequest(privateKey, {
      method: first.method,
      pathname: first.pathname,
      timestamp: first.timestamp,
      bodyText: first.body,
    });
    const request = new Request(first.url, {
      method: first.method,
      headers: {
        [INSTALL_HEADER]: file.install_id,
        [TIMESTAMP_HEADER]: first.timestamp,
        [SIGNATURE_HEADER]: freshSignature,
      },
      body: first.body,
    });
    await expect(
      verifySignedRequest(request, first.body, {
        lookupInstall,
        nowSeconds: () => Number(first.timestamp),
      }),
    ).resolves.toEqual({ ok: true, installId: file.install_id });
  });
});
