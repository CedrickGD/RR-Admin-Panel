import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as discordStatus } from "../../functions/api/discord/status";
import { onRequestPost as discordVerify } from "../../functions/api/discord/verify";
import {
  createMockD1,
  type MockD1,
  type MockD1Resolvers,
  type RecordedD1Operation,
} from "../helpers/mock-d1";
import { createSyntheticRequest } from "../helpers/request";

const SECRET = "bot-shared-secret-1234567890";
const DISCORD_ID = "123456789012345678";
const LICENSE_LOOKUP = /FROM licenses WHERE license_key = \?/;
const LINK_LOOKUP = /^SELECT \* FROM discord_links WHERE discord_id = \?/;
const LINK_UPSERT = /^INSERT INTO discord_links/;

afterEach(() => {
  vi.restoreAllMocks();
});

function env(mock: MockD1, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return { DB: mock.db, VERIFY_SHARED_SECRET: SECRET, ...overrides };
}

interface BotRequestOptions {
  bearer?: string;
  querySecret?: string;
  json?: unknown;
}

function botRequest(path: string, options: BotRequestOptions): Request {
  return createSyntheticRequest({
    method: "POST",
    path,
    query: options.querySecret === undefined ? undefined : { secret: options.querySecret },
    headers:
      options.bearer === undefined ? undefined : { authorization: `Bearer ${options.bearer}` },
    json: options.json ?? { discord_id: DISCORD_ID },
  });
}

function ops(mock: MockD1, pattern: RegExp): RecordedD1Operation[] {
  return mock.operations.filter((operation) => pattern.test(operation.normalizedSql));
}

async function expectJson(
  response: Response,
  status: number,
  expected: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toMatchObject(expected);
  return body;
}

async function expectGenericFailure(response: Response, rawFragments: string[]): Promise<void> {
  expect(response.status).toBe(500);
  const text = await response.text();
  const body = JSON.parse(text) as { ok: boolean; error: string; details: { requestId?: string } };
  expect(body).toMatchObject({ ok: false, error: "Unable to complete the request." });
  expect(body.details.requestId).toMatch(/\S/);
  expect(response.headers.get("x-request-id")).toBe(body.details.requestId);
  for (const fragment of rawFragments) {
    expect(text).not.toContain(fragment);
  }
}

const UNAUTHORIZED = { ok: false, error: "Unauthorized." };

describe("POST /api/discord/verify (bot shared secret)", () => {
  const verifyBody = { discord_id: DISCORD_ID, license_key: "RR-TEST-KEY" };

  it("rejects ?secret= even when it is correct and no Bearer token is sent", async () => {
    const mock = createMockD1();

    const response = await discordVerify({
      request: botRequest("/api/discord/verify", { querySecret: SECRET, json: verifyBody }),
      env: env(mock),
    });

    await expectJson(response, 401, UNAUTHORIZED);
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects a wrong Bearer token even when ?secret= is correct", async () => {
    const mock = createMockD1();

    const response = await discordVerify({
      request: botRequest("/api/discord/verify", {
        bearer: "not-the-secret",
        querySecret: SECRET,
        json: verifyBody,
      }),
      env: env(mock),
    });

    await expectJson(response, 401, UNAUTHORIZED);
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects a request without any credential", async () => {
    const response = await discordVerify({
      request: botRequest("/api/discord/verify", { json: verifyBody }),
      env: env(createMockD1()),
    });

    await expectJson(response, 401, UNAUTHORIZED);
  });

  it("a correct Bearer token proceeds to the license lookup", async () => {
    const mock = createMockD1();

    const response = await discordVerify({
      request: botRequest("/api/discord/verify", { bearer: SECRET, json: verifyBody }),
      env: env(mock),
    });

    await expectJson(response, 200, { ok: true, verified: false, reason: "invalid_key" });
    const lookups = ops(mock, LICENSE_LOOKUP);
    expect(lookups).toHaveLength(1);
    expect(lookups[0].values).toEqual(["RR-TEST-KEY"]);
  });

  it("a correct Bearer token records a staff manual grant", async () => {
    const mock = createMockD1();

    const response = await discordVerify({
      request: botRequest("/api/discord/verify", {
        bearer: SECRET,
        json: { discord_id: DISCORD_ID, discord_tag: "staff#0001", manual: true },
      }),
      env: env(mock),
    });

    await expectJson(response, 200, {
      ok: true,
      verified: true,
      manual: true,
      discord_id: DISCORD_ID,
      license_key: "MANUAL",
    });
    const upserts = ops(mock, LINK_UPSERT);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].values.slice(0, 3)).toEqual([DISCORD_ID, "staff#0001", "MANUAL"]);
    expect(upserts[0].values[5]).toBe("manual");
  });

  it("keeps the 400 for a missing discord_id", async () => {
    const response = await discordVerify({
      request: botRequest("/api/discord/verify", { bearer: SECRET, json: { license_key: "x" } }),
      env: env(createMockD1()),
    });

    await expectJson(response, 400, { ok: false, error: "discord_id is required." });
  });

  it("answers 500 when the shared secret is not configured", async () => {
    const response = await discordVerify({
      request: botRequest("/api/discord/verify", { bearer: SECRET, json: verifyBody }),
      env: env(createMockD1(), { VERIFY_SHARED_SECRET: undefined }),
    });

    await expectJson(response, 500, {
      ok: false,
      error: "Discord verification is not configured on the server.",
    });
  });

  it("a storage failure yields a generic 500 with a request id and no SQL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mock = createMockD1({
      first: [
        {
          match: LICENSE_LOOKUP,
          result: () => {
            throw new Error("D1_ERROR: no such table: licenses (SELECT license_key FROM licenses)");
          },
        },
      ],
    });

    const response = await discordVerify({
      request: botRequest("/api/discord/verify", { bearer: SECRET, json: verifyBody }),
      env: env(mock),
    });

    await expectGenericFailure(response, ["D1_ERROR", "no such table", "SELECT license_key"]);
  });
});

