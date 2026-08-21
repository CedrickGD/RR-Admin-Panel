import { describe, expect, it } from "vitest";

import {
  MAX_BODY_BYTES,
  MAX_MESSAGE_LENGTH,
  MAX_METRICS_BYTES,
  MAX_METRICS_KEYS,
  MAX_TIMESTAMP_SKEW_MS,
  attachRequestContext,
  clampTimestamp,
  normalizePayload,
  readBodyTextLimited,
  readRequestContext,
  sanitizeIdentifier,
  validatePayload,
  type CanonicalPayload,
  type RequestContext,
} from "../../shared/telemetry-contract";
import canonicalFixture from "./fixtures/canonical-v2.json";
import legacyFixture from "./fixtures/legacy-heartbeat.json";

const NOW_ISO = "2026-08-21T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function canonical(overrides: Partial<CanonicalPayload> = {}): CanonicalPayload {
  return {
    ...(structuredClone(canonicalFixture) as CanonicalPayload),
    ...overrides,
  };
}

function emptyContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    clientIp: null,
    country: null,
    city: null,
    region: null,
    latitude: null,
    longitude: null,
    timezone: null,
    ...overrides,
  };
}

function edgeContext(): RequestContext {
  return {
    clientIp: "203.0.113.7",
    country: "DE",
    city: "Berlin",
    region: "Berlin",
    latitude: 52.52,
    longitude: 13.405,
    timezone: "Europe/Berlin",
  };
}

function postRequest(body: BodyInit | null, headers?: HeadersInit): Request {
  return new Request("https://admin.test/api/ingest", { method: "POST", headers, body });
}

describe("telemetry contract constants", () => {
  it("pins the public limits", () => {
    expect(MAX_BODY_BYTES).toBe(16 * 1024);
    expect(MAX_METRICS_KEYS).toBe(64);
    expect(MAX_METRICS_BYTES).toBe(8 * 1024);
    expect(MAX_MESSAGE_LENGTH).toBe(500);
    expect(MAX_TIMESTAMP_SKEW_MS).toBe(10 * 60 * 1000);
  });
});

describe("normalizePayload", () => {
  it("normalizes the canonical fixture to itself", () => {
    const result = normalizePayload(structuredClone(canonicalFixture));

    expect(result).toEqual({ valid: true, payload: canonicalFixture });
    expect(result.valid && validatePayload(result.payload)).toEqual({ valid: true });
  });

  it("maps a legacy heartbeat onto session_active and keeps the session id", () => {
    const result = normalizePayload(structuredClone(legacyFixture));

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.payload.service).toBe("session_active");
    expect(result.payload.source).toBe("razorreaper-app");
    expect(result.payload.status).toBe("ok");
    expect(result.payload.timestamp).toBe(legacyFixture.timestamp_utc);
    expect(result.payload.metrics.session_id).toBe(legacyFixture.properties.session_id);
    expect(result.payload.metrics.install_id).toBe(legacyFixture.install_id);
    expect(result.payload.metrics.app_version).toBe("1.3.2");
    expect(result.payload.metrics.platform).toBe("windows");
    // Legacy scalars arrive as strings and are coerced exactly as before.
    expect(result.payload.metrics.uptime_seconds).toBe(120);
    expect(result.payload.metrics.rpc_enabled).toBe(true);
    expect(validatePayload(result.payload)).toEqual({ valid: true });
  });

  it("derives install:<id> as the session id when the legacy payload has none", () => {
    const legacy = structuredClone(legacyFixture) as Record<string, unknown>;
    legacy.properties = { worker_name: "razorreaper-app" };

    const result = normalizePayload(legacy);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.payload.metrics.session_id).toBe(`install:${legacyFixture.install_id}`);
  });

  it.each([
    ["app_start", "session_start"],
    ["app_exit", "session_end"],
    ["app_stop", "session_end"],
    ["shutdown", "session_end"],
    ["Custom Event", "custom_event"],
  ])("maps legacy event %s to service %s", (eventName, service) => {
    const result = normalizePayload({
      install_id: "abc",
      event_name: eventName,
      timestamp_utc: NOW_ISO,
    });

    expect(result.valid && result.payload.service).toBe(service);
  });

  it("derives status and message from legacy properties", () => {
    const failed = normalizePayload({
      install_id: "abc",
      event_name: "heartbeat",
      timestamp_utc: NOW_ISO,
      properties: { result: "failed" },
    });
    const degraded = normalizePayload({
      install_id: "abc",
      event_name: "heartbeat",
      timestamp_utc: NOW_ISO,
      properties: { result: "slow", message: "took a while" },
    });
    const errored = normalizePayload({
      install_id: "abc",
      event_name: "startup_error",
      timestamp_utc: NOW_ISO,
    });

    expect(failed.valid && failed.payload.status).toBe("down");
    expect(failed.valid && failed.payload.message).toBe("result:failed");
    expect(degraded.valid && degraded.payload.status).toBe("degraded");
    expect(degraded.valid && degraded.payload.message).toBe("took a while");
    expect(errored.valid && errored.payload.status).toBe("down");
    expect(errored.valid && errored.payload.message).toBeUndefined();
  });

  it.each([null, [], "text", 42])("rejects a non-object payload: %s", (raw) => {
    expect(normalizePayload(raw)).toEqual({
      valid: false,
      message: "Payload must be a JSON object.",
    });
  });

  it("rejects an object that matches neither schema and lists the accepted ones", () => {
    const result = normalizePayload({ hello: "world" });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.message).toBe("Payload does not match supported schemas.");
    expect(result.details).toMatchObject({
      acceptedSchemas: [expect.stringContaining("canonical"), expect.stringContaining("legacy")],
    });
  });

  it("rejects a canonical payload with a non-string message", () => {
    const result = normalizePayload({ ...structuredClone(canonicalFixture), message: 7 });

    expect(result.valid).toBe(false);
  });
});

