import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseJsonObject,
  requireInstallAuth,
  type InstallAuthMode,
} from "../../functions/_lib/install-auth";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import {
  generateInstallKeyPair,
  signedHeaders,
  type InstallKeyPair,
} from "../helpers/install-signer";
import {
  createMockD1,
  type MockD1,
  type MockD1Resolvers,
  type RecordedD1Operation,
} from "../helpers/mock-d1";
import { createSyntheticRequest } from "../helpers/request";

const ORIGIN = "https://admin.test";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const INSTALL_LOOKUP = /SELECT .* FROM installs WHERE install_id = \?/;
const INSTALLS_DDL = /^CREATE (TABLE|INDEX) IF NOT EXISTS (installs|idx_installs_hwid)/;
const TOUCH = /^UPDATE installs SET last_seen_at = \?/;
const PAYLOAD = { hwid: "HWID-1", feature: "desync" };
const BODY_TEXT = JSON.stringify(PAYLOAD);

let keys: InstallKeyPair;
let otherKeys: InstallKeyPair;

beforeAll(async () => {
  keys = await generateInstallKeyPair();
  otherKeys = await generateInstallKeyPair();
});

beforeEach(() => {
  resetInstallsSchemaStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function installRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    install_id: INSTALL_ID,
    public_key_jwk: JSON.stringify(keys.publicKeyJwk),
    hwid: "HWID-1",
    app_version: "1.4.9",
    created_at: "2026-08-01T00:00:00.000Z",
    last_seen_at: null,
    revoked_at: null,
    license_id: null,
    ...overrides,
  };
}

function installsDb(
  row: Record<string, unknown> | null | (() => Record<string, unknown> | null) = installRow(),
  extra: MockD1Resolvers = {},
): MockD1 {
  return createMockD1({
    ...extra,
    first: [
      {
        match: INSTALL_LOOKUP,
        result: typeof row === "function" ? row : row,
      },
      ...(extra.first ?? []),
    ],
  });
}

interface SignedRequestOptions {
  path?: string;
  method?: string;
  bodyText?: string;
  installId?: string;
  timestamp?: string;
  privateKey?: CryptoKey;
  /** Sign over a different path/body than the one actually sent (tamper tests). */
  signPath?: string;
  signBodyText?: string;
  headers?: Record<string, string>;
}

async function signedRequest(options: SignedRequestOptions = {}): Promise<Request> {
  const path = options.path ?? "/api/usage/consume";
  const method = options.method ?? "POST";
  const bodyText = options.bodyText ?? (method === "GET" ? "" : BODY_TEXT);
  const url = new URL(path, ORIGIN);
  const headers = await signedHeaders(
    options.privateKey ?? keys.privateKey,
    {
      installId: options.installId ?? INSTALL_ID,
      method,
      pathname: options.signPath ?? url.pathname,
      timestamp: options.timestamp ?? nowSeconds(),
      bodyText: options.signBodyText ?? bodyText,
    },
    { "content-type": "application/json", ...(options.headers ?? {}) },
  );
  return new Request(url, { method, headers, body: method === "GET" ? undefined : bodyText });
}

function unsignedRequest(): Request {
  return createSyntheticRequest({ path: "/api/usage/consume", json: PAYLOAD });
}

function ops(mock: MockD1, pattern: RegExp): RecordedD1Operation[] {
  return mock.operations.filter((operation) => pattern.test(operation.normalizedSql));
}

async function run(
  request: Request,
  mock: MockD1 | null,
  mode: InstallAuthMode,
  envOverrides: Partial<RuntimeEnv> = {},
) {
  const env: RuntimeEnv = { ...(mock ? { DB: mock.db } : {}), ...envOverrides };
  return requireInstallAuth({ request, env }, mode);
}

async function expectDenied(
  result: Awaited<ReturnType<typeof requireInstallAuth>>,
  status: number,
  message: string,
): Promise<Record<string, unknown>> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a denial");
  expect(result.response.status).toBe(status);
  expect(result.response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  const body = (await result.response.json()) as Record<string, unknown>;
  expect(body.ok).toBe(false);
  expect(body.error).toBe(message);
  return body;
}

