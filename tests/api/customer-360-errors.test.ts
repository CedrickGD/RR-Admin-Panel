// F1: Customer 360 listed a customer's app_error rows under one 200-row cap. A
// client looping on RR-E1003 filled it with seconds of background noise, so a
// real crash reported at any other moment was missing from the one screen
// support opens to answer "what broke for this user".
//
// Real SQLite (json_extract, the CTE, LIMIT semantics), not the recorded-SQL mock.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { onRequestGet as customer360 } from "../../functions/api/admin/customer-360";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import {
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";
import {
  backgroundFault,
  createTelemetryTestDb,
  realError,
  type TelemetryTestDb,
} from "../helpers/telemetry-db";

const ADMIN = "admin@example.test";
const HWID = "HW-LOOP";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const SESSION_ID = "s-loop";

const SECOND = 1000;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** The real crash is hours old; the fault loop is seconds old and 300 rows deep. */
const REAL_ERROR_AT = ago(6 * 3600e3);

let db: TelemetryTestDb;

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

beforeEach(() => {
  resetInstallsSchemaStateForTests();
  db = createTelemetryTestDb();
  db.handle
    .prepare(
      `INSERT INTO app_sessions (session_id, install_id, hwid, source, started_at, last_seen_at,
         is_active, last_status, error_count, updated_at)
       VALUES (?, ?, ?, 'desktop', ?, ?, 0, 'down', 0, ?)`,
    )
    .run(SESSION_ID, INSTALL_ID, HWID, ago(7 * 3600e3), ago(SECOND), ago(SECOND));

  db.insertEvents([
    realError(REAL_ERROR_AT, { hwid: HWID, install_id: INSTALL_ID, session_id: SESSION_ID }),
    // 300 background faults inside one minute — well past the old 200-row cap.
    ...Array.from({ length: 300 }, (_, index) =>
      backgroundFault(ago(index * 200 + SECOND), {
        base_exception_type: "System.NullReferenceException",
        hwid: HWID,
        install_id: INSTALL_ID,
        session_id: SESSION_ID,
      }),
    ),
  ]);
});

afterEach(() => {
  db.close();
  vi.clearAllMocks();
});

async function fetchCustomer() {
  const response = await customer360({
    request: createSyntheticRequest({
      path: "/api/admin/customer-360",
      query: { hwid: HWID },
      headers: await accessIdentityHeaders(ADMIN),
    }),
    env: testAccessEnv(ADMIN, {
      DB: db.env.DB,
      ACCESS_ALLOWED_EMAIL: ADMIN,
      ACCESS_ADMIN_EMAIL: ADMIN,
    }),
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    customer: {
      errors: Array<{ kind: string | null; timestamp: string }>;
      summary: { error_count: number };
      section_errors: Record<string, string>;
    };
  };
  expect(payload.customer.section_errors.errors).toBeUndefined();
  return payload.customer;
}

describe("Customer 360 errors: background faults never crowd out a real error", () => {
  it("keeps the real error even under 300 newer background faults", async () => {
    const customer = await fetchCustomer();
    const real = customer.errors.filter((row) => row.kind !== "background");

    expect(real).toHaveLength(1);
    expect(real[0].timestamp).toBe(REAL_ERROR_AT);
  });

  it("gives background faults their own budget instead of the shared cap", async () => {
    const customer = await fetchCustomer();
    const background = customer.errors.filter((row) => row.kind === "background");

    // Visible for support, but bounded — not 200, and not all 300.
    expect(background).toHaveLength(40);
    expect(customer.errors).toHaveLength(41);
  });

  it("agrees with Key figures on what counts as an error", async () => {
    const customer = await fetchCustomer();
    // What the section header counts must be what summary.error_count counts.
    const headerCount = customer.errors.filter((row) => row.kind !== "background").length;

    expect(headerCount).toBe(customer.summary.error_count);
    expect(customer.summary.error_count).toBe(1);
  });

  it("still returns newest-first across both budgets", async () => {
    const customer = await fetchCustomer();
    const timestamps = customer.errors.map((row) => Date.parse(row.timestamp));

    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });
});