describe("validatePayload", () => {
  it("accepts the canonical fixture", () => {
    expect(validatePayload(canonical())).toEqual({ valid: true });
  });

  it("rejects a source with characters outside [a-zA-Z0-9._:-]", () => {
    expect(validatePayload(canonical({ source: "razor reaper!" }))).toMatchObject({
      valid: false,
      message: expect.stringContaining("Invalid source"),
    });
  });

  it("rejects a service with characters outside [a-zA-Z0-9._:-]", () => {
    expect(validatePayload(canonical({ service: "session/active" }))).toMatchObject({
      valid: false,
      message: expect.stringContaining("Invalid service"),
    });
  });

  it("rejects 65 metric keys", () => {
    const metrics: Record<string, unknown> = {};
    for (let index = 0; index < MAX_METRICS_KEYS + 1; index += 1) {
      metrics[`k${index}`] = index;
    }

    expect(validatePayload(canonical({ metrics }))).toMatchObject({
      valid: false,
      message: `metrics has too many keys (max ${MAX_METRICS_KEYS}).`,
    });
  });

  it("accepts exactly 64 metric keys", () => {
    const metrics: Record<string, unknown> = {};
    for (let index = 0; index < MAX_METRICS_KEYS; index += 1) {
      metrics[`k${index}`] = index;
    }

    expect(validatePayload(canonical({ metrics }))).toEqual({ valid: true });
  });

  it("rejects metrics above 8 KB serialized", () => {
    const metrics = { blob: "x".repeat(MAX_METRICS_BYTES + 1) };

    expect(validatePayload(canonical({ metrics }))).toMatchObject({
      valid: false,
      message: `metrics payload exceeds ${MAX_METRICS_BYTES} bytes.`,
    });
  });

  it("measures metric bytes in UTF-8, not characters", () => {
    const metrics = { blob: "€".repeat(Math.ceil(MAX_METRICS_BYTES / 3)) };

    expect(validatePayload(canonical({ metrics }))).toMatchObject({
      valid: false,
      message: `metrics payload exceeds ${MAX_METRICS_BYTES} bytes.`,
    });
  });

  it("rejects a metric key longer than 64 characters", () => {
    const metrics = { ["k".repeat(65)]: 1 };

    expect(validatePayload(canonical({ metrics }))).toMatchObject({
      valid: false,
      message: "metrics keys must be between 1 and 64 characters.",
    });
  });

  it("rejects a message longer than 500 characters", () => {
    expect(
      validatePayload(canonical({ message: "m".repeat(MAX_MESSAGE_LENGTH + 1) })),
    ).toMatchObject({
      valid: false,
      message: `message must be <= ${MAX_MESSAGE_LENGTH} characters.`,
    });
  });

  it("rejects an unknown status", () => {
    expect(
      validatePayload(canonical({ status: "meh" as CanonicalPayload["status"] })),
    ).toMatchObject({
      valid: false,
      message: "status must be one of: ok, degraded, down.",
    });
  });

  it("rejects an unparsable timestamp", () => {
    expect(validatePayload(canonical({ timestamp: "yesterday" }))).toMatchObject({
      valid: false,
      message: "timestamp must be a valid ISO string.",
    });
  });

  it("rejects metrics that are not an object", () => {
    expect(
      validatePayload(canonical({ metrics: [] as unknown as Record<string, unknown> })),
    ).toMatchObject({
      valid: false,
      message: "metrics must be a JSON object.",
    });
  });
});

