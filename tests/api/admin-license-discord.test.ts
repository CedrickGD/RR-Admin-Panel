import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DISCORD_LINK_AUDIT_ACTIONS,
  onRequestDelete as unlinkDiscord,
  onRequestGet as listDiscord,
  onRequestPost as linkDiscord,
} from "../../functions/api/admin/licenses/[key]/discord";
import { createMockD1, type MockD1, type MockD1Resolvers } from "../helpers/mock-d1";
import {
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

/**
 * Admin: rebind or add the Discord account of a license. `replace` is the rebind ("I bought this on
 * my old account"); without it the account is added on purpose past the seat limit, which is why no
 * seat check may appear on this path.
 */
const ADMIN = "admin@example.com";
const VIEWER = "viewer@example.com";
const LICENSE_KEY = "RR-AAAA-BBBB-CCCC";
const DISCORD_ID = "123456789012345678";
const OTHER_ID = "987654321098765432";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

const LICENSE_LOOKUP = /SELECT license_key, hwid FROM licenses WHERE license_key = \?/;
const LINK_UPSERT = /^INSERT INTO discord_links/;
const LINK_REVOKE = /^UPDATE discord_links SET is_active = 0/;
const LINK_LIST = /^SELECT discord_id, discord_tag, license_key/;
const AUDIT_INSERT = /^INSERT INTO panel_audit/;

beforeAll(async () => {
  const signer = await getTestAccessSigner();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `https://${TEST_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify(signer.jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected network request: ${url}`);
    }),
  );
});

afterAll(() => vi.unstubAllGlobals());

function env(mock: MockD1) {
  return testAccessEnv(`${ADMIN},${VIEWER}`, {
    DB: mock.db,
    ACCESS_ADMIN_EMAIL: ADMIN,
    ACCESS_ALLOWED_EMAIL: `${ADMIN},${VIEWER}`,
  });
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    discord_id: DISCORD_ID,
    discord_tag: "member",
    license_key: LICENSE_KEY,
    hwid: null,
    verified_at: "2026-09-19T10:00:00.000Z",
    revoked_at: null,
    is_active: 1,
    source: "manual",
    ...overrides,
  };
}

function db(resolvers: MockD1Resolvers = {}): MockD1 {
  return createMockD1({
    ...resolvers,
    first: [
      { match: LICENSE_LOOKUP, result: { license_key: LICENSE_KEY, hwid: HWID } },
      ...(resolvers.first ?? []),
    ],
    all: [{ match: LINK_LIST, result: { results: [linkRow()] } }, ...(resolvers.all ?? [])],
  });
}

async function call(
  handler: (context: {
    request: Request;
    env: ReturnType<typeof env>;
    params: { key: string };
  }) => Promise<Response>,
  options: {
    method: string;
    mock: MockD1;
    json?: unknown;
    email?: string;
    key?: string;
  },
): Promise<Response> {
  const key = options.key ?? LICENSE_KEY;
  return handler({
    request: createSyntheticRequest({
      method: options.method,
      path: `/api/admin/licenses/${encodeURIComponent(key)}/discord`,
      json: options.json,
      headers: await accessIdentityHeaders(options.email ?? ADMIN),
    }),
    env: env(options.mock),
    params: { key: encodeURIComponent(key) },
  });
}

function ops(mock: MockD1, pattern: RegExp) {
  return mock.operations.filter((operation) => pattern.test(operation.normalizedSql));
}

describe("GET /api/admin/licenses/:key/discord", () => {
  it("lists the license's links", async () => {
    const mock = db();

    const response = await call(listDiscord, { method: "GET", mock });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      license_key: LICENSE_KEY,
      links: [{ discord_id: DISCORD_ID, is_active: 1 }],
    });
  });
});

