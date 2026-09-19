import { beforeEach, describe, expect, it } from "vitest";

import { onRequestPost as purchase } from "../../functions/api/discord/purchase";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { createMockD1, type MockD1, type MockD1Resolvers } from "../helpers/mock-d1";
import { createSyntheticRequest } from "../helpers/request";

/** "My purchase" in a ticket: the order data the storefront stamped on the key, masked. */
const SECRET = "bot-shared-secret-1234567890";
const DISCORD_ID = "123456789012345678";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const LINK_LOOKUP = /FROM discord_links WHERE discord_id = \?/;

const LICENSE_ROW = {
  id: 7,
  license_key: "RR-AAAA-BBBB-CCCC",
  type: "lifetime",
  duration_days: null,
  hwid: HWID,
  max_uses: 2,
  usage_count: 1,
  status: "active",
  custom_options: "{}",
  created_at: "2026-09-01T00:00:00.000Z",
  activated_at: "2026-09-02T00:00:00.000Z",
  expires_at: null,
  order_id: "SH-ORDER-99XYZ",
  customer_name: "Example Customer",
  customer_email: "buyer@example.com",
  customer_discord: "buyer#1000",
  order_source: "sellhub",
  order_note: null,
  order_meta: null,
  purchased_at: "2026-09-01T00:00:00.000Z",
};

function db(resolvers: MockD1Resolvers = {}): MockD1 {
  return createMockD1({
    ...resolvers,
    // A case's own resolvers come first: they override the defaults below, not the other way round.
    first: [
      ...(resolvers.first ?? []),
      { match: LINK_LOOKUP, result: { license_key: LICENSE_ROW.license_key, hwid: HWID } },
      { match: /SELECT \* FROM licenses WHERE license_key = \?/, result: LICENSE_ROW },
    ],
    all: [
      ...(resolvers.all ?? []),
      { match: /SELECT \* FROM licenses WHERE/, result: { results: [LICENSE_ROW] } },
    ],
  });
}

function env(mock: MockD1): RuntimeEnv {
  return { DB: mock.db, VERIFY_SHARED_SECRET: SECRET };
}

function call(mock: MockD1, json: unknown, bearer: string = SECRET) {
  return purchase({
    request: createSyntheticRequest({
      method: "POST",
      path: "/api/discord/purchase",
      headers: { authorization: `Bearer ${bearer}` },
      json,
    }),
    env: env(mock),
  });
}

beforeEach(() => resetInstallsSchemaStateForTests());

describe("POST /api/discord/purchase", () => {
  it("rejects a wrong Bearer token before touching the database", async () => {
    const mock = db();
    expect((await call(mock, { discord_id: DISCORD_ID }, "nope")).status).toBe(401);
    expect(mock.operations).toHaveLength(0);
  });

  it("refuses anything that is not a Discord snowflake", async () => {
    expect((await call(db(), { discord_id: "@buyer" })).status).toBe(400);
  });

  it("says linked:false instead of guessing for an unverified account", async () => {
    const response = await call(db({ first: [{ match: LINK_LOOKUP, result: null }] }), {
      discord_id: DISCORD_ID,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, linked: false, purchases: [] });
  });

  it("returns the plan and dates with the order id masked and the key reduced to four characters", async () => {
    const response = await call(db(), { discord_id: DISCORD_ID });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { linked: boolean; purchases: unknown[] };
    expect(body.linked).toBe(true);
    expect(body.purchases).toEqual([
      {
        plan: "lifetime",
        durationDays: null,
        status: "active",
        lifetime: true,
        purchasedAt: "2026-09-01T00:00:00.000Z",
        activatedAt: "2026-09-02T00:00:00.000Z",
        expiresAt: null,
        source: "sellhub",
        orderRef: "••••9XYZ",
        keyLast4: "CCCC",
        seatsUsed: 1,
        seatsMax: 2,
      },
    ]);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      LICENSE_ROW.order_id,
      LICENSE_ROW.license_key,
      "buyer@example.com",
      "Example Customer",
      HWID,
    ])
      expect(serialized).not.toContain(forbidden);
  });
});