describe("readRequestContext", () => {
  it("prefers cf-connecting-ip and request.cf geo fields", () => {
    const request = postRequest(null, {
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.9, 10.0.0.1",
      "cf-ipcountry": "US",
    });
    Object.assign(request, {
      cf: {
        country: "DE",
        city: "Berlin",
        region: "Berlin",
        latitude: "52.5200066",
        longitude: "13.4049540",
        timezone: "Europe/Berlin",
      },
    });

    expect(readRequestContext(request)).toEqual({
      clientIp: "203.0.113.7",
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      latitude: 52.520007,
      longitude: 13.404954,
      timezone: "Europe/Berlin",
    });
  });

  it("falls back to the first x-forwarded-for hop and cf-ipcountry", () => {
    const request = postRequest(null, {
      "x-forwarded-for": "198.51.100.9, 10.0.0.1",
      "cf-ipcountry": "US",
    });

    expect(readRequestContext(request)).toEqual({
      clientIp: "198.51.100.9",
      country: "US",
      city: null,
      region: null,
      latitude: null,
      longitude: null,
      timezone: null,
    });
  });

  it("drops out-of-range coordinates", () => {
    const request = postRequest(null);
    Object.assign(request, { cf: { latitude: "95", longitude: "-200" } });

    expect(readRequestContext(request)).toMatchObject({ latitude: null, longitude: null });
  });
});

describe("attachRequestContext", () => {
  it("fills every edge field when the client supplied none", () => {
    const metrics = attachRequestContext({ session_id: "s1" }, edgeContext());

    expect(metrics).toEqual({
      session_id: "s1",
      client_ip: "203.0.113.7",
      client_ip_version: "ipv4",
      client_country: "DE",
      client_geo_source: "edge_ip",
      client_geo_signal_source: "ip",
      client_city: "Berlin",
      client_region: "Berlin",
      client_latitude: 52.52,
      client_longitude: 13.405,
      client_timezone: "Europe/Berlin",
    });
  });

  it("does not mutate the input metrics", () => {
    const input = { session_id: "s1" };
    attachRequestContext(input, edgeContext());

    expect(input).toEqual({ session_id: "s1" });
  });

  it("keeps client-supplied values, including client_latitude (ruling)", () => {
    const supplied = {
      client_ip: "10.1.2.3",
      client_ip_version: "ipv4",
      client_country: "AT",
      client_city: "Vienna",
      client_region: "Vienna",
      client_latitude: 48.2082,
      client_longitude: 16.3738,
      client_timezone: "Europe/Vienna",
      client_geo_source: "gps",
      client_geo_signal_source: "device",
    };

    expect(attachRequestContext({ ...supplied }, edgeContext())).toEqual(supplied);
  });

  it("labels the ipv6 client ip version", () => {
    const metrics = attachRequestContext({}, emptyContext({ clientIp: "2001:db8::1" }));

    expect(metrics).toEqual({ client_ip: "2001:db8::1", client_ip_version: "ipv6" });
  });

  it("adds nothing when the edge knows nothing", () => {
    expect(attachRequestContext({ a: 1 }, emptyContext())).toEqual({ a: 1 });
  });

  it("sets geo_source without a signal source when only coordinates are known", () => {
    const metrics = attachRequestContext({}, emptyContext({ latitude: 1.5, longitude: 2.5 }));

    expect(metrics).toEqual({
      client_geo_source: "edge_ip",
      client_latitude: 1.5,
      client_longitude: 2.5,
    });
  });

  it("treats a non-object metrics value as empty", () => {
    const metrics = attachRequestContext(
      null as unknown as Record<string, unknown>,
      emptyContext({ country: "DE" }),
    );

    expect(metrics).toEqual({
      client_country: "DE",
      client_geo_source: "edge_ip",
      client_geo_signal_source: "ip",
    });
  });
});

