import { describe, expect, it } from "vitest";

import {
  parseBoundedIdentifier,
  parseBoundedInteger,
  parseBoundedNumber,
  readObjectBody,
} from "../../functions/_lib/validation";

function requestWithBody(body: BodyInit | null, headers?: HeadersInit): Request {
  return new Request("https://admin.test/api/example", {
    method: "POST",
    headers,
    body,
  });
}

describe("readObjectBody", () => {
  it("treats a request with no body as an empty-body result", async () => {
    const request = new Request("https://admin.test/api/example", { method: "POST" });

    await expect(readObjectBody(request, 128)).resolves.toMatchObject({
      ok: false,
      error: { code: "body_required", field: "$body" },
    });
  });

  it("returns a parsed JSON object through a discriminated success result", async () => {
    const result = await readObjectBody(
      requestWithBody('{"name":"Razor Reaper","enabled":true}'),
      128,
    );

    expect(result).toEqual({
      ok: true,
      value: { name: "Razor Reaper", enabled: true },
    });
  });

  it.each(["", "   \r\n\t"])("rejects an empty body %#", async (body) => {
    const result = await readObjectBody(requestWithBody(body), 128);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "body_required", field: "$body" },
    });
  });

  it("rejects malformed JSON without throwing", async () => {
    const result = await readObjectBody(requestWithBody('{"broken":'), 128);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_json", field: "$body" },
    });
  });

  it("rejects invalid UTF-8 as malformed JSON", async () => {
    const result = await readObjectBody(requestWithBody(new Uint8Array([0xff])), 128);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_json", field: "$body" },
    });
  });

  it.each(["null", "[]", '"text"', "42", "true"])(
    "rejects a non-object JSON root: %s",
    async (body) => {
      const result = await readObjectBody(requestWithBody(body), 128);

      expect(result).toMatchObject({
        ok: false,
        error: { code: "object_required", field: "$body" },
      });
    },
  );

  it("enforces the actual UTF-8 byte count rather than JavaScript character count", async () => {
    const body = '{"value":"€€"}';
    expect(body.length).toBeLessThan(new TextEncoder().encode(body).byteLength);

    const result = await readObjectBody(requestWithBody(body), body.length);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "body_too_large", field: "$body" },
    });
  });

  it("rejects an oversized declared content length before trusting a smaller body", async () => {
    const result = await readObjectBody(requestWithBody("{}", { "content-length": "4096" }), 128);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "body_too_large", field: "$body" },
    });
  });

  it("still checks actual bytes when content-length understates the body", async () => {
    const result = await readObjectBody(
      requestWithBody('{"value":"too large"}', { "content-length": "2" }),
      8,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "body_too_large", field: "$body" },
    });
  });

  it("returns a stable failure when the body was already consumed", async () => {
    const request = requestWithBody('{"value":"once"}');
    await request.text();

    await expect(readObjectBody(request, 128)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_json", field: "$body" },
    });
  });

  it("returns a stable failure instead of throwing when the body stream is locked", async () => {
    const request = requestWithBody('{"value":"locked"}');
    const reader = request.body?.getReader();

    try {
      await expect(readObjectBody(request, 128)).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_json", field: "$body" },
      });
    } finally {
      reader?.releaseLock();
    }
  });

  it("returns a stable failure when reading the body stream rejects", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("synthetic stream failure"));
      },
    });
    const request = new Request("https://admin.test/api/example", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readObjectBody(request, 128)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_json", field: "$body" },
    });
  });

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid body limit before reading: %s",
    async (maxBytes) => {
      await expect(readObjectBody(requestWithBody("{}"), maxBytes)).rejects.toThrow(RangeError);
    },
  );
});

