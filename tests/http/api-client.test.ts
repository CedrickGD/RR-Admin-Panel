import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchApi,
  fetchSession,
  SessionExpiredError,
  withJsonMutationHeaders,
} from "../../src/utils/api";

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("withJsonMutationHeaders", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "delete"])(
    "adds the JSON content type to a bodyless %s request",
    (method) => {
      const normalized = withJsonMutationHeaders({ method, credentials: "include" });

      expect(new Headers(normalized.headers).get("content-type")).toBe("application/json");
      expect(normalized.credentials).toBe("include");
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])("does not modify a %s request", (method) => {
    const init: RequestInit = { method };

    expect(withJsonMutationHeaders(init)).toBe(init);
  });

  it("preserves an explicit mutation content type and the original init", () => {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/custom+json", "x-test": "kept" },
      body: "payload",
    };

    const normalized = withJsonMutationHeaders(init);

    expect(normalized).toBe(init);
    expect(new Headers(normalized.headers).get("content-type")).toBe("application/custom+json");
    expect(new Headers(normalized.headers).get("x-test")).toBe("kept");
  });

  it("applies the JSON content type before fetch sends a bodyless DELETE", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    await fetchApi("/api/admin/announcements/42", { method: "DELETE" }, { retry: false });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });
});

describe("fetchSession", () => {
  const authenticatedSession = {
    authenticated: true,
    hasUsers: true,
    authMode: "access" as const,
    user: { email: "admin@example.test", role: "admin" as const },
  };

  function useFakeWindowTimers(): void {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
  }

  it("accepts an explicit unauthenticated verdict from a successful session response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ authenticated: false, hasUsers: true, authMode: "app" }),
    );

    await expect(fetchSession()).resolves.toEqual({
      authenticated: false,
      hasUsers: true,
      authMode: "app",
    });
  });

  it("recovers when the built-in retry succeeds after a transient network failure", async () => {
    useFakeWindowTimers();
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(Response.json(authenticatedSession));

    const assertion = expect(fetchSession()).resolves.toEqual(authenticatedSession);
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
  });

  it("rejects repeated network failures instead of inventing an unauthenticated verdict", async () => {
    useFakeWindowTimers();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unavailable"));

    const assertion = expect(fetchSession()).rejects.toThrow("network unavailable");
    await vi.advanceTimersByTimeAsync(400);
    await assertion;
  });

  it("rejects request timeouts instead of inventing an unauthenticated verdict", async () => {
    useFakeWindowTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        }),
    );

    const assertion = expect(fetchSession()).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it.each([
    ["a 5xx response", Response.json({ error: "temporary failure" }, { status: 503 })],
    ["a JWKS verifier failure", Response.json({ error: "JWKS unavailable" }, { status: 500 })],
    ["malformed JSON", new Response("<html>edge error</html>", { status: 200 })],
    ["an invalid session schema", Response.json({ authenticated: "no", hasUsers: true })],
  ])("rejects %s instead of inventing an unauthenticated verdict", async (_label, response) => {
    useFakeWindowTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => response.clone());

    const assertion = expect(fetchSession()).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("preserves the guarded Cloudflare Access redirect reload behavior", async () => {
    const reload = vi.fn();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: { reload },
    });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302 }));

    await expect(fetchSession()).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(fetchSession()).rejects.toBeInstanceOf(SessionExpiredError);

    expect(reload).toHaveBeenCalledOnce();
  });
});
