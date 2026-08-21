import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLIENT_CF_HEADER,
  CLIENT_IP_HEADER,
  FORWARDED_HOST_HEADER,
  FORWARDED_PROTO_HEADER,
  ORIGIN_KEY_HEADER,
  buildClientResponse,
  buildOriginRequest,
  isProxyModeEnabled,
  proxyToOrigin,
  readOriginProxyConfig,
  type OriginProxyConfig,
} from "../../shared/origin-proxy";

const ORIGIN_KEY = "k".repeat(40);
const CFG: OriginProxyConfig = { originBase: "https://origin.test", originKey: ORIGIN_KEY };

type RequestWithCf = Request & { cf?: Record<string, unknown> };

function incoming(
  path: string,
  init: RequestInit & { cf?: Record<string, unknown> } = {},
): Request {
  const { cf, ...requestInit } = init;
  const request = new Request(new URL(path, "https://backend.workers.test"), requestInit);
  if (cf) {
    Object.defineProperty(request, "cf", { value: cf, enumerable: false });
  }
  return request;
}

function decodeBase64UrlJson(text: string): unknown {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(padded));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isProxyModeEnabled / readOriginProxyConfig", () => {
  it("is ON only when ORIGIN_BASE and ORIGIN_KEY are both non-empty", () => {
    expect(isProxyModeEnabled({})).toBe(false);
    expect(isProxyModeEnabled({ ORIGIN_BASE: "https://origin.test" })).toBe(false);
    expect(isProxyModeEnabled({ ORIGIN_KEY: ORIGIN_KEY })).toBe(false);
    expect(isProxyModeEnabled({ ORIGIN_BASE: "  ", ORIGIN_KEY: ORIGIN_KEY })).toBe(false);
    expect(isProxyModeEnabled({ ORIGIN_BASE: "https://origin.test", ORIGIN_KEY: "" })).toBe(false);
    expect(isProxyModeEnabled({ ORIGIN_BASE: 42, ORIGIN_KEY: ORIGIN_KEY })).toBe(false);
    expect(isProxyModeEnabled({ ORIGIN_BASE: "https://origin.test", ORIGIN_KEY })).toBe(true);
  });

  it("trims and drops trailing slashes from the base", () => {
    expect(readOriginProxyConfig({ ORIGIN_BASE: " https://origin.test// ", ORIGIN_KEY })).toEqual({
      originBase: "https://origin.test",
      originKey: ORIGIN_KEY,
    });
    expect(readOriginProxyConfig({ ORIGIN_BASE: "https://origin.test" })).toBeNull();
  });
});

