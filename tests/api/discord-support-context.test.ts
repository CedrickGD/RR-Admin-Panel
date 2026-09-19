import { beforeEach, describe, expect, it } from "vitest";

import { onRequestPost as supportContext } from "../../functions/api/discord/support-context";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { createMockD1, type MockD1, type MockD1Resolvers } from "../helpers/mock-d1";
import { createSyntheticRequest } from "../helpers/request";

/**
 * The bot asks for client data after the member pressed "I've sent it". The anchor is the member's
 * Discord link; a Report ID typed into a ticket anchors the report instead and then proves nothing
 * about ownership, which is what the licence-withholding case below pins down.
 */
const SECRET = "bot-shared-secret-1234567890";
const DISCORD_ID = "123456789012345678";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const OTHER_HWID = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const LICENSE_KEY = "RR-AAAA-BBBB-CCCC";

const LINK_LOOKUP = /FROM discord_links WHERE discord_id = \?/;
const LICENSE_ROW = {
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
  order_id: "SH-ORDER-99XYZ",
  customer_name: "Example Customer",
  customer_email: "buyer@example.com",
  customer_discord: "buyer#1000",
  order_source: "sellhub",
  order_note: null,
  order_meta: null,
  purchased_at: "2026-09-01T00:00:00.000Z",
};

const SESSION = {
  session_id: "session-1",
  install_id: INSTALL_ID,
  hwid: HWID,
  source: "desktop",
  user_label: "CEDRIC-PC",
  client_ip: "203.0.113.10",
  client_country: "DE",
  client_city: "Berlin",
  client_timezone: "Europe/Berlin",
  app_version: "1.5.3",
  display_version: "1.5.3",
  platform: "win32",
  os_version: "Windows 11",
  device_model: "Desktop",
  rpc_enabled: 1,
  discord_user: "buyer#1000",
  features_json: "{}",
  started_at: "2026-09-19T09:00:00.000Z",
  last_seen_at: "2026-09-19T10:00:00.000Z",
  ended_at: null,
  duration_seconds: 3600,
  is_active: 1,
  last_event: "heartbeat",
  last_status: "ok",
  error_count: 1,
};

function supportReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    message: "Desync does nothing when I press the hotkey",
    contact: "buyer@example.com",
    hwid: HWID,
    install_id: INSTALL_ID,
    license_key: LICENSE_KEY,
    machine_name: "CEDRIC-PC",
    app_version: "1.5.3",
    platform: "win32",
    status: "new",
    kind: "support",
    created_at: "2026-09-19T10:05:00.000Z",
    report_id: "FB-ABCDEF123456",
    auth_mode: "signed",
    verified_install_id: INSTALL_ID,
    ...overrides,
  };
}

function db(resolvers: MockD1Resolvers = {}): MockD1 {
  return createMockD1({
    ...resolvers,
    // A case's own resolvers come first: they override the defaults below, not the other way round.
    first: [
      ...(resolvers.first ?? []),
      {
        match: LINK_LOOKUP,
        result: { discord_id: DISCORD_ID, license_key: LICENSE_KEY, hwid: HWID },
      },
      { match: /SELECT \* FROM licenses WHERE license_key = \?/, result: LICENSE_ROW },
      { match: /FROM app_sessions WHERE \(\? IS NOT NULL AND hwid = \?\)/, result: SESSION },
    ],
    all: [
      ...(resolvers.all ?? []),
      {
        match: /SELECT session_id, install_id, hwid, source, user_label.*FROM app_sessions WHERE/,
        result: { results: [SESSION] },
      },
      {
        match: /FROM installs WHERE/,
        result: {
          results: [
            {
              install_id: INSTALL_ID,
              hwid: HWID,
              app_version: "1.5.3",
              created_at: "2026-09-01T00:00:00.000Z",
              last_seen_at: "2026-09-19T10:00:00.000Z",
              revoked_at: null,
              revoke_reason: null,
              license_id: 7,
            },
          ],
        },
      },
      { match: /SELECT \* FROM licenses WHERE/, result: { results: [LICENSE_ROW] } },
      { match: /SELECT f\.\*, m\.report_id/, result: { results: [supportReport()] } },
    ],
  });
}

