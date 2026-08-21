import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import type { D1SessionRow } from "../../functions/_lib/storage";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequest as ingest } from "../../functions/api/ingest";
import { onRequest as legacyRouteIngest } from "../../functions/v1/telemetry/event";
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

const ORIGIN = "https://admin.test";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const OTHER_INSTALL_ID = "0b7e3c44-1d2a-4f9b-9c1e-5a6b7c8d9e0f";
const SESSION_ID = "0b7c4e1a-3d2f-4c8e-9a1b-5e6f7a8b9c0d";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const LEGACY_TOKEN = "legacy-shared-ingest-token";

const INSTALL_LOOKUP = /SELECT .* FROM installs WHERE install_id = \?/;
const SESSION_LOOKUP = /FROM app_sessions WHERE session_id = \?/;
const EVENTS_INSERT = /^INSERT INTO telemetry_events/;
const SESSIONS_UPSERT = /^INSERT INTO app_sessions/;
const COUNTERS_UPSERT = /^INSERT INTO telemetry_counters/;
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

afterEach(() => {
  vi.restoreAllMocks();
});

function installRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    install_id: INSTALL_ID,
    public_key_jwk: JSON.stringify(keys.publicKeyJwk),
    hwid: HWID,
    app_version: "1.4.9",
    created_at: "2026-08-01T00:00:00.000Z",
    last_seen_at: null,
    revoked_at: null,
    license_id: null,
    ...overrides,
  };
}

function sessionRow(installId: string, overrides: Partial<D1SessionRow> = {}): D1SessionRow {
  return {
    session_id: SESSION_ID,
    install_id: installId,
    hwid: HWID,
    source: "razorreaper",
    user_label: "GAMING-PC",
    client_ip: "203.0.113.7",
    client_country: "DE",
    client_city: null,
    client_region: null,
    client_latitude: null,
    client_longitude: null,
    client_timezone: null,
    client_geo_source: null,
    client_geo_signal_source: null,
    client_accuracy_meters: null,
    client_geo_captured_at: null,
    app_version: "1.4.9",
    display_version: "1.4.9",
    platform: "windows",
    os_version: null,
    device_model: null,
    rpc_enabled: null,
    discord_user: null,
    features_json: null,
    started_at: "2026-08-21T11:00:00.000Z",
    last_seen_at: "2026-08-21T11:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    is_active: 1,
    last_event: "session_start",
    last_status: "ok",
    error_count: 0,
    updated_at: "2026-08-21T11:00:00.000Z",
    ...overrides,
  };
}

function db(options: { session?: D1SessionRow | null; resolvers?: MockD1Resolvers } = {}): MockD1 {
  const resolvers = options.resolvers ?? {};
  return createMockD1({
    ...resolvers,
    first: [
      { match: INSTALL_LOOKUP, result: installRow() },
      { match: SESSION_LOOKUP, result: options.session ?? null },
      ...(resolvers.first ?? []),
    ],
  });
}

function env(mock: MockD1, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return { DB: mock.db, INGEST_TOKEN: LEGACY_TOKEN, ...overrides };
}

function payload(
  overrides: Record<string, unknown> = {},
  metrics: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: "razorreaper",
    service: "session_start",
    timestamp: new Date().toISOString(),
    status: "ok",
    metrics: {
      install_id: INSTALL_ID,
      session_id: SESSION_ID,
      hwid: HWID,
      app_version: "1.4.9",
      platform: "windows",
      ...metrics,
    },
    ...overrides,
  };
}

function rawRequest(
  bodyText: string,
  headers: HeadersInit,
  options: { path?: string; method?: string } = {},
): Request {
  const method = options.method ?? "POST";
  return new Request(new URL(options.path ?? "/api/ingest", ORIGIN), {
    method,
    headers: new Headers({
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    }),
    body: method === "GET" ? undefined : bodyText,
  });
}

async function signedRequest(
  body: unknown,
  options: {
    path?: string;
    privateKey?: CryptoKey;
    installId?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  } = {},
): Promise<Request> {
  const path = options.path ?? "/api/ingest";
  const bodyText = options.bodyText ?? JSON.stringify(body);
  const headers = await signedHeaders(
    options.privateKey ?? keys.privateKey,
    {
      installId: options.installId ?? INSTALL_ID,
      method: "POST",
      pathname: new URL(path, ORIGIN).pathname,
      timestamp: String(Math.floor(Date.now() / 1000)),
      bodyText,
    },
    options.headers,
  );
  return rawRequest(bodyText, headers, { path });
}

function legacyRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return rawRequest(JSON.stringify(body), { authorization: `Bearer ${LEGACY_TOKEN}`, ...headers });
}

function ops(mock: MockD1, pattern: RegExp): RecordedD1Operation[] {
  return mock.operations.filter((operation) => pattern.test(operation.normalizedSql));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function eventInsert(mock: MockD1): RecordedD1Operation {
  const inserts = ops(mock, EVENTS_INSERT);
  expect(inserts).toHaveLength(1);
  return inserts[0];
}

function storedMetrics(insert: RecordedD1Operation): Record<string, unknown> {
  const columns = insert.normalizedSql.match(/\(([^)]*)\)\s*VALUES/i)?.[1] ?? "";
  const index = columns
    .split(",")
    .map((c) => c.trim())
    .indexOf("metrics_json");
  expect(index).toBeGreaterThanOrEqual(0);
  return JSON.parse(String(insert.values[index])) as Record<string, unknown>;
}

function storedColumn(insert: RecordedD1Operation, column: string): unknown {
  const columns = insert.normalizedSql.match(/\(([^)]*)\)\s*VALUES/i)?.[1] ?? "";
  const index = columns
    .split(",")
    .map((c) => c.trim())
    .indexOf(column);
  expect(index).toBeGreaterThanOrEqual(0);
  return insert.values[index];
}

describe("POST /api/ingest — routing", () => {
  it("rejects non-POST methods with 405", async () => {
    const response = await ingest({
      request: new Request(`${ORIGIN}/api/ingest`, { method: "GET" }),
      env: env(db()),
    });
    expect(response.status).toBe(405);
  });

  it("/v1/telemetry/event is the same handler", () => {
    expect(legacyRouteIngest).toBe(ingest);
  });
});

describe("POST /api/ingest — signed installs", () => {
  it("accepts a signed event (202), tags the row 'signed' and stamps the verified install id into metrics", async () => {
    const mock = db();
    const spoofed = payload({}, { install_id: OTHER_INSTALL_ID });

    const response = await ingest({ request: await signedRequest(spoofed), env: env(mock) });

    expect(response.status).toBe(202);
    const body = await readJson(response);
    expect(body).toMatchObject({ ok: true, backend: "d1" });
    expect(typeof body.eventId).toBe("string");

    const insert = eventInsert(mock);
    expect(insert.normalizedSql).toContain("ingest_auth_mode");
    expect(storedColumn(insert, "ingest_auth_mode")).toBe("signed");
    expect(storedMetrics(insert).install_id).toBe(INSTALL_ID);
    expect(storedMetrics(insert).session_id).toBe(SESSION_ID);

    const upserts = ops(mock, SESSIONS_UPSERT);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].values[0]).toBe(SESSION_ID);
    expect(upserts[0].values[1]).toBe(INSTALL_ID);
    expect(ops(mock, TOUCH)).toHaveLength(1);
  });

  it("signs over the real pathname, so the legacy /v1/telemetry/event path verifies too", async () => {
    const mock = db();

    const response = await ingest({
      request: await signedRequest(payload(), { path: "/v1/telemetry/event" }),
      env: env(mock),
    });

    expect(response.status).toBe(202);
    expect(storedColumn(eventInsert(mock), "ingest_auth_mode")).toBe("signed");
  });

  it("a bad signature is rejected (401) even when a valid legacy key is also sent", async () => {
    const mock = db();

    const response = await ingest({
      request: await signedRequest(payload(), {
        privateKey: otherKeys.privateKey,
        headers: { authorization: `Bearer ${LEGACY_TOKEN}` },
      }),
      env: env(mock),
    });

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      error: "Invalid install signature.",
    });
    expect(ops(mock, EVENTS_INSERT)).toHaveLength(0);
    expect(ops(mock, SESSIONS_UPSERT)).toHaveLength(0);
  });

  it("refuses to write into a session owned by another install (403) and leaves it untouched", async () => {
    const mock = db({ session: sessionRow(OTHER_INSTALL_ID) });

    const response = await ingest({ request: await signedRequest(payload()), env: env(mock) });

    expect(response.status).toBe(403);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      error: "Session belongs to another install.",
    });
    expect(ops(mock, SESSION_LOOKUP)).toHaveLength(1);
    expect(ops(mock, EVENTS_INSERT)).toHaveLength(0);
    expect(ops(mock, SESSIONS_UPSERT)).toHaveLength(0);
    expect(ops(mock, COUNTERS_UPSERT)).toHaveLength(0);
  });

  it("also protects heartbeats: a signed session_active for a foreign session is refused", async () => {
    const mock = db({ session: sessionRow(OTHER_INSTALL_ID) });

    const response = await ingest({
      request: await signedRequest(payload({ service: "session_active" })),
      env: env(mock),
    });

    expect(response.status).toBe(403);
    expect(ops(mock, SESSIONS_UPSERT)).toHaveLength(0);
  });

  it("does not fall back to KV when ownership fails", async () => {
    const mock = db({ session: sessionRow(OTHER_INSTALL_ID) });
    const puts: string[] = [];
    const kv: NonNullable<RuntimeEnv["KV"]> = {
      get: async () => null,
      put: async (key: string) => {
        puts.push(key);
      },
      delete: async () => undefined,
      list: async () => ({ keys: [], list_complete: true }),
    };

    const response = await ingest({
      request: await signedRequest(payload()),
      env: env(mock, { KV: kv }),
    });

    expect(response.status).toBe(403);
    expect(puts).toEqual([]);
  });

  it("writes into its own existing session (install ids compare case-insensitively)", async () => {
    const mock = db({ session: sessionRow(INSTALL_ID.toUpperCase()) });

    const response = await ingest({
      request: await signedRequest(payload({ service: "app_error", status: "degraded" })),
      env: env(mock),
    });

    expect(response.status).toBe(202);
    expect(ops(mock, EVENTS_INSERT)).toHaveLength(1);
    expect(ops(mock, SESSIONS_UPSERT)).toHaveLength(1);
  });

  it("heartbeats only touch the session row, never the event log", async () => {
    const mock = db();

    const response = await ingest({
      request: await signedRequest(payload({ service: "session_active" })),
      env: env(mock),
    });

    expect(response.status).toBe(202);
    expect(ops(mock, EVENTS_INSERT)).toHaveLength(0);
    expect(ops(mock, SESSIONS_UPSERT)).toHaveLength(1);
  });
});

