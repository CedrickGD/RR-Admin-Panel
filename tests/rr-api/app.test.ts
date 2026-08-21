// End-to-end: the real worker + the generated Pages route table through createApp(), on an
// in-memory SQLite bootstrapped from schema.sql (the handlers' ensure* DDL runs on top).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import worker, { resetWorkerStateForTests } from "../../backend-worker/index.js";
import { createApp, isWorkerPath, type RrApiApp } from "../../deploy/nas/rr-api/src/app";
import { applySchema, locateSchemaFile } from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { buildRuntimeEnv, type RrApiEnv } from "../../deploy/nas/rr-api/src/env";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import {
  generateInstallKeyPair,
  signedHeaders,
  type InstallKeyPair,
} from "../helpers/install-signer";
import {
  TEST_ACCESS_AUD,
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  getTestAccessSigner,
} from "../helpers/request";
import { readFileSync } from "node:fs";

const ORIGIN = "http://rr-api.test";
const SHARED_KEY = "legacy-shared-key";
const ADMIN_EMAIL = "admin@example.com";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const HWID = "A1B2C3D4E5B60718293A4B5C6D7E8F90";

let handle: SqliteDatabaseHandle;
let env: RrApiEnv;
let api: RrApiApp;
let keys: InstallKeyPair;