describe("buildOriginRequest", () => {
  it("targets originBase + path + query byte-for-byte", () => {
    const request = incoming("/api/admin/licenses/RR%2FABC?x=1&y=%20a&z");
    const built = buildOriginRequest(request, CFG);
    expect(built.url).toBe("https://origin.test/api/admin/licenses/RR%2FABC?x=1&y=%20a&z");
    expect(buildOriginRequest(request, { ...CFG, originBase: "https://origin.test/" }).url).toBe(
      "https://origin.test/api/admin/licenses/RR%2FABC?x=1&y=%20a&z",
    );
  });

  it("passes method and body through and uses redirect: manual", async () => {
    const request = incoming("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    const built = buildOriginRequest(request, CFG);
    expect(built.method).toBe("POST");
    expect(built.redirect).toBe("manual");
    expect(await built.text()).toBe('{"a":1}');

    const get = buildOriginRequest(incoming("/api/x"), CFG);
    expect(get.method).toBe("GET");
    expect(get.body).toBeNull();
    const head = buildOriginRequest(incoming("/api/x", { method: "HEAD" }), CFG);
    expect(head.body).toBeNull();
  });

  it("forwards ordinary headers unchanged and drops hop-by-hop / edge / spoofable ones", () => {
    const request = incoming("/api/ingest", {
      method: "POST",
      headers: {
        host: "backend.workers.test",
        "cf-connecting-ip": "203.0.113.7",
        "cf-ipcountry": "DE",
        "cf-ray": "abc-FRA",
        "x-forwarded-for": "203.0.113.7",
        "x-forwarded-proto": "https",
        "x-real-ip": "203.0.113.7",
        "content-length": "7",
        connection: "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        upgrade: "h2c",
        te: "trailers",
        trailer: "x",
        "proxy-authorization": "Basic xyz",
        "proxy-connection": "keep-alive",
        "x-rr-origin-key": "spoofed",
        "x-rr-client-ip": "1.2.3.4",
        "x-rr-client-cf": "eyJjb3VudHJ5IjoiWFgifQ",
        "x-rr-forwarded-host": "evil.example",
        "x-rr-forwarded-proto": "http",
        // forwarded as-is
        "cf-access-jwt-assertion": "jwt-token",
        "cf-access-authenticated-user-email": "admin@example.com",
        cookie: "rr_session=abc",
        authorization: "Bearer shared-key",
        "content-type": "application/json",
        "x-rr-install": "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13",
        "x-rr-timestamp": "1700000000",
        "x-rr-signature": "sig",
        "x-app-key": "legacy",
        "user-agent": "RazorReaper/1.4.9",
        origin: "https://app",
      },
      body: '{"a":1}',
    });

    const built = buildOriginRequest(request, CFG);
    const h = built.headers;
    for (const dropped of [
      "cf-connecting-ip",
      "cf-ipcountry",
      "cf-ray",
      "x-forwarded-for",
      "x-forwarded-proto",
      "x-real-ip",
      "connection",
      "keep-alive",
      "transfer-encoding",
      "upgrade",
      "te",
      "trailer",
      "proxy-authorization",
      "proxy-connection",
    ]) {
      expect(h.get(dropped), dropped).toBeNull();
    }
    expect(h.get("host")).not.toBe("backend.workers.test");
    expect(h.get("content-length")).not.toBe("7");

    expect(h.get("cf-access-jwt-assertion")).toBe("jwt-token");
    expect(h.get("cf-access-authenticated-user-email")).toBe("admin@example.com");
    expect(h.get("cookie")).toBe("rr_session=abc");
    expect(h.get("authorization")).toBe("Bearer shared-key");
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("x-rr-install")).toBe("6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13");
    expect(h.get("x-rr-timestamp")).toBe("1700000000");
    expect(h.get("x-rr-signature")).toBe("sig");
    expect(h.get("x-app-key")).toBe("legacy");
    expect(h.get("user-agent")).toBe("RazorReaper/1.4.9");
    expect(h.get("origin")).toBe("https://app");

    // Client-supplied forwarding headers are replaced, never merged.
    expect(h.get(ORIGIN_KEY_HEADER)).toBe(ORIGIN_KEY);
    expect(h.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
    expect(decodeBase64UrlJson(h.get(CLIENT_CF_HEADER)!)).toEqual({});
    expect(h.get(FORWARDED_HOST_HEADER)).toBe("backend.workers.test");
    expect(h.get(FORWARDED_PROTO_HEADER)).toBe("https");
  });

  it("encodes the whitelisted request.cf keys into X-RR-Client-CF", () => {
    const request = incoming("/api/ingest", {
      cf: {
        country: "DE",
        city: "Berlin",
        region: "Berlin",
        regionCode: "BE",
        postalCode: "10115",
        latitude: "52.52000",
        longitude: "13.40500",
        timezone: "Europe/Berlin",
        continent: "EU",
        colo: "FRA",
        asn: 3320,
        asOrganization: "Deutsche Telekom",
        // not whitelisted
        tlsVersion: "TLSv1.3",
        botManagement: { score: 1 },
        city2: null,
      },
    });
    const built = buildOriginRequest(request, CFG);
    expect(decodeBase64UrlJson(built.headers.get(CLIENT_CF_HEADER)!)).toEqual({
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      regionCode: "BE",
      postalCode: "10115",
      latitude: "52.52000",
      longitude: "13.40500",
      timezone: "Europe/Berlin",
      continent: "EU",
      colo: "FRA",
      asn: 3320,
      asOrganization: "Deutsche Telekom",
    });
  });

  it("sends an empty X-RR-Client-IP when the request has no cf-connecting-ip", () => {
    const built = buildOriginRequest(incoming("/api/x"), CFG);
    expect(built.headers.get(CLIENT_IP_HEADER)).toBe("");
    expect((incoming("/api/x") as RequestWithCf).cf).toBeUndefined();
  });
});

describe("proxyToOrigin", () => {
  it("returns the origin status, body and headers (incl. 4xx/5xx) without CORS", async () => {
    for (const status of [200, 201, 401, 404, 429, 500]) {
      const fetchImpl = vi.fn(
        async () =>
          new Response(`body-${status}`, {
            status,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "retry-after": "60",
              "x-request-id": "abc",
              "set-cookie": "rr_session=1; HttpOnly",
            },
          }),
      );
      const response = await proxyToOrigin(incoming("/api/x"), CFG, fetchImpl as typeof fetch);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(`body-${status}`);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("retry-after")).toBe("60");
      expect(response.headers.get("x-request-id")).toBe("abc");
      expect(response.headers.get("set-cookie")).toBe("rr_session=1; HttpOnly");
      for (const name of response.headers.keys()) {
        expect(name.startsWith("access-control-")).toBe(false);
      }
    }
  });

  it("hands the built origin request and a timeout signal to fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await proxyToOrigin(
      incoming("/api/ingest?q=1", { method: "POST", body: "payload" }),
      CFG,
      fetchImpl as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [sent, init] = fetchImpl.mock.calls[0] as unknown as [Request, RequestInit];
    expect(sent).toBeInstanceOf(Request);
    expect(sent.url).toBe("https://origin.test/api/ingest?q=1");
    expect(sent.headers.get(ORIGIN_KEY_HEADER)).toBe(ORIGIN_KEY);
    expect(await sent.text()).toBe("payload");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("strips hop-by-hop, content-length and content-encoding from the origin response", () => {
    const upstream = new Response("x", {
      status: 200,
      headers: {
        connection: "close",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        upgrade: "h2c",
        te: "trailers",
        trailer: "x",
        "content-length": "1",
        "content-encoding": "gzip",
        "content-type": "text/plain",
        "cache-control": "no-store",
      },
    });
    const response = buildClientResponse(upstream);
    for (const name of [
      "connection",
      "keep-alive",
      "transfer-encoding",
      "upgrade",
      "te",
      "trailer",
      "content-length",
      "content-encoding",
    ]) {
      expect(response.headers.get(name), name).toBeNull();
    }
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 JSON when fetch rejects and never logs the origin URL or key", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed: https://origin.test/api/x with ${ORIGIN_KEY}`);
    });
    const response = await proxyToOrigin(incoming("/api/x"), CFG, fetchImpl as typeof fetch);
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Backend temporarily unavailable." });
    for (const name of response.headers.keys()) {
      expect(name.startsWith("access-control-")).toBe(false);
    }

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [label, details] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(label).toBe("origin_proxy_failed");
    const logged = JSON.stringify(details);
    expect(logged).not.toContain(ORIGIN_KEY);
    expect(logged).not.toContain("origin.test");
    expect(logged).toContain("fetch failed");
  });

  it("answers 503 when the origin does not respond within timeoutMs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const response = await proxyToOrigin(
      incoming("/api/x"),
      { ...CFG, timeoutMs: 20 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "Backend temporarily unavailable." });
  });
});
