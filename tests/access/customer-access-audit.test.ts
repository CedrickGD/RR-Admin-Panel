import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { ensureAccessSchema } from "../../functions/_lib/access";
import { createAppSessionToken, hashPassword } from "../../functions/_lib/auth";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import { onRequestGet as listAccess } from "../../functions/api/admin/access/index";
import { onRequestPost as lift } from "../../functions/api/admin/access/lift";
import { onRequestPost as suspend } from "../../functions/api/admin/access/suspend";
import { onRequest as team } from "../../functions/api/admin/team";
import type { RuntimeEnv } from "../../functions/_lib/types";

const OWNER = "owner@example.test",
  SUPPORT = "support@example.test",
  SECRET = "test-secret-used-only-in-local-tests",
  SCHEMA = readFileSync(resolve(__dirname, "../../schema.sql"), "utf8");
let db: SqliteDatabaseHandle, env: RuntimeEnv, ownerToken: string, supportToken: string;

function request(path: string, token: string, body?: unknown) {
  return new Request(`https://panel.test${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: `rr_session=${token}`,
      origin: "https://panel.test",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const post = (handler: typeof lift, path: string, token: string, body: unknown) =>
  handler({ env, request: request(path, token, body) });

type AuditRow = { actor: string; target: string; action: string; detail: string };
function customerAudit(): AuditRow[] {
  return db
    .prepare(
      "SELECT actor, target, action, detail FROM panel_audit WHERE action LIKE 'customer-%' ORDER BY id",
    )
    .all() as AuditRow[];
}
function record(identity: string) {
  return db.prepare("SELECT * FROM access_suspensions WHERE identity = ?").get(identity) as
    | Record<string, unknown>
    | undefined;
}
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

beforeEach(async () => {
  db = createInMemoryDatabase();
  applySchema(db, SCHEMA);
  env = {
    AUTH_MODE: "app",
    JWT_SECRET: SECRET,
    DB: createD1Database(db),
    ACCESS_ENFORCEMENT: "off",
  };
  await ensureAuthSchema(env);
  const hash = await hashPassword("Example-Password-123!");
  await createUser(env, OWNER, "admin", hash);
  await createUser(env, SUPPORT, "viewer", hash);
  ownerToken = (await createAppSessionToken(SECRET, OWNER, "admin")).token;
  supportToken = (await createAppSessionToken(SECRET, SUPPORT, "viewer")).token;
  // The first team GET seeds panel_members; then the second account becomes Support, which holds
  // access.read but not access.write.
  expect((await team({ env, request: request("/api/admin/team", ownerToken) })).status).toBe(200);
  const saved = await team({
    env,
    request: request("/api/admin/team", ownerToken, {
      action: "save",
      email: SUPPORT,
      displayName: "Support",
      role: "support",
      enabled: true,
      expiresAt: null,
      overrides: {},
    }),
  });
  expect(saved.status).toBe(200);
});
afterEach(() => {
  db.close();
});

describe("customer access writes land in the panel access history", () => {
  it("records a suspend, a change of a restriction in force and a lift", async () => {
    const until = future(10);
    const first = await post(suspend, "/api/admin/access/suspend", ownerToken, {
      identity: "hwid-1",
      hwid: "hwid-1",
      user_label: "Mara Feldt",
      mode: "suspend",
      banned_until: until,
      reason: "Shared licence key",
    });
    expect(first.status).toBe(200);

    const second = await post(suspend, "/api/admin/access/suspend", ownerToken, {
      identity: "hwid-1",
      mode: "ban",
      reason: "Chargeback",
    });
    expect(second.status).toBe(200);

    const lifted = await post(lift, "/api/admin/access/lift", ownerToken, { identity: "hwid-1" });
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toMatchObject({ ok: true, lifted: true, lifted_by: OWNER });

    const rows = customerAudit();
    expect(rows.map((row) => [row.action, row.actor, row.target])).toEqual([
      ["customer-suspend", OWNER, "hwid-1"],
      ["customer-suspend-change", OWNER, "hwid-1"],
      ["customer-lift", OWNER, "hwid-1"],
    ]);
    expect(JSON.parse(rows[0].detail)).toEqual({
      customer: "Mara Feldt",
      type: "temporary",
      until: new Date(until).toISOString(),
      reason: "Shared licence key",
    });
    expect(JSON.parse(rows[1].detail)).toEqual({
      // The change request carried no label; the record's own name is kept.
      customer: "Mara Feldt",
      type: "permanent",
      until: null,
      reason: "Chargeback",
      previous: {
        type: "temporary",
        until: new Date(until).toISOString(),
        reason: "Shared licence key",
      },
    });
    expect(JSON.parse(rows[2].detail)).toEqual({
      customer: "Mara Feldt",
      type: "permanent",
      until: null,
      reason: "Chargeback",
    });

    expect(record("hwid-1")).toMatchObject({ is_active: 0, lifted_by: OWNER });
  });

  it("does not rewrite a lift that already happened, and 404s an unknown customer", async () => {
    await post(suspend, "/api/admin/access/suspend", ownerToken, {
      identity: "hwid-2",
      mode: "ban",
    });
    await post(lift, "/api/admin/access/lift", ownerToken, { identity: "hwid-2" });
    const liftedAt = record("hwid-2")?.lifted_at;

    const again = await post(lift, "/api/admin/access/lift", ownerToken, { identity: "hwid-2" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, lifted: false });
    expect(record("hwid-2")?.lifted_at).toBe(liftedAt);

    const unknown = await post(lift, "/api/admin/access/lift", ownerToken, { identity: "nobody" });
    expect(unknown.status).toBe(404);

    expect(customerAudit().map((row) => row.action)).toEqual(["customer-suspend", "customer-lift"]);
  });

  it("treats suspending a lifted customer as a new restriction and clears who lifted it", async () => {
    await post(suspend, "/api/admin/access/suspend", ownerToken, {
      identity: "hwid-3",
      mode: "ban",
    });
    await post(lift, "/api/admin/access/lift", ownerToken, { identity: "hwid-3" });
    await post(suspend, "/api/admin/access/suspend", ownerToken, {
      identity: "hwid-3",
      mode: "ban",
    });

    expect(record("hwid-3")).toMatchObject({ is_active: 1, lifted_at: null, lifted_by: null });
    const actions = customerAudit().map((row) => row.action);
    expect(actions).toEqual(["customer-suspend", "customer-lift", "customer-suspend"]);
  });
});

describe("the restrictions list and the lift respect access.read / access.write", () => {
  it("lets a Support member read the list but not lift or suspend", async () => {
    await post(suspend, "/api/admin/access/suspend", ownerToken, {
      identity: "hwid-4",
      mode: "ban",
    });

    const list = await listAccess({ env, request: request("/api/admin/access", supportToken) });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { suspensions: Array<Record<string, unknown>> };
    expect(body.suspensions).toHaveLength(1);
    expect(body.suspensions[0]).toHaveProperty("lifted_by", null);

    const denied = await post(lift, "/api/admin/access/lift", supportToken, { identity: "hwid-4" });
    expect(denied.status).toBe(403);
    const deniedSuspend = await post(suspend, "/api/admin/access/suspend", supportToken, {
      identity: "hwid-5",
      mode: "ban",
    });
    expect(deniedSuspend.status).toBe(403);

    expect(record("hwid-4")).toMatchObject({ is_active: 1 });
    expect(record("hwid-5")).toBeUndefined();
    expect(customerAudit().map((row) => row.actor)).toEqual([OWNER]);
  });
});

describe("access schema migration", () => {
  it("adds lifted_by to a table created before the column existed", async () => {
    const legacy = createInMemoryDatabase();
    legacy.exec(`CREATE TABLE access_suspensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT NOT NULL UNIQUE, hwid TEXT, install_id TEXT,
      user_label TEXT, mode TEXT NOT NULL DEFAULT 'ban', reason TEXT, banned_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, had_paid_license INTEGER NOT NULL DEFAULT 0,
      paid_license_keys TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      lifted_at TEXT)`);
    legacy
      .prepare(
        "INSERT INTO access_suspensions (identity, created_at, updated_at) VALUES ('old', 'x', 'x')",
      )
      .run();

    await ensureAccessSchema({ DB: createD1Database(legacy) });

    const columns = legacy.prepare("PRAGMA table_info(access_suspensions)").all() as Array<{
      name: string;
    }>;
    expect(columns.map((c) => c.name)).toContain("lifted_by");
    expect(legacy.prepare("SELECT identity, lifted_by FROM access_suspensions").get()).toEqual({
      identity: "old",
      lifted_by: null,
    });
    legacy.close();
  });
});
