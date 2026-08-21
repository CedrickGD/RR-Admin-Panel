import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequest as apiMiddleware } from "../../functions/api/_middleware";
import { onRequest as v1Middleware } from "../../functions/v1/_middleware";
import { accessIdentityHeaders, createSyntheticRequest } from "../helpers/request";

const ORIGIN_BASE = "https://origin.test";
const ORIGIN_KEY = "pages-origin-key".padEnd(40, "y");
const PROXY_ENV: RuntimeEnv = { ORIGIN_BASE, ORIGIN_KEY };

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

function stubFetch(status = 200): FetchMock {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true, via: "origin" }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentRequest(fetchMock: FetchMock): Request {
  const input = fetchMock.mock.calls[0]?.[0];
  if (!(input instanceof Request)) {
    throw new Error("middleware must hand a Request object to fetch");
  }
  return input;
}

function localNext(): { next: () => Promise<Response>; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    next: async () => {
      calls.push(1);
      return new Response("local", { status: 200 });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("functions/api/_middleware (proxy mode)", () => {
  it("forwards admin requests with cf-access-jwt-assertion and cookie (not the unverified email header), never calling next()", async () => {
    const fetchMock = stubFetch();
    const local = localNext();
    const headers = await accessIdentityHeaders("admin@example.com", {
      cookie: "rr_session=abc",
      "cf-connecting-ip": "203.0.113.9",
      "cf-ipcountry": "DE",
    });
    const request = createSyntheticRequest({ path: "/api/admin/data?range=7d", headers });
    const jwt = headers.get("cf-access-jwt-assertion");

    const response = await apiMiddleware({ request, env: PROXY_ENV, next: local.next });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, via: "origin" });
    expect(local.calls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${ORIGIN_BASE}/api/admin/data?range=7d`);
    expect(sent.headers.get("cf-access-jwt-assertion")).toBe(jwt);
    // Only the verifiable assertion crosses; the unverified identity header is dropped.
    expect(sent.headers.get("cf-access-authenticated-user-email")).toBeNull();
    expect(sent.headers.get("cookie")).toBe("rr_session=abc");
    expect(sent.headers.get("x-rr-origin-key")).toBe(ORIGIN_KEY);
    expect(sent.headers.get("x-rr-client-ip")).toBe("203.0.113.9");
    expect(sent.headers.get("x-rr-forwarded-host")).toBe("admin.test");
    expect(sent.headers.get("cf-connecting-ip")).toBeNull();
    expect(sent.headers.get("cf-ipcountry")).toBeNull();
  });

  it("forwards POST bodies (ingest, license) unchanged", async () => {
    const fetchMock = stubFetch(202);
    const local = localNext();
    const request = createSyntheticRequest({
      path: "/api/ingest",
      headers: { "x-app-key": "legacy" },
      json: { install_id: "abc", event_name: "heartbeat", timestamp_utc: "2026-08-21T00:00:00Z" },
    });

    const response = await apiMiddleware({ request, env: PROXY_ENV, next: local.next });

    expect(response.status).toBe(202);
    expect(local.calls).toHaveLength(0);
    const sent = sentRequest(fetchMock);
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("x-app-key")).toBe("legacy");
    expect(await sent.json()).toEqual({
      install_id: "abc",
      event_name: "heartbeat",
      timestamp_utc: "2026-08-21T00:00:00Z",
    });
  });

  it("skips /api/health (next() runs, nothing is forwarded)", async () => {
    const fetchMock = stubFetch();
    const local = localNext();
    const request = createSyntheticRequest({ path: "/api/health" });

    const response = await apiMiddleware({ request, env: PROXY_ENV, next: local.next });

    expect(await response.text()).toBe("local");
    expect(local.calls).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls next() when proxy mode is OFF", async () => {
    const fetchMock = stubFetch();
    for (const env of [{}, { ORIGIN_BASE }, { ORIGIN_KEY }, { ORIGIN_BASE: " ", ORIGIN_KEY }]) {
      const local = localNext();
      const request = createSyntheticRequest({ path: "/api/admin/data" });

      const response = await apiMiddleware({ request, env, next: local.next });

      expect(await response.text()).toBe("local");
      expect(local.calls).toHaveLength(1);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the origin is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const local = localNext();
    const request = createSyntheticRequest({ path: "/api/announcements/active" });

    const response = await apiMiddleware({ request, env: PROXY_ENV, next: local.next });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "Backend temporarily unavailable." });
    expect(local.calls).toHaveLength(0);
  });
});

describe("functions/v1/_middleware (proxy mode)", () => {
  it("forwards /v1/telemetry/event and calls next() when OFF", async () => {
    const fetchMock = stubFetch(202);
    const forwarded = localNext();
    const request = createSyntheticRequest({
      path: "/v1/telemetry/event",
      headers: { authorization: "Bearer ingest-token" },
      json: { source: "razorreaper" },
    });

    const response = await v1Middleware({ request, env: PROXY_ENV, next: forwarded.next });
    expect(response.status).toBe(202);
    expect(forwarded.calls).toHaveLength(0);
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${ORIGIN_BASE}/v1/telemetry/event`);
    expect(sent.headers.get("authorization")).toBe("Bearer ingest-token");

    const local = localNext();
    const offResponse = await v1Middleware({
      request: createSyntheticRequest({ path: "/v1/telemetry/event", json: {} }),
      env: {},
      next: local.next,
    });
    expect(await offResponse.text()).toBe("local");
    expect(local.calls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
