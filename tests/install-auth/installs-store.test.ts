import { beforeEach, describe, expect, it } from "vitest";

import type { PublicKeyJwk } from "../../shared/install-auth";
import {
  INSTALLS_DDL,
  countInstallsForHwidSince,
  ensureInstallsSchema,
  findInstall,
  listInstallsForHwid,
  registerInstall,
  resetInstallsSchemaStateForTests,
  revokeInstall,
  touchInstall,
} from "../../shared/installs-store";
import { createMockD1, type RecordedD1Operation } from "../helpers/mock-d1";
import { generateInstallKeyPair } from "../helpers/install-signer";

const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
const NOW_ISO = "2026-08-21T12:00:00.000Z";
const INSTALL_LOOKUP = /SELECT .* FROM installs WHERE install_id = \?/;

let jwk: PublicKeyJwk;
let otherJwk: PublicKeyJwk;

beforeEach(async () => {
  resetInstallsSchemaStateForTests();
  jwk = (await generateInstallKeyPair()).publicKeyJwk;
  otherJwk = (await generateInstallKeyPair()).publicKeyJwk;
});

function opsMatching(operations: RecordedD1Operation[], pattern: RegExp): RecordedD1Operation[] {
  return operations.filter((operation) => pattern.test(operation.normalizedSql));
}

