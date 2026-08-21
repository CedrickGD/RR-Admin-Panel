import { beforeAll, describe, expect, it } from "vitest";

import { generateInstallKeyPair, type InstallKeyPair } from "../helpers/install-signer";
import type { RecordedD1Operation } from "../helpers/mock-d1";
import {
  HWID,
  HWID_COUNT,
  INSTALL_ID,
  INSTALL_INSERT,
  INSTALL_LOOKUP,
  TEST_CLIENT_IP,
  createWorkerHarness,
  dispatch,
  fakeLimiter,
  readJson,
  workerRequest,
} from "./helpers";

const REGISTER_PATH = "/api/install/register";

let keys: InstallKeyPair;
let otherKeys: InstallKeyPair;

beforeAll(async () => {
  keys = await generateInstallKeyPair();
  otherKeys = await generateInstallKeyPair();
});

function opsMatching(operations: RecordedD1Operation[], pattern: RegExp): RecordedD1Operation[] {
  return operations.filter((operation) => pattern.test(operation.normalizedSql));
}

function registrationBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    install_id: INSTALL_ID.toUpperCase(),
    hwid: HWID,
    public_key: keys.publicKeyJwk,
    app_version: "1.4.9",
    ...overrides,
  };
}

function existingInstall(jwk = keys.publicKeyJwk, overrides: Record<string, unknown> = {}) {
  return {
    first: [
      {
        match: INSTALL_LOOKUP,
        result: {
          install_id: INSTALL_ID,
          public_key_jwk: JSON.stringify(jwk),
          revoked_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          ...overrides,
        },
      },
    ],
  };
}