describe("requireInstallAuth — unsigned requests", () => {
  it("passes an unsigned request through in optional mode with installId null and the raw body", async () => {
    const mock = installsDb();

    const result = await run(unsignedRequest(), mock, "optional");

    expect(result).toEqual({ ok: true, installId: null, bodyText: BODY_TEXT });
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects an unsigned request in required mode with 401 and touches no storage", async () => {
    const mock = installsDb();

    await expectDenied(
      await run(unsignedRequest(), mock, "required"),
      401,
      "Install signature required.",
    );
    expect(mock.operations).toHaveLength(0);
  });

  it("REQUIRE_INSTALL_SIGNATURE=true turns optional routes into required ones", async () => {
    const mock = installsDb();

    await expectDenied(
      await run(unsignedRequest(), mock, "optional", { REQUIRE_INSTALL_SIGNATURE: "true" }),
      401,
      "Install signature required.",
    );
    await expectDenied(
      await run(unsignedRequest(), mock, "optional", { REQUIRE_INSTALL_SIGNATURE: " TRUE " }),
      401,
      "Install signature required.",
    );

    const relaxed = await run(unsignedRequest(), mock, "optional", {
      REQUIRE_INSTALL_SIGNATURE: "false",
    });
    expect(relaxed.ok).toBe(true);
  });

  it("a GET without a body yields an empty bodyText", async () => {
    const request = createSyntheticRequest({ path: "/api/usage/status", query: { hwid: "H" } });

    const result = await run(request, installsDb(), "optional");

    expect(result).toEqual({ ok: true, installId: null, bodyText: "" });
  });
});

