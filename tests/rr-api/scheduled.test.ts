import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import worker, { resetWorkerStateForTests } from "../../backend-worker/index.js";
import { applySchema, locateSchemaFile } from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { buildRuntimeEnv, type RrApiEnv } from "../../deploy/nas/rr-api/src/env";

let handle: SqliteDatabaseHandle;
let env: RrApiEnv;

beforeEach(() => {
  resetWorkerStateForTests();
  handle = createInMemoryDatabase();
  applySchema(handle, readFileSync(locateSchemaFile()!, "utf8"));
  env = buildRuntimeEnv({}, createD1Database(handle));
});

afterEach(() => {
  handle.close();
});

function insertLicense(key: string, status: string, expiresAt: string | null): void {
  handle
    .prepare(
      `INSERT INTO licenses (license_key, type, status, expires_at, created_at)
       VALUES (?, 'monthly', ?, ?, ?)`,
    )
    .run(key, status, expiresAt, "2026-01-01T00:00:00.000Z");
}

describe("worker.scheduled on the SQLite adapter", () => {
  it("deletes expired licenses and keeps live ones, without throwing", async () => {
    insertLicense("RR-EXPIRED-FLAG", "expired", null);
    insertLicense("RR-EXPIRED-DATE", "active", "2020-01-01T00:00:00.000Z");
    insertLicense("RR-LIVE", "active", "2999-01-01T00:00:00.000Z");
    insertLicense("RR-LIFETIME", "active", null);

    await expect(
      worker.scheduled({ cron: "30 3 * * *", scheduledTime: Date.now() }, env, {
        waitUntil: () => {},
      }),
    ).resolves.toBeUndefined();

    const remaining = handle
      .prepare("SELECT license_key FROM licenses ORDER BY license_key")
      .all() as Array<{ license_key: string }>;
    expect(remaining.map((row) => row.license_key)).toEqual(["RR-LIFETIME", "RR-LIVE"]);
  });

  it("tolerates an empty licenses table", async () => {
    await expect(
      worker.scheduled({ cron: "30 3 * * *", scheduledTime: Date.now() }, env, {
        waitUntil: () => {},
      }),
    ).resolves.toBeUndefined();
  });
});
