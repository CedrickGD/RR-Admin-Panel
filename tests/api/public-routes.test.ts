import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import type { RuntimeEnv } from "../../functions/_lib/types";
import * as accessStatusModule from "../../functions/api/access/status";
import { onRequestPost as feedback } from "../../functions/api/feedback/index";
import { onRequestPost as activateLicense } from "../../functions/api/license/activate";
import { onRequestPost as validateLicense } from "../../functions/api/license/validate";
import { onRequestPost as usageConsume } from "../../functions/api/usage/consume";
import { onRequestGet as usageStatus } from "../../functions/api/usage/status";
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
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const INSTALL_LOOKUP = /SELECT .* FROM installs WHERE install_id = \?/;
const TOUCH = /^UPDATE installs SET last_seen_at = \?/;

let keys: InstallKeyPair;
let otherKeys: InstallKeyPair;

beforeAll(async () => {
  keys = await generateInstallKeyPair();
  otherKeys = await generateInstallKeyPair();
});

beforeEach(() => {
  resetRateLimitsForTests();
  resetInstallsSchemaStateForTests();
});

function db(resolvers: MockD1Resolvers = {}): MockD1 {
  return createMockD1({
    ...resolvers,
    first: [
      {
        match: INSTALL_LOOKUP,
        result: {
          install_id: INSTALL_ID,
          public_key_jwk: JSON.stringify(keys.publicKeyJwk),
          hwid: HWID,
          app_version: "1.4.9",
          created_at: "2026-08-01T00:00:00.000Z",
          last_seen_at: null,
          revoked_at: null,
          license_id: null,
        },
      },
      ...(resolvers.first ?? []),
    ],
  });
}

function env(mock: MockD1, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return { DB: mock.db, ...overrides };
}

interface SignedOptions {
  method?: string;
  json?: unknown;
  bodyText?: string;
  privateKey?: CryptoKey;
  headers?: Record<string, string>;
}

async function signed(path: string, options: SignedOptions = {}): Promise<Request> {
  const method =
    options.method ?? (options.json !== undefined || options.bodyText ? "POST" : "GET");
  const bodyText =
    options.bodyText ?? (options.json !== undefined ? JSON.stringify(options.json) : "");
  const url = new URL(path, ORIGIN);
  const headers = await signedHeaders(
    options.privateKey ?? keys.privateKey,
    {
      installId: INSTALL_ID,
      method,
      pathname: url.pathname,
      timestamp: String(Math.floor(Date.now() / 1000)),
      bodyText,
    },
    { "content-type": "application/json", ...(options.headers ?? {}) },
  );
  return new Request(url, { method, headers, body: method === "GET" ? undefined : bodyText });
}

function unsigned(path: string, json?: unknown, query?: Record<string, string>): Request {
  return createSyntheticRequest({ path, json, query });
}

function ops(mock: MockD1, pattern: RegExp): RecordedD1Operation[] {
  return mock.operations.filter((operation) => pattern.test(operation.normalizedSql));
}

async function expectJson(
  response: Response,
  status: number,
  expected: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject(expected);
  return body;
}

const SIGNATURE_REQUIRED = { ok: false, error: "Install signature required." };
const SIGNATURE_INVALID = { ok: false, error: "Invalid install signature." };

describe("POST /api/usage/consume (signature required)", () => {
  const body = { hwid: HWID, feature: "desync" };

  it("rejects unsigned calls with 401 and does no work", async () => {
    const mock = db();

    const response = await usageConsume({
      request: unsigned("/api/usage/consume", body),
      env: env(mock),
    });

    await expectJson(response, 401, SIGNATURE_REQUIRED);
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects a bad signature with 401", async () => {
    const mock = db();

    const response = await usageConsume({
      request: await signed("/api/usage/consume", { json: body, privateKey: otherKeys.privateKey }),
      env: env(mock),
    });

    await expectJson(response, 401, SIGNATURE_INVALID);
    expect(ops(mock, /feature_usage/)).toHaveLength(0);
  });

  it("a signed call reaches consumeUse and answers the quota", async () => {
    const mock = db({
      first: [{ match: /INSERT INTO feature_usage/, result: { count: 3 } }],
    });

    const response = await usageConsume({
      request: await signed("/api/usage/consume", { json: body }),
      env: env(mock),
    });

    await expectJson(response, 200, {
      ok: true,
      unlimited: false,
      allowed: true,
      remaining: 17,
      limit: 20,
    });
    const consumes = ops(mock, /^INSERT INTO feature_usage/);
    expect(consumes).toHaveLength(1);
    expect(consumes[0].values[0]).toBe(HWID);
    expect(consumes[0].values[1]).toBe("desync");
    expect(ops(mock, TOUCH)).toHaveLength(1);
  });

  it("keeps the 400 for a missing hwid/feature after a valid signature", async () => {
    const response = await usageConsume({
      request: await signed("/api/usage/consume", { json: { hwid: HWID } }),
      env: env(db()),
    });

    await expectJson(response, 400, { ok: false, error: "hwid and feature are required." });
  });

  it("treats an unparsable signed body like an empty one (400)", async () => {
    const response = await usageConsume({
      request: await signed("/api/usage/consume", { bodyText: "{nope" }),
      env: env(db()),
    });

    await expectJson(response, 400, { ok: false, error: "hwid and feature are required." });
  });
});

