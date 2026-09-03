import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { onRequestPost as activateLicense } from "../../functions/api/admin/licenses/[key]/activate";
import { onRequestPost as bindLicense } from "../../functions/api/admin/licenses/[key]/bind";
import { onRequestPost as issueLicense } from "../../functions/api/admin/licenses/issue";
import { onRequestGet as searchLicenses } from "../../functions/api/admin/licenses/search";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { createMockD1, type MockD1Resolvers } from "../helpers/mock-d1";
import {
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const ADMIN = "admin@example.com";
const VIEWER = "viewer@example.com";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const LICENSE_KEY = "RR-AAAA-BBBB-CCCC";

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
beforeEach(() => resetInstallsSchemaStateForTests());

function env(db: ReturnType<typeof createMockD1>["db"], email = ADMIN) {
  return testAccessEnv(`${ADMIN},${VIEWER}`, {
    DB: db,
    ACCESS_ADMIN_EMAIL: ADMIN,
    ACCESS_ALLOWED_EMAIL: `${ADMIN},${VIEWER}`,
  });
}

async function mutationRequest(path: string, payload: Record<string, unknown>, email = ADMIN) {
  const headers = await accessIdentityHeaders(email, {
    "Idempotency-Key": String(payload.idempotency_key),
  });
  return createSyntheticRequest({ path, json: payload, headers });
}

function license(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    license_key: LICENSE_KEY,
    type: "lifetime",
    duration_days: null,
    hwid: HWID,
    max_uses: 1,
    usage_count: 1,
    status: "active",
    custom_options: "{}",
    created_at: "2026-09-01T00:00:00.000Z",
    activated_at: "2026-09-02T00:00:00.000Z",
    expires_at: null,
    order_id: "ORDER-100",
    customer_name: "Example Customer",
    customer_email: "buyer@example.com",
    customer_discord: null,
    order_source: "admin",
    order_note: null,
    order_meta: null,
    purchased_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("admin license order workflow", () => {
  it("is admin-only", async () => {
    const mock = createMockD1();
    const response = await issueLicense({
      request: await mutationRequest(
        "/api/admin/licenses/issue",
        { order_id: "ORDER-1", type: "lifetime", idempotency_key: "idem-viewer-0001" },
        VIEWER,
      ),
      env: env(mock.db),
    });

    expect(response.status).toBe(403);
    expect(mock.operations).toHaveLength(0);
  });

  it("blocks a second license for an exact order even with a fresh idempotency key", async () => {
    const existing = license();
    const mock = createMockD1({
      all: [
        {
          match: /SELECT \* FROM licenses WHERE order_id = \? ORDER BY id DESC/,
          result: { results: [existing] },
        },
      ],
    });
    const response = await issueLicense({
      request: await mutationRequest("/api/admin/licenses/issue", {
        order_id: "ORDER-100",
        customer_email: "buyer@example.com",
        type: "lifetime",
        idempotency_key: "fresh-idem-0001",
      }),
      env: env(mock.db),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "order_already_fulfilled",
      existing_licenses: [existing],
    });
    expect(
      mock.operations.filter((operation) =>
        operation.normalizedSql.startsWith("INSERT INTO licenses"),
      ),
    ).toHaveLength(0);
    expect(
      mock.operations.some(
        (operation) =>
          operation.normalizedSql.startsWith("UPDATE license_admin_operations") &&
          operation.values[0] === "rejected",
      ),
    ).toBe(true);
  });

  it("searches an order exactly and treats customer wildcard characters literally", async () => {
    const mock = createMockD1({
      all: [{ match: /FROM licenses l/, result: { results: [license()] } }],
      first: [{ match: /SELECT COUNT\(\*\) AS total/, result: { total: 1 } }],
    });
    const request = createSyntheticRequest({
      path: "/api/admin/licenses/search",
      query: { order_id: "ORDER-100", customer: "buyer_%" },
      headers: await accessIdentityHeaders(ADMIN),
    });
    const response = await searchLicenses({ request, env: env(mock.db) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, total: 1 });
    const query = mock.operations.find(
      (operation) =>
        operation.kind === "all" && operation.normalizedSql.includes("FROM licenses l"),
    );
    expect(query?.normalizedSql).toContain("l.order_id = ?");
    expect(query?.normalizedSql).toContain(
      "instr(lower(COALESCE(l.customer_email, '')), lower(?))",
    );
    expect(query?.values).toEqual(["ORDER-100", "buyer_%", "buyer_%", "buyer_%"]);
  });
});

describe("admin activate/bind workflow", () => {
  function bindingDb(
    current: Record<string, unknown>,
    updated = current,
    resolvers: MockD1Resolvers = {},
  ) {
    return createMockD1({
      ...resolvers,
      first: [
        ...(resolvers.first ?? []),
        { match: /FROM license_admin_operations WHERE idempotency_key/, result: null },
        { match: /SELECT \* FROM licenses WHERE license_key = \?/, result: current },
        {
          match: /FROM installs WHERE install_id = \?/,
          result: {
            install_id: INSTALL_ID,
            hwid: HWID,
            revoked_at: null,
            license_id: 7,
          },
        },
        { match: /SELECT \* FROM licenses WHERE id = \?/, result: updated },
      ],
    });
  }

  it("repeating a bind to an existing HWID does not update or double-count the license", async () => {
    const current = license();
    const mock = bindingDb(current);
    const response = await bindLicense({
      request: await mutationRequest(`/api/admin/licenses/${LICENSE_KEY}/bind`, {
        hwid: HWID,
        install_id: INSTALL_ID,
        idempotency_key: "bind-existing-0001",
      }),
      env: env(mock.db),
      params: { key: LICENSE_KEY },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      changed: false,
      activated: false,
      license: { usage_count: 1, hwid: HWID },
    });
    expect(
      mock.operations.filter((operation) =>
        operation.normalizedSql.startsWith("UPDATE licenses SET hwid"),
      ),
    ).toHaveLength(0);
  });

  it("first activation binds one seat and derives usage_count from unique HWIDs", async () => {
    let installLinked = false;
    const current = license({ hwid: null, usage_count: 0, activated_at: null });
    const updated = license({
      hwid: HWID,
      usage_count: 1,
      activated_at: "2026-09-03T00:00:00.000Z",
    });
    const mock = bindingDb(current, updated, {
      first: [
        {
          match: /FROM installs WHERE install_id = \?/,
          result: () => ({
            install_id: INSTALL_ID,
            hwid: HWID,
            revoked_at: null,
            license_id: installLinked ? 7 : null,
          }),
        },
      ],
      run: [
        {
          match: /^UPDATE installs SET license_id = \?/,
          result: () => {
            installLinked = true;
            return { success: true, meta: { changes: 1 } };
          },
        },
      ],
    });
    const response = await activateLicense({
      request: await mutationRequest(`/api/admin/licenses/${LICENSE_KEY}/activate`, {
        install_id: INSTALL_ID,
        idempotency_key: "activate-new-0001",
      }),
      env: env(mock.db),
      params: { key: LICENSE_KEY },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, changed: true, activated: true });
    const update = mock.operations.find((operation) =>
      operation.normalizedSql.startsWith("UPDATE licenses SET hwid"),
    );
    expect(update?.values[0]).toBe(HWID);
    expect(update?.values[1]).toBe(1);
  });

  it("an install-claim race rolls back before the license can be double-linked", async () => {
    let installClaimReads = 0;
    const current = license({ hwid: null, usage_count: 0, activated_at: null });
    const mock = bindingDb(current, current, {
      first: [
        {
          match: /FROM installs WHERE install_id = \?/,
          result: {
            install_id: INSTALL_ID,
            hwid: HWID,
            revoked_at: null,
            license_id: null,
          },
        },
        {
          match: /FROM license_install_claims WHERE install_id = \?/,
          result: () => {
            installClaimReads += 1;
            return installClaimReads === 1
              ? null
              : { install_id: INSTALL_ID, license_id: 8, operation_id: "LO-WINNER" };
          },
        },
      ],
      run: [
        {
          match: /^INSERT INTO license_install_claims/,
          result: () => {
            throw new Error("UNIQUE constraint failed: license_install_claims.install_id");
          },
        },
      ],
    });
    const response = await activateLicense({
      request: await mutationRequest(`/api/admin/licenses/${LICENSE_KEY}/activate`, {
        install_id: INSTALL_ID,
        idempotency_key: "activate-race-0001",
      }),
      env: env(mock.db),
      params: { key: LICENSE_KEY },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "install_linked_to_another_license",
    });
    expect(
      mock.operations.filter((operation) =>
        operation.normalizedSql.startsWith("UPDATE licenses SET hwid"),
      ),
    ).toHaveLength(0);
  });
});
