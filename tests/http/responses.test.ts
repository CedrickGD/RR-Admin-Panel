import { afterEach, describe, expect, it, vi } from "vitest";

import { internalError } from "../../functions/_lib/responses";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("internalError", () => {
  it("propagates a valid incoming request ID in the header and stable error details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = new Request("https://admin.test/api/example", {
      headers: { "x-request-id": "edge-request-001" },
    });

    const response = internalError(request, "Unable to complete the request.", new Error("boom"));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("edge-request-001");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Unable to complete the request.",
      details: { requestId: "edge-request-001" },
    });
  });

  it("generates a request ID when none is supplied", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = internalError(
      new Request("https://admin.test/api/example"),
      "Internal service failure.",
      new Error("boom"),
    );
    const requestId = response.headers.get("x-request-id");
    const body = (await response.json()) as { details?: { requestId?: string } };

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.details?.requestId).toBe(requestId);
  });

  it("replaces an invalid or overlong incoming request ID", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const invalid = `contains spaces ${"x".repeat(200)}`;
    const response = internalError(
      new Request("https://admin.test/api/example", {
        headers: { "x-request-id": invalid },
      }),
      "Internal service failure.",
      null,
    );

    expect(response.headers.get("x-request-id")).not.toBe(invalid);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("never includes the raw cause, D1/SQL/path/upstream body, token, or license key publicly", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rawCause =
      "D1_ERROR: SELECT * FROM licenses at C:\\workers\\schema.sql; " +
      "upstream body=<html>failure</html>; token=raw-token; license_key=RR-RAW-LICENSE";
    const cause = new Error(rawCause);
    Object.assign(cause, {
      Authorization: "Bearer raw-authorization",
      nested: { LicenseKey: "RR-NESTED-LICENSE" },
    });

    const response = internalError(
      new Request("https://admin.test/api/example", {
        headers: { "x-request-id": "safe-request-42" },
      }),
      "Unable to save the operation.",
      cause,
    );
    const publicText = await response.text();

    for (const privateFragment of [
      "D1_ERROR",
      "SELECT *",
      "C:\\workers\\schema.sql",
      "<html>failure</html>",
      "raw-token",
      "RR-RAW-LICENSE",
      "raw-authorization",
      "RR-NESTED-LICENSE",
    ]) {
      expect(publicText).not.toContain(privateFragment);
    }
    expect(publicText).toContain("Unable to save the operation.");

    expect(log).toHaveBeenCalledTimes(1);
    const [label, logged] = log.mock.calls[0];
    expect(label).toBe("internal_error");
    expect(logged).toMatchObject({
      requestId: "safe-request-42",
      cause: {
        name: "Error",
        Authorization: "[REDACTED]",
        nested: { LicenseKey: "[REDACTED]" },
      },
    });
    const loggedText = JSON.stringify(logged);
    expect(loggedText).not.toContain("raw-token");
    expect(loggedText).not.toContain("raw-authorization");
    expect(loggedText).not.toContain("RR-NESTED-LICENSE");
  });

  it("does not accept a raw cause message as the public message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = new Error("SQLITE_CONSTRAINT at /srv/private/db.sql token=private");

    const response = internalError(
      new Request("https://admin.test/api/example"),
      cause.message,
      cause,
    );

    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain(cause.message);
  });

  it.each([
    "D1_ERROR: database unavailable",
    "SELECT * FROM licenses",
    "failed at /etc/razor-reaper/private.sql",
    "failed at C:\\workers\\private.sql",
    "upstream response=<html>private</html>",
    "token=public-token",
    "license_key=RR-PUBLIC-LICENSE",
  ])("rejects technical or sensitive public-message input: %s", async (publicMessage) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = internalError(
      new Request("https://admin.test/api/example"),
      publicMessage,
      null,
    );

    await expect(response.json()).resolves.toMatchObject({
      error: "Internal server error.",
    });
  });

  it("does not expose a thrown string when it is repeated as the public message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = "opaque upstream failure";

    const response = internalError(new Request("https://admin.test/api/example"), cause, cause);

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Internal server error.",
    });
  });

  it("uses the stable fallback when the public message contains only controls", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = internalError(new Request("https://admin.test/api/example"), "\u0085", null);

    await expect(response.json()).resolves.toMatchObject({
      error: "Internal server error.",
    });
  });

  it.each(["\u202E", "\u200B", "opaque\u0000secret"])(
    "rejects Cc/Cf or normalization-changing public text: %#",
    async (publicMessage) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = internalError(
        new Request("https://admin.test/api/example"),
        publicMessage,
        publicMessage,
      );

      await expect(response.json()).resolves.toMatchObject({
        error: "Internal server error.",
      });
    },
  );

  it.each([
    "DROP TABLE licenses",
    "UNIQUE constraint failed: licenses.key",
    "failed in ../../private/config",
    "This arbitrary attacker-controlled message looks harmless.",
  ])("fails closed for non-allowlisted public text: %s", async (publicMessage) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = internalError(
      new Request("https://admin.test/api/example"),
      publicMessage,
      null,
    );

    await expect(response.json()).resolves.toMatchObject({
      error: "Internal server error.",
    });
  });

  it("rejects a public message matching an inherited cause message data property", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, "message", {
      value: "Unable to complete the request.",
    });
    const cause = Object.create(prototype) as object;

    const response = internalError(
      new Request("https://admin.test/api/example"),
      "Unable to complete the request.",
      cause,
    );

    await expect(response.json()).resolves.toMatchObject({ error: "Internal server error." });
  });

  it("rejects a public message matching a cause stack data property", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = new Error("different message");
    Object.defineProperty(cause, "stack", {
      configurable: true,
      value: "Unable to complete the request.",
    });

    const response = internalError(
      new Request("https://admin.test/api/example"),
      "Unable to complete the request.",
      cause,
    );

    await expect(response.json()).resolves.toMatchObject({ error: "Internal server error." });
  });

  it("rejects an allowlisted public message that wraps bounded cause text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = internalError(
      new Request("https://admin.test/api/example"),
      "Unable to complete the request.",
      new Error("complete the request"),
    );

    await expect(response.json()).resolves.toMatchObject({ error: "Internal server error." });
  });

  it("does not invoke cause message or stack accessors while checking public text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let getterCalls = 0;
    const cause = {};
    for (const key of ["message", "stack"] as const) {
      Object.defineProperty(cause, key, {
        get() {
          getterCalls += 1;
          return "Unable to complete the request.";
        },
      });
    }

    const response = internalError(
      new Request("https://admin.test/api/example"),
      "Unable to complete the request.",
      cause,
    );

    await expect(response.json()).resolves.toMatchObject({
      error: "Unable to complete the request.",
    });
    expect(getterCalls).toBe(0);
  });

  it.each(["boom", 42, 42n, true, Symbol("synthetic")])(
    "handles a bounded primitive cause without exposing it: %s",
    async (cause) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = internalError(
        new Request("https://admin.test/api/example"),
        "Unable to complete the request.",
        cause,
      );

      await expect(response.json()).resolves.toMatchObject({
        error: "Unable to complete the request.",
      });
    },
  );

  it("handles a cause whose property descriptors cannot be inspected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("synthetic descriptor trap");
        },
      },
    );

    const response = internalError(
      new Request("https://admin.test/api/example"),
      "Unable to complete the request.",
      cause,
    );

    await expect(response.json()).resolves.toMatchObject({
      error: "Unable to complete the request.",
    });
  });

  it("handles a cause whose prototype cannot be inspected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("synthetic prototype trap");
        },
      },
    );

    const response = internalError(
      new Request("https://admin.test/api/example"),
      "Unable to complete the request.",
      cause,
    );

    await expect(response.json()).resolves.toMatchObject({
      error: "Unable to complete the request.",
    });
  });

  it("logs only a bounded redacted cause and handles circular values", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause: Record<string, unknown> = {
      huge: "x".repeat(100_000),
      token: "private-token",
      items: Array.from({ length: 500 }, (_, index) => ({ index })),
    };
    cause.self = cause;

    expect(() =>
      internalError(
        new Request("https://admin.test/api/example", {
          headers: { "x-request-id": "bounded-log-1" },
        }),
        "Internal service failure.",
        cause,
      ),
    ).not.toThrow();

    const [label, logged] = log.mock.calls[0];
    const serialized = JSON.stringify(logged);
    expect(label).toBe("internal_error");
    expect(serialized.length).toBeLessThan(20_000);
    expect(serialized).not.toContain("private-token");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[TRUNCATED]");
    expect(serialized).toContain("[CIRCULAR]");
  });

  it("redacts folded Authorization and Cookie values at the actual log boundary", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = new Error(
      "Authorization: Custom\r\n" +
        " synthetic-auth-continuation\r\n" +
        "Cookie: session=first;\n" +
        "\tsynthetic-cookie-continuation\n" +
        "X-Trace: keep-log-trace",
    );

    internalError(
      new Request("https://admin.test/api/example", {
        headers: { "x-request-id": "folded-log-1" },
      }),
      "Internal service failure.",
      cause,
    );

    expect(log).toHaveBeenCalledTimes(1);
    const [label, logged] = log.mock.calls[0];
    expect(label).toBe("internal_error");
    expect(logged).toMatchObject({
      requestId: "folded-log-1",
      cause: {
        name: "Error",
        message:
          "Authorization: [REDACTED]\r\n" + "Cookie: [REDACTED]\n" + "X-Trace: keep-log-trace",
      },
    });
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("synthetic-auth-continuation");
    expect(serialized).not.toContain("synthetic-cookie-continuation");
    expect(serialized).toContain("keep-log-trace");
  });

  it.each([
    ["Authorization", "Authori\tzation: Custom synthetic-log-tab-auth", "synthetic-log-tab-auth"],
    ["Cookie", "Coo\nkie: synthetic-log-lf-cookie", "synthetic-log-lf-cookie"],
  ])(
    "fails closed for a Cc-split %s label at the actual log boundary",
    (_label, message, secret) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

      internalError(
        new Request("https://admin.test/api/example", {
          headers: { "x-request-id": "split-label-log-1" },
        }),
        "Internal service failure.",
        new Error(message),
      );

      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toEqual([
        "internal_error",
        {
          requestId: "split-label-log-1",
          cause: { name: "Error", message: "[REDACTED]" },
        },
      ]);
      expect(JSON.stringify(log.mock.calls[0])).not.toContain(secret);
    },
  );

  it("redacts inline Custom Authorization at the actual log boundary", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    internalError(
      new Request("https://admin.test/api/example", {
        headers: { "x-request-id": "inline-auth-log-1" },
      }),
      "Internal service failure.",
      new Error("trace Authorization: Custom synthetic-inline-log-auth; keep suffix"),
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual([
      "internal_error",
      {
        requestId: "inline-auth-log-1",
        cause: {
          name: "Error",
          message: "trace Authorization: [REDACTED]; keep suffix",
        },
      },
    ]);
    expect(JSON.stringify(log.mock.calls[0])).not.toContain("synthetic-inline-log-auth");
  });
});
