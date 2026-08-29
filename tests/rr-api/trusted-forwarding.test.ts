import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import worker, { resetWorkerStateForTests } from "../../backend-worker/index.js";
import { createApp, parseWorkerHosts, type RrApiApp } from "../../deploy/nas/rr-api/src/app";
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
  readForwardedHost,
  readRequestHost,
  rebuildClientUrl,
} from "../../deploy/nas/rr-api/src/trusted-forwarding";
import { createSessionCookie } from "../../functions/_lib/auth";
import { enforceSameOriginMutation } from "../../functions/_lib/csrf";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { buildOriginRequest, encodeClientCf } from "../../shared/origin-proxy";
import { readRequestContext } from "../../shared/telemetry-contract";
import {
  TEST_ACCESS_AUD,
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  getTestAccessSigner,
} from "../helpers/request";

const ORIGIN_KEY = "nas-origin-key".padEnd(40, "z");
const ORIGIN_HOST = "origin.test";
const WORKER_HOST = "backend.rr-admin-panel.workers.dev";
const PAGES_HOST = "rr-admin-panel.pages.dev";
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
    // Trusted: the URL moves to the forwarded proto/host, path + query untouched.
    expect(result.request.url).toBe("https://backend.rr-admin-panel.workers.dev/api/ingest?x=1");
    expect(result.forwardedHost).toBe("backend.rr-admin-panel.workers.dev");
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

  it("moves a trusted request onto the forwarded proto/host so same-origin checks see the client URL", async () => {
    // What the Pages shell delivers over the tunnel: Host = origin host, browser Origin intact.
    const incoming = tunnelRequest(
      "/api/admin/licenses?x=1",
      {
        ...forwardingHeaders({ "x-rr-forwarded-host": PAGES_HOST }),
        origin: `https://${PAGES_HOST}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      { method: "POST", body: '{"type":"lifetime"}' },
      ORIGIN_HOST,
    );
    // The tunnel speaks plain http to the container.
    const tunnelUrl = new Request(incoming.url.replace("https://", "http://"), incoming);
    expect(tunnelUrl.url).toBe(`http://${ORIGIN_HOST}/api/admin/licenses?x=1`);

    const result = applyTrustedForwarding(tunnelUrl, {
      originKey: ORIGIN_KEY,
      originHost: ORIGIN_HOST,
    });
    if (!result.ok) throw new Error("expected the request to pass");
    expect(result.trusted).toBe(true);
    expect(result.forwardedHost).toBe(PAGES_HOST);
    expect(result.request.url).toBe(`https://${PAGES_HOST}/api/admin/licenses?x=1`);
    expect(result.request.method).toBe("POST");
    expect(result.request.headers.get("origin")).toBe(`https://${PAGES_HOST}`);
    expect(result.request.headers.get("cf-connecting-ip")).toBe(CLIENT_IP);
    expectStripped(result.request);
    expect(await result.request.text()).toBe('{"type":"lifetime"}');

    // The CSRF guard compares Origin with request.url: the dashboard mutation passes …
    expect(enforceSameOriginMutation(result.request)).toBeNull();
    // … and the session cookie keeps its Secure flag (the tunnel URL was http).
    expect(createSessionCookie("tok", result.request)).toContain("; Secure");
  });

  it("still blocks a cross-site Origin on a trusted mutation", () => {
    const incoming = tunnelRequest(
      "/api/admin/licenses",
      {
        ...forwardingHeaders({ "x-rr-forwarded-host": PAGES_HOST }),
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      { method: "POST", body: "{}" },
      ORIGIN_HOST,
    );
    const result = applyTrustedForwarding(incoming, { originKey: ORIGIN_KEY });
    if (!result.ok) throw new Error("expected the request to pass");
    expect(enforceSameOriginMutation(result.request)?.status).toBe(403);
  });

  it("keeps the tunnel URL when the forwarded host/proto is absent or not a plain host", () => {
    const tunnelUrl = `https://${ORIGIN_HOST}/api/admin/data?q=1`;
    for (const forwardedHost of [
      "",
      "   ",
      "evil.example/@x",
      "user@evil.example",
      "evil example",
      "evil.example:99999x",
      "[::1]:8787",
      "http://evil.example",
      "-bad.example",
    ]) {
      const headers =
        forwardedHost === ""
          ? forwardingHeaders()
          : forwardingHeaders({ "x-rr-forwarded-host": forwardedHost });
      if (forwardedHost === "") delete headers["x-rr-forwarded-host"];
      const request = tunnelRequest("/api/admin/data?q=1", headers, {}, ORIGIN_HOST);
      expect(readForwardedHost(request), forwardedHost).toBeNull();
      const result = applyTrustedForwarding(request, { originKey: ORIGIN_KEY });
      if (!result.ok) throw new Error("expected the request to pass");
      expect(result.trusted).toBe(true);
      expect(result.forwardedHost, forwardedHost).toBeNull();
      expect(result.request.url, forwardedHost).toBe(tunnelUrl);
      expectStripped(result.request);
    }

    // Bogus proto: host still moves, the tunnel scheme stays.
    const badProto = applyTrustedForwarding(
      tunnelRequest(
        "/api/x",
        forwardingHeaders({ "x-rr-forwarded-host": PAGES_HOST, "x-rr-forwarded-proto": "ftp" }),
        {},
        ORIGIN_HOST,
      ),
      { originKey: ORIGIN_KEY },
    );
    if (!badProto.ok) throw new Error("expected the request to pass");
    expect(badProto.request.url).toBe(`https://${PAGES_HOST}/api/x`);

    // Host[:port] and upper-case are accepted and normalised.
    const withPort = tunnelRequest(
      "/api/x",
      forwardingHeaders({ "x-rr-forwarded-host": "Admin.Example:8443" }),
      {},
      ORIGIN_HOST,
    );
    expect(readForwardedHost(withPort)).toBe("admin.example:8443");
    expect(rebuildClientUrl(withPort)).toBe("https://admin.example:8443/api/x");
  });

  it("never rewrites the URL of an untrusted request, whatever X-RR-Forwarded-* it carries", () => {
    const spoofed = tunnelRequest("/api/admin/data", {
      "x-rr-forwarded-host": PAGES_HOST,
      "x-rr-forwarded-proto": "https",
      origin: `https://${PAGES_HOST}`,
    });
    for (const options of [{ originKey: ORIGIN_KEY, originHost: ORIGIN_HOST }, { originKey: "" }]) {
      const result = applyTrustedForwarding(spoofed, options);
      if (!result.ok) throw new Error("expected the request to pass");
      expect(result.trusted).toBe(false);
      expect(result.forwardedHost).toBeNull();
      expect(result.request.url).toBe("https://api.test/api/admin/data");
      expectStripped(result.request);
    }
  });

  it("parses WORKER_HOST as a lower-cased, comma-separated set", () => {
    expect(parseWorkerHosts(undefined)).toEqual(new Set());
    expect(parseWorkerHosts("")).toEqual(new Set());
    expect(parseWorkerHosts(` ${WORKER_HOST.toUpperCase()}, backend-staging.test ,`)).toEqual(
      new Set([WORKER_HOST, "backend-staging.test"]),
    );
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
  const ADMIN_EMAIL = "admin@example.com";
  let handle: SqliteDatabaseHandle;
  let api: RrApiApp;

  beforeAll(async () => {
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
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: TEST_ACCESS_TEAM_DOMAIN,
        ACCESS_AUD: TEST_ACCESS_AUD,
        ACCESS_ALLOWED_EMAIL: ADMIN_EMAIL,
        ORIGIN_KEY,
        ORIGIN_HOST,
        WORKER_HOST,
      },
      createD1Database(handle),
    );
    api = createApp({ env, worker });

    // Access JWT verification fetches the team JWKS; serve the shared test signer's key instead.
    const signer = await getTestAccessSigner();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === `https://${TEST_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
          return new Response(JSON.stringify(signer.jwks), {
            status: 200,
            headers: { "content-type": "application/json" },
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

  /** What rr-api receives when the Pages shell forwards a browser request over the tunnel. */
  async function viaPagesShell(
    path: string,
    init: {
      method?: string;
      json?: unknown;
      origin?: string | null;
      headers?: HeadersInit;
    } = {},
  ): Promise<Request> {
    const headers = await accessIdentityHeaders(ADMIN_EMAIL, {
      "cf-connecting-ip": CLIENT_IP,
      "sec-fetch-site": "same-origin",
      ...(init.json === undefined ? {} : { "content-type": "application/json" }),
      ...Object.fromEntries(new Headers(init.headers)),
    });
    if (init.origin !== null) {
      headers.set("origin", init.origin ?? `https://${PAGES_HOST}`);
    }
    const browserRequest = new Request(new URL(path, `https://${PAGES_HOST}`), {
      method: init.method ?? (init.json === undefined ? "GET" : "POST"),
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
    });
    const forwarded = buildOriginRequest(browserRequest, {
      originBase: `https://${ORIGIN_HOST}`,
      originKey: ORIGIN_KEY,
    });
    // cloudflared hands the container the tunnel hostname over plain http.
    const tunnelHeaders = new Headers(forwarded.headers);
    tunnelHeaders.set("host", ORIGIN_HOST);
    return new Request(forwarded.url.replace("https://", "http://"), {
      method: forwarded.method,
      headers: tunnelHeaders,
      body: forwarded.body,
      duplex: "half",
    } as RequestInit);
  }

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

  it("accepts a dashboard mutation forwarded by the Pages shell (same-origin guard sees the browser URL)", async () => {
    const created = await api.fetch(
      await viaPagesShell("/api/admin/announcements", {
        json: { title: "Proxied", body: "Created through the shell", level: "info" },
      }),
    );
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const row = handle
      .prepare("SELECT id, title, body, level, is_active FROM announcements WHERE title = ?")
      .get("Proxied") as
      | {
          id: number;
          title: string;
          body: string;
          level: string;
          is_active: number;
        }
      | undefined;
    expect(row).toEqual({
      id: expect.any(Number),
      title: "Proxied",
      body: "Created through the shell",
      level: "info",
      is_active: 1,
    });
    if (!row) throw new Error("expected the announcement to be created");

    const edited = await api.fetch(
      await viaPagesShell(`/api/admin/announcements/${row.id}`, {
        method: "PUT",
        json: {
          title: "Proxied edited",
          body: "Updated through the shell",
          level: "warning",
        },
      }),
    );
    expect(edited.status, await edited.clone().text()).toBeLessThan(300);
    expect(
      handle
        .prepare("SELECT title, body, level, is_active FROM announcements WHERE id = ?")
        .get(row.id),
    ).toEqual({
      title: "Proxied edited",
      body: "Updated through the shell",
      level: "warning",
      is_active: 1,
    });

    const toggled = await api.fetch(
      await viaPagesShell(`/api/admin/announcements/${row.id}`, {
        method: "PUT",
        json: { is_active: false },
      }),
    );
    expect(toggled.status, await toggled.clone().text()).toBeLessThan(300);
    expect(
      handle
        .prepare("SELECT title, body, level, is_active FROM announcements WHERE id = ?")
        .get(row.id),
    ).toEqual({
      title: "Proxied edited",
      body: "Updated through the shell",
      level: "warning",
      is_active: 0,
    });

    const deleted = await api.fetch(
      await viaPagesShell(`/api/admin/announcements/${row.id}`, {
        method: "DELETE",
        // Match the browser client exactly: DELETE has no body, but still declares JSON so the
        // streamed Pages -> NAS request satisfies the same-origin mutation contract.
        headers: { "content-type": "application/json" },
      }),
    );
    expect(deleted.status, await deleted.clone().text()).toBeLessThan(300);
    expect(handle.prepare("SELECT id FROM announcements WHERE id = ?").get(row.id)).toBeUndefined();

    // A cross-site Origin is still refused behind the shell.
    const crossSite = await api.fetch(
      await viaPagesShell("/api/admin/announcements", {
        json: { title: "Evil", body: "nope" },
        origin: "https://evil.example",
      }),
    );
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toMatchObject({
      ok: false,
      error: "Cross-site request blocked.",
    });

    // Reads work too (the Access JWT is verified on rr-api).
    const list = await api.fetch(await viaPagesShell("/api/admin/announcements"));
    expect(list.status).toBe(200);
  });

  it("serves requests forwarded from the worker hostname with the worker surface only", async () => {
    const fromWorker = (
      path: string,
      headers: Record<string, string> = {},
      init: RequestInit = {},
    ): Request =>
      tunnelRequest(
        path,
        { ...forwardingHeaders({ "x-rr-forwarded-host": WORKER_HOST }), ...headers },
        init,
        ORIGIN_HOST,
      );

    // Ingest still lands (worker handler, real client ip).
    const ingest = await api.fetch(
      fromWorker(
        "/api/ingest",
        { "x-app-key": SHARED_KEY, "content-type": "application/json" },
        { method: "POST", body: JSON.stringify(event("session-worker-shell")) },
      ),
    );
    expect(ingest.status).toBe(202);
    expect(
      handle
        .prepare("SELECT client_ip FROM app_sessions WHERE session_id = ?")
        .get("session-worker-shell"),
    ).toEqual({ client_ip: CLIENT_IP });

    // Pages-only routes answer exactly like the standalone worker does today: 410 / 404.
    const dashboard = await api.fetch(fromWorker("/api/admin/data"));
    expect(dashboard.status).toBe(410);
    const publicRoute = await api.fetch(fromWorker("/api/announcements/active"));
    expect(publicRoute.status).toBe(404);
    expect(await publicRoute.json()).toEqual({ ok: false, error: "Route not found." });

    // The same public route forwarded by the Pages shell (or reached directly) is served.
    const viaPages = await api.fetch(
      fromWorker("/api/announcements/active", { "x-rr-forwarded-host": PAGES_HOST }),
    );
    expect(viaPages.status).toBe(200);
    const direct = await api.fetch(tunnelRequest("/api/announcements/active"));
    expect(direct.status).toBe(200);
  });
});