describe("requireInstallAuth — signed requests", () => {
  it("verifies a valid signature, runs the installs DDL once and bumps last_seen_at", async () => {
    const mock = installsDb();

    const first = await run(await signedRequest(), mock, "required");
    expect(first).toEqual({ ok: true, installId: INSTALL_ID, bodyText: BODY_TEXT });

    expect(ops(mock, INSTALLS_DDL).length).toBeGreaterThanOrEqual(2);
    const lookups = ops(mock, INSTALL_LOOKUP);
    expect(lookups).toHaveLength(1);
    expect(lookups[0].values).toEqual([INSTALL_ID]);
    const touches = ops(mock, TOUCH);
    expect(touches).toHaveLength(1);
    expect(touches[0].values).toContain(INSTALL_ID);

    const ddlCount = ops(mock, INSTALLS_DDL).length;
    const second = await run(await signedRequest(), mock, "optional");
    expect(second.ok).toBe(true);
    // Once per isolate: no second DDL run.
    expect(ops(mock, INSTALLS_DDL)).toHaveLength(ddlCount);
    expect(ops(mock, TOUCH)).toHaveLength(2);
  });

  it("normalizes the install id from the header to lowercase", async () => {
    const mock = installsDb();

    const result = await run(
      await signedRequest({ installId: INSTALL_ID.toUpperCase() }),
      mock,
      "required",
    );

    expect(result).toEqual({ ok: true, installId: INSTALL_ID, bodyText: BODY_TEXT });
  });

  it("verifies a signed GET over the path without the query string and SHA-256 of the empty body", async () => {
    const mock = installsDb();
    const request = await signedRequest({
      method: "GET",
      path: "/api/usage/status?hwid=HWID-1",
    });

    const result = await run(request, mock, "required");

    expect(result).toEqual({ ok: true, installId: INSTALL_ID, bodyText: "" });
  });

  const rejected: Array<[string, () => Promise<Request>]> = [
    ["a tampered body", () => signedRequest({ signBodyText: BODY_TEXT + " " })],
    ["a different path", () => signedRequest({ signPath: "/api/usage/status" })],
    ["a signature from another key", () => signedRequest({ privateKey: otherKeys.privateKey })],
    [
      "a stale timestamp",
      () => signedRequest({ timestamp: String(Math.floor(Date.now() / 1000) - 301) }),
    ],
    ["a malformed timestamp", () => signedRequest({ timestamp: "yesterday" })],
    ["a malformed install id", () => signedRequest({ installId: "not-a-guid" })],
    [
      "a partial header set",
      async () => {
        const request = await signedRequest();
        request.headers.delete("x-rr-timestamp");
        return request;
      },
    ],
    [
      "a signature that is not base64url",
      async () => {
        const request = await signedRequest();
        request.headers.set("x-rr-signature", "***not-base64url***");
        return request;
      },
    ],
  ];

  for (const [label, build] of rejected) {
    it(`rejects ${label} with 401 Invalid install signature (in both modes) and never touches the install`, async () => {
      for (const mode of ["required", "optional"] as const) {
        const mock = installsDb();

        await expectDenied(await run(await build(), mock, mode), 401, "Invalid install signature.");

        expect(ops(mock, TOUCH)).toHaveLength(0);
      }
    });
  }

  it("rejects unknown installs with 401", async () => {
    const mock = installsDb(null);

    await expectDenied(
      await run(await signedRequest(), mock, "optional"),
      401,
      "Invalid install signature.",
    );
    expect(ops(mock, INSTALL_LOOKUP)).toHaveLength(1);
    expect(ops(mock, TOUCH)).toHaveLength(0);
  });

  it("rejects revoked installs with 401", async () => {
    const mock = installsDb(installRow({ revoked_at: "2026-08-10T00:00:00.000Z" }));

    await expectDenied(
      await run(await signedRequest(), mock, "optional"),
      401,
      "Invalid install signature.",
    );
    expect(ops(mock, TOUCH)).toHaveLength(0);
  });

  it("a failing last_seen_at bump does not fail the request", async () => {
    const mock = installsDb(installRow(), {
      run: [
        {
          match: TOUCH,
          result: () => {
            throw new Error("D1 write lock");
          },
        },
      ],
    });

    const result = await run(await signedRequest(), mock, "required");

    expect(result).toEqual({ ok: true, installId: INSTALL_ID, bodyText: BODY_TEXT });
    expect(ops(mock, TOUCH)).toHaveLength(1);
  });

  it("answers 500 with a generic message when the install lookup itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mock = installsDb(() => {
      throw new Error("D1_ERROR: no such table: installs (SELECT ... FROM installs)");
    });

    const result = await run(await signedRequest(), mock, "required");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(500);
    const text = await result.response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "Unable to complete the request." });
    expect(text).not.toContain("no such table");
    expect(text).not.toContain("SELECT");
    expect(result.response.headers.get("x-request-id")).toMatch(/\S/);
  });

  it("answers 500 when signature headers arrive but no DB binding exists", async () => {
    const result = await run(await signedRequest(), null, "optional");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(500);
  });
});

describe("requireInstallAuth — body limits", () => {
  it("rejects a 16 KB + 1 body with 413 before any signature work", async () => {
    const mock = installsDb();
    const huge = JSON.stringify({ pad: "x".repeat(16 * 1024) });
    expect(new TextEncoder().encode(huge).byteLength).toBeGreaterThan(16 * 1024);

    const result = await run(await signedRequest({ bodyText: huge }), mock, "optional");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects an oversized declared content-length with 413 without reading the body", async () => {
    const request = new Request(`${ORIGIN}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(64 * 1024) },
      body: BODY_TEXT,
    });

    const result = await run(request, installsDb(), "optional");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
  });
});

describe("parseJsonObject", () => {
  it("returns the object for a JSON object body", () => {
    expect(parseJsonObject(BODY_TEXT)).toEqual(PAYLOAD);
    expect(parseJsonObject("  {\n}  ")).toEqual({});
  });

  it("returns null for blank, invalid, or non-object bodies", () => {
    expect(parseJsonObject("")).toBeNull();
    expect(parseJsonObject("   ")).toBeNull();
    expect(parseJsonObject("{not json")).toBeNull();
    expect(parseJsonObject("[]")).toBeNull();
    expect(parseJsonObject("null")).toBeNull();
    expect(parseJsonObject('"text"')).toBeNull();
    expect(parseJsonObject("42")).toBeNull();
  });
});
