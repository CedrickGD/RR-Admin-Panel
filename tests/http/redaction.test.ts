import { describe, expect, it } from "vitest";

import { redactValue } from "../../functions/_lib/redaction";

describe("redactValue", () => {
  it("redacts mixed-case credential and identifier field names recursively", () => {
    const input = {
      Authorization: "Bearer auth-value",
      nested: [
        { CoOkIeS: "session=cookie-value" },
        { clientSecret: "client-secret-value" },
        { API_KEY: "api-key-value" },
        { passWORD: "password-value" },
        { refreshToken: "refresh-token-value" },
        { webhookUrl: "https://example.test/hooks/webhook-value" },
        { License_Key: "RR-SECRET-LICENSE-0001" },
      ],
      safe: { region: "DE-BE", attempts: 2 },
    };

    expect(redactValue(input)).toEqual({
      Authorization: "[REDACTED]",
      nested: [
        { CoOkIeS: "[REDACTED]" },
        { clientSecret: "[REDACTED]" },
        { API_KEY: "[REDACTED]" },
        { passWORD: "[REDACTED]" },
        { refreshToken: "[REDACTED]" },
        { webhookUrl: "[REDACTED]" },
        { License_Key: "[REDACTED]" },
      ],
      safe: { region: "DE-BE", attempts: 2 },
    });
  });

  it("redacts recognizable secrets embedded in otherwise nonsensitive string values", () => {
    const redacted = redactValue({
      url: "https://admin.test/callback?token=query-token&view=summary",
      authLine: "Authorization: Bearer bearer-token",
      requestHeaders: "Cookie: session=cookie-token; theme=dark",
      detail: "password=hunter2; client_secret=client-value; apiKey=api-value",
      delivery: "license_key: RR-ABCD-EFGH-IJKL-MNOP",
      upstreamLine: "POST https://discord.com/api/webhooks/123456/webhook-token",
      safe: "ordinary diagnostic text",
    });
    const serialized = JSON.stringify(redacted);

    for (const secret of [
      "query-token",
      "bearer-token",
      "cookie-token",
      "hunter2",
      "client-value",
      "api-value",
      "RR-ABCD-EFGH-IJKL-MNOP",
      "webhook-token",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("view=summary");
    expect(serialized).not.toContain("theme=dark");
    expect(serialized).toContain("ordinary diagnostic text");
    expect(serialized).toContain("[REDACTED]");
  });

  it("does not mutate or reuse nested input structures", () => {
    const input = {
      safe: { values: ["first", "second"] },
      token: "private",
    };
    const before = JSON.stringify(input);
    const result = redactValue(input) as {
      safe: { values: string[] };
      token: string;
    };

    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toBe(input);
    expect(result.safe).not.toBe(input.safe);
    expect(result.safe.values).not.toBe(input.safe.values);
    expect(result.token).toBe("[REDACTED]");
  });

  it("bounds recursion depth", () => {
    expect(redactValue({ level1: { level2: { level3: "hidden" } } }, { maxDepth: 2 })).toEqual({
      level1: { level2: "[MAX_DEPTH]" },
    });
  });

  it("bounds array length with an explicit truncation marker", () => {
    const result = redactValue([1, 2, 3, 4], { maxArrayItems: 2 });

    expect(result).toEqual([1, "[TRUNCATED]"]);
    expect(result).toHaveLength(2);
  });

  it("bounds object keys while preserving the first useful fields", () => {
    const result = redactValue({ first: 1, second: 2, third: 3 }, { maxObjectKeys: 2 });

    expect(result).toEqual({
      first: 1,
      $truncated: "[TRUNCATED]",
    });
    expect(Object.keys(result as object)).toHaveLength(2);
  });

  it("bounds individual property-key length without exposing an unclassified value", () => {
    const longKey = `${"k".repeat(32)}Token`;

    expect(redactValue({ [longKey]: "private-value" }, { maxKeyLength: 8 })).toEqual({
      "kkkkkkk…": "[REDACTED]",
    });
  });

  it("bounds strings after applying secret redaction", () => {
    expect(redactValue("abcdefghijklmnop", { maxStringLength: 8 })).toBe("abcdefg…");
    expect(redactValue("token=abcdefghijklmnop", { maxStringLength: 32 })).toBe("token=[REDACTED]");
    const repeatedSecrets = redactValue("token=a&".repeat(20), { maxStringLength: 32 });
    expect(Array.from(repeatedSecrets as string).length).toBeLessThanOrEqual(32);
  });

  it("redacts complete Authorization and Cookie header values", () => {
    const result = redactValue(
      "Authorization: Custom synthetic-private-value\n" +
        "Cookie: session=synthetic-session; theme=dark",
    ) as string;

    expect(result).toContain("Authorization: [REDACTED]");
    expect(result).toContain("Cookie: [REDACTED]");
    expect(result).not.toContain("synthetic-private-value");
    expect(result).not.toContain("synthetic-session");
    expect(result).not.toContain("theme=dark");
  });

  it.each([
    [
      "Authorization with CRLF and space folding",
      "Authorization: Custom\r\n synthetic-auth-continuation\r\nX-Trace: keep-auth-trace",
      "Authorization: [REDACTED]\r\nX-Trace: keep-auth-trace",
    ],
    [
      "Authorization with LF and tab folding",
      "Authorization: Custom\n\tsynthetic-tabbed-auth\nX-Trace: keep-tabbed-auth-trace",
      "Authorization: [REDACTED]\nX-Trace: keep-tabbed-auth-trace",
    ],
    [
      "Cookie with CRLF and tab folding",
      "Cookie: session=first;\r\n\tsynthetic-cookie-continuation\r\nX-Trace: keep-cookie-trace",
      "Cookie: [REDACTED]\r\nX-Trace: keep-cookie-trace",
    ],
    [
      "Cookie with LF and space folding",
      "Cookie: session=first;\n synthetic-spaced-cookie\nX-Trace: keep-spaced-cookie-trace",
      "Cookie: [REDACTED]\nX-Trace: keep-spaced-cookie-trace",
    ],
  ])(
    "redacts a complete folded sensitive header without consuming the next header: %s",
    (_name, input, expected) => {
      const result = redactValue(input);

      expect(result).toBe(expected);
      expect(JSON.stringify(result)).not.toMatch(/synthetic-(?:auth|tabbed|cookie|spaced)/u);
    },
  );

  it("redacts folded AWS authorization as one logical field and preserves later text", () => {
    const result = redactValue(
      "Authorization: AWS4-HMAC-SHA256\r\n" +
        " Credential=SYNTHETIC/20260817/eu-central-1/service/aws4_request,\r\n" +
        " SignedHeaders=host;x-amz-date,\r\n" +
        " Signature=abcdef0123456789\r\n" +
        "X-Trace: keep-aws-trace\r\n" +
        " ordinary trace continuation",
    );

    expect(result).toBe(
      "Authorization: [REDACTED]\r\n" +
        "X-Trace: keep-aws-trace\r\n" +
        " ordinary trace continuation",
    );
  });

  it.each([
    ["cookie=synthetic-equals-cookie; mode=normal", "cookie=[REDACTED]; mode=normal"],
    [
      "detail cookies: synthetic-colon-cookie; mode=normal",
      "detail cookies: [REDACTED]; mode=normal",
    ],
    ["cookies=synthetic-plural-cookie, next=visible", "cookies=[REDACTED], next=visible"],
  ])(
    "redacts inline Cookie labels without consuming following safe text: %s",
    (input, expected) => {
      expect(redactValue(input)).toBe(expected);
    },
  );

  it.each([
    [
      "Authorization split by HTAB",
      "aUtHoRi\tZaTiOn: Custom synthetic-auth-tab",
      "synthetic-auth-tab",
    ],
    ["Authorization split by CR", "Authori\rzation: Custom synthetic-auth-cr", "synthetic-auth-cr"],
    ["Authorization split by LF", "Authori\nzation: Custom synthetic-auth-lf", "synthetic-auth-lf"],
    [
      "Authorization split by Cf",
      "Authori\u200Bzation: Custom synthetic-auth-cf",
      "synthetic-auth-cf",
    ],
    [
      "Authorization split by nonstructural Cc",
      "Authori\u0000zation: Custom synthetic-auth-nul",
      "synthetic-auth-nul",
    ],
    ["Cookie split by HTAB", "CoO\tKiE: synthetic-cookie-tab", "synthetic-cookie-tab"],
    ["Cookie split by CR", "Coo\rkie: synthetic-cookie-cr", "synthetic-cookie-cr"],
    ["Cookie split by LF", "Coo\nkie: synthetic-cookie-lf", "synthetic-cookie-lf"],
    ["Cookie split by Cf", "Coo\u200Bkie: synthetic-cookie-cf", "synthetic-cookie-cf"],
    [
      "Cookie split by nonstructural Cc",
      "Coo\u0000kie: synthetic-cookie-nul",
      "synthetic-cookie-nul",
    ],
  ])(
    "fails closed when a control or format character splits a sensitive label: %s",
    (_name, input, secret) => {
      const result = redactValue(input);

      expect(result).toBe("[REDACTED]");
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it.each([
    [
      "horizontal whitespace before the delimiter",
      "Authori\u200Bzation \t: Custom synthetic-spaced-delimiter-auth",
    ],
    [
      "mixed separators and controls inside the label",
      "Authori\u200B_zation: Custom synthetic-separated-auth",
    ],
  ])("fails closed for control-split labels with %s", (_name, input) => {
    expect(redactValue(input)).toBe("[REDACTED]");
  });

  it("preserves a control-split sensitive suffix inside an unrelated longer label", () => {
    const input = "reauthori\u200Bzation: public-value; keep";

    expect(redactValue(input)).toBe(input);
  });

  it("redacts inline Custom Authorization while preserving its exact prefix and suffix", () => {
    expect(redactValue("trace Authorization: Custom synthetic-inline-auth; keep suffix")).toBe(
      "trace Authorization: [REDACTED]; keep suffix",
    );
  });

  it.each([
    [
      "trace aUtHoRiZaTiOn: Custom synthetic-mixed-auth; keep mixed suffix",
      "trace aUtHoRiZaTiOn: [REDACTED]; keep mixed suffix",
    ],
    [
      "trace authorization=synthetic-equals-auth, keep equals suffix",
      "trace authorization=[REDACTED], keep equals suffix",
    ],
  ])("redacts a bounded inline Authorization spelling: %s", (input, expected) => {
    expect(redactValue(input)).toBe(expected);
  });

  it("redacts duplicate inline Authorization fields without consuming text between them", () => {
    expect(
      redactValue(
        "trace Authorization: Custom synthetic-first-auth; between=visible; " +
          "authorization=synthetic-second-auth, tail=visible",
      ),
    ).toBe(
      "trace Authorization: [REDACTED]; between=visible; " +
        "authorization=[REDACTED], tail=visible",
    );
  });

  it.each([
    "trace reauthorization: public-value; keep",
    "trace cookiecutter=public-value; keep",
    "https://example.test/docs/authorization-overview",
    "https://example.test/docs/cookie-handling",
    "plain prose about authorization and cookies without a value delimiter",
  ])("preserves unrelated substrings, URLs, and prose: %s", (input) => {
    expect(redactValue(input)).toBe(input);
  });

  it("preserves ordinary indented multiline text that does not follow a sensitive header", () => {
    const input =
      "ordinary diagnostic line\r\n synthetic-public-continuation\n\tstill-public\nX-Trace: keep";

    expect(redactValue(input)).toBe(input);
  });

  it("redacts a sensitive header without a continuation and preserves the next header", () => {
    expect(
      redactValue("Authorization: Custom synthetic-private-value\nX-Trace: keep-next-header"),
    ).toBe("Authorization: [REDACTED]\nX-Trace: keep-next-header");
  });

  it("redacts multiline AWS authorization credentials completely", () => {
    const result = redactValue(
      "Authorization: AWS4-HMAC-SHA256\n" +
        "Credential=SYNTHETIC/20260817/eu-central-1/service/aws4_request,\n" +
        "SignedHeaders=host;x-amz-date,\n" +
        "Signature=abcdef0123456789",
    );
    const serialized = JSON.stringify(result);

    for (const fragment of ["SYNTHETIC", "host;x-amz-date", "abcdef0123456789"]) {
      expect(serialized).not.toContain(fragment);
    }
  });

  it("fails closed when a format character splits a sensitive inline label", () => {
    const result = redactValue("to\u200Bken=synthetic-private-value");

    expect(result).toBe("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
  });

  it("redacts versioned Discord webhook URLs", () => {
    const result = redactValue(
      "POST https://discord.com/api/v10/webhooks/123456/synthetic-webhook-token",
    );

    expect(JSON.stringify(result)).not.toContain("synthetic-webhook-token");
  });

  it("redacts the Cloudflare Access JWT assertion field", () => {
    expect(redactValue({ "Cf-Access-Jwt-Assertion": "synthetic-opaque-assertion" })).toEqual({
      "Cf-Access-Jwt-Assertion": "[REDACTED]",
    });
  });

  it("unwraps boxed strings and applies primitive secret redaction", () => {
    const result = redactValue(new String("token=synthetic-private-value"));

    expect(result).toBe("token=[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
  });

  it("marks repeated DAG nodes instead of expanding every shared path", () => {
    let shared: Record<string, unknown> = { leaf: "safe" };
    for (let depth = 0; depth < 6; depth += 1) {
      const parent: Record<string, unknown> = {};
      for (let index = 0; index < 8; index += 1) {
        parent[`child${index}`] = shared;
      }
      shared = parent;
    }

    const startedAt = performance.now();
    const result = redactValue(shared);
    const elapsedMs = performance.now() - startedAt;
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("[REPEATED]");
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(16 * 1024);
    expect(elapsedMs).toBeLessThan(250);
  });

  it("enforces a hard serialized output cap for large unique objects", () => {
    const input = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`field${index}`, "x".repeat(4096)]),
    );

    const serialized = JSON.stringify(
      redactValue(input, { maxObjectKeys: 100, maxStringLength: 4096 }),
    );

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(16 * 1024);
  });

  it("replaces output whose serialized structural cost exceeds the hard byte cap", () => {
    const input = Array.from({ length: 50 }, () =>
      Array.from({ length: 40 }, () => Number.MAX_VALUE),
    );

    expect(redactValue(input)).toBe("[OUTPUT_TRUNCATED]");
  });

  it("handles circular structures without throwing", () => {
    const input: Record<string, unknown> = { name: "cycle" };
    input.self = input;

    expect(redactValue(input)).toEqual({ name: "cycle", self: "[CIRCULAR]" });
  });

  it("does not invoke accessors and neutralizes prototype-risk property names", () => {
    let getterCalls = 0;
    const input = Object.create({ inherited: "not-an-own-property" }) as Record<string, unknown>;
    Object.defineProperty(input, "safe", {
      enumerable: true,
      value: "visible",
    });
    Object.defineProperty(input, "computed", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "getter-secret";
      },
    });
    Object.defineProperty(input, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    Object.defineProperty(input, "constructor", {
      enumerable: true,
      value: "dangerous",
    });

    const result = redactValue(input) as Record<string, unknown>;

    expect(getterCalls).toBe(0);
    expect(result).toEqual({
      safe: "visible",
      computed: "[ACCESSOR]",
      ["__proto__"]: "[REDACTED]",
      constructor: "[REDACTED]",
    });
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(result).not.toHaveProperty("inherited");
  });

  it("turns Error objects into bounded data without exposing a stack", () => {
    const error = new Error("request failed: token=private-token");
    Object.assign(error, { retryable: true });

    const result = redactValue(error) as Record<string, unknown>;
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      name: "Error",
      message: "request failed: token=[REDACTED]",
      retryable: true,
    });
    expect(result).not.toHaveProperty("stack");
    expect(serialized).not.toContain("private-token");
  });

  it("does not invoke hostile Error accessors", () => {
    let getterCalls = 0;
    const error = new Error();
    Object.defineProperty(error, "message", {
      configurable: true,
      get() {
        getterCalls += 1;
        return "token=accessor-secret";
      },
    });

    expect(redactValue(error)).toMatchObject({
      name: "Error",
      message: "Unknown error",
    });
    expect(getterCalls).toBe(0);
  });

  it("represents every primitive kind without throwing", () => {
    expect(redactValue(null)).toBeNull();
    expect(redactValue(true)).toBe(true);
    expect(redactValue(Number.NaN)).toBe("[NON_FINITE_NUMBER]");
    expect(redactValue(12n)).toBe("12n");
    expect(redactValue(undefined)).toBe("[UNDEFINED]");
    expect(redactValue(Symbol("synthetic"))).toBe("Symbol(synthetic)");
    expect(redactValue(() => undefined)).toBe("[FUNCTION]");
  });

  it("unwraps all standard boxed primitive kinds", () => {
    expect(redactValue(new Number(12))).toBe(12);
    expect(redactValue(new Boolean(true))).toBe(true);
    expect(redactValue(Object(12n))).toBe("12n");
    expect(redactValue(Object(Symbol("synthetic")))).toBe("Symbol(synthetic)");
  });

  it("bounds a marker to a one-code-point string cap", () => {
    expect(redactValue(Number.NaN, { maxStringLength: 1 })).toBe("…");
  });

  it("enforces the global traversal budget on a broad unique graph", () => {
    const input = Array.from({ length: 50 }, () => Array.from({ length: 50 }, () => 0));

    const result = redactValue(input);
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("[WORK_LIMIT]");
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(16 * 1024);
  });

  it("handles sparse, accessor, and uninspectable array items without invoking accessors", () => {
    let getterCalls = 0;
    const sparse: unknown[] = [];
    sparse.length = 2;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "token=private";
      },
    });
    accessor.length = 1;
    const uninspectable = new Proxy(["safe"], {
      getOwnPropertyDescriptor() {
        throw new Error("synthetic descriptor trap");
      },
    });

    expect(redactValue(sparse)).toEqual(["[EMPTY]", "[EMPTY]"]);
    expect(redactValue(accessor)).toEqual(["[ACCESSOR]"]);
    expect(redactValue(uninspectable)).toEqual(["[UNINSPECTABLE]"]);
    expect(getterCalls).toBe(0);
  });

  it("handles invalid or unreadable array lengths as empty", () => {
    const invalidLength = new Proxy(["safe"], {
      get(target, key, receiver) {
        return key === "length" ? -1 : Reflect.get(target, key, receiver);
      },
    });
    const unreadableLength = new Proxy(["safe"], {
      get(target, key, receiver) {
        if (key === "length") {
          throw new Error("synthetic length trap");
        }
        return Reflect.get(target, key, receiver);
      },
    });

    expect(redactValue(invalidLength)).toEqual([]);
    expect(redactValue(unreadableLength)).toEqual([]);
  });

  it("fails closed for revoked and self-revoking proxy values", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    const revokeHolder: { revoke?: () => void } = {};
    const selfRevoking = Proxy.revocable(
      {},
      {
        getPrototypeOf() {
          revokeHolder.revoke?.();
          return Object.prototype;
        },
      },
    );
    revokeHolder.revoke = selfRevoking.revoke;

    expect(redactValue(revoked.proxy)).toBe("[UNINSPECTABLE]");
    expect(redactValue(selfRevoking.proxy)).toBe("[UNINSPECTABLE]");
  });

  it("fails closed when object keys or descriptors cannot be inspected", () => {
    const unreadableKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("synthetic ownKeys trap");
        },
      },
    );
    let descriptorCalls = 0;
    const unreadableValue = new Proxy(
      { safe: "visible" },
      {
        getOwnPropertyDescriptor(target, key) {
          descriptorCalls += 1;
          if (descriptorCalls > 1) {
            throw new Error("synthetic descriptor trap");
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const unreadableEnumerable = new Proxy(
      { safe: "visible" },
      {
        getOwnPropertyDescriptor() {
          throw new Error("synthetic enumerable trap");
        },
      },
    );

    expect(redactValue(unreadableKeys)).toBe("[UNINSPECTABLE]");
    expect(redactValue(unreadableValue)).toEqual({ safe: "[UNINSPECTABLE]" });
    expect(redactValue(unreadableEnumerable)).toEqual({});
  });

  it("bounds Error keys and safely handles Error property edge cases", () => {
    const truncated = new Error("safe");
    Object.assign(truncated, { first: 1, second: 2 });

    const accessor = new Error("safe");
    Object.defineProperty(accessor, "computed", {
      enumerable: true,
      get() {
        return "token=private";
      },
    });

    let descriptorCalls = 0;
    const unreadableValue = new Proxy(Object.assign(new Error("safe"), { detail: "visible" }), {
      getOwnPropertyDescriptor(target, key) {
        if (key === "detail") {
          descriptorCalls += 1;
          if (descriptorCalls > 1) {
            throw new Error("synthetic descriptor trap");
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    expect(redactValue(truncated, { maxObjectKeys: 2 })).toEqual({
      name: "Error",
      $truncated: "[TRUNCATED]",
    });
    expect(redactValue(truncated, { maxObjectKeys: 0 })).toEqual({});
    expect(redactValue(accessor)).toMatchObject({ computed: "[ACCESSOR]" });
    expect(redactValue(unreadableValue)).toMatchObject({ detail: "[UNINSPECTABLE]" });
  });

  it("fails closed when Error keys or inherited text cannot be inspected", () => {
    const unreadableKeys = new Proxy(new Error("safe"), {
      ownKeys() {
        throw new Error("synthetic ownKeys trap");
      },
    });
    const unreadableName = new Proxy(new Error("safe"), {
      getOwnPropertyDescriptor(target, key) {
        if (key === "name") {
          throw new Error("synthetic name trap");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    expect(redactValue(unreadableKeys)).toBe("[UNINSPECTABLE]");
    expect(redactValue(unreadableName)).toMatchObject({ name: "Error", message: "safe" });
  });

  it("uses the Error fallback when a bounded prototype walk finds no name descriptor", () => {
    const error = new Error("safe");
    let prototype: object = Error.prototype;
    for (let depth = 0; depth < 5; depth += 1) {
      prototype = Object.create(prototype) as object;
    }
    Object.setPrototypeOf(error, prototype);

    expect(redactValue(error)).toMatchObject({ name: "Error", message: "safe" });
  });
});