describe("INSTALLS_DDL / ensureInstallsSchema", () => {
  it("declares the installs table and the hwid index", () => {
    expect(INSTALLS_DDL.length).toBeGreaterThanOrEqual(2);
    expect(INSTALLS_DDL[0]).toMatch(/CREATE TABLE IF NOT EXISTS installs/);
    for (const column of [
      "install_id",
      "public_key_jwk",
      "hwid",
      "app_version",
      "created_at",
      "last_seen_at",
      "revoked_at",
      "revoke_reason",
      "license_id",
    ]) {
      expect(INSTALLS_DDL[0]).toContain(column);
    }
    expect(
      INSTALLS_DDL.some((sql) =>
        /CREATE INDEX IF NOT EXISTS idx_installs_hwid ON installs\s*\(hwid\)/.test(sql),
      ),
    ).toBe(true);
  });

  it("runs the DDL once per isolate", async () => {
    const mock = createMockD1();

    await ensureInstallsSchema(mock.db);
    await ensureInstallsSchema(mock.db);

    const ddlOps = opsMatching(mock.operations, /^CREATE (TABLE|INDEX) IF NOT EXISTS/);
    expect(ddlOps).toHaveLength(INSTALLS_DDL.length);
    expect(mock.operations).toHaveLength(INSTALLS_DDL.length);
  });

  it("retries the DDL on the next call when a statement failed", async () => {
    let attempts = 0;
    const mock = createMockD1({
      run: [
        {
          match: "CREATE INDEX",
          result: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("D1 hiccup");
            return { success: true };
          },
        },
      ],
    });

    await expect(ensureInstallsSchema(mock.db)).rejects.toThrow();
    await expect(ensureInstallsSchema(mock.db)).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});

describe("findInstall", () => {
  it("maps a row to an InstallRecord with the parsed JWK", async () => {
    const mock = createMockD1({
      first: [
        {
          match: INSTALL_LOOKUP,
          result: {
            install_id: INSTALL_ID,
            public_key_jwk: JSON.stringify(jwk),
            hwid: HWID,
            app_version: "1.4.9",
            created_at: NOW_ISO,
            last_seen_at: null,
            revoked_at: null,
            license_id: 7,
          },
        },
      ],
    });

    const record = await findInstall(mock.db, INSTALL_ID.toUpperCase());

    expect(record).toEqual({
      installId: INSTALL_ID,
      publicKeyJwk: jwk,
      revokedAt: null,
      hwid: HWID,
      appVersion: "1.4.9",
      createdAt: NOW_ISO,
      lastSeenAt: null,
      licenseId: 7,
    });
    expect(mock.operations[0].values).toEqual([INSTALL_ID]);
  });

  it("returns null for unknown installs and for rows with an unusable stored key", async () => {
    const missing = createMockD1();
    await expect(findInstall(missing.db, INSTALL_ID)).resolves.toBeNull();

    const corrupt = createMockD1({
      first: [
        {
          match: INSTALL_LOOKUP,
          result: {
            install_id: INSTALL_ID,
            public_key_jwk: "{not json",
            hwid: HWID,
            app_version: null,
            created_at: NOW_ISO,
            last_seen_at: null,
            revoked_at: null,
            license_id: null,
          },
        },
      ],
    });
    await expect(findInstall(corrupt.db, INSTALL_ID)).resolves.toBeNull();
  });
});

describe("registerInstall", () => {
  const input = () => ({
    installId: INSTALL_ID,
    hwid: HWID,
    publicKeyJwk: jwk,
    appVersion: "1.4.9",
    licenseKey: null,
    nowIso: NOW_ISO,
  });

  it("creates a new row and reports created", async () => {
    const mock = createMockD1();

    const result = await registerInstall(mock.db, input());

    expect(result).toEqual({ outcome: "created", registeredAt: NOW_ISO });
    const inserts = opsMatching(mock.operations, /^INSERT (OR IGNORE )?INTO installs/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toContain(INSTALL_ID);
    expect(inserts[0].values).toContain(HWID);
    expect(inserts[0].values).toContain("1.4.9");
    expect(inserts[0].values).toContain(NOW_ISO);
    expect(inserts[0].values).toContain(JSON.stringify(jwk));
    expect(opsMatching(mock.operations, /FROM licenses/)).toHaveLength(0);
  });

  it("links an active license key to license_id (best effort)", async () => {
    const mock = createMockD1({
      first: [
        { match: /FROM licenses WHERE license_key = \? AND status = 'active'/, result: { id: 42 } },
      ],
    });

    await registerInstall(mock.db, { ...input(), licenseKey: "RR-KEY" });

    const licenseLookup = opsMatching(mock.operations, /FROM licenses/);
    expect(licenseLookup).toHaveLength(1);
    expect(licenseLookup[0].values).toEqual(["RR-KEY"]);
    const inserts = opsMatching(mock.operations, /^INSERT (OR IGNORE )?INTO installs/);
    expect(inserts[0].values).toContain(42);
  });

  it("stores license_id null when the key is unknown or the lookup throws", async () => {
    const unknown = createMockD1();
    await registerInstall(unknown.db, { ...input(), licenseKey: "RR-UNKNOWN" });
    let inserts = opsMatching(unknown.operations, /^INSERT (OR IGNORE )?INTO installs/);
    expect(inserts[0].values).toContain(null);
    expect(inserts[0].values).not.toContain(42);

    const broken = createMockD1({
      first: [
        {
          match: /FROM licenses/,
          result: () => {
            throw new Error("no such table: licenses");
          },
        },
      ],
    });
    const result = await registerInstall(broken.db, { ...input(), licenseKey: "RR-KEY" });
    expect(result.outcome).toBe("created");
    inserts = opsMatching(broken.operations, /^INSERT (OR IGNORE )?INTO installs/);
    expect(inserts).toHaveLength(1);
  });

  it("reports same for an identical key and does not insert again", async () => {
    const mock = createMockD1({
      first: [
        {
          match: INSTALL_LOOKUP,
          result: {
            install_id: INSTALL_ID,
            public_key_jwk: JSON.stringify({ ...jwk, ext: true }),
            revoked_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        },
      ],
    });

    const result = await registerInstall(mock.db, input());

    expect(result).toEqual({ outcome: "same", registeredAt: "2026-08-01T00:00:00.000Z" });
    expect(opsMatching(mock.operations, /^INSERT/)).toHaveLength(0);
  });

  it("reports conflict for a different key and does not insert", async () => {
    const mock = createMockD1({
      first: [
        {
          match: INSTALL_LOOKUP,
          result: {
            install_id: INSTALL_ID,
            public_key_jwk: JSON.stringify(otherJwk),
            revoked_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        },
      ],
    });

    const result = await registerInstall(mock.db, input());

    expect(result.outcome).toBe("conflict");
    expect(result.registeredAt).toBeNull();
    expect(opsMatching(mock.operations, /^INSERT/)).toHaveLength(0);
  });

  it("reports revoked for a revoked install regardless of the key", async () => {
    for (const storedJwk of [jwk, otherJwk]) {
      const mock = createMockD1({
        first: [
          {
            match: INSTALL_LOOKUP,
            result: {
              install_id: INSTALL_ID,
              public_key_jwk: JSON.stringify(storedJwk),
              revoked_at: "2026-08-10T00:00:00.000Z",
              created_at: "2026-08-01T00:00:00.000Z",
            },
          },
        ],
      });

      const result = await registerInstall(mock.db, input());

      expect(result.outcome).toBe("revoked");
      expect(result.registeredAt).toBeNull();
      expect(opsMatching(mock.operations, /^INSERT/)).toHaveLength(0);
    }
  });

  it("re-classifies when a concurrent insert won the race", async () => {
    let lookups = 0;
    const mock = createMockD1({
      first: [
        {
          match: INSTALL_LOOKUP,
          result: () => {
            lookups += 1;
            if (lookups === 1) return null;
            return {
              install_id: INSTALL_ID,
              public_key_jwk: JSON.stringify(otherJwk),
              revoked_at: null,
              created_at: NOW_ISO,
            };
          },
        },
      ],
      run: [
        {
          match: /^INSERT (OR IGNORE )?INTO installs/,
          result: { success: true, meta: { changes: 0 } },
        },
      ],
    });

    const result = await registerInstall(mock.db, input());

    expect(result.outcome).toBe("conflict");
    expect(lookups).toBe(2);
  });
});

describe("countInstallsForHwidSince / listInstallsForHwid", () => {
  it("counts installs created since the cutoff", async () => {
    const mock = createMockD1({
      first: [
        {
          match: /SELECT COUNT\(\*\) AS count FROM installs WHERE hwid = \? AND created_at >= \?/,
          result: { count: 3 },
        },
      ],
    });

    await expect(
      countInstallsForHwidSince(mock.db, HWID, "2026-08-20T12:00:00.000Z"),
    ).resolves.toBe(3);
    expect(mock.operations[0].values).toEqual([HWID, "2026-08-20T12:00:00.000Z"]);

    const empty = createMockD1();
    await expect(countInstallsForHwidSince(empty.db, HWID, NOW_ISO)).resolves.toBe(0);
  });

  it("lists installs for a device without exposing the public key", async () => {
    const mock = createMockD1({
      all: [
        {
          match: /FROM installs WHERE hwid = \?/,
          result: {
            results: [
              {
                install_id: INSTALL_ID,
                hwid: HWID,
                app_version: "1.4.9",
                created_at: NOW_ISO,
                last_seen_at: NOW_ISO,
                revoked_at: null,
                revoke_reason: null,
                license_id: 7,
              },
            ],
          },
        },
      ],
    });

    const rows = await listInstallsForHwid(mock.db, HWID);

    expect(rows).toEqual([
      {
        installId: INSTALL_ID,
        hwid: HWID,
        appVersion: "1.4.9",
        createdAt: NOW_ISO,
        lastSeenAt: NOW_ISO,
        revokedAt: null,
        revokeReason: null,
        licenseId: 7,
      },
    ]);
    expect(mock.operations[0].normalizedSql).toMatch(/ORDER BY created_at DESC/);
    expect(mock.operations[0].normalizedSql).not.toMatch(/public_key_jwk/);
  });
});

describe("touchInstall", () => {
  it("bumps last_seen_at at most once per five minutes", async () => {
    const mock = createMockD1();

    await touchInstall(mock.db, INSTALL_ID.toUpperCase(), NOW_ISO);

    expect(mock.operations).toHaveLength(1);
    const [operation] = mock.operations;
    expect(operation.kind).toBe("run");
    expect(operation.normalizedSql).toMatch(/^UPDATE installs SET last_seen_at = \?/);
    expect(operation.normalizedSql).toContain("last_seen_at IS NULL");
    expect(operation.normalizedSql).toContain("-5 minutes");
    expect(operation.values).toContain(NOW_ISO);
    expect(operation.values).toContain(INSTALL_ID);
  });
});

describe("revokeInstall", () => {
  it("stamps revoked_at/revoke_reason and reports whether the install existed", async () => {
    const mock = createMockD1();

    await expect(revokeInstall(mock.db, INSTALL_ID, "shared key leaked", NOW_ISO)).resolves.toBe(
      true,
    );

    const [operation] = mock.operations;
    expect(operation.normalizedSql).toMatch(/^UPDATE installs SET revoked_at =/);
    expect(operation.normalizedSql).toContain("revoke_reason");
    expect(operation.normalizedSql).toMatch(/WHERE install_id = \?/);
    expect(operation.values).toEqual([NOW_ISO, "shared key leaked", INSTALL_ID]);
  });

  it("returns false when no install matched", async () => {
    const mock = createMockD1({
      run: [
        {
          match: /^UPDATE installs SET revoked_at/,
          result: { success: true, meta: { changes: 0 } },
        },
      ],
    });

    await expect(revokeInstall(mock.db, INSTALL_ID, null, NOW_ISO)).resolves.toBe(false);
    expect(mock.operations[0].values).toEqual([NOW_ISO, null, INSTALL_ID]);
  });
});