beforeAll(async () => {
  resetWorkerStateForTests();
  resetInstallsSchemaStateForTests();
  resetRateLimitsForTests();

  handle = createInMemoryDatabase();
  const schemaPath = locateSchemaFile();
  if (!schemaPath) throw new Error("schema.sql not found");
  applySchema(handle, readFileSync(schemaPath, "utf8"));

  env = buildRuntimeEnv(
    {
      APP_SHARED_KEY: SHARED_KEY,
      LEGACY_INGEST_KEY_ENABLED: "true",
      AUTH_MODE: "access",
      ACCESS_TEAM_DOMAIN: TEST_ACCESS_TEAM_DOMAIN,
      ACCESS_AUD: TEST_ACCESS_AUD,
      ACCESS_ALLOWED_EMAIL: ADMIN_EMAIL,
    },
    createD1Database(handle),
  );
  api = createApp({ env, worker });
  keys = await generateInstallKeyPair();

  // Access JWT verification fetches the team JWKS; serve the shared test signer's key instead.
  const signer = await getTestAccessSigner();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `https://${TEST_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify(signer.jwks), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://media.razorreaper.app/")) {
        return new Response("png-bytes", {
          status: 200,
          headers: { "content-type": "image/png", etag: '"abc"' },
        });
      }
      throw new Error(`Unexpected network request in test: ${url}`);
    }),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await api.drain();
  handle.close();
});

interface CallOptions {
  method?: string;
  headers?: HeadersInit;
  json?: unknown;
  clientIp?: string;
}

function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("cf-connecting-ip", options.clientIp ?? "203.0.113.7");
  const body = options.json === undefined ? undefined : JSON.stringify(options.json);
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return api.fetch(
    new Request(new URL(path, ORIGIN), {
      method: options.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
    }),
  );
}

async function signedCall(
  path: string,
  privateKey: CryptoKey,
  options: CallOptions & { installId?: string } = {},
): Promise<Response> {
  const body = options.json === undefined ? "" : JSON.stringify(options.json);
  const method = options.method ?? (body ? "POST" : "GET");
  const headers = await signedHeaders(
    privateKey,
    {
      installId: options.installId ?? INSTALL_ID,
      method,
      pathname: new URL(path, ORIGIN).pathname,
      timestamp: String(Math.floor(Date.now() / 1000)),
      bodyText: body,
    },
    options.headers,
  );
  headers.set("cf-connecting-ip", options.clientIp ?? "203.0.113.7");
  if (body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return api.fetch(
    new Request(new URL(path, ORIGIN), { method, headers, body: body || undefined }),
  );
}

function event(service: string, sessionId: string, extra: Record<string, unknown> = {}) {
  return {
    source: "razorreaper",
    service,
    timestamp: new Date().toISOString(),
    status: "ok",
    metrics: {
      session_id: sessionId,
      install_id: INSTALL_ID,
      hwid: HWID,
      app_version: "1.4.9",
      platform: "windows",
      ...extra,
    },
  };
}

function row<T = Record<string, unknown>>(sql: string, ...values: unknown[]): T | undefined {
  return handle.prepare(sql).get(...values) as T | undefined;
}

describe("rr-api app", () => {
  it("answers its own /health and routes /api/health + /healthz to the worker", async () => {
    const own = await call("/health");
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ ok: true, service: "rr-api" });

    const viaWorker = await call("/api/health");
    expect(viaWorker.status).toBe(200);
    expect(await viaWorker.json()).toEqual({ ok: true, service: "backend" });
    expect((await call("/healthz")).status).toBe(200);
  });

  it("classifies worker-owned paths", () => {
    expect(isWorkerPath("/api/ingest")).toBe(true);
    expect(isWorkerPath("/v1/telemetry/event")).toBe(true);
    expect(isWorkerPath("/api/install/register")).toBe(true);
    expect(isWorkerPath("/media/images/x.png")).toBe(true);
    expect(isWorkerPath("/update/update.xml")).toBe(true);
    expect(isWorkerPath("/api/admin/data")).toBe(false);
    expect(isWorkerPath("/health")).toBe(false);
  });

  it("returns the 404 JSON for unknown routes", async () => {
    const response = await call("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Route not found." });
  });

  it("accepts a legacy-key ingest (202) and stores the event + cf geo context", async () => {
    const response = await call("/api/ingest", {
      headers: {
        "x-app-key": SHARED_KEY,
        "cf-ipcountry": "DE",
        "cf-ipcity": "Berlin",
        "cf-region": "Berlin",
        "cf-iplatitude": "52.52",
        "cf-iplongitude": "13.405",
        "cf-timezone": "Europe/Berlin",
      },
      json: event("session_start", "session-legacy"),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.backend).toBe("d1");

    const stored = row<{ ingest_auth_mode: string; metrics_json: string; service: string }>(
      "SELECT ingest_auth_mode, metrics_json, service FROM telemetry_events WHERE event_id = ?",
      body.eventId,
    );
    expect(stored?.ingest_auth_mode).toBe("legacy_key");
    expect(stored?.service).toBe("session_start");
    const metrics = JSON.parse(stored!.metrics_json) as Record<string, unknown>;
    expect(metrics.client_country).toBe("DE");
    expect(metrics.client_city).toBe("Berlin");
    expect(metrics.client_ip).toBe("203.0.113.7");
    expect(metrics.client_latitude).toBeCloseTo(52.52);

    const session = row<{ client_country: string; client_city: string; client_timezone: string }>(
      "SELECT client_country, client_city, client_timezone FROM app_sessions WHERE session_id = ?",
      "session-legacy",
    );
    expect(session).toEqual({
      client_country: "DE",
      client_city: "Berlin",
      client_timezone: "Europe/Berlin",
    });
  });

  it("rejects a wrong legacy key with 401", async () => {
    const response = await call("/api/ingest", {
      headers: { "x-app-key": "nope" },
      json: event("session_start", "session-bad"),
    });
    expect(response.status).toBe(401);
  });

  it("registers an install (201) and accepts a signed ingest (202)", async () => {
    const register = await call("/api/install/register", {
      json: {
        install_id: INSTALL_ID,
        hwid: HWID,
        public_key: keys.publicKeyJwk,
        app_version: "1.4.9",
      },
    });
    expect(register.status).toBe(201);
    expect(((await register.json()) as Record<string, unknown>).install_id).toBe(INSTALL_ID);

    const install = row<{ install_id: string; hwid: string; revoked_at: string | null }>(
      "SELECT install_id, hwid, revoked_at FROM installs WHERE install_id = ?",
      INSTALL_ID,
    );
    expect(install).toEqual({ install_id: INSTALL_ID, hwid: HWID, revoked_at: null });

    const again = await call("/api/install/register", {
      json: { install_id: INSTALL_ID, hwid: HWID, public_key: keys.publicKeyJwk },
    });
    expect(again.status).toBe(200);

    const ingest = await signedCall("/v1/telemetry/event", keys.privateKey, {
      json: event("session_start", "session-signed"),
    });
    expect(ingest.status).toBe(202);
    const body = (await ingest.json()) as Record<string, unknown>;
    const stored = row<{ ingest_auth_mode: string }>(
      "SELECT ingest_auth_mode FROM telemetry_events WHERE event_id = ?",
      body.eventId,
    );
    expect(stored?.ingest_auth_mode).toBe("signed");
    expect(
      row<{ install_id: string }>(
        "SELECT install_id FROM app_sessions WHERE session_id = ?",
        "session-signed",
      )?.install_id,
    ).toBe(INSTALL_ID);
  });

  it("refuses a signed ingest from an unknown install (401)", async () => {
    const other = await generateInstallKeyPair();
    const response = await signedCall("/api/ingest", other.privateKey, {
      installId: "0b7e5a1c-3d2f-4e6a-9c8b-1a2b3c4d5e6f",
      json: event("session_start", "session-unknown"),
    });
    expect(response.status).toBe(401);
  });

  it("serves GET /api/announcements/active through the Pages route table", async () => {
    const response = await call("/api/announcements/active");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, announcements: [] });
  });

  it("answers POST /api/access/status with a clear verdict", async () => {
    const response = await call("/api/access/status", { json: { hwid: HWID } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, suspended: false });
    expect((await call("/api/access/status")).status).toBe(405);
  });

  it("keeps the admin routes closed without an Access JWT", async () => {
    const data = await call("/api/admin/data");
    expect(data.status).toBe(401);
    expect((await call("/api/admin/installs?hwid=" + HWID)).status).toBe(401);
  });

  it("serves static and param admin routes with a verified Access JWT", async () => {
    const headers = await accessIdentityHeaders(ADMIN_EMAIL);
    const list = await call(`/api/admin/installs?hwid=${HWID}`, { headers });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { installs: Array<{ installId: string }> };
    expect(listed.installs.map((install) => install.installId)).toEqual([INSTALL_ID]);

    const revoke = await call(`/api/admin/installs/${INSTALL_ID.toUpperCase()}/revoke`, {
      headers: await accessIdentityHeaders(ADMIN_EMAIL),
      json: { reason: "leaked" },
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toEqual({ ok: true, installId: INSTALL_ID, revoked: true });
    expect(
      row<{ revoke_reason: string }>(
        "SELECT revoke_reason FROM installs WHERE install_id = ?",
        INSTALL_ID,
      )?.revoke_reason,
    ).toBe("leaked");

    // Revoked installs can no longer ingest with their signature.
    const afterRevoke = await signedCall("/api/ingest", keys.privateKey, {
      json: event("session_active", "session-signed"),
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("proxies /media/* through the worker without an edge cache (caches shim)", async () => {
    const response = await call("/media/images/presets/default.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-media-cache")).toBe("miss");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("png-bytes");
    await api.drain();

    const preflight = await call("/media/images/presets/default.png", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect((await call("/media/images/")).status).toBe(400);
  });

  it("rate-limits the 61st ingest from one cf-connecting-ip with 429", async () => {
    const clientIp = "198.51.100.9";
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      const response = await call("/api/ingest", {
        clientIp,
        headers: { "x-app-key": SHARED_KEY },
        json: event("update_check", `session-rl-${index}`),
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 202)).toBe(true);
    expect(statuses[60]).toBe(429);
    // A different client is unaffected.
    const other = await call("/api/ingest", {
      clientIp: "198.51.100.10",
      headers: { "x-app-key": SHARED_KEY },
      json: event("update_check", "session-rl-other"),
    });
    expect(other.status).toBe(202);
  });

  it("rate-limits registration per ip via the in-process RL_REGISTER binding", async () => {
    const clientIp = "198.51.100.77";
    let limited = 0;
    for (let index = 0; index < 8; index += 1) {
      const response = await call("/api/install/register", {
        clientIp,
        json: { install_id: "not-a-guid" },
      });
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
