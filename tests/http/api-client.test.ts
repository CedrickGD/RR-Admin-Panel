import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchApi, withJsonMutationHeaders } from "../../src/utils/api";

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
});

afterEach(() => {
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