describe("POST /api/install/register", () => {
  it("registers a new install with 201 and the lower-cased install id", async () => {
    const harness = createWorkerHarness();
    const before = Date.now();

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody() }),
    );

    expect(response.status).toBe(201);
    const body = await readJson(response);
    expect(body.ok).toBe(true);
    expect(body.install_id).toBe(INSTALL_ID);
    expect(Date.parse(body.registered_at as string)).toBeGreaterThanOrEqual(before);

    expect(
      opsMatching(harness.mock.operations, /CREATE TABLE IF NOT EXISTS installs/),
    ).toHaveLength(1);
    const inserts = opsMatching(harness.mock.operations, INSTALL_INSERT);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toContain(INSTALL_ID);
    expect(inserts[0].values).toContain(HWID);
    expect(inserts[0].values).toContain("1.4.9");
    expect(inserts[0].values).toContain(JSON.stringify(keys.publicKeyJwk));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is idempotent: same install + same key answers 200 with the original registered_at", async () => {
    const harness = createWorkerHarness(existingInstall());

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody() }),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      ok: true,
      install_id: INSTALL_ID,
      registered_at: "2026-08-01T00:00:00.000Z",
    });
    expect(opsMatching(harness.mock.operations, INSTALL_INSERT)).toHaveLength(0);
  });

  it("answers 409 when the install id is already bound to a different key", async () => {
    const harness = createWorkerHarness(existingInstall(otherKeys.publicKeyJwk));

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody() }),
    );

    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      ok: false,
      error: "install_id already registered with a different key",
    });
    expect(opsMatching(harness.mock.operations, INSTALL_INSERT)).toHaveLength(0);
  });

  it("answers 401 for a revoked install", async () => {
    const harness = createWorkerHarness(
      existingInstall(keys.publicKeyJwk, { revoked_at: "2026-08-10T00:00:00.000Z" }),
    );

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody() }),
    );

    expect(response.status).toBe(401);
    const body = await readJson(response);
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(opsMatching(harness.mock.operations, INSTALL_INSERT)).toHaveLength(0);
  });

  it("caps new installs at 3 per device per day", async () => {
    const harness = createWorkerHarness({
      first: [{ match: HWID_COUNT, result: { count: 3 } }],
    });

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody() }),
    );

    expect(response.status).toBe(429);
    expect(await readJson(response)).toEqual({
      ok: false,
      error: "Too many installs for this device.",
    });
    const counts = opsMatching(harness.mock.operations, HWID_COUNT);
    expect(counts).toHaveLength(1);
    expect(counts[0].values[0]).toBe(HWID);
    const since = Date.parse(counts[0].values[1] as string);
    expect(Date.now() - since).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(Date.now() - since).toBeLessThan(25 * 60 * 60 * 1000);
    expect(opsMatching(harness.mock.operations, INSTALL_INSERT)).toHaveLength(0);
  });

  it("allows the third install of the day but not the fourth", async () => {
    const harness = createWorkerHarness({
      first: [{ match: HWID_COUNT, result: { count: 2 } }],
    });

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody() }),
    );

    expect(response.status).toBe(201);
  });

  it("returns 400 for shape errors", async () => {
    const cases: Array<{ body?: unknown; raw?: string }> = [
      { body: registrationBody({ install_id: "not-a-guid" }) },
      { body: registrationBody({ hwid: "x".repeat(65) }) },
      { body: registrationBody({ public_key: { kty: "EC", crv: "P-256", x: "AA", y: "AA" } }) },
      { body: registrationBody({ public_key: undefined }) },
      { body: [] },
      { raw: "{nope" },
      { raw: "" },
    ];

    for (const testCase of cases) {
      const harness = createWorkerHarness();
      const request =
        testCase.raw !== undefined
          ? workerRequest({ path: REGISTER_PATH, body: testCase.raw })
          : workerRequest({ path: REGISTER_PATH, json: testCase.body });

      const response = await dispatch(harness, request);

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body.ok).toBe(false);
      expect(typeof body.error).toBe("string");
      expect(opsMatching(harness.mock.operations, INSTALL_INSERT)).toHaveLength(0);
    }
  });

  it("returns 413 for bodies over 4 KB", async () => {
    const harness = createWorkerHarness();
    const response = await dispatch(
      harness,
      workerRequest({
        path: REGISTER_PATH,
        json: registrationBody({ license_key: "k".repeat(4 * 1024) }),
      }),
    );

    expect(response.status).toBe(413);
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("returns 429 when the RL_REGISTER binding rejects the client IP", async () => {
    const harness = createWorkerHarness();
    const limiter = fakeLimiter(false);
    harness.env.RL_REGISTER = limiter;

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody() }),
    );

    expect(response.status).toBe(429);
    expect(await readJson(response)).toEqual({ ok: false, error: "Too many requests." });
    expect(limiter.keys).toEqual([TEST_CLIENT_IP]);
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("does not use the ingest limiter for registration", async () => {
    const harness = createWorkerHarness();

    await dispatch(harness, workerRequest({ path: REGISTER_PATH, json: registrationBody() }));

    expect(harness.registerLimiter.keys).toEqual([TEST_CLIENT_IP]);
    expect(harness.ingestLimiter.keys).toEqual([]);
  });

  it("only accepts POST", async () => {
    const harness = createWorkerHarness();

    const response = await dispatch(harness, workerRequest({ path: REGISTER_PATH }));

    expect(response.status).toBe(404);
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("links an active license key (best effort) without exposing the lookup", async () => {
    const harness = createWorkerHarness({
      first: [{ match: /FROM licenses WHERE license_key = \?/, result: { id: 42 } }],
    });

    const response = await dispatch(
      harness,
      workerRequest({ path: REGISTER_PATH, json: registrationBody({ license_key: "RR-KEY" }) }),
    );

    expect(response.status).toBe(201);
    const [insert] = opsMatching(harness.mock.operations, INSTALL_INSERT);
    expect(insert.values).toContain(42);
    expect(Object.keys(await readJson(response)).sort()).toEqual([
      "install_id",
      "ok",
      "registered_at",
    ]);
  });
});
