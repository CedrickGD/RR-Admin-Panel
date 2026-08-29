import { describe, expect, it, vi } from "vitest";
import { handlePagesRequest, type PagesProxyEnv } from "../deploy/pages/worker";

function env(overrides: Partial<PagesProxyEnv> = {}): PagesProxyEnv {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response("asset", { status: 200 })),
    },
    ORIGIN_BASE: "https://origin.example.test",
    ORIGIN_KEY: "origin-secret",
    ...overrides,
  };
}

describe("Pages advanced proxy worker", () => {
  it("serves frontend paths only from the Pages asset binding", async () => {
    const runtime = env();
    const upstream = vi.fn();

    const response = await handlePagesRequest(
      new Request("https://panel.example.test/assets/app.js"),
      runtime,
      upstream as typeof fetch,
    );

    expect(await response.text()).toBe("asset");
    expect(runtime.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["/api", "/api/auth/session", "/v1", "/v1/telemetry/event"])(
    "proxies backend path %s with trusted forwarding headers",
    async (pathname) => {
      const runtime = env();
      const upstream = vi.fn(async (request: Request) => {
        expect(request.url).toBe(`https://origin.example.test${pathname}?probe=1`);
        expect(request.headers.get("x-rr-origin-key")).toBe("origin-secret");
        expect(request.headers.get("x-rr-forwarded-host")).toBe("panel.example.test");
        expect(request.headers.get("cf-access-jwt-assertion")).toBe("access-jwt");
        return Response.json({ ok: true });
      });

      const response = await handlePagesRequest(
        new Request(`https://panel.example.test${pathname}?probe=1`, {
          headers: { "cf-access-jwt-assertion": "access-jwt" },
        }),
        runtime,
        upstream as typeof fetch,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(runtime.ASSETS.fetch).not.toHaveBeenCalled();
      expect(upstream).toHaveBeenCalledOnce();
    },
  );

  it("fails closed when origin proxy configuration is missing", async () => {
    const runtime = env({ ORIGIN_KEY: undefined });
    const upstream = vi.fn();

    const response = await handlePagesRequest(
      new Request("https://panel.example.test/api/auth/session"),
      runtime,
      upstream as typeof fetch,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Backend temporarily unavailable.",
    });
    expect(runtime.ASSETS.fetch).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
});