describe("POST /api/admin/licenses/:key/discord", () => {
  it("needs the licenses write permission", async () => {
    const mock = db();

    const response = await call(linkDiscord, {
      method: "POST",
      mock,
      json: { discord_id: DISCORD_ID },
      email: VIEWER,
    });

    expect(response.status).toBe(403);
    expect(ops(mock, LINK_UPSERT)).toHaveLength(0);
  });

  it("refuses anything that is not a Discord snowflake", async () => {
    const mock = db();

    const response = await call(linkDiscord, {
      method: "POST",
      mock,
      json: { discord_id: "@buyer" },
    });

    expect(response.status).toBe(400);
    expect(ops(mock, LINK_UPSERT)).toHaveLength(0);
  });

  it("404s an unknown license instead of linking into nowhere", async () => {
    const mock = createMockD1({ first: [{ match: LICENSE_LOOKUP, result: null }] });

    const response = await call(linkDiscord, {
      method: "POST",
      mock,
      json: { discord_id: DISCORD_ID },
    });

    expect(response.status).toBe(404);
    expect(ops(mock, LINK_UPSERT)).toHaveLength(0);
  });

  it("adds an account without touching the others, and audits it", async () => {
    const mock = db();

    const response = await call(linkDiscord, {
      method: "POST",
      mock,
      json: { discord_id: DISCORD_ID, discord_tag: "buyer" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, discord_id: DISCORD_ID, replaced: 0 });
    // Seat limits are deliberately not enforced here — that is the owner's override.
    expect(ops(mock, /SELECT COUNT\(\*\) AS c FROM discord_links/)).toHaveLength(0);
    expect(ops(mock, LINK_REVOKE)).toHaveLength(0);
    const upserts = ops(mock, LINK_UPSERT);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].values.slice(0, 4)).toEqual([DISCORD_ID, "buyer", LICENSE_KEY, HWID]);
    expect(upserts[0].values[5]).toBe("manual");
    const audit = ops(mock, AUDIT_INSERT);
    expect(audit).toHaveLength(1);
    expect(audit[0].values.slice(0, 3)).toEqual([
      ADMIN,
      LICENSE_KEY,
      DISCORD_LINK_AUDIT_ACTIONS.link,
    ]);
  });

  it("replace revokes the license's other accounts first — the rebind", async () => {
    const mock = db({
      run: [{ match: LINK_REVOKE, result: { success: true, meta: { changes: 2 } } }],
      first: [
        {
          match: /SELECT license_key, is_active FROM discord_links/,
          result: { license_key: "RR-OLD-KEY", is_active: 1 },
        },
      ],
    });

    const response = await call(linkDiscord, {
      method: "POST",
      mock,
      json: { discord_id: DISCORD_ID, replace: true },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, replaced: 2 });
    const revokes = ops(mock, LINK_REVOKE);
    expect(revokes).toHaveLength(1);
    expect(revokes[0].normalizedSql).toContain("discord_id <> ?");
    expect(revokes[0].values.slice(1)).toEqual([LICENSE_KEY, DISCORD_ID]);
    // Revoke first, then the upsert — never the other way round, or the new row is revoked too.
    const order = mock.operations.findIndex((op) => LINK_REVOKE.test(op.normalizedSql));
    expect(order).toBeLessThan(
      mock.operations.findIndex((op) => LINK_UPSERT.test(op.normalizedSql)),
    );
    const audit = ops(mock, AUDIT_INSERT);
    expect(audit[0].values[2]).toBe(DISCORD_LINK_AUDIT_ACTIONS.rebind);
    expect(String(audit[0].values[3])).toContain("RR-OLD-KEY");
  });
});

describe("DELETE /api/admin/licenses/:key/discord", () => {
  it("revokes exactly that account on this license", async () => {
    const mock = db({ all: [{ match: LINK_LIST, result: { results: [] } }] });

    const response = await call(unlinkDiscord, {
      method: "DELETE",
      mock,
      json: { discord_id: OTHER_ID },
    });

    expect(response.status).toBe(200);
    const revokes = ops(mock, LINK_REVOKE);
    expect(revokes).toHaveLength(1);
    expect(revokes[0].normalizedSql).toContain("discord_id = ?");
    expect(revokes[0].values.slice(1)).toEqual([LICENSE_KEY, OTHER_ID]);
    expect(ops(mock, AUDIT_INSERT)[0].values[2]).toBe(DISCORD_LINK_AUDIT_ACTIONS.unlink);
  });

  it("404s when the account has no active link on this license", async () => {
    const mock = db({
      run: [{ match: LINK_REVOKE, result: { success: true, meta: { changes: 0 } } }],
    });

    const response = await call(unlinkDiscord, {
      method: "DELETE",
      mock,
      json: { discord_id: OTHER_ID },
    });

    expect(response.status).toBe(404);
    expect(ops(mock, AUDIT_INSERT)).toHaveLength(0);
  });
});