describe("clampTimestamp", () => {
  it("keeps an in-window timestamp and normalizes it to ISO", () => {
    expect(clampTimestamp("2026-08-21T11:55:00Z", NOW_MS)).toEqual({
      iso: "2026-08-21T11:55:00.000Z",
      adjusted: false,
    });
  });

  it("keeps a timestamp exactly at the skew boundary", () => {
    const edge = new Date(NOW_MS - MAX_TIMESTAMP_SKEW_MS).toISOString();

    expect(clampTimestamp(edge, NOW_MS)).toEqual({ iso: edge, adjusted: false });
  });

  it("clamps a timestamp 7 hours in the future to now", () => {
    const future = new Date(NOW_MS + 7 * 60 * 60 * 1000).toISOString();

    expect(clampTimestamp(future, NOW_MS)).toEqual({ iso: NOW_ISO, adjusted: true });
  });

  it("clamps a timestamp far in the past to now", () => {
    expect(clampTimestamp("2020-01-01T00:00:00Z", NOW_MS)).toEqual({
      iso: NOW_ISO,
      adjusted: true,
    });
  });

  it("clamps garbage to now", () => {
    expect(clampTimestamp("yesterday", NOW_MS)).toEqual({ iso: NOW_ISO, adjusted: true });
  });

  it("honours a custom skew window", () => {
    const slightlyOld = new Date(NOW_MS - 2_000).toISOString();

    expect(clampTimestamp(slightlyOld, NOW_MS, 1_000)).toEqual({ iso: NOW_ISO, adjusted: true });
    expect(clampTimestamp(slightlyOld, NOW_MS, 5_000)).toEqual({
      iso: slightlyOld,
      adjusted: false,
    });
  });
});

describe("readBodyTextLimited", () => {
  it("returns the raw body text", async () => {
    const result = await readBodyTextLimited(postRequest('{"source":"a"}'));

    expect(result).toEqual({ ok: true, text: '{"source":"a"}' });
  });

  it("returns empty text for a request without a body", async () => {
    await expect(readBodyTextLimited(postRequest(null))).resolves.toEqual({
      ok: true,
      text: "",
    });
  });

  it("rejects a 16 KB + 1 byte body with 413", async () => {
    const result = await readBodyTextLimited(postRequest("x".repeat(MAX_BODY_BYTES + 1)));

    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("accepts a body of exactly the limit", async () => {
    const body = "x".repeat(MAX_BODY_BYTES);

    await expect(readBodyTextLimited(postRequest(body))).resolves.toEqual({ ok: true, text: body });
  });

  it("measures UTF-8 bytes rather than characters", async () => {
    const result = await readBodyTextLimited(postRequest("€".repeat(40)), 100);

    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects an oversized declared content-length with 413 without reading the body", async () => {
    const request = postRequest("small", { "content-length": String(MAX_BODY_BYTES + 1) });

    const result = await readBodyTextLimited(request);

    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(request.bodyUsed).toBe(false);
  });

  it("honours a custom byte limit", async () => {
    await expect(readBodyTextLimited(postRequest("123456"), 5)).resolves.toMatchObject({
      ok: false,
      status: 413,
    });
  });

  it("reports a body that cannot be read as 400", async () => {
    const request = postRequest("abc");
    await request.text();

    await expect(readBodyTextLimited(request)).resolves.toMatchObject({ ok: false, status: 400 });
  });
});

describe("sanitizeIdentifier", () => {
  it("lower-cases, collapses whitespace and strips unsupported characters", () => {
    expect(sanitizeIdentifier("  Razor Reaper  App!  ", "fallback")).toBe("razor_reaper_app_");
  });

  it("collapses repeated underscores and truncates to 64 characters", () => {
    expect(sanitizeIdentifier("a___b", "fallback")).toBe("a_b");
    expect(sanitizeIdentifier("z".repeat(80), "fallback")).toHaveLength(64);
  });

  it("returns the fallback for an empty result", () => {
    expect(sanitizeIdentifier("   ", "fallback")).toBe("fallback");
  });
});