describe("GET /api/usage/status (signature required)", () => {
  it("rejects unsigned calls with 401", async () => {
    const mock = db();

    const response = await usageStatus({
      request: unsigned("/api/usage/status", undefined, { hwid: HWID }),
      env: env(mock),
    });

    await expectJson(response, 401, SIGNATURE_REQUIRED);
    expect(mock.operations).toHaveLength(0);
  });

  it("a signed GET (empty body) answers the per-feature usage", async () => {
    const mock = db({
      all: [
        {
          match: /SELECT feature, count FROM feature_usage/,
          result: { results: [{ feature: "desync", count: 4 }] },
        },
      ],
    });

    const response = await usageStatus({
      request: await signed(`/api/usage/status?hwid=${HWID}`),
      env: env(mock),
    });

    const body = await expectJson(response, 200, { ok: true, unlimited: false });
    expect((body.features as Record<string, { used: number; limit: number }>).desync).toEqual({
      used: 4,
      limit: 20,
    });
    const reads = ops(mock, /SELECT feature, count FROM feature_usage/);
    expect(reads).toHaveLength(1);
    expect(reads[0].values[0]).toBe(HWID);
  });

  it("rejects a bad signature with 401", async () => {
    const response = await usageStatus({
      request: await signed(`/api/usage/status?hwid=${HWID}`, {
        privateKey: otherKeys.privateKey,
      }),
      env: env(db()),
    });

    await expectJson(response, 401, SIGNATURE_INVALID);
  });
});

describe("POST /api/feedback (signature optional)", () => {
  const body = { message: "hello from the app", hwid: HWID, install_id: INSTALL_ID };

  it("accepts unsigned feedback (legacy clients) with 201", async () => {
    const mock = db();

    const response = await feedback({ request: unsigned("/api/feedback", body), env: env(mock) });

    await expectJson(response, 201, { ok: true });
    const inserts = ops(mock, /^INSERT INTO feedback/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values[0]).toBe("hello from the app");
    expect(ops(mock, INSTALL_LOOKUP)).toHaveLength(0);
  });

  it("accepts signed feedback with 201 and bumps the install", async () => {
    const mock = db();

    const response = await feedback({
      request: await signed("/api/feedback", { json: body }),
      env: env(mock),
    });

    await expectJson(response, 201, { ok: true });
    expect(ops(mock, /^INSERT INTO feedback\b/)).toHaveLength(1);
    expect(ops(mock, TOUCH)).toHaveLength(1);
  });

  it("rejects unsigned feedback once REQUIRE_INSTALL_SIGNATURE=true", async () => {
    const mock = db();

    const response = await feedback({
      request: unsigned("/api/feedback", body),
      env: env(mock, { REQUIRE_INSTALL_SIGNATURE: "true" }),
    });

    await expectJson(response, 401, SIGNATURE_REQUIRED);
    expect(ops(mock, /^INSERT INTO feedback/)).toHaveLength(0);
  });

  it("rejects a bad signature with 401 and stores nothing", async () => {
    const mock = db();

    const response = await feedback({
      request: await signed("/api/feedback", { json: body, privateKey: otherKeys.privateKey }),
      env: env(mock),
    });

    await expectJson(response, 401, SIGNATURE_INVALID);
    expect(ops(mock, /^INSERT INTO feedback/)).toHaveLength(0);
  });

  it("rejects a body that is not a JSON object with 400", async () => {
    const mock = db();

    for (const bodyText of ["", "{nope", "[]"]) {
      const response = await feedback({
        request: new Request(`${ORIGIN}/api/feedback`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: bodyText,
        }),
        env: env(mock),
      });
      await expectJson(response, 400, { ok: false, error: "Request body must be a JSON object." });
    }
    expect(ops(mock, /^INSERT INTO feedback/)).toHaveLength(0);
  });

  it("still requires a message", async () => {
    const response = await feedback({
      request: unsigned("/api/feedback", { message: "   " }),
      env: env(db()),
    });

    await expectJson(response, 400, {
      ok: false,
      error: "Please describe the issue in the Feedback form before sending diagnostics.",
    });
  });
});

