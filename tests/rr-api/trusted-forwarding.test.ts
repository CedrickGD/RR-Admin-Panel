import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import worker, { resetWorkerStateForTests } from "../../backend-worker/index.js";
import { createApp, type RrApiApp } from "../../deploy/nas/rr-api/src/app";
import { applySchema, locateSchemaFile } from "../../deploy/nas/rr-api/src/bootstrap";
import { attachCloudflareContext } from "../../deploy/nas/rr-api/src/cf-request";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { buildRuntimeEnv } from "../../deploy/nas/rr-api/src/env";
import {
  applyTrustedForwarding,
  decodeClientCf,
  readRequestHost,
} from "../../deploy/nas/rr-api/src/trusted-forwarding";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { encodeClientCf } from "../../shared/origin-proxy";
import { readRequestContext } from "../../shared/telemetry-contract";

const ORIGIN_KEY = "nas-origin-key".padEnd(40, "z");
const ORIGIN_HOST = "origin.test";
const TUNNEL_IP = "198.51.100.1";
const CLIENT_IP = "203.0.113.7";
const UNAUTHORIZED = { ok: false, error: "Unauthorized origin request." };

type RequestWithCf = Request & { cf?: Record<string, unknown> };

function tunnelRequest(
  path: string,
  headers: Record<string, string> = {},
  init: RequestInit = {},
  host = "api.test",
): Request {
  return new Request(new URL(path, `https://${host}`), {
    ...init,
    headers: {
      host,
      "cf-connecting-ip": TUNNEL_IP,
      "cf-ipcountry": "US",
      "cf-ray": "8f1a2b3c4d5e6f70-IAD",
      ...headers,
    },
  });
}

function forwardingHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "x-rr-origin-key": ORIGIN_KEY,
    "x-rr-client-ip": CLIENT_IP,
    "x-rr-client-cf": encodeClientCf({
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      latitude: "52.52000",
      longitude: "13.40500",
      timezone: "Europe/Berlin",
      colo: "FRA",
      asn: 3320,
    }),
    "x-rr-forwarded-host": "backend.rr-admin-panel.workers.dev",
    "x-rr-forwarded-proto": "https",
    ...overrides,
  };
}

function expectStripped(request: Request): void {
  for (const name of [
    "x-rr-origin-key",
    "x-rr-client-ip",
    "x-rr-client-cf",
    "x-rr-forwarded-host",
    "x-rr-forwarded-proto",
  ]) {
    expect(request.headers.get(name), name).toBeNull();
  }
}