describe("POST /api/ingest — legacy shared key", () => {
  it("accepts the shared bearer key while LEGACY_INGEST_KEY_ENABLED is unset and tags rows 'legacy_key'", async () => {
    const mock = db();

    const response = await ingest({ request: legacyRequest(payload()), env: env(mock) });

    expect(response.status).toBe(202);
    const insert = eventInsert(mock);
    expect(storedColumn(insert, "ingest_auth_mode")).toBe("legacy_key");
    // Unsigned writes keep the client-supplied install id (nothing to override it with).
    expect(storedMetrics(insert).install_id).toBe(INSTALL_ID);
    expect(ops(mock, INSTALL_LOOKUP)).toHaveLength(0);
    expect(ops(mock, TOUCH)).toHaveLength(0);
  });

  it("accepts the legacy x-app-key header (TELEMETRY_APP_KEY) the same way", async () => {
    const mock = db();

    const response = await ingest({
      request: rawRequest(JSON.stringify(payload()), { "x-app-key": "app-key-1" }),
      env: env(mock, { TELEMETRY_APP_KEY: "app-key-1" }),
    });

    expect(response.status).toBe(202);
    expect(storedColumn(eventInsert(mock), "ingest_auth_mode")).toBe("legacy_key");
  });

  it("still accepts the key when LEGACY_INGEST_KEY_ENABLED=true explicitly", async () => {
    const mock = db();

    const response = await ingest({
      request: legacyRequest(payload()),
      env: env(mock, { LEGACY_INGEST_KEY_ENABLED: "true" }),
    });

    expect(response.status).toBe(202);
  });

  it("rejects the shared key with 401 once LEGACY_INGEST_KEY_ENABLED=false", async () => {
    const mock = db();

    const response = await ingest({
      request: legacyRequest(payload()),
      env: env(mock, { LEGACY_INGEST_KEY_ENABLED: "false" }),
    });

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      error: "Install signature required.",
    });
    expect(ops(mock, EVENTS_INSERT)).toHaveLength(0);
    expect(ops(mock, SESSIONS_UPSERT)).toHaveLength(0);
  });

  it("signed requests keep working when the legacy key is disabled", async () => {
    const mock = db();

    const response = await ingest({
      request: await signedRequest(payload()),
      env: env(mock, { LEGACY_INGEST_KEY_ENABLED: "false", INGEST_TOKEN: undefined }),
    });

    expect(response.status).toBe(202);
  });

  it("rejects requests without any credentials with 401", async () => {
    const mock = db();

    const response = await ingest({
      request: rawRequest(JSON.stringify(payload()), {}),
      env: env(mock),
    });

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      error: "Unauthorized ingestion credentials.",
    });
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects a wrong shared key with 401", async () => {
    const response = await ingest({
      request: rawRequest(JSON.stringify(payload()), { authorization: "Bearer nope" }),
      env: env(db()),
    });

    expect(response.status).toBe(401);
  });

  it("legacy-key writes are not ownership-bound (legacy clients have no install identity)", async () => {
    const mock = db({ session: sessionRow(OTHER_INSTALL_ID) });

    const response = await ingest({ request: legacyRequest(payload()), env: env(mock) });

    expect(response.status).toBe(202);
    expect(ops(mock, SESSIONS_UPSERT)).toHaveLength(1);
  });
});

