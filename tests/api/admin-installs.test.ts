import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestGet as listInstalls } from "../../functions/api/admin/installs/index";
import { onRequestPost as revokeInstall } from "../../functions/api/admin/installs/[id]/revoke";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { createMockD1, type MockD1, type MockD1Resolvers } from "../helpers/mock-d1";
import {
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "admin@example.com";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const OTHER_INSTALL_ID = "0b6f0c52-1b6e-4f1a-9c3e-5d8a7e2b1c44";
const LIST_FOR_HWID = /FROM installs WHERE hwid = \? ORDER BY created_at DESC/;
const REVOKE = /^UPDATE installs SET revoked_at = COALESCE\(revoked_at, \?\)/;

const INSTALL_ROWS = [
  {
    install_id: INSTALL_ID,
    hwid: HWID,
    app_version: "1.4.9",
    created_at: "2026-08-02T10:00:00.000Z",
    last_seen_at: "2026-08-20T18:30:00.000Z",
    revoked_at: null,
    revoke_reason: null,
    license_id: 7,
  },
  {
    install_id: OTHER_INSTALL_ID,
    hwid: HWID,
    app_version: "1.4.8",
    created_at: "2026-07-01T09:00:00.000Z",
    last_seen_at: null,
    revoked_at: "2026-07-15T12:00:00.000Z",
    revoke_reason: "key leaked",
    license_id: null,
  },
];

beforeAll(async () => {
  // The route handlers use the default JWKS fetcher; serve the shared test signer's public key
  // from the team certs URL so no request ever leaves the process.
  const signer = await getTestAccessSigner();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `https://${TEST_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify(signer.jwks), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected network request in test: ${url}`);
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetInstallsSchemaStateForTests();
});

function db(resolvers: MockD1Resolvers = {}): MockD1 {
  return createMockD1({
    ...resolvers,
    all: [{ match: LIST_FOR_HWID, result: { results: INSTALL_ROWS } }, ...(resolvers.all ?? [])],
  });
}

function env(mock: MockD1, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, { DB: mock.db, ...overrides });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("GET /api/admin/installs", () => {
  it("returns 401 without an Access JWT", async () => {
    const mock = db();
    const request = createSyntheticRequest({
      path: "/api/admin/installs",
      query: { hwid: HWID },
      headers: { "cf-access-authenticated-user-email": EMAIL },
    });

    const response = await listInstalls({ request, env: env(mock) });

    expect(response.status).toBe(401);
    expect(mock.operations).toHaveLength(0);
  });

  it("lists the installs for a device from D1 (newest first, camelCase)", async () => {
    const mock = db();
    const request = createSyntheticRequest({
      path: "/api/admin/installs",
      query: { hwid: HWID },
      headers: await accessIdentityHeaders(EMAIL),
    });

    const response = await listInstalls({ request, env: env(mock) });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      ok: true,
      hwid: HWID,
      installs: [
        {
          installId: INSTALL_ID,
          hwid: HWID,
          appVersion: "1.4.9",
          createdAt: "2026-08-02T10:00:00.000Z",
          lastSeenAt: "2026-08-20T18:30:00.000Z",
          revokedAt: null,
          revokeReason: null,
          licenseId: 7,
        },
        {
          installId: OTHER_INSTALL_ID,
          hwid: HWID,
          appVersion: "1.4.8",
          createdAt: "2026-07-01T09:00:00.000Z",
          lastSeenAt: null,
          revokedAt: "2026-07-15T12:00:00.000Z",
          revokeReason: "key leaked",
          licenseId: null,
        },
      ],
    });

    const list = mock.operations.find((op) => LIST_FOR_HWID.test(op.normalizedSql));
    expect(list?.kind).toBe("all");
    expect(list?.values).toEqual([HWID]);
    // The installs table is created on demand so a fresh D1 never 500s on the first listing.
    expect(
      mock.operations.some((op) =>
        op.normalizedSql.startsWith("CREATE TABLE IF NOT EXISTS installs"),
      ),
    ).toBe(true);
  });

  it("returns an empty list for a device without installs", async () => {
    const mock = createMockD1();
    const request = createSyntheticRequest({
      path: "/api/admin/installs",
      query: { hwid: "UNKNOWN-DEVICE" },
      headers: await accessIdentityHeaders(EMAIL),
    });

    const response = await listInstalls({ request, env: env(mock) });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, hwid: "UNKNOWN-DEVICE", installs: [] });
  });

  it("returns 400 when hwid is missing or malformed", async () => {
    const mock = db();
    const headers = await accessIdentityHeaders(EMAIL);

    const missing = await listInstalls({
      request: createSyntheticRequest({ path: "/api/admin/installs", headers }),
      env: env(mock),
    });
    expect(missing.status).toBe(400);

    const tooLong = await listInstalls({
      request: createSyntheticRequest({
        path: "/api/admin/installs",
        query: { hwid: "x".repeat(65) },
        headers,
      }),
      env: env(mock),
    });
    expect(tooLong.status).toBe(400);

    const withSpace = await listInstalls({
      request: createSyntheticRequest({
        path: "/api/admin/installs",
        query: { hwid: "bad hwid" },
        headers,
      }),
      env: env(mock),
    });
    expect(withSpace.status).toBe(400);

    expect(mock.operations.filter((op) => LIST_FOR_HWID.test(op.normalizedSql))).toHaveLength(0);
  });

  it("returns 500 without a database binding", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/installs",
      query: { hwid: HWID },
      headers: await accessIdentityHeaders(EMAIL),
    });

    const response = await listInstalls({ request, env: testAccessEnv(EMAIL) });

    expect(response.status).toBe(500);
  });
});