describe("applyTrustedForwarding", () => {
  it("trusts a valid key: cf-connecting-ip + cf come from the proxy, X-RR-* headers are stripped", async () => {
    const incoming = tunnelRequest(
      "/api/ingest?x=1",
      {
        ...forwardingHeaders(),
        "x-rr-install": "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13",
        "x-app-key": "legacy",
      },
      { method: "POST", body: '{"hello":"world"}' },
    );

    const result = applyTrustedForwarding(incoming, {
      originKey: ORIGIN_KEY,
      originHost: ORIGIN_HOST,
    });
    if (!result.ok) throw new Error("expected the request to pass");

    expect(result.trusted).toBe(true);
    expectStripped(result.request);
    expect(result.request.headers.get("cf-connecting-ip")).toBe(CLIENT_IP);
    expect(result.request.headers.get("x-rr-install")).toBe("6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13");
    expect(result.request.headers.get("x-app-key")).toBe("legacy");
    expect(result.request.method).toBe("POST");
    expect(result.request.url).toBe("https://api.test/api/ingest?x=1");
    expect(await result.request.text()).toBe('{"hello":"world"}');

    expect(result.cf).toEqual({
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      latitude: "52.52000",
      longitude: "13.40500",
      timezone: "Europe/Berlin",
      colo: "FRA",
      asn: "3320",
    });

    const request = attachCloudflareContext(result.request, result.cf) as RequestWithCf;
    expect(request.cf).toEqual({
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      latitude: "52.52000",
      longitude: "13.40500",
      timezone: "Europe/Berlin",
      colo: "FRA",
      asn: "3320",
      ray: "8f1a2b3c4d5e6f70-IAD",
    });
    const context = readRequestContext(request);
    expect(context.clientIp).toBe(CLIENT_IP);
    expect(context.country).toBe("DE");
    expect(context.city).toBe("Berlin");
    expect(context.latitude).toBeCloseTo(52.52);
  });

  it("rejects a wrong key with 401 (any host)", async () => {
    for (const host of ["api.test", ORIGIN_HOST]) {
      const result = applyTrustedForwarding(
        tunnelRequest("/api/ingest", forwardingHeaders({ "x-rr-origin-key": "wrong" }), {}, host),
        { originKey: ORIGIN_KEY, originHost: ORIGIN_HOST },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected 401");
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual(UNAUTHORIZED);
    }
    // Same length, different content.
    const result = applyTrustedForwarding(
      tunnelRequest(
        "/api/ingest",
        forwardingHeaders({ "x-rr-origin-key": ORIGIN_KEY.slice(0, -1) + "A" }),
      ),
      { originKey: ORIGIN_KEY },
    );
    expect(result.ok).toBe(false);
  });

  it("enforces ORIGIN_HOST: no key on that host -> 401, except /health", async () => {
    const denied = applyTrustedForwarding(tunnelRequest("/api/ingest", {}, {}, ORIGIN_HOST), {
      originKey: ORIGIN_KEY,
      originHost: ORIGIN_HOST,
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) throw new Error("expected 401");
    expect(denied.response.status).toBe(401);
    expect(await denied.response.json()).toEqual(UNAUTHORIZED);

    const health = applyTrustedForwarding(tunnelRequest("/health", {}, {}, ORIGIN_HOST), {
      originKey: ORIGIN_KEY,
      originHost: ORIGIN_HOST,
    });
    expect(health.ok).toBe(true);

    // Host matching ignores case and port; X-Forwarded-Host is honoured when Host is absent.
    const upper = applyTrustedForwarding(tunnelRequest("/api/x", {}, {}, "ORIGIN.test:8787"), {
      originKey: ORIGIN_KEY,
      originHost: ORIGIN_HOST,
    });
    expect(upper.ok).toBe(false);
    const viaForwarded = new Request("https://internal/api/x", {
      headers: { "x-forwarded-host": ORIGIN_HOST },
    });
    expect(
      applyTrustedForwarding(viaForwarded, { originKey: ORIGIN_KEY, originHost: ORIGIN_HOST }).ok,
    ).toBe(false);

    // Key + origin host -> trusted.
    const trusted = applyTrustedForwarding(
      tunnelRequest("/api/ingest", forwardingHeaders(), {}, ORIGIN_HOST),
      { originKey: ORIGIN_KEY, originHost: ORIGIN_HOST },
    );
    expect(trusted.ok && trusted.trusted).toBe(true);

    // Other hosts stay open without a key.
    const publicHost = applyTrustedForwarding(tunnelRequest("/api/ingest"), {
      originKey: ORIGIN_KEY,
      originHost: ORIGIN_HOST,
    });
    expect(publicHost.ok && !publicHost.trusted).toBe(true);

    // ORIGIN_HOST without ORIGIN_KEY: nothing can be trusted, so the host is closed.
    const noKey = applyTrustedForwarding(
      tunnelRequest("/api/ingest", forwardingHeaders(), {}, ORIGIN_HOST),
      { originKey: "", originHost: ORIGIN_HOST },
    );
    expect(noKey.ok).toBe(false);
  });

  it("ignores and strips the X-RR-* headers when no ORIGIN_KEY is configured", () => {
    for (const originKey of [undefined, "", "   "]) {
      const result = applyTrustedForwarding(tunnelRequest("/api/ingest", forwardingHeaders()), {
        originKey,
      });
      if (!result.ok) throw new Error("expected the request to pass");
      expect(result.trusted).toBe(false);
      expect(result.cf).toEqual({});
      expectStripped(result.request);
      expect(result.request.headers.get("cf-connecting-ip")).toBe(TUNNEL_IP);
      expect(result.request.headers.get("cf-ipcountry")).toBe("US");
    }
  });

  it("strips stray X-RR-* headers from untrusted requests and leaves clean ones untouched", () => {
    const stray = applyTrustedForwarding(
      tunnelRequest("/api/ingest", { "x-rr-client-ip": CLIENT_IP, "x-rr-forwarded-proto": "http" }),
      { originKey: ORIGIN_KEY, originHost: ORIGIN_HOST },
    );
    if (!stray.ok) throw new Error("expected the request to pass");
    expect(stray.trusted).toBe(false);
    expectStripped(stray.request);
    expect(stray.request.headers.get("cf-connecting-ip")).toBe(TUNNEL_IP);

    const clean = tunnelRequest("/api/ingest");
    const passed = applyTrustedForwarding(clean, {
      originKey: ORIGIN_KEY,
      originHost: ORIGIN_HOST,
    });
    if (!passed.ok) throw new Error("expected the request to pass");
    expect(passed.request).toBe(clean);
  });

  it("keeps the tunnel ip when X-RR-Client-IP is not a valid IPv4/IPv6 literal", () => {
    for (const bad of ["", "not-an-ip", "203.0.113.7, 10.0.0.1", "1.2.3", "::g"]) {
      const result = applyTrustedForwarding(
        tunnelRequest("/api/ingest", forwardingHeaders({ "x-rr-client-ip": bad })),
        { originKey: ORIGIN_KEY },
      );
      if (!result.ok) throw new Error("expected the request to pass");
      expect(result.trusted).toBe(true);
      expect(result.request.headers.get("cf-connecting-ip"), bad).toBe(TUNNEL_IP);
    }
    const v6 = applyTrustedForwarding(
      tunnelRequest("/api/ingest", forwardingHeaders({ "x-rr-client-ip": "2001:db8::1" })),
      { originKey: ORIGIN_KEY },
    );
    if (!v6.ok) throw new Error("expected the request to pass");
    expect(v6.request.headers.get("cf-connecting-ip")).toBe("2001:db8::1");
  });

  it("ignores a malformed X-RR-Client-CF and filters non-whitelisted / oversized values", () => {
    expect(decodeClientCf(null)).toEqual({});
    expect(decodeClientCf("")).toEqual({});
    expect(decodeClientCf("not*base64url")).toEqual({});
    expect(decodeClientCf(Buffer.from("{not json").toString("base64url"))).toEqual({});
    expect(decodeClientCf(Buffer.from('["DE"]').toString("base64url"))).toEqual({});
    expect(decodeClientCf(Buffer.from("null").toString("base64url"))).toEqual({});
    expect(
      decodeClientCf(
        encodeClientCf({
          country: "DE",
          city: "x".repeat(129),
          region: 12.5,
          timezone: { nested: true },
          tlsVersion: "TLSv1.3",
          botManagement: { score: 1 },
          latitude: "",
        }),
      ),
    ).toEqual({ country: "DE", region: "12.5" });

    const result = applyTrustedForwarding(
      tunnelRequest("/api/ingest", forwardingHeaders({ "x-rr-client-cf": "%%%" })),
      { originKey: ORIGIN_KEY },
    );
    if (!result.ok) throw new Error("expected the request to pass");
    expect(result.trusted).toBe(true);
    expect(result.cf).toEqual({});
    const request = attachCloudflareContext(result.request, result.cf) as RequestWithCf;
    expect(request.cf).toEqual({ country: "US", ray: "8f1a2b3c4d5e6f70-IAD", colo: "IAD" });
  });

  it("reads the request host from Host, X-Forwarded-Host or the URL", () => {
    expect(
      readRequestHost(new Request("https://a.test/x", { headers: { host: "B.test:443" } })),
    ).toBe("b.test");
    expect(
      readRequestHost(
        new Request("https://a.test/x", { headers: { "x-forwarded-host": "c.test" } }),
      ),
    ).toBe("c.test");
    expect(readRequestHost(new Request("https://a.test:8443/x"))).toBe("a.test");
    expect(readRequestHost(new Request("https://[::1]:8787/x"))).toBe("[::1]");
  });
});

describe("trusted forwarding through createApp", () => {
  const SHARED_KEY = "legacy-shared-key";
  let handle: SqliteDatabaseHandle;
  let api: RrApiApp;

  beforeAll(() => {
    resetWorkerStateForTests();
    resetInstallsSchemaStateForTests();
    resetRateLimitsForTests();
    handle = createInMemoryDatabase();
    const schemaPath = locateSchemaFile();
    if (!schemaPath) throw new Error("schema.sql not found");
    applySchema(handle, readFileSync(schemaPath, "utf8"));
    const env = buildRuntimeEnv(
      {
        APP_SHARED_KEY: SHARED_KEY,
        LEGACY_INGEST_KEY_ENABLED: "true",
        ORIGIN_KEY,
        ORIGIN_HOST,
      },
      createD1Database(handle),
    );
    api = createApp({ env, worker });
  });

  afterAll(async () => {
    await api.drain();
    handle.close();
  });

  function event(sessionId: string): Record<string, unknown> {
    return {
      source: "razorreaper",
      service: "session_start",
      timestamp: new Date().toISOString(),
      status: "ok",
      metrics: {
        session_id: sessionId,
        install_id: "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13",
        app_version: "1.4.9",
        platform: "windows",
      },
    };
  }

  it("stores the forwarded client ip + geo for a trusted ingest on the origin host", async () => {
    const response = await api.fetch(
      tunnelRequest(
        "/api/ingest",
        { ...forwardingHeaders(), "x-app-key": SHARED_KEY, "content-type": "application/json" },
        { method: "POST", body: JSON.stringify(event("session-proxied")) },
        ORIGIN_HOST,
      ),
    );
    expect(response.status).toBe(202);

    const session = handle
      .prepare(
        "SELECT client_ip, client_country, client_city, client_timezone FROM app_sessions WHERE session_id = ?",
      )
      .get("session-proxied") as Record<string, unknown> | undefined;
    expect(session).toEqual({
      client_ip: CLIENT_IP,
      client_country: "DE",
      client_city: "Berlin",
      client_timezone: "Europe/Berlin",
    });
  });

  it("refuses the origin host without the key (401) but keeps /health and the public host open", async () => {
    const denied = await api.fetch(
      tunnelRequest(
        "/api/ingest",
        { "x-app-key": SHARED_KEY, "content-type": "application/json" },
        { method: "POST", body: JSON.stringify(event("session-denied")) },
        ORIGIN_HOST,
      ),
    );
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual(UNAUTHORIZED);

    const health = await api.fetch(tunnelRequest("/health", {}, {}, ORIGIN_HOST));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "rr-api" });

    const direct = await api.fetch(
      tunnelRequest(
        "/api/ingest",
        {
          "x-app-key": SHARED_KEY,
          "content-type": "application/json",
          // A spoof attempt over the public host: no key -> ignored + stripped.
          "x-rr-client-ip": "192.0.2.99",
        },
        { method: "POST", body: JSON.stringify(event("session-direct")) },
      ),
    );
    expect(direct.status).toBe(202);
    const session = handle
      .prepare("SELECT client_ip, client_country FROM app_sessions WHERE session_id = ?")
      .get("session-direct") as Record<string, unknown> | undefined;
    expect(session).toEqual({ client_ip: TUNNEL_IP, client_country: "US" });
  });

  it("rejects a wrong key on any host with 401", async () => {
    const response = await api.fetch(
      tunnelRequest("/api/announcements/active", { "x-rr-origin-key": "nope" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED);
  });
});
