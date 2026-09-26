import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureLicenseOperationsSchema } from "../../functions/_lib/license-operations";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as bindLicense } from "../../functions/api/admin/licenses/[key]/bind";
import { onRequestPost as revokeLicense } from "../../functions/api/admin/licenses/[key]/revoke";
import {
  LICENSE_RELEASE_AUDIT_ACTION,
  onRequestPost as releaseLicense,
} from "../../functions/api/admin/licenses/[key]/release";
import { onRequestPost as activateLicense } from "../../functions/api/license/activate";
import {
  ensureInstallsSchema,
  resetInstallsSchemaStateForTests,
} from "../../shared/installs-store";
import {
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";
import { createTelemetryTestDb, type TelemetryTestDb } from "../helpers/telemetry-db";

/**
 * Admin: release one PC from a license (customer changed hardware / moved to a new PC), then the
 * new PC activates with the ORIGINAL end date. Real SQLite, because the claim renumbering and the
 * guarded UPDATE are the point.
 */
const ADMIN = "admin@example.com";
const VIEWER = "viewer@example.com";
const KEY = "RR-AAAA-BBBB-189D";
const OLD_PC = "1CBEFB0F00000000000000000000AAAA";
const OTHER_PC = "2DDDDDDD00000000000000000000BBBB";
const NEW_PC = "3EEEEEEE00000000000000000000CCCC";
const OLD_INSTALL = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const NEW_INSTALL = "7e92aed6-2c02-45af-9050-ef665c14104a";
const ACTIVATED_AT = "2026-08-29T14:43:29.111Z";
const EXPIRES_AT = "2099-11-27T14:43:29.111Z";

let tdb: TelemetryTestDb;
let env: RuntimeEnv;

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

beforeEach(async () => {
  resetInstallsSchemaStateForTests();
  resetRateLimitsForTests();
  tdb = createTelemetryTestDb();
  env = testAccessEnv(`${ADMIN},${VIEWER}`, {
    DB: tdb.env.DB,
    ACCESS_ADMIN_EMAIL: ADMIN,
    ACCESS_ALLOWED_EMAIL: `${ADMIN},${VIEWER}`,
  });
  await ensureLicenseOperationsSchema(env.DB!);
  await ensureInstallsSchema(env.DB!);
});

afterEach(() => tdb.close());

function seedLicense(fields: Record<string, unknown>) {
  const row = {
    license_key: KEY,
    type: "3-months",
    duration_days: 90,
    hwid: OLD_PC,
    max_uses: 1,
    usage_count: 1,
    status: "active",
    created_at: "2026-08-29T14:42:33.445Z",
    activated_at: ACTIVATED_AT,
    expires_at: EXPIRES_AT,
    ...fields,
  };
  const columns = Object.keys(row);
  const info = tdb.handle
    .prepare(
      `INSERT INTO licenses (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    )
    .run(...Object.values(row));
  return Number(info.lastInsertRowid);
}

function seedInstall(installId: string, hwid: string, licenseId: number | null) {
  tdb.handle
    .prepare(
      `INSERT INTO installs (install_id, public_key_jwk, hwid, created_at, last_seen_at, license_id)
       VALUES (?, '{}', ?, '2026-09-26T15:38:32.957Z', '2026-09-26T16:15:14.941Z', ?)`,
    )
    .run(installId, hwid, licenseId);
}

function seedClaim(licenseId: number, hwid: string, slot: number) {
  tdb.handle
    .prepare(
      `INSERT INTO license_binding_claims (license_id, hwid, slot_number, operation_id, created_by, created_at)
       VALUES (?, ?, ?, ?, 'admin@example.com', '2026-08-29T14:43:29.111Z')`,
    )
    .run(licenseId, hwid, slot, `op-${hwid}`);
}

function licenseRow() {
  return tdb.handle.prepare(`SELECT * FROM licenses WHERE license_key = ?`).get(KEY) as Record<
    string,
    unknown
  >;
}

async function release(payload: Record<string, unknown>, email = ADMIN) {
  const headers = await accessIdentityHeaders(email);
  return releaseLicense({
    request: createSyntheticRequest({
      path: `/api/admin/licenses/${KEY}/release`,
      json: payload,
      headers,
    }),
    env,
    params: { key: KEY },
  });
}

async function publicActivate(hwid: string) {
  return activateLicense({
    request: createSyntheticRequest({
      path: "/api/license/activate",
      json: { license_key: KEY, hwid },
    }),
    env,
  });
}

describe("POST /api/admin/licenses/:key/release", () => {
  it("frees the PC's seat and keeps activation and expiry dates", async () => {
    const id = seedLicense({});
    seedInstall(OLD_INSTALL, OLD_PC, id);
    tdb.handle
      .prepare(
        `INSERT INTO license_install_claims (install_id, license_id, operation_id, created_by, created_at)
         VALUES (?, ?, 'op-install', 'admin@example.com', '2026-08-29T14:43:29.111Z')`,
      )
      .run(OLD_INSTALL, id);
    seedClaim(id, OLD_PC, 1);

    // Case-insensitive, like the admin bind.
    const response = await release({ hwid: OLD_PC.toLowerCase(), reason: "new PC" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, released_hwid: OLD_PC });

    expect(licenseRow()).toMatchObject({
      hwid: null,
      usage_count: 0,
      status: "active",
      activated_at: ACTIVATED_AT,
      expires_at: EXPIRES_AT,
    });
    expect(tdb.handle.prepare(`SELECT COUNT(*) AS n FROM license_binding_claims`).get()).toEqual({
      n: 0,
    });
    expect(tdb.handle.prepare(`SELECT COUNT(*) AS n FROM license_install_claims`).get()).toEqual({
      n: 0,
    });
    expect(
      tdb.handle.prepare(`SELECT license_id FROM installs WHERE install_id = ?`).get(OLD_INSTALL),
    ).toEqual({ license_id: null });
    const audit = tdb.handle
      .prepare(`SELECT actor, target, action, detail FROM panel_audit`)
      .all() as Array<Record<string, string>>;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: ADMIN,
      target: KEY,
      action: LICENSE_RELEASE_AUDIT_ACTION,
    });
    expect(JSON.parse(audit[0].detail)).toEqual({ hwid: OLD_PC, remaining: 0, reason: "new PC" });
  });

  it("keeps the other PCs and closes the slot gap so the next admin bind fits", async () => {
    const id = seedLicense({ hwid: `${OLD_PC},${OTHER_PC}`, max_uses: 2, usage_count: 2 });
    seedClaim(id, OLD_PC, 1);
    seedClaim(id, OTHER_PC, 2);
    seedInstall(NEW_INSTALL, NEW_PC, null);

    const response = await release({ hwid: OLD_PC });
    expect(response.status).toBe(200);
    expect(licenseRow()).toMatchObject({ hwid: OTHER_PC, usage_count: 1 });
    expect(
      tdb.handle
        .prepare(`SELECT hwid, slot_number FROM license_binding_claims ORDER BY slot_number`)
        .all(),
    ).toEqual([{ hwid: OTHER_PC, slot_number: 1 }]);

    // Without the renumbering the new PC would take slot 2 again and hit UNIQUE(license_id, slot).
    const idempotencyKey = "admin-release-test-bind";
    const bind = await bindLicense({
      request: createSyntheticRequest({
        path: `/api/admin/licenses/${KEY}/bind`,
        json: { hwid: NEW_PC, idempotency_key: idempotencyKey },
        headers: await accessIdentityHeaders(ADMIN, { "Idempotency-Key": idempotencyKey }),
      }),
      env,
      params: { key: KEY },
    });
    expect(bind.status).toBe(200);
    expect(licenseRow()).toMatchObject({
      hwid: `${OTHER_PC},${NEW_PC}`,
      usage_count: 2,
      expires_at: EXPIRES_AT,
    });
  });

  it("is all-or-nothing: a failed write leaves everything bound and a retry completes", async () => {
    const id = seedLicense({});
    seedInstall(OLD_INSTALL, OLD_PC, id);
    seedClaim(id, OLD_PC, 1);
    const db = env.DB!;
    const realBatch = db.batch.bind(db);
    db.batch = async () => {
      throw new Error("D1_ERROR: Network connection lost.");
    };
    expect((await release({ hwid: OLD_PC })).status).toBe(500);
    db.batch = realBatch;
    expect(licenseRow()).toMatchObject({ hwid: OLD_PC, usage_count: 1 });
    expect(tdb.handle.prepare(`SELECT COUNT(*) AS n FROM license_binding_claims`).get()).toEqual({
      n: 1,
    });

    expect((await release({ hwid: OLD_PC })).status).toBe(200);
    expect(licenseRow()).toMatchObject({ hwid: null, usage_count: 0 });
    expect(tdb.handle.prepare(`SELECT COUNT(*) AS n FROM license_binding_claims`).get()).toEqual({
      n: 0,
    });
  });

  it("answers 409 and writes nothing when the license changed after it was read", async () => {
    const id = seedLicense({ hwid: `${OLD_PC},${OTHER_PC}`, max_uses: 2, usage_count: 2 });
    seedClaim(id, OLD_PC, 1);
    seedClaim(id, OTHER_PC, 2);
    const db = env.DB!;
    const realBatch = db.batch.bind(db);
    // A concurrent change lands between the handler's read and its batch.
    db.batch = async (statements) => {
      tdb.handle.prepare(`UPDATE licenses SET hwid = ? WHERE id = ?`).run(OTHER_PC, id);
      return realBatch(statements);
    };
    const response = await release({ hwid: OLD_PC });
    db.batch = realBatch;
    expect(response.status).toBe(409);
    expect(
      tdb.handle
        .prepare(`SELECT hwid, slot_number FROM license_binding_claims ORDER BY slot_number`)
        .all(),
    ).toEqual([
      { hwid: OLD_PC, slot_number: 1 },
      { hwid: OTHER_PC, slot_number: 2 },
    ]);
  });

  it("keeps every other stored seat verbatim, including legacy values", async () => {
    seedLicense({ hwid: `legacy value,${OLD_PC}`, max_uses: 2, usage_count: 2 });
    expect((await release({ hwid: OLD_PC })).status).toBe(200);
    expect(licenseRow()).toMatchObject({ hwid: "legacy value", usage_count: 1 });
    expect((await release({ hwid: "legacy value" })).status).toBe(200);
    expect(licenseRow()).toMatchObject({ hwid: null, usage_count: 0 });
  });

  it("leaves a released licence revocable, not deletable", async () => {
    seedLicense({ hwid: null, usage_count: 0 });
    const response = await revokeLicense({
      request: createSyntheticRequest({
        path: `/api/admin/licenses/${KEY}/revoke`,
        method: "POST",
        headers: await accessIdentityHeaders(ADMIN),
      }),
      env,
      params: { key: KEY },
    });
    expect(response.status).toBe(200);
    expect(licenseRow()).toMatchObject({ status: "revoked", activated_at: ACTIVATED_AT });
  });

  it("answers 404 when that PC is not bound, and changes nothing", async () => {
    seedLicense({});
    const response = await release({ hwid: NEW_PC });
    expect(response.status).toBe(404);
    expect(licenseRow()).toMatchObject({ hwid: OLD_PC, usage_count: 1 });
  });

  it("is refused for a non-admin", async () => {
    seedLicense({});
    const response = await release({ hwid: OLD_PC }, VIEWER);
    expect(response.status).toBe(403);
    expect(licenseRow()).toMatchObject({ hwid: OLD_PC, usage_count: 1 });
  });
});

describe("POST /api/license/activate after a release", () => {
  it("binds the new PC and keeps the original end date", async () => {
    seedLicense({ hwid: null, usage_count: 0 });
    const response = await publicActivate(NEW_PC);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, expires_at: EXPIRES_AT });
    expect(licenseRow()).toMatchObject({ hwid: NEW_PC, usage_count: 1, expires_at: EXPIRES_AT });
  });

  it("refuses a comma in the hwid: one seat must never bind several PCs", async () => {
    seedLicense({ hwid: null, usage_count: 0, activated_at: null, expires_at: null });
    const response = await publicActivate(`${NEW_PC},${OTHER_PC},${OLD_PC}`);
    expect(response.status).toBe(400);
    expect(licenseRow()).toMatchObject({ hwid: null, usage_count: 0 });
  });

  it("does not overwrite a change that landed after it read the license", async () => {
    const id = seedLicense({ hwid: OTHER_PC, max_uses: 2, usage_count: 1 });
    const db = env.DB!;
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      // An admin release of OTHER_PC commits between activate's read and its write.
      if (sql.startsWith("UPDATE licenses SET hwid")) {
        tdb.handle.prepare(`UPDATE licenses SET hwid = NULL, usage_count = 0 WHERE id = ?`).run(id);
      }
      return realPrepare(sql);
    };
    const response = await publicActivate(NEW_PC);
    db.prepare = realPrepare;
    expect(response.status).toBe(409);
    expect(licenseRow()).toMatchObject({ hwid: null, usage_count: 0 });
  });

  it("refuses a released key whose term already ran out", async () => {
    seedLicense({ hwid: null, usage_count: 0, expires_at: "2026-01-01T00:00:00.000Z" });
    const response = await publicActivate(NEW_PC);
    expect(response.status).toBe(403);
    expect(licenseRow()).toMatchObject({ hwid: null, status: "expired" });
  });

  it("still starts the clock on a key's very first activation", async () => {
    seedLicense({ hwid: null, usage_count: 0, activated_at: null, expires_at: null });
    const before = Date.now();
    const response = await publicActivate(NEW_PC);
    expect(response.status).toBe(200);
    const expires = Date.parse(String(licenseRow().expires_at));
    expect(expires).toBeGreaterThanOrEqual(before + 90 * 86_400_000);
    expect(expires).toBeLessThan(before + 90 * 86_400_000 + 60_000);
  });
});