describe("/api/access/status (POST only, signature optional)", () => {
  const { onRequest: accessStatus, onRequestPost: accessStatusPost } = accessStatusModule;

  it("no longer exports a GET handler", () => {
    expect("onRequestGet" in accessStatusModule).toBe(false);
  });

  it("answers GET with 405", async () => {
    const response = await accessStatus({
      request: unsigned("/api/access/status", undefined, { hwid: HWID }),
      env: env(db()),
    });

    expect(response.status).toBe(405);
  });

  it("answers an unsigned POST with the suspension status (legacy clients)", async () => {
    const mock = db();

    const response = await accessStatusPost({
      request: unsigned("/api/access/status", { hwid: HWID }),
      env: env(mock),
    });

    await expectJson(response, 200, { ok: true, suspended: false });
    expect(ops(mock, /FROM access_suspensions WHERE is_active = 1/)).toHaveLength(1);
  });

  it("the catch-all handler serves POST as well", async () => {
    const response = await accessStatus({
      request: unsigned("/api/access/status", { hwid: HWID }),
      env: env(db()),
    });

    await expectJson(response, 200, { ok: true, suspended: false });
  });

  it("answers a signed POST", async () => {
    const mock = db();

    const response = await accessStatusPost({
      request: await signed("/api/access/status", { json: { hwid: HWID } }),
      env: env(mock),
    });

    await expectJson(response, 200, { ok: true, suspended: false });
    expect(ops(mock, TOUCH)).toHaveLength(1);
  });

  it("rejects a bad signature with 401", async () => {
    const mock = db();

    const response = await accessStatusPost({
      request: await signed("/api/access/status", {
        json: { hwid: HWID },
        privateKey: otherKeys.privateKey,
      }),
      env: env(mock),
    });

    await expectJson(response, 401, SIGNATURE_INVALID);
    expect(ops(mock, /FROM access_suspensions/)).toHaveLength(0);
  });

  it("rejects unsigned POSTs once REQUIRE_INSTALL_SIGNATURE=true", async () => {
    const response = await accessStatusPost({
      request: unsigned("/api/access/status", { hwid: HWID }),
      env: env(db(), { REQUIRE_INSTALL_SIGNATURE: "true" }),
    });

    await expectJson(response, 401, SIGNATURE_REQUIRED);
  });

  it("keeps the 400 when neither hwid nor install_id is sent (also for unparsable bodies)", async () => {
    for (const request of [
      unsigned("/api/access/status", {}),
      new Request(`${ORIGIN}/api/access/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{nope",
      }),
    ]) {
      const response = await accessStatusPost({ request, env: env(db()) });
      await expectJson(response, 400, { ok: false, error: "hwid or install_id is required." });
    }
  });
});

describe("POST /api/license/validate + /api/license/activate (signature optional)", () => {
  const body = { license_key: "RR-TEST-KEY", hwid: HWID };
  const handlers = [
    { name: "validate", path: "/api/license/validate", handler: validateLicense },
    { name: "activate", path: "/api/license/activate", handler: activateLicense },
  ];

  for (const { name, path, handler } of handlers) {
    it(`${name}: unsigned calls still reach the license lookup`, async () => {
      const mock = db();

      const response = await handler({ request: unsigned(path, body), env: env(mock) });

      await expectJson(response, 404, { ok: false, error: "Invalid license key." });
      const lookups = ops(mock, /^SELECT \* FROM licenses WHERE license_key = \?/);
      expect(lookups).toHaveLength(1);
      expect(lookups[0].values).toEqual(["RR-TEST-KEY"]);
    });

    it(`${name}: signed calls reach the license lookup and bump the install`, async () => {
      const mock = db();

      const response = await handler({
        request: await signed(path, { json: body }),
        env: env(mock),
      });

      await expectJson(response, 404, { ok: false, error: "Invalid license key." });
      expect(ops(mock, /^SELECT \* FROM licenses WHERE license_key = \?/)).toHaveLength(1);
      expect(ops(mock, TOUCH)).toHaveLength(1);
    });

    it(`${name}: a bad signature is rejected before any license lookup`, async () => {
      const mock = db();

      const response = await handler({
        request: await signed(path, { json: body, privateKey: otherKeys.privateKey }),
        env: env(mock),
      });

      await expectJson(response, 401, SIGNATURE_INVALID);
      expect(ops(mock, /FROM licenses/)).toHaveLength(0);
    });

    it(`${name}: unsigned calls are refused once REQUIRE_INSTALL_SIGNATURE=true`, async () => {
      const mock = db();

      const response = await handler({
        request: unsigned(path, body),
        env: env(mock, { REQUIRE_INSTALL_SIGNATURE: "true" }),
      });

      await expectJson(response, 401, SIGNATURE_REQUIRED);
      expect(ops(mock, /FROM licenses/)).toHaveLength(0);
    });

    it(`${name}: a body that is not a JSON object is a 400, not a 500`, async () => {
      const response = await handler({
        request: new Request(`${ORIGIN}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{nope",
        }),
        env: env(db()),
      });

      await expectJson(response, 400, { ok: false, error: "Request body must be a JSON object." });
    });

    it(`${name}: missing fields keep their 400`, async () => {
      const response = await handler({
        request: unsigned(path, { license_key: "RR-TEST-KEY" }),
        env: env(db()),
      });

      await expectJson(response, 400, { ok: false, error: "license_key and hwid are required." });
    });
  }
});
