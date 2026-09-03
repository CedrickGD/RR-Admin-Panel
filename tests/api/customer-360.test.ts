import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { onRequestGet as customer360 } from "../../functions/api/admin/customer-360";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { createMockD1 } from "../helpers/mock-d1";
import {
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const ADMIN = "admin@example.com";
const VIEWER = "viewer@example.com";
const SESSION_ID = "session-100";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

const SESSION = {
  session_id: SESSION_ID,
  install_id: INSTALL_ID,
  hwid: HWID,
  source: "desktop",
  user_label: "Support User",
  client_ip: "203.0.113.10",
  client_country: "DE",
  client_city: "Berlin",
  client_region: "Berlin",
  client_latitude: 52.52,
  client_longitude: 13.405,
  client_timezone: "Europe/Berlin",
  client_geo_source: "edge",
  client_geo_signal_source: "cf",
  client_accuracy_meters: 10,
  client_geo_captured_at: "2026-09-03T10:00:00.000Z",
  app_version: "1.5.0",
  display_version: "1.5.0",
  platform: "win32",
  os_version: "Windows 11",
  device_model: "Desktop",
  rpc_enabled: 1,
  discord_user: "support-user",
  features_json: '{"desync":1}',
  started_at: "2026-09-03T10:00:00.000Z",
  last_seen_at: "2026-09-03T10:02:00.000Z",
  ended_at: "2026-09-03T10:02:00.000Z",
  duration_seconds: 120,
  is_active: 0,
  last_event: "session_end",
  last_status: "ok",
  error_count: 1,
  updated_at: "2026-09-03T10:02:00.000Z",
};

const LICENSE = {
  id: 7,
  license_key: "RR-AAAA-BBBB-CCCC",
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
  customer_discord: "buyer#1000",
  order_source: "admin",
  order_note: null,
  order_meta: null,
  purchased_at: "2026-09-01T00:00:00.000Z",
};

beforeAll(async () => {
  const signer = await getTestAccessSigner();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `https://${TEST_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify(signer.jwks));
      }
      throw new Error(`Unexpected network request: ${url}`);
    }),
  );
});

afterAll(() => vi.unstubAllGlobals());
beforeEach(() => resetInstallsSchemaStateForTests());

function env(db: ReturnType<typeof createMockD1>["db"]) {
  return testAccessEnv(`${ADMIN},${VIEWER}`, {
    DB: db,
    ACCESS_ALLOWED_EMAIL: `${ADMIN},${VIEWER}`,
    ACCESS_ADMIN_EMAIL: ADMIN,
  });
}

describe("GET /api/admin/customer-360", () => {
  it("returns a section-tolerant Customer 360 record joined only by strong identifiers", async () => {
    const mock = createMockD1({
      first: [
        { match: /FROM app_sessions WHERE session_id = \? LIMIT 1/, result: SESSION },
        {
          match: /SUM\(CASE WHEN session_id LIKE 'install:%'/,
          result: {
            legacy_rows: 0,
            first_seen: SESSION.started_at,
            legacy_last_seen: null,
          },
        },
      ],
      all: [
        {
          match: /SELECT session_id, install_id, hwid, source, user_label.*FROM app_sessions WHERE/,
          result: { results: [SESSION] },
        },
        {
          match:
            /SELECT install_id, hwid, app_version, created_at, last_seen_at, revoked_at, revoke_reason, license_id FROM installs WHERE/,
          result: {
            results: [
              {
                install_id: INSTALL_ID,
                hwid: HWID,
                app_version: "1.5.0",
                created_at: "2026-09-01T00:00:00.000Z",
                last_seen_at: SESSION.last_seen_at,
                revoked_at: null,
                revoke_reason: null,
                license_id: 7,
              },
            ],
          },
        },
        { match: /SELECT \* FROM licenses WHERE/, result: { results: [LICENSE] } },
        {
          match: /SELECT f\.\*, m\.report_id/,
          result: {
            results: [
              {
                id: 20,
                message: "Desync does not work",
                contact: "support-user",
                hwid: HWID,
                install_id: INSTALL_ID,
                license_key: LICENSE.license_key,
                machine_name: "DESKTOP",
                app_version: "1.5.0",
                platform: "win32",
                status: "new",
                created_at: "2026-09-03T10:03:00.000Z",
                report_id: null,
                auth_mode: null,
                verified_install_id: null,
              },
            ],
          },
        },
        {
          match:
            /SELECT started_at, ended_at, last_seen_at, is_active, last_event, client_timezone FROM app_sessions/,
          result: { results: [SESSION] },
        },
      ],
    });
    const response = await customer360({
      request: createSyntheticRequest({
        path: "/api/admin/customer-360",
        query: { session_id: SESSION_ID },
        headers: await accessIdentityHeaders(ADMIN),
      }),
      env: env(mock.db),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, any>;
    expect(payload.ok).toBe(true);
    expect(payload.customer.anchor).toEqual({
      requested_by: "session_id",
      requested_value: SESSION_ID,
      requested_session_id: SESSION_ID,
      identity: HWID,
      hwid: HWID,
      install_id: INSTALL_ID,
      confidence: "verified_customer",
    });
    expect(payload.customer.profile).toMatchObject({
      user_label: "Support User",
      customer_name: "Example Customer",
      email: "buyer@example.com",
    });
    expect(payload.customer.summary).toMatchObject({
      license_tier: "premium",
      total_sessions: 1,
      total_duration_seconds: 120,
      os_version: "Windows 11",
    });
    expect(payload.customer.orders[0]).toMatchObject({ order_id: "ORDER-100", license_count: 1 });
    expect(payload.customer.feedback[0]).toMatchObject({
      report_id: "FB-000020",
      identity_confidence: "claimed_identity",
    });
    for (const key of [
      "usage",
      "orders",
      "licenses",
      "access",
      "discord_links",
      "feedback",
      "errors",
      "installs",
      "sessions",
    ]) {
      expect(Array.isArray(payload.customer[key])).toBe(true);
    }
  });

  it("rejects ambiguous selectors, name-only lookup, and viewer access", async () => {
    const mock = createMockD1();
    const adminHeaders = await accessIdentityHeaders(ADMIN);
    const ambiguous = await customer360({
      request: createSyntheticRequest({
        path: "/api/admin/customer-360",
        query: { session_id: SESSION_ID, hwid: HWID },
        headers: adminHeaders,
      }),
      env: env(mock.db),
    });
    expect(ambiguous.status).toBe(400);

    const nameOnly = await customer360({
      request: createSyntheticRequest({
        path: "/api/admin/customer-360",
        query: { customer: "Example Customer" },
        headers: adminHeaders,
      }),
      env: env(mock.db),
    });
    expect(nameOnly.status).toBe(400);

    const viewer = await customer360({
      request: createSyntheticRequest({
        path: "/api/admin/customer-360",
        query: { session_id: SESSION_ID },
        headers: await accessIdentityHeaders(VIEWER),
      }),
      env: env(mock.db),
    });
    expect(viewer.status).toBe(403);
  });
});
