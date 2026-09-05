import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { requireDashboardAccess } from "../../functions/_lib/admin";
import { createAppSessionToken, hashPassword } from "../../functions/_lib/auth";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import { tokenId } from "../../functions/_lib/panel-access";
import { onRequest as team } from "../../functions/api/admin/team";
import { onRequest as session } from "../../functions/api/auth/session";
import { onRequest as login } from "../../functions/api/auth/login";
import { onRequest as watch } from "../../functions/api/auth/watch";
import { effectivePermissions } from "../../shared/panel-policy";
import { accessIdentityHeaders, testAccessDeps, testAccessEnv } from "../helpers/request";
import type { RuntimeEnv } from "../../functions/_lib/types";
let db: SqliteDatabaseHandle, env: RuntimeEnv, ownerToken: string, memberToken: string;
const OWNER = "owner@example.test",
  MEMBER = "support@example.test",
  SECRET = "test-secret-used-only-in-local-tests";
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
async function save(extra: Record<string, unknown> = {}) {
  return team({
    env,
    request: request("/api/admin/team", ownerToken, {
      action: "save",
      email: MEMBER,
      displayName: "Support",
      role: "support",
      enabled: true,
      expiresAt: null,
      overrides: {},
      ...extra,
    }),
  });
}
beforeEach(async () => {
  db = createInMemoryDatabase();
  env = {
    AUTH_MODE: "app",
    JWT_SECRET: SECRET,
    DB: createD1Database(db),
    ACCESS_ENFORCEMENT: "off",
  };
  await ensureAuthSchema(env);
  const hash = await hashPassword("Example-Password-123!");
  await createUser(env, OWNER, "admin", hash);
  await createUser(env, MEMBER, "viewer", hash);
  ownerToken = (await createAppSessionToken(SECRET, OWNER, "admin")).token;
  memberToken = (await createAppSessionToken(SECRET, MEMBER, "viewer")).token;
  expect((await team({ env, request: request("/api/admin/team", ownerToken) })).status).toBe(200);
  expect((await save()).status).toBe(200);
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
});
describe("panel permissions and session lifecycle on SQLite", () => {
  it("allows a newly created member to log in immediately", async () => {
    const email = "new@example.test";
    expect((await save({ email, password: "New-Member-Password-123!" })).status).toBe(200);
    const response = await login({
      env,
      request: request("/api/auth/login", "", { email, password: "New-Member-Password-123!" }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    expect(
      (
        await requireDashboardAccess(
          new Request("https://panel.test/api/admin/data", { headers: { cookie } }),
          env,
        )
      ).ok,
    ).toBe(true);
  });
  it("preserves legacy viewer restrictions when importing existing accounts", async () => {
    const email = "legacy@example.test";
    await createUser(env, email, "viewer", await hashPassword("Legacy-Password-123!"));
    await team({ env, request: request("/api/admin/team", ownerToken) });
    const token = (await createAppSessionToken(SECRET, email, "viewer")).token;
    expect((await requireDashboardAccess(request("/api/admin/licenses", token), env)).ok).toBe(
      false,
    );
    expect((await requireDashboardAccess(request("/api/admin/data", token), env)).ok).toBe(true);
  });
  it("streams live permission changes and logout to an open panel", async () => {
    const response = await watch({ env, request: request("/api/auth/watch", memberToken) });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain("retry:");
    await save({ overrides: { "support.write": { effect: "deny", expiresAt: null } } });
    const changed = decoder.decode((await reader.read()).value);
    expect(changed).toContain('"authenticated":true');
    expect(changed).not.toContain('"support.write"');
    await team({
      env,
      request: request("/api/admin/team", ownerToken, { action: "kick", email: MEMBER }),
    });
    expect(decoder.decode((await reader.read()).value)).toContain('"authenticated":false');
    await reader.cancel();
  }, 10000);
  it("uses current permissions for an already-issued token and denies unknown endpoints", async () => {
    expect(
      (
        await requireDashboardAccess(
          request("/api/admin/feedback", memberToken, { status: "resolved" }),
          env,
        )
      ).ok,
    ).toBe(true);
    await save({ overrides: { "support.write": { effect: "deny", expiresAt: null } } });
    const denied = await requireDashboardAccess(
      request("/api/admin/feedback", memberToken, { status: "resolved" }),
      env,
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);
    expect(
      (await requireDashboardAccess(request("/api/admin/future-endpoint", memberToken), env)).ok,
    ).toBe(false);
  });
  it("denies privilege escalation and protects the owner", async () => {
    expect(
      (
        await team({
          env,
          request: request("/api/admin/team", memberToken, {
            action: "save",
            email: MEMBER,
            role: "admin",
            enabled: true,
          }),
        })
      ).status,
    ).toBe(403);
    expect((await save({ email: OWNER, enabled: false })).status).toBe(403);
    expect((await save({ role: "owner" })).status).toBe(400);
    expect(db.prepare("SELECT role,enabled FROM panel_members WHERE email=?").get(OWNER)).toEqual({
      role: "owner",
      enabled: 1,
    });
  });
  it("ends one session without ending another session of the same member", async () => {
    const second = (await createAppSessionToken(SECRET, MEMBER, "viewer")).token;
    await requireDashboardAccess(request("/api/admin/data", memberToken), env);
    await requireDashboardAccess(request("/api/admin/data", second), env);
    expect(second).not.toBe(memberToken);
    const response = await team({
      env,
      request: request("/api/admin/team", ownerToken, {
        action: "end-session",
        email: MEMBER,
        sessionId: await tokenId(memberToken),
      }),
    });
    expect(response.status).toBe(200);
    expect((await requireDashboardAccess(request("/api/admin/data", memberToken), env)).ok).toBe(
      false,
    );
    expect((await requireDashboardAccess(request("/api/admin/data", second), env)).ok).toBe(true);
  });
  it("kick-all rejects previously unseen old tokens as well as tracked sessions", async () => {
    const unseen = (await createAppSessionToken(SECRET, MEMBER, "viewer")).token;
    await requireDashboardAccess(request("/api/admin/data", memberToken), env);
    const response = await team({
      env,
      request: request("/api/admin/team", ownerToken, { action: "kick", email: MEMBER }),
    });
    expect(response.status).toBe(200);
    for (const token of [memberToken, unseen])
      expect((await requireDashboardAccess(request("/api/admin/data", token), env)).ok).toBe(false);
    expect(
      (await (await session({ env, request: request("/api/auth/session", memberToken) })).json())
        .authenticated,
    ).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);
    const fresh = (await createAppSessionToken(SECRET, MEMBER, "viewer")).token;
    expect((await requireDashboardAccess(request("/api/admin/data", fresh), env)).ok).toBe(true);
  });
  it("disabled and expired members cannot sign in or reuse a token", async () => {
    await save({ enabled: false });
    expect((await requireDashboardAccess(request("/api/admin/data", memberToken), env)).ok).toBe(
      false,
    );
    const signedIn = await login({
      env,
      request: request("/api/auth/login", "", { email: MEMBER, password: "Example-Password-123!" }),
    });
    expect(signedIn.status).toBe(403);
    await save({ enabled: true, expiresAt: "2020-01-01T00:00:00Z" });
    expect((await requireDashboardAccess(request("/api/admin/data", memberToken), env)).ok).toBe(
      false,
    );
  });
  it("supports timed grants and keeps explicit read denial above write grants", () => {
    expect(
      effectivePermissions("viewer", {
        "licenses.write": { effect: "allow", expiresAt: "2020-01-01T00:00:00Z" },
      }),
    ).not.toContain("licenses.write");
    expect(
      effectivePermissions("viewer", { "licenses.write": { effect: "allow", expiresAt: null } }),
    ).toContain("licenses.write");
    expect(
      effectivePermissions("admin", { "licenses.read": { effect: "deny", expiresAt: null } }),
    ).not.toContain("licenses.write");
  });
  it("records a structured audit without passwords or bearer tokens", async () => {
    await save({ role: "admin" });
    const rows = db.prepare("SELECT * FROM panel_audit").all();
    expect(rows.length).toBeGreaterThan(0);
    const json = JSON.stringify(rows);
    expect(json).toContain(MEMBER);
    expect(json).toContain("role");
    expect(json).not.toContain(memberToken);
    expect(json).not.toContain("Example-Password");
  });
  it("applies managed access and revocation to Cloudflare identities too", async () => {
    const accessEnv = { ...testAccessEnv(OWNER), DB: env.DB };
    const headers = await accessIdentityHeaders(MEMBER);
    const req = new Request("https://panel.test/api/admin/data", { headers });
    expect((await requireDashboardAccess(req, accessEnv, testAccessDeps())).ok).toBe(true);
    await save({ enabled: false });
    expect((await requireDashboardAccess(req, accessEnv, testAccessDeps())).ok).toBe(false);
  });
});