function env(mock: MockD1): RuntimeEnv {
  return { DB: mock.db, VERIFY_SHARED_SECRET: SECRET };
}

function call(mock: MockD1, json: unknown, bearer: string = SECRET) {
  return supportContext({
    request: createSyntheticRequest({
      method: "POST",
      path: "/api/discord/support-context",
      headers: { authorization: `Bearer ${bearer}` },
      json,
    }),
    env: env(mock),
  });
}

beforeEach(() => resetInstallsSchemaStateForTests());

describe("POST /api/discord/support-context", () => {
  it("rejects a wrong Bearer token before touching the database", async () => {
    const mock = db();
    const response = await call(mock, { discord_id: DISCORD_ID }, "nope");

    expect(response.status).toBe(401);
    expect(mock.operations).toHaveLength(0);
  });

  it("needs a discord_id or a report_id", async () => {
    expect((await call(db(), {})).status).toBe(400);
    expect((await call(db(), { discord_id: "@buyer" })).status).toBe(400);
  });

  it("answers linked:false, found:false for an account that never ran /verify", async () => {
    const mock = db({ first: [{ match: LINK_LOOKUP, result: null }] });

    const response = await call(mock, { discord_id: DISCORD_ID });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      linked: false,
      found: false,
      context: null,
    });
  });

  it("answers from the linked licence, and sends no identifier along with it", async () => {
    const mock = db();

    const response = await call(mock, { discord_id: DISCORD_ID });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { linked: boolean; found: boolean; context: any };
    expect(body).toMatchObject({ linked: true, found: true });
    expect(body.context).toMatchObject({
      app_version: "1.5.3",
      platform: "win32",
      os_version: "Windows 11",
      last_seen_at: "2026-09-19T10:00:00.000Z",
      installs: 1,
      licence: { plan: "lifetime", status: "active", lifetime: true, suspended: false },
      report: { report_id: "FB-ABCDEF123456" },
    });
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      HWID,
      INSTALL_ID,
      LICENSE_KEY,
      "CEDRIC-PC",
      "203.0.113.10",
      "buyer@example.com",
      "Berlin",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("prefers the report the member sent after the bot asked for one", async () => {
    const mock = db({
      all: [
        {
          match: /SELECT f\.\*, m\.report_id/,
          result: {
            results: [
              supportReport({
                id: 9,
                kind: "feedback",
                created_at: "2026-09-19T10:30:00.000Z",
                report_id: "FB-IDEA",
              }),
              supportReport({ id: 8, created_at: "2026-09-19T10:20:00.000Z", report_id: "FB-NEW" }),
              supportReport({ id: 5, created_at: "2026-09-18T08:00:00.000Z", report_id: "FB-OLD" }),
            ],
          },
        },
      ],
    });

    const response = await call(mock, {
      discord_id: DISCORD_ID,
      since: "2026-09-19T10:10:00.000Z",
    });

    const body = (await response.json()) as { context: { report: { report_id: string } } };
    expect(body.context.report.report_id).toBe("FB-NEW");
  });

  it("withholds the licence when a Report ID points at a different machine", async () => {
    // The report belongs to another install; the Discord link is the only thing tying the caller
    // to a licence, and it does not match. A pasted Report ID must not unlock someone else's plan.
    const mock = db({
      first: [
        {
          match: /SELECT feedback_id FROM feedback_report_meta WHERE report_id = \?/,
          result: { feedback_id: 42 },
        },
        {
          match: /SELECT \* FROM feedback WHERE id = \? LIMIT 1/,
          result: {
            id: 42,
            hwid: OTHER_HWID,
            install_id: null,
            license_key: null,
            kind: "support",
          },
        },
        { match: /FROM app_sessions WHERE \(\? IS NOT NULL AND hwid = \?\)/, result: null },
      ],
    });

    const response = await call(mock, { discord_id: DISCORD_ID, report_id: "FB-ABCDEF123456" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { linked: boolean; found: boolean; context: any };
    expect(body).toMatchObject({ linked: true, found: true });
    expect(body.context.licence).toBeNull();
    // The licence table is never even read on that path.
    expect(
      mock.operations.filter((op) => /SELECT \* FROM licenses WHERE \(/.test(op.normalizedSql)),
    ).toHaveLength(0);
  });
});