describe("POST /api/ingest — payload handling", () => {
  it("keeps an in-window client timestamp verbatim", async () => {
    const mock = db();
    const timestamp = new Date(Date.now() - 60_000).toISOString();

    const response = await ingest({
      request: await signedRequest(payload({ timestamp })),
      env: env(mock),
    });

    expect(response.status).toBe(202);
    expect(storedColumn(eventInsert(mock), "ts")).toBe(timestamp);
  });

  it("clamps a client timestamp outside ±10 minutes to the server clock", async () => {
    const mock = db();
    const before = Date.now();

    const response = await ingest({
      request: await signedRequest(
        payload({ timestamp: new Date(before - 7 * 60 * 60 * 1000).toISOString() }),
      ),
      env: env(mock),
    });

    expect(response.status).toBe(202);
    const stored = Date.parse(String(storedColumn(eventInsert(mock), "ts")));
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now());
  });

  it("fills edge request context into metrics without overriding client-supplied values", async () => {
    const mock = db();

    const response = await ingest({
      request: await signedRequest(payload({}, { client_latitude: 51.5 }), {
        headers: { "cf-connecting-ip": "203.0.113.7", "cf-ipcountry": "DE" },
      }),
      env: env(mock),
    });

    expect(response.status).toBe(202);
    const metrics = storedMetrics(eventInsert(mock));
    expect(metrics.client_ip).toBe("203.0.113.7");
    expect(metrics.client_country).toBe("DE");
    expect(metrics.client_latitude).toBe(51.5);
  });

  it("rejects an empty body with 400", async () => {
    const response = await ingest({
      request: await signedRequest(null, { bodyText: "" }),
      env: env(db()),
    });

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ error: "Request body is required." });
  });

  it("rejects invalid JSON with 400 (the signature is over the raw bytes and still verifies)", async () => {
    const response = await ingest({
      request: await signedRequest(null, { bodyText: "{not json" }),
      env: env(db()),
    });

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ error: "Invalid JSON." });
  });

  it("rejects a payload that fails validation with 400", async () => {
    const response = await ingest({
      request: await signedRequest(payload({ status: "meh" })),
      env: env(db()),
    });

    expect(response.status).toBe(400);
  });

  it("rejects a 16 KB + 1 body with 413", async () => {
    const huge = JSON.stringify(payload({}, { pad: "x".repeat(16 * 1024) }));

    const response = await ingest({
      request: await signedRequest(null, { bodyText: huge }),
      env: env(db()),
    });

    expect(response.status).toBe(413);
  });
});

describe("POST /api/ingest — storage failures", () => {
  it("returns a generic 500 with a request id and no SQL when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mock = db({
      resolvers: {
        run: [
          {
            match: EVENTS_INSERT,
            result: () => {
              throw new Error("D1_ERROR: no such table: telemetry_events (INSERT INTO ...)");
            },
          },
        ],
      },
    });

    const response = await ingest({ request: await signedRequest(payload()), env: env(mock) });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, error: "Unable to save the operation." });
    expect(text).not.toContain("no such table");
    expect(text).not.toContain("INSERT");
    expect(response.headers.get("x-request-id")).toMatch(/\S/);
  });
});