describe("POST /api/admin/installs/:id/revoke", () => {
  function revokeRequest(
    id: string,
    json: unknown = { reason: "shared the key" },
    extraHeaders: HeadersInit = {},
  ): Promise<Request> {
    return accessIdentityHeaders(EMAIL, extraHeaders).then((headers) =>
      createSyntheticRequest({ path: `/api/admin/installs/${id}/revoke`, json, headers }),
    );
  }

  it("returns 401 without an Access JWT", async () => {
    const mock = db();
    const request = createSyntheticRequest({
      path: `/api/admin/installs/${INSTALL_ID}/revoke`,
      json: { reason: "x" },
    });

    const response = await revokeInstall({
      request,
      env: env(mock),
      params: { id: INSTALL_ID },
    });

    expect(response.status).toBe(401);
    expect(mock.operations).toHaveLength(0);
  });

  it("revokes the install and stores the reason", async () => {
    const mock = db();

    const response = await revokeInstall({
      request: await revokeRequest(INSTALL_ID.toUpperCase()),
      env: env(mock),
      params: { id: INSTALL_ID.toUpperCase() },
    });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, installId: INSTALL_ID, revoked: true });

    const update = mock.operations.find((op) => REVOKE.test(op.normalizedSql));
    expect(update?.kind).toBe("run");
    expect(update?.values).toHaveLength(3);
    expect(typeof update?.values[0]).toBe("string");
    expect(Number.isNaN(Date.parse(String(update?.values[0])))).toBe(false);
    expect(update?.values[1]).toBe("shared the key");
    expect(update?.values[2]).toBe(INSTALL_ID);
  });

  it("is idempotent: a second revoke of the same install still answers 200", async () => {
    let updates = 0;
    const mock = db({
      run: [
        {
          match: REVOKE,
          result: () => {
            updates += 1;
            // SQLite counts the matched row even when COALESCE keeps the first revocation.
            return { success: true, meta: { changes: 1 } };
          },
        },
      ],
    });

    const first = await revokeInstall({
      request: await revokeRequest(INSTALL_ID),
      env: env(mock),
      params: { id: INSTALL_ID },
    });
    const second = await revokeInstall({
      request: await revokeRequest(INSTALL_ID, { reason: "again" }),
      env: env(mock),
      params: { id: INSTALL_ID },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(updates).toBe(2);
  });

  it("accepts an empty body and stores a null reason", async () => {
    const mock = db();
    const headers = await accessIdentityHeaders(EMAIL);
    const request = createSyntheticRequest({
      path: `/api/admin/installs/${INSTALL_ID}/revoke`,
      method: "POST",
      headers,
    });

    const response = await revokeInstall({ request, env: env(mock), params: { id: INSTALL_ID } });

    expect(response.status).toBe(200);
    const update = mock.operations.find((op) => REVOKE.test(op.normalizedSql));
    expect(update?.values[1]).toBeNull();
  });

  it("returns 404 when no install has that id", async () => {
    const mock = db({
      run: [{ match: REVOKE, result: { success: true, meta: { changes: 0 } } }],
    });

    const response = await revokeInstall({
      request: await revokeRequest(OTHER_INSTALL_ID),
      env: env(mock),
      params: { id: OTHER_INSTALL_ID },
    });

    expect(response.status).toBe(404);
  });

  it("returns 400 for a malformed install id, an invalid JSON body or a non-string reason", async () => {
    const mock = db();

    const badId = await revokeInstall({
      request: await revokeRequest("not-a-guid"),
      env: env(mock),
      params: { id: "not-a-guid" },
    });
    expect(badId.status).toBe(400);

    const headers = await accessIdentityHeaders(EMAIL, { "content-type": "application/json" });
    const invalidJson = await revokeInstall({
      request: new Request(`https://admin.test/api/admin/installs/${INSTALL_ID}/revoke`, {
        method: "POST",
        headers,
        body: "{not json",
      }),
      env: env(mock),
      params: { id: INSTALL_ID },
    });
    expect(invalidJson.status).toBe(400);

    const badReason = await revokeInstall({
      request: await revokeRequest(INSTALL_ID, { reason: 42 }),
      env: env(mock),
      params: { id: INSTALL_ID },
    });
    expect(badReason.status).toBe(400);

    expect(mock.operations.filter((op) => REVOKE.test(op.normalizedSql))).toHaveLength(0);
  });

  it("returns 403 for a cross-site request even with a valid identity", async () => {
    const mock = db();

    const response = await revokeInstall({
      request: await revokeRequest(INSTALL_ID, { reason: "x" }, { "sec-fetch-site": "cross-site" }),
      env: env(mock),
      params: { id: INSTALL_ID },
    });

    expect(response.status).toBe(403);
    expect(mock.operations).toHaveLength(0);
  });

  it("never returns the raw D1 error text", async () => {
    const mock = db({
      run: [
        {
          match: REVOKE,
          result: () => {
            throw new Error("D1_ERROR: no such table: installs at UPDATE installs");
          },
        },
      ],
    });

    const response = await revokeInstall({
      request: await revokeRequest(INSTALL_ID),
      env: env(mock),
      params: { id: INSTALL_ID },
    });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("D1_ERROR");
    expect(text).not.toContain("no such table");
  });
});