describe("POST /api/discord/status (bot shared secret)", () => {
  function linkDb(link: Record<string, unknown> | null, extra: MockD1Resolvers = {}): MockD1 {
    return createMockD1({
      ...extra,
      first: [{ match: LINK_LOOKUP, result: link }, ...(extra.first ?? [])],
    });
  }

  it("rejects ?secret= even when it is correct and no Bearer token is sent", async () => {
    const mock = linkDb(null);

    const response = await discordStatus({
      request: botRequest("/api/discord/status", { querySecret: SECRET }),
      env: env(mock),
    });

    await expectJson(response, 401, UNAUTHORIZED);
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects a wrong Bearer token", async () => {
    const response = await discordStatus({
      request: botRequest("/api/discord/status", { bearer: "nope", querySecret: SECRET }),
      env: env(linkDb(null)),
    });

    await expectJson(response, 401, UNAUTHORIZED);
  });

  it("a correct Bearer token proceeds to the link lookup", async () => {
    const mock = linkDb(null);

    const response = await discordStatus({
      request: botRequest("/api/discord/status", { bearer: SECRET }),
      env: env(mock),
    });

    await expectJson(response, 200, { ok: true, linked: false, active: false });
    const lookups = ops(mock, LINK_LOOKUP);
    expect(lookups).toHaveLength(1);
    expect(lookups[0].values).toEqual([DISCORD_ID]);
  });

  it("reports a manual grant as active without a license lookup", async () => {
    const mock = linkDb({
      discord_id: DISCORD_ID,
      discord_tag: "staff#0001",
      license_key: "MANUAL",
      hwid: null,
      is_active: 1,
      source: "manual",
    });

    const response = await discordStatus({
      request: botRequest("/api/discord/status", { bearer: SECRET }),
      env: env(mock),
    });

    await expectJson(response, 200, {
      ok: true,
      linked: true,
      active: true,
      license_key: "MANUAL",
    });
    expect(ops(mock, LICENSE_LOOKUP)).toHaveLength(0);
  });

  it("keeps the 400 for a missing discord_id", async () => {
    const response = await discordStatus({
      request: botRequest("/api/discord/status", { bearer: SECRET, json: {} }),
      env: env(linkDb(null)),
    });

    await expectJson(response, 400, { ok: false, error: "discord_id is required." });
  });

  it("a storage failure yields a generic 500 with a request id and no SQL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mock = createMockD1({
      first: [
        {
          match: LINK_LOOKUP,
          result: () => {
            throw new Error("D1_ERROR: no such table: discord_links (SELECT * FROM discord_links)");
          },
        },
      ],
    });

    const response = await discordStatus({
      request: botRequest("/api/discord/status", { bearer: SECRET }),
      env: env(mock),
    });

    await expectGenericFailure(response, ["D1_ERROR", "no such table", "SELECT * FROM"]);
  });
});
