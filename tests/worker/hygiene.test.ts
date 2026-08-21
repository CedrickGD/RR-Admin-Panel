import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalEvent,
  createWorkerHarness,
  dispatch,
  legacyKeyHeaders,
  readJson,
  workerRequest,
} from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectNoCorsHeaders(response: Response): void {
  for (const name of response.headers.keys()) {
    expect(name.toLowerCase().startsWith("access-control-")).toBe(false);
  }
}

describe("health endpoints", () => {
  for (const path of ["/health", "/api/health", "/healthz"]) {
    it(`GET ${path} answers without touching D1`, async () => {
      const harness = createWorkerHarness();

      const response = await dispatch(harness, workerRequest({ path }));

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true, service: "backend" });
      expect(harness.mock.operations).toHaveLength(0);
      expectNoCorsHeaders(response);
    });
  }

  it("answers health even when the DB binding is missing", async () => {
    const harness = createWorkerHarness({}, { DB: undefined });

    const response = await dispatch(harness, workerRequest({ path: "/api/health" }));

    expect(response.status).toBe(200);
  });
});

describe("CORS scope", () => {
  it("OPTIONS on API routes answers 204 without CORS headers", async () => {
    const harness = createWorkerHarness();

    for (const path of ["/api/ingest", "/api/install/register", "/v1/telemetry/event"]) {
      const response = await dispatch(
        harness,
        workerRequest({
          method: "OPTIONS",
          path,
          headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
        }),
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expectNoCorsHeaders(response);
    }
  });

  it("API JSON responses carry no access-control-* headers", async () => {
    const harness = createWorkerHarness();

    const accepted = await dispatch(
      harness,
      workerRequest({
        path: "/api/ingest",
        headers: { ...legacyKeyHeaders(), origin: "https://evil.example" },
        json: canonicalEvent(),
      }),
    );
    expect(accepted.status).toBe(202);
    expectNoCorsHeaders(accepted);

    const notFound = await dispatch(
      harness,
      workerRequest({ path: "/nope", headers: { origin: "https://evil.example" } }),
    );
    expect(notFound.status).toBe(404);
    expectNoCorsHeaders(notFound);

    const unauthorized = await dispatch(
      harness,
      workerRequest({ path: "/api/ingest", json: canonicalEvent() }),
    );
    expect(unauthorized.status).toBe(401);
    expectNoCorsHeaders(unauthorized);
  });

  it("/media/* keeps Access-Control-Allow-Origin: * (upstream mocked)", async () => {
    vi.stubGlobal("caches", {
      default: {
        match: async () => undefined,
        put: async () => undefined,
      },
    });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response("png-bytes", {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "9" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const harness = createWorkerHarness();

    const response = await dispatch(
      harness,
      workerRequest({ path: "/media/spots/preview.png", headers: { origin: "https://app" } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/spots/preview.png");
    expect(harness.mock.operations).toHaveLength(0);
  });

  it("/media/* error responses also carry CORS headers", async () => {
    vi.stubGlobal("caches", {
      default: { match: async () => undefined, put: async () => undefined },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const harness = createWorkerHarness();

    const response = await dispatch(harness, workerRequest({ path: "/media/missing.png" }));

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).not.toBeNull();
  });
});

describe("internal error hygiene", () => {
  it("maps unexpected exceptions to a generic 500 with a requestId and logs internal_error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = createWorkerHarness({
      first: [
        {
          match: /FROM installs WHERE install_id = \?/,
          result: () => {
            throw new Error("D1_ERROR: disk I/O error at /var/lib/d1/rr_admin_panel.sqlite");
          },
        },
      ],
    });
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);

    const response = await dispatch(
      harness,
      workerRequest({
        path: "/api/install/register",
        json: {
          install_id: "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13",
          hwid: "A1B2C3D4E5F60718293A4B5C6D7E8F90",
          public_key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
        },
      }),
    );

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toMatch(/D1_ERROR|disk I\/O|sqlite|\/var\/lib/i);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body).toEqual({
      ok: false,
      error: "Internal error.",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(response.headers.get("content-type")).toContain("application/json");

    expect(errorSpy).toHaveBeenCalled();
    const [label, details] = errorSpy.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(label).toBe("internal_error");
    expect(details.requestId).toBe(body.requestId);
    expect(String(details.message)).toContain("disk I/O error");
  });

  it("keeps the dashboard routes disabled on the standalone worker", async () => {
    const harness = createWorkerHarness();

    const response = await dispatch(harness, workerRequest({ path: "/api/admin/data" }));

    expect(response.status).toBe(410);
    expectNoCorsHeaders(response);
  });
});
