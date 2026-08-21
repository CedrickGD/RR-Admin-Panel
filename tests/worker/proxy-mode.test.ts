import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_BODY_BYTES } from "../../shared/telemetry-contract";
import {
  TEST_CLIENT_IP,
  canonicalEvent,
  createWorkerHarness,
  dispatch,
  legacyKeyHeaders,
  readJson,
  workerRequest,
  type WorkerHarness,
} from "./helpers";

const ORIGIN_BASE = "https://origin.test";
const ORIGIN_KEY = "origin-key-".padEnd(40, "x");
const PROXY_ENV = { ORIGIN_BASE, ORIGIN_KEY };

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

function stubFetch(
  respond: (request: Request) => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ ok: true, via: "origin" }), {
      status: 202,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
): FetchMock {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return respond(request);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentRequest(fetchMock: FetchMock, index = 0): Request {
  const input = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) {
    throw new Error("proxy must hand a Request object to fetch");
  }
  return input;
}

function proxyHarness(): WorkerHarness {
  return createWorkerHarness({}, PROXY_ENV);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proxy mode ON", () => {
  it("forwards POST /api/ingest with body + forwarding headers and touches no D1", async () => {
    const fetchMock = stubFetch();
    const harness = proxyHarness();
    const event = canonicalEvent();

    const response = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest?src=app", headers: legacyKeyHeaders(), json: event }),
    );

    expect(response.status).toBe(202);
    expect(await readJson(response)).toEqual({ ok: true, via: "origin" });
    expect(harness.mock.operations).toHaveLength(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${ORIGIN_BASE}/api/ingest?src=app`);
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("x-rr-origin-key")).toBe(ORIGIN_KEY);
    expect(sent.headers.get("x-rr-client-ip")).toBe(TEST_CLIENT_IP);
    expect(sent.headers.get("x-rr-client-cf")).toBe("e30"); // base64url("{}")
    expect(sent.headers.get("x-rr-forwarded-host")).toBe("backend.test");
    expect(sent.headers.get("x-rr-forwarded-proto")).toBe("https");
    expect(sent.headers.get("x-app-key")).toBe(legacyKeyHeaders()["x-app-key"]);
    expect(sent.headers.get("content-type")).toBe("application/json");
    expect(sent.headers.get("cf-connecting-ip")).toBeNull();
    expect(await sent.json()).toEqual(event);
  });

  it("forwards /v1/telemetry/event and /api/install/register without D1 access", async () => {
    const fetchMock = stubFetch();
    const harness = proxyHarness();

    const telemetry = await dispatch(
      harness,
      workerRequest({
        path: "/v1/telemetry/event",
        headers: legacyKeyHeaders(),
        json: canonicalEvent(),
      }),
    );
    expect(telemetry.status).toBe(202);
    expect(sentRequest(fetchMock, 0).url).toBe(`${ORIGIN_BASE}/v1/telemetry/event`);

    const register = await dispatch(
      harness,
      workerRequest({ path: "/api/install/register", json: { install_id: "x" } }),
    );
    expect(register.status).toBe(202);
    expect(sentRequest(fetchMock, 1).url).toBe(`${ORIGIN_BASE}/api/install/register`);
    expect(sentRequest(fetchMock, 1).headers.get("x-rr-origin-key")).toBe(ORIGIN_KEY);

    expect(harness.mock.operations).toHaveLength(0);
  });

  it("forwards every other /api/* and /v1/* path, including the formerly disabled dashboard routes", async () => {
    const fetchMock = stubFetch(
      (request) => new Response(`origin:${new URL(request.url).pathname}`, { status: 200 }),
    );
    const harness = proxyHarness();

    for (const path of ["/api/anything", "/api/admin/data", "/api/summary", "/v1/whatever"]) {
      const response = await dispatch(harness, workerRequest({ path }));
      expect(response.status, path).toBe(200);
      expect(await response.text()).toBe(`origin:${path}`);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("passes the origin's 4xx/5xx through unchanged", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ ok: false, error: "Invalid install signature." }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    );
    const harness = proxyHarness();

    const response = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest", json: canonicalEvent() }),
    );
    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ ok: false, error: "Invalid install signature." });
  });

  it("keeps /api/health, /healthz and /health local (no fetch)", async () => {
    const fetchMock = stubFetch();
    const harness = proxyHarness();

    for (const path of ["/api/health", "/healthz", "/health"]) {
      const response = await dispatch(harness, workerRequest({ path }));
      expect(response.status, path).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true, service: "backend" });
    }
    // Non-GET health stays the local 404, not a proxied request.
    const post = await dispatch(harness, workerRequest({ path: "/api/health", method: "POST" }));
    expect(post.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("keeps /media/* on the local media proxy (upstream = MEDIA_ORIGIN, not ORIGIN_BASE)", async () => {
    vi.stubGlobal("caches", {
      default: { match: async () => undefined, put: async () => undefined },
    });
    const fetchMock = stubFetch(
      () =>
        new Response("png-bytes", {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );
    const harness = proxyHarness();

    const response = await dispatch(harness, workerRequest({ path: "/media/spots/preview.png" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://media.razorreaper.app/spots/preview.png",
    );
  });

  it("keeps /update/* on the local GitHub proxy", async () => {
    const fetchMock = stubFetch(
      () =>
        new Response("<item><url>https://github.com/x</url></item>", {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
    );
    const harness = proxyHarness();

    const response = await dispatch(harness, workerRequest({ path: "/update/update.xml" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<url>https://backend.test/update/download</url>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^https:\/\/api\.github\.com\//);
  });

  it("answers OPTIONS, unknown paths and /summary locally", async () => {
    const fetchMock = stubFetch();
    const harness = proxyHarness();

    const preflight = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest", method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(204);
    expect((await dispatch(harness, workerRequest({ path: "/nope" }))).status).toBe(404);
    expect((await dispatch(harness, workerRequest({ path: "/summary" }))).status).toBe(410);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still applies the local per-IP rate limit before forwarding ingest", async () => {
    const fetchMock = stubFetch();
    const harness = proxyHarness();

    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      const response = await dispatch(
        harness,
        workerRequest({
          path: "/api/ingest",
          headers: legacyKeyHeaders(),
          json: canonicalEvent(),
          clientIp: "198.51.100.40",
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 202)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(60);
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("rejects an oversized declared body locally (413) instead of forwarding it", async () => {
    const fetchMock = stubFetch();
    const harness = proxyHarness();

    const response = await dispatch(
      harness,
      workerRequest({
        path: "/api/ingest",
        headers: { ...legacyKeyHeaders(), "content-length": String(MAX_BODY_BYTES + 1) },
        body: "{}",
      }),
    );
    expect(response.status).toBe(413);
    expect(await readJson(response)).toEqual({
      ok: false,
      error: `Payload exceeds ${MAX_BODY_BYTES} bytes.`,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the origin is unreachable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const harness = proxyHarness();

    const response = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest", headers: legacyKeyHeaders(), json: canonicalEvent() }),
    );
    expect(response.status).toBe(503);
    expect(await readJson(response)).toEqual({
      ok: false,
      error: "Backend temporarily unavailable.",
    });
    expect(errorSpy).toHaveBeenCalledWith("origin_proxy_failed", expect.any(Object));
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(ORIGIN_KEY);
  });
});

describe("proxy mode OFF", () => {
  it("needs BOTH ORIGIN_BASE and ORIGIN_KEY; otherwise the worker serves locally as before", async () => {
    const fetchMock = stubFetch();
    for (const envOverrides of [
      {},
      { ORIGIN_BASE },
      { ORIGIN_KEY },
      { ORIGIN_BASE: "", ORIGIN_KEY },
    ]) {
      const harness = createWorkerHarness({}, envOverrides);

      const ingest = await dispatch(
        harness,
        workerRequest({ path: "/api/ingest", headers: legacyKeyHeaders(), json: canonicalEvent() }),
      );
      expect(ingest.status).toBe(202);
      expect(harness.mock.operations.length).toBeGreaterThan(0);

      const admin = await dispatch(harness, workerRequest({ path: "/api/admin/data" }));
      expect(admin.status).toBe(410);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
