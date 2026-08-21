import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MAX_BODY_BYTES } from "../../shared/telemetry-contract";
import { generateInstallKeyPair, type InstallKeyPair } from "../helpers/install-signer";
import type { RecordedD1Operation } from "../helpers/mock-d1";
import {
  EVENT_INSERT,
  INSTALL_ID,
  INSTALL_LOOKUP,
  OTHER_INSTALL_ID,
  SESSION_LOOKUP,
  SESSION_UPSERT,
  TEST_CLIENT_IP,
  canonicalEvent,
  createWorkerHarness,
  dispatch,
  fakeLimiter,
  installRow,
  legacyKeyHeaders,
  readJson,
  sessionRow,
  signedWorkerRequest,
  workerRequest,
} from "./helpers";

let keys: InstallKeyPair;
let otherKeys: InstallKeyPair;

beforeAll(async () => {
  keys = await generateInstallKeyPair();
  otherKeys = await generateInstallKeyPair();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function opsMatching(operations: RecordedD1Operation[], pattern: RegExp): RecordedD1Operation[] {
  return operations.filter((operation) => pattern.test(operation.normalizedSql));
}

function installResolvers(row = installRow(keys.publicKeyJwk)) {
  return { first: [{ match: INSTALL_LOOKUP, result: row }] };
}

describe("worker ingest: signed requests", () => {
  for (const path of ["/api/ingest", "/v1/telemetry/event"]) {
    it(`accepts a signed event on ${path} and tags the row as signed`, async () => {
      const harness = createWorkerHarness(installResolvers());
      const request = await signedWorkerRequest({
        path,
        privateKey: keys.privateKey,
        json: canonicalEvent(),
      });

      const response = await dispatch(harness, request);

      expect(response.status).toBe(202);
      const body = await readJson(response);
      expect(body.ok).toBe(true);
      expect(body.accepted).toBe(true);
      expect(typeof body.eventId).toBe("string");

      const inserts = opsMatching(harness.mock.operations, EVENT_INSERT);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].normalizedSql).toContain("ingest_auth_mode");
      expect(inserts[0].values).toContain("signed");
      expect(inserts[0].values).not.toContain("legacy_key");
      expect(opsMatching(harness.mock.operations, SESSION_UPSERT)).toHaveLength(1);
    });
  }

  it("overwrites metrics.install_id with the authenticated install", async () => {
    const harness = createWorkerHarness(installResolvers());
    const request = await signedWorkerRequest({
      path: "/api/ingest",
      privateKey: keys.privateKey,
      json: canonicalEvent({
        metrics: { session_id: "session-1", install_id: OTHER_INSTALL_ID },
      }),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(202);
    const [insert] = opsMatching(harness.mock.operations, EVENT_INSERT);
    const metricsJson = insert.values.find(
      (value) => typeof value === "string" && value.startsWith("{"),
    ) as string;
    expect(JSON.parse(metricsJson).install_id).toBe(INSTALL_ID);
    const [upsert] = opsMatching(harness.mock.operations, SESSION_UPSERT);
    expect(upsert.values[1]).toBe(INSTALL_ID);
  });

  it("bumps installs.last_seen_at for the signed install (best effort)", async () => {
    const harness = createWorkerHarness(installResolvers());
    const request = await signedWorkerRequest({
      path: "/api/ingest",
      privateKey: keys.privateKey,
      json: canonicalEvent(),
    });

    await dispatch(harness, request);

    const touches = opsMatching(harness.mock.operations, /^UPDATE installs SET last_seen_at/);
    expect(touches).toHaveLength(1);
    expect(touches[0].values).toContain(INSTALL_ID);
  });

  it("rejects a signature made with a different key", async () => {
    const harness = createWorkerHarness(installResolvers());
    const request = await signedWorkerRequest({
      path: "/api/ingest",
      privateKey: otherKeys.privateKey,
      json: canonicalEvent(),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ ok: false, error: "Invalid install signature." });
    expect(opsMatching(harness.mock.operations, EVENT_INSERT)).toHaveLength(0);
  });

  it("rejects a tampered body even with valid headers", async () => {
    const harness = createWorkerHarness(installResolvers());
    const signed = await signedWorkerRequest({
      path: "/api/ingest",
      privateKey: keys.privateKey,
      json: canonicalEvent(),
    });
    const tampered = workerRequest({
      path: "/api/ingest",
      headers: signed.headers,
      json: canonicalEvent({ message: "tampered" }),
    });

    const response = await dispatch(harness, tampered);

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ ok: false, error: "Invalid install signature." });
  });

  it("rejects unknown installs, revoked installs and stale timestamps with 401", async () => {
    const unknown = createWorkerHarness();
    const unknownResponse = await dispatch(
      unknown,
      await signedWorkerRequest({
        path: "/api/ingest",
        privateKey: keys.privateKey,
        json: canonicalEvent(),
      }),
    );
    expect(unknownResponse.status).toBe(401);

    const revoked = createWorkerHarness(
      installResolvers(installRow(keys.publicKeyJwk, { revoked_at: "2026-08-21T00:00:00.000Z" })),
    );
    const revokedResponse = await dispatch(
      revoked,
      await signedWorkerRequest({
        path: "/api/ingest",
        privateKey: keys.privateKey,
        json: canonicalEvent(),
      }),
    );
    expect(revokedResponse.status).toBe(401);

    const stale = createWorkerHarness(installResolvers());
    const staleResponse = await dispatch(
      stale,
      await signedWorkerRequest({
        path: "/api/ingest",
        privateKey: keys.privateKey,
        json: canonicalEvent(),
        timestamp: String(Math.floor(Date.now() / 1000) - 301),
      }),
    );
    expect(staleResponse.status).toBe(401);
    expect(await readJson(staleResponse)).toEqual({
      ok: false,
      error: "Invalid install signature.",
    });
  });

  it("does not fall back to the legacy key when signature headers are present but invalid", async () => {
    const harness = createWorkerHarness(installResolvers());
    const signed = await signedWorkerRequest({
      path: "/api/ingest",
      privateKey: otherKeys.privateKey,
      json: canonicalEvent(),
      headers: legacyKeyHeaders(),
    });

    const response = await dispatch(harness, signed);

    expect(response.status).toBe(401);
    expect(opsMatching(harness.mock.operations, EVENT_INSERT)).toHaveLength(0);
  });

  it("refuses to write into a session owned by another install", async () => {
    const harness = createWorkerHarness({
      first: [
        { match: INSTALL_LOOKUP, result: installRow(keys.publicKeyJwk) },
        { match: SESSION_LOOKUP, result: sessionRow({ install_id: OTHER_INSTALL_ID }) },
      ],
    });
    const request = await signedWorkerRequest({
      path: "/api/ingest",
      privateKey: keys.privateKey,
      json: canonicalEvent({ service: "session_active" }),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      ok: false,
      error: "Session belongs to another install.",
    });
    expect(opsMatching(harness.mock.operations, SESSION_UPSERT)).toHaveLength(0);
    expect(opsMatching(harness.mock.operations, EVENT_INSERT)).toHaveLength(0);
  });

  it("lets the owning install keep writing to its own session", async () => {
    const harness = createWorkerHarness({
      first: [
        { match: INSTALL_LOOKUP, result: installRow(keys.publicKeyJwk) },
        { match: SESSION_LOOKUP, result: sessionRow({ install_id: INSTALL_ID }) },
      ],
    });
    const request = await signedWorkerRequest({
      path: "/api/ingest",
      privateKey: keys.privateKey,
      json: canonicalEvent({ service: "crosshair_overlay" }),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(202);
    expect(opsMatching(harness.mock.operations, SESSION_UPSERT)).toHaveLength(1);
  });
});

describe("worker ingest: legacy shared key", () => {
  it("accepts the x-app-key header and tags the row as legacy_key", async () => {
    const harness = createWorkerHarness();
    const request = workerRequest({
      path: "/api/ingest",
      headers: legacyKeyHeaders(),
      json: canonicalEvent(),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(202);
    const [insert] = opsMatching(harness.mock.operations, EVENT_INSERT);
    expect(insert.values).toContain("legacy_key");
    expect(insert.values).not.toContain("signed");
    expect(opsMatching(harness.mock.operations, INSTALL_LOOKUP)).toHaveLength(0);
  });

  it("accepts the key as a bearer token and falls back to INGEST_TOKEN", async () => {
    const harness = createWorkerHarness(
      {},
      { APP_SHARED_KEY: undefined, INGEST_TOKEN: "token-from-ingest-token" },
    );
    const request = workerRequest({
      path: "/api/ingest",
      headers: { authorization: "Bearer token-from-ingest-token" },
      json: canonicalEvent(),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(202);
  });

  it("keeps accepting legacy heartbeats and does not write event rows for them", async () => {
    const harness = createWorkerHarness();
    const request = workerRequest({
      path: "/v1/telemetry/event",
      headers: legacyKeyHeaders(),
      json: {
        install_id: INSTALL_ID,
        event_name: "heartbeat",
        timestamp_utc: new Date().toISOString(),
        app_version: "1.3.0",
        properties: { session_id: "legacy-session" },
      },
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(202);
    expect(opsMatching(harness.mock.operations, EVENT_INSERT)).toHaveLength(0);
    expect(opsMatching(harness.mock.operations, SESSION_UPSERT)).toHaveLength(1);
  });

  it("rejects the legacy key once LEGACY_INGEST_KEY_ENABLED is false", async () => {
    const harness = createWorkerHarness({}, { LEGACY_INGEST_KEY_ENABLED: "false" });
    const request = workerRequest({
      path: "/api/ingest",
      headers: legacyKeyHeaders(),
      json: canonicalEvent(),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ ok: false, error: "Invalid install signature." });
    expect(opsMatching(harness.mock.operations, EVENT_INSERT)).toHaveLength(0);
  });

  it("rejects a wrong key and a missing key with 401", async () => {
    const wrong = createWorkerHarness();
    const wrongResponse = await dispatch(
      wrong,
      workerRequest({
        path: "/api/ingest",
        headers: legacyKeyHeaders("not-the-key"),
        json: canonicalEvent(),
      }),
    );
    expect(wrongResponse.status).toBe(401);

    const missing = createWorkerHarness();
    const missingResponse = await dispatch(
      missing,
      workerRequest({ path: "/api/ingest", json: canonicalEvent() }),
    );
    expect(missingResponse.status).toBe(401);
    expect(await readJson(missingResponse)).toEqual({
      ok: false,
      error: "Invalid ingest credentials.",
    });
    expect(missing.mock.operations).toHaveLength(0);
  });

  it("rejects unsigned requests when no shared key is configured at all", async () => {
    const harness = createWorkerHarness({}, { APP_SHARED_KEY: undefined, INGEST_TOKEN: undefined });
    const request = workerRequest({
      path: "/api/ingest",
      headers: legacyKeyHeaders(""),
      json: canonicalEvent(),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(401);
  });
});

describe("worker ingest: payload handling", () => {
  it("returns 413 for bodies over MAX_BODY_BYTES before any auth or DB work", async () => {
    const harness = createWorkerHarness();
    const request = workerRequest({
      path: "/api/ingest",
      headers: legacyKeyHeaders(),
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(413);
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("returns 400 for invalid JSON, empty bodies and unsupported schemas", async () => {
    for (const body of ["{not json", ""]) {
      const harness = createWorkerHarness();
      const response = await dispatch(
        harness,
        workerRequest({ path: "/api/ingest", headers: legacyKeyHeaders(), body }),
      );
      expect(response.status).toBe(400);
      expect(opsMatching(harness.mock.operations, EVENT_INSERT)).toHaveLength(0);
    }

    const harness = createWorkerHarness();
    const response = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest", headers: legacyKeyHeaders(), json: { nope: true } }),
    );
    expect(response.status).toBe(400);
    expect((await readJson(response)).ok).toBe(false);

    const invalid = createWorkerHarness();
    const invalidResponse = await dispatch(
      invalid,
      workerRequest({
        path: "/api/ingest",
        headers: legacyKeyHeaders(),
        json: canonicalEvent({ status: "meh" }),
      }),
    );
    expect(invalidResponse.status).toBe(400);
  });

  it("clamps client timestamps outside the skew window to the server time", async () => {
    const harness = createWorkerHarness();
    const farFuture = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString();
    const before = Date.now();
    const response = await dispatch(
      harness,
      workerRequest({
        path: "/api/ingest",
        headers: legacyKeyHeaders(),
        json: canonicalEvent({ timestamp: farFuture }),
      }),
    );
    const after = Date.now();

    expect(response.status).toBe(202);
    const [insert] = opsMatching(harness.mock.operations, EVENT_INSERT);
    const storedTs = Date.parse(insert.values[3] as string);
    expect(storedTs).toBeGreaterThanOrEqual(before);
    expect(storedTs).toBeLessThanOrEqual(after);
  });

  it("keeps in-window client timestamps unchanged", async () => {
    const harness = createWorkerHarness();
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    await dispatch(
      harness,
      workerRequest({
        path: "/api/ingest",
        headers: legacyKeyHeaders(),
        json: canonicalEvent({ timestamp: recent }),
      }),
    );

    const [insert] = opsMatching(harness.mock.operations, EVENT_INSERT);
    expect(insert.values[3]).toBe(recent);
  });

  it("attaches the edge request context without overriding client-supplied values", async () => {
    const harness = createWorkerHarness();
    await dispatch(
      harness,
      workerRequest({
        path: "/api/ingest",
        headers: { ...legacyKeyHeaders(), "cf-ipcountry": "DE" },
        json: canonicalEvent({
          metrics: { session_id: "session-1", install_id: INSTALL_ID, client_ip: "10.0.0.1" },
        }),
      }),
    );

    const [insert] = opsMatching(harness.mock.operations, EVENT_INSERT);
    const metrics = JSON.parse(insert.values[5] as string) as Record<string, unknown>;
    expect(metrics.client_ip).toBe("10.0.0.1");
    expect(metrics.client_country).toBe("DE");
    expect(metrics.client_geo_source).toBe("edge_ip");
  });
});

describe("worker ingest: rate limit and failures", () => {
  it("returns 429 when the RL_INGEST binding rejects the client IP", async () => {
    const harness = createWorkerHarness();
    const limiter = fakeLimiter(false);
    harness.env.RL_INGEST = limiter;
    const request = workerRequest({
      path: "/api/ingest",
      headers: legacyKeyHeaders(),
      json: canonicalEvent(),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(429);
    expect(await readJson(response)).toEqual({ ok: false, error: "Too many requests." });
    expect(limiter.keys).toEqual([TEST_CLIENT_IP]);
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("still serves ingest when no RL_INGEST binding is configured", async () => {
    const harness = createWorkerHarness({}, { RL_INGEST: undefined });
    const response = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest", headers: legacyKeyHeaders(), json: canonicalEvent() }),
    );
    expect(response.status).toBe(202);
  });

  it("answers a storage failure with a generic 500 carrying a requestId and no SQL", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createWorkerHarness({
      run: [
        {
          match: EVENT_INSERT,
          result: () => {
            throw new Error(
              "D1_ERROR: no such table: telemetry_events: SQLITE_ERROR at INSERT INTO telemetry_events",
            );
          },
        },
      ],
    });
    const request = workerRequest({
      path: "/api/ingest",
      headers: legacyKeyHeaders(),
      json: canonicalEvent(),
    });

    const response = await dispatch(harness, request);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toMatch(/SQLITE|INSERT|telemetry_events|no such table/i);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Internal error.");
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty("details");
    expect(errorSpy).toHaveBeenCalledWith(
      "internal_error",
      expect.objectContaining({ requestId: body.requestId }),
    );
  });

  it("returns a generic 500 when the DB binding is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createWorkerHarness({}, { DB: undefined });
    const response = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest", headers: legacyKeyHeaders(), json: canonicalEvent() }),
    );

    expect(response.status).toBe(500);
    const body = await readJson(response);
    expect(body.error).toBe("Internal error.");
    expect(typeof body.requestId).toBe("string");
  });
});