describe("parseBoundedIdentifier", () => {
  const options = { field: "invoice_id", minLength: 2, maxLength: 12 };

  it("trims and preserves a bounded identifier", () => {
    expect(parseBoundedIdentifier("  Inv-001  ", options)).toEqual({
      ok: true,
      value: "Inv-001",
    });
  });

  it.each([undefined, null, 42, true, {}])("rejects non-string identifiers: %#", (value) => {
    expect(parseBoundedIdentifier(value, options)).toMatchObject({
      ok: false,
      error: { code: "invalid_type", field: "invoice_id" },
    });
  });

  it.each(["", "  ", "x"])("rejects empty or too-short identifiers: %#", (value) => {
    expect(parseBoundedIdentifier(value, options)).toMatchObject({
      ok: false,
      error: {
        code: value.trim().length === 0 ? "value_required" : "too_short",
        field: "invoice_id",
      },
    });
  });

  it.each(["ab\u0000cd", "ab\u001fcd", "ab\u007fcd", "ab\u0085cd"])(
    "rejects identifiers containing control characters: %#",
    (value) => {
      expect(parseBoundedIdentifier(value, options)).toMatchObject({
        ok: false,
        error: { code: "control_character", field: "invoice_id" },
      });
    },
  );

  it.each(["\tabc", "abc\n", "ab\u202Ecd"])(
    "rejects leading, trailing, and Unicode format controls before trimming: %#",
    (value) => {
      expect(parseBoundedIdentifier(value, options)).toMatchObject({
        ok: false,
        error: { code: "control_character", field: "invoice_id" },
      });
    },
  );

  it("rejects rather than truncating an overlong identifier", () => {
    const result = parseBoundedIdentifier("ABCDEFGHIJKLM", options);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "too_long", field: "invoice_id" },
    });
  });

  it("counts Unicode code points rather than UTF-16 surrogate halves", () => {
    expect(
      parseBoundedIdentifier("💚💚", {
        field: "symbolic_id",
        minLength: 2,
        maxLength: 2,
      }),
    ).toEqual({ ok: true, value: "💚💚" });
  });

  it("applies an optional full identifier pattern without coercion", () => {
    const patternOptions = {
      field: "operation_id",
      maxLength: 8,
      pattern: /^[a-z0-9-]+$/,
    };

    expect(parseBoundedIdentifier("abc-123", patternOptions)).toEqual({
      ok: true,
      value: "abc-123",
    });
    expect(parseBoundedIdentifier("ABC-123", patternOptions)).toMatchObject({
      ok: false,
      error: { code: "invalid_format", field: "operation_id" },
    });
  });

  it.each([
    { field: "", minLength: 1, maxLength: 2 },
    { field: "value", minLength: 1.5, maxLength: 2 },
    { field: "value", minLength: 1, maxLength: 2.5 },
    { field: "value", minLength: 0, maxLength: 2 },
    { field: "value", minLength: 3, maxLength: 2 },
  ])("rejects invalid identifier bounds: %#", (bounds) => {
    expect(() => parseBoundedIdentifier("ok", bounds)).toThrow(RangeError);
  });
});

describe("bounded number parsers", () => {
  it.each([
    [Number.NaN, "not_finite"],
    [Number.POSITIVE_INFINITY, "not_finite"],
    [Number.NEGATIVE_INFINITY, "not_finite"],
    ["5", "invalid_type"],
    [null, "invalid_type"],
  ] as const)("rejects a non-finite or non-number value: %s", (value, code) => {
    expect(parseBoundedNumber(value, { field: "duration", min: 0, max: 10 })).toMatchObject({
      ok: false,
      error: { code, field: "duration" },
    });
  });

  it.each([-1, 11])("rejects a number outside the inclusive range: %s", (value) => {
    expect(parseBoundedNumber(value, { field: "duration", min: 0, max: 10 })).toMatchObject({
      ok: false,
      error: { code: "out_of_range", field: "duration" },
    });
  });

  it("accepts finite fractional numbers when integer mode is not requested", () => {
    expect(parseBoundedNumber(0.5, { field: "duration", min: 0, max: 1 })).toEqual({
      ok: true,
      value: 0.5,
    });
  });

  it("rejects fractional numbers in integer mode", () => {
    expect(
      parseBoundedNumber(1.25, { field: "count", min: 1, max: 100, integer: true }),
    ).toMatchObject({
      ok: false,
      error: { code: "not_integer", field: "count" },
    });
  });

  it("provides an integer parser with inclusive finite bounds", () => {
    expect(parseBoundedInteger(1, { field: "count", min: 1, max: 100 })).toEqual({
      ok: true,
      value: 1,
    });
    expect(parseBoundedInteger(100, { field: "count", min: 1, max: 100 })).toEqual({
      ok: true,
      value: 100,
    });
    expect(parseBoundedInteger(-1, { field: "count", min: 1, max: 100 })).toMatchObject({
      ok: false,
      error: { code: "out_of_range" },
    });
    expect(parseBoundedInteger(1.5, { field: "count", min: 1, max: 100 })).toMatchObject({
      ok: false,
      error: { code: "not_integer" },
    });
  });

  it.each([
    { field: "", min: 0, max: 1 },
    { field: "value", min: Number.NaN, max: 1 },
    { field: "value", min: 0, max: Number.POSITIVE_INFINITY },
    { field: "value", min: 2, max: 1 },
  ])("rejects invalid numeric bounds: %#", (bounds) => {
    expect(() => parseBoundedNumber(1, bounds)).toThrow(RangeError);
  });
});
