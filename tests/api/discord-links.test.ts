import { describe, expect, it } from "vitest";

import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as discordLinks } from "../../functions/api/discord/links";
import { createMockD1, type MockD1, type RecordedD1Operation } from "../helpers/mock-d1";
import { createSyntheticRequest } from "../helpers/request";

/**
 * The bot's reconcile sweep reads every active link in one call. The rules behind `active` are
 * `resolveLicenseForVerification`'s — these cases exist to prove this endpoint asks it rather than
 * carrying a second copy (an expired key must not answer active, a staff grant must).
 */
const SECRET = "bot-shared-secret-1234567890";
const LINKS_QUERY = /^SELECT discord_id, license_key FROM discord_links WHERE is_active = 1/;
const LICENSE_LOOKUP = /FROM licenses WHERE license_key = \?/;
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

const LICENSES: Record<string, Record<string, unknown>> = {
  "KEY-LIFETIME": {
    license_key: "KEY-LIFETIME",
    hwid: null,
    status: "active",
    expires_at: null,
    type: "lifetime",
    max_uses: 1,
  },
  "KEY-TRIAL": {
    license_key: "KEY-TRIAL",
    hwid: null,
    status: "active",
    expires_at: FUTURE,
    type: "trial",
    max_uses: 1,
  },
  "KEY-EXPIRED": {
    license_key: "KEY-EXPIRED",
    hwid: null,
    status: "active",
    expires_at: PAST,
    type: "trial",
    max_uses: 1,
  },
};

interface LinkEntry {
  discord_id: string;
  active: boolean;
  lifetime: boolean;
  plan: string;
  expiresAt: string | null;
  reason?: string;
}

function env(mock: MockD1): RuntimeEnv {
  return { DB: mock.db, VERIFY_SHARED_SECRET: SECRET };
}

function request(bearer?: string, querySecret?: string): Request {
  return createSyntheticRequest({
    method: "POST",
    path: "/api/discord/links",
    query: querySecret === undefined ? undefined : { secret: querySecret },
    headers: bearer === undefined ? undefined : { authorization: `Bearer ${bearer}` },
    json: {},
  });
}

function linkDb(rows: Array<{ discord_id: string; license_key: string }>): MockD1 {
  return createMockD1({
    all: [{ match: LINKS_QUERY, result: { results: rows } }],
    first: [
      {
        match: LICENSE_LOOKUP,
        result: (operation: RecordedD1Operation) => LICENSES[String(operation.values[0])] ?? null,
      },
    ],
  });
}

describe("POST /api/discord/links (bot shared secret)", () => {
  it("rejects ?secret= even when it is correct and no Bearer token is sent", async () => {
    const mock = linkDb([]);

    const response = await discordLinks({ request: request(undefined, SECRET), env: env(mock) });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: "Unauthorized." });
    expect(mock.operations).toHaveLength(0);
  });

  it("rejects a wrong Bearer token", async () => {
    const response = await discordLinks({ request: request("nope"), env: env(linkDb([])) });

    expect(response.status).toBe(401);
  });

  it("answers 500 when the shared secret is not configured", async () => {
    const response = await discordLinks({
      request: request(SECRET),
      env: { DB: linkDb([]).db },
    });

    expect(response.status).toBe(500);
  });

  it("reports one entry per active link with its plan, expiry and lifetime flag", async () => {
    const mock = linkDb([
      { discord_id: "111111111111111111", license_key: "KEY-LIFETIME" },
      { discord_id: "222222222222222222", license_key: "KEY-TRIAL" },
      { discord_id: "333333333333333333", license_key: "KEY-EXPIRED" },
      { discord_id: "444444444444444444", license_key: "MANUAL" },
      { discord_id: "555555555555555555", license_key: "KEY-GONE" },
    ]);

    const response = await discordLinks({ request: request(SECRET), env: env(mock) });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; links: LinkEntry[] };
    expect(body.ok).toBe(true);
    expect(body.links).toEqual([
      {
        discord_id: "111111111111111111",
        active: true,
        lifetime: true,
        plan: "lifetime",
        expiresAt: null,
      },
      {
        discord_id: "222222222222222222",
        active: true,
        lifetime: false,
        plan: "trial",
        expiresAt: FUTURE,
      },
      {
        discord_id: "333333333333333333",
        active: false,
        lifetime: false,
        plan: "trial",
        expiresAt: PAST,
        reason: "expired",
      },
      {
        discord_id: "444444444444444444",
        active: true,
        lifetime: false,
        plan: "manual",
        expiresAt: null,
      },
      {
        discord_id: "555555555555555555",
        active: false,
        lifetime: false,
        plan: "unknown",
        expiresAt: null,
        reason: "invalid_key",
      },
    ]);
  });

  it("never returns a license key and skips the lookup for a staff grant", async () => {
    const mock = linkDb([{ discord_id: "444444444444444444", license_key: "MANUAL" }]);

    const response = await discordLinks({ request: request(SECRET), env: env(mock) });

    expect(await response.text()).not.toContain("license_key");
    expect(mock.operations.filter((op) => LICENSE_LOOKUP.test(op.normalizedSql))).toHaveLength(0);
  });
});
