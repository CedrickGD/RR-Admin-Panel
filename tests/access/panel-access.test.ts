import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { requireDashboardAccess } from "../../functions/_lib/admin";
import { createAppSessionToken, hashPassword } from "../../functions/_lib/auth";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import {
  describePanelSessions,
  ensurePanelSchema,
  groupPanelSessions,
  memberDeniedMessage,
  sessionAccessView,
  tokenId,
  type PanelMember,
  type PanelSessionGroup,
} from "../../functions/_lib/panel-access";
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
  it("removes a member for good, even while the address stays on the env allow-list", async () => {
    const accessEnv = { ...testAccessEnv(`${OWNER},${MEMBER}`), DB: env.DB };
    const headers = await accessIdentityHeaders(MEMBER);
    const accessRequest = new Request("https://panel.test/api/admin/data", { headers });
    expect((await requireDashboardAccess(accessRequest, accessEnv, testAccessDeps())).ok).toBe(
      true,
    );
    const removed = await team({
      env,
      request: request("/api/admin/team", ownerToken, { action: "revoke", email: MEMBER }),
    });
    expect(removed.status).toBe(200);
    // The allow-list still names the address; the panel refuses it anyway, and with 403 so the
    // SPA shows "forbidden" instead of bouncing through the Access login again.
    const denied = await requireDashboardAccess(accessRequest, accessEnv, testAccessDeps());
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);
    const cookieDenied = await requireDashboardAccess(request("/api/admin/data", memberToken), env);
    expect(cookieDenied.ok).toBe(false);
    if (!cookieDenied.ok) expect(cookieDenied.response.status).toBe(403);
    expect(db.prepare("SELECT enabled FROM panel_members WHERE email=?").get(MEMBER)).toEqual({
      enabled: 0,
    });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM panel_audit WHERE action='revoke' AND target=?")
        .get(MEMBER),
    ).toEqual({ n: 1 });
  });
  it("never resurrects a removed member when the team page re-seeds", async () => {
    // MEMBER also exists in admin_users, which is exactly what the seed imports from.
    await team({
      env,
      request: request("/api/admin/team", ownerToken, { action: "revoke", email: MEMBER }),
    });
    const response = await team({ env, request: request("/api/admin/team", ownerToken) });
    const body = await response.json();
    const member = body.members.find((m: { email: string }) => m.email === MEMBER);
    expect(member.enabled).toBe(0);
    expect(member.removed_at).toBeTruthy();
    expect((await requireDashboardAccess(request("/api/admin/data", memberToken), env)).ok).toBe(
      false,
    );
  });
  it("restores a removed member", async () => {
    await team({
      env,
      request: request("/api/admin/team", ownerToken, { action: "revoke", email: MEMBER }),
    });
    expect(
      (
        await team({
          env,
          request: request("/api/admin/team", ownerToken, { action: "restore", email: MEMBER }),
        })
      ).status,
    ).toBe(200);
    expect(
      db.prepare("SELECT enabled,removed_at FROM panel_members WHERE email=?").get(MEMBER),
    ).toEqual({ enabled: 1, removed_at: null });
    // `revoke` also moved `revoked_before`, so only a token minted afterwards may pass.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);
    const fresh = (await createAppSessionToken(SECRET, MEMBER, "viewer")).token;
    expect((await requireDashboardAccess(request("/api/admin/data", fresh), env)).ok).toBe(true);
  });
  it("groups the sessions of one browser and ends every token of the group at once", async () => {
    const second = (await createAppSessionToken(SECRET, MEMBER, "viewer")).token;
    for (const token of [memberToken, second])
      await requireDashboardAccess(request("/api/admin/data", token), env);
    const body = await (
      await team({ env, request: request("/api/admin/team", ownerToken) })
    ).json();
    const group = body.sessions.find((s: { email: string }) => s.email === MEMBER);
    // Two tokens, one browser: one row for the member (plus the owner's own request).
    expect(body.sessions.filter((s: { email: string }) => s.email === MEMBER)).toHaveLength(1);
    expect(group.tokens).toBe(2);
    expect(group.ids).toHaveLength(2);
    expect(group.ids).toContain(await tokenId(memberToken));
    const ended = await team({
      env,
      request: request("/api/admin/team", ownerToken, {
        action: "end-session",
        email: MEMBER,
        sessionIds: group.ids,
      }),
    });
    expect(ended.status).toBe(200);
    for (const token of [memberToken, second])
      expect((await requireDashboardAccess(request("/api/admin/data", token), env)).ok).toBe(false);
  });
  it("keeps the single-id form of end-session and rejects an empty selection", async () => {
    await requireDashboardAccess(request("/api/admin/data", memberToken), env);
    expect(
      (
        await team({
          env,
          request: request("/api/admin/team", ownerToken, {
            action: "end-session",
            email: MEMBER,
            sessionIds: [],
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await team({
          env,
          request: request("/api/admin/team", ownerToken, {
            action: "end-session",
            email: MEMBER,
            sessionId: await tokenId(memberToken),
          }),
        })
      ).status,
    ).toBe(200);
    expect((await requireDashboardAccess(request("/api/admin/data", memberToken), env)).ok).toBe(
      false,
    );
  });
  it("adds removed_at once, however often the schema is ensured", async () => {
    // A second D1 wrapper is a second cache key, so the migration really runs again.
    await ensurePanelSchema({ ...env, DB: createD1Database(db) });
    await ensurePanelSchema({ ...env, DB: createD1Database(db) });
    const columns = db.prepare("PRAGMA table_info(panel_members)").all() as { name: string }[];
    expect(columns.filter((c) => c.name === "removed_at")).toHaveLength(1);
  });
  it("groups session rows per email, auth mode and browser, newest first", () => {
    const row = (id: string, extra: Record<string, unknown>) => ({
      id,
      email: MEMBER,
      auth_mode: "access",
      user_agent: "Chrome",
      created_at: "2026-09-12T10:00:00.000Z",
      last_seen_at: "2026-09-12T10:00:00.000Z",
      expires_at: "2026-09-12T11:00:00.000Z",
      ...extra,
    });
    const groups = groupPanelSessions([
      row("a", { created_at: "2026-09-12T09:00:00.000Z" }),
      row("b", {
        last_seen_at: "2026-09-12T10:30:00.000Z",
        expires_at: "2026-09-12T12:00:00.000Z",
      }),
      row("c", { user_agent: "Firefox", last_seen_at: "2026-09-12T09:30:00.000Z" }),
      row("d", { email: OWNER, last_seen_at: "2026-09-12T09:45:00.000Z" }),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([["a", "b"], ["d"], ["c"]]);
    expect(groups[0]).toMatchObject({
      tokens: 2,
      first_seen_at: "2026-09-12T09:00:00.000Z",
      last_seen_at: "2026-09-12T10:30:00.000Z",
      expires_at: "2026-09-12T12:00:00.000Z",
    });
  });
  it("reports the earlier of the sign-in and the member's own expiry, and says which", () => {
    const at = (iso: string) => Date.parse(iso);
    const NOW = at("2026-09-18T12:00:00.000Z");
    const member = (extra: Partial<PanelMember> = {}): PanelMember => ({
      email: MEMBER,
      display_name: "",
      role: "support",
      enabled: 1,
      expires_at: null,
      overrides_json: "{}",
      revoked_before: 0,
      removed_at: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      ...extra,
    });
    // A month-long Cloudflare session, which is what the Allow policy hands everyone now.
    const group = (expires = "2026-10-18T12:00:00.000Z"): PanelSessionGroup => ({
      key: `${MEMBER}|access|Chrome`,
      email: MEMBER,
      auth_mode: "access",
      user_agent: "Chrome",
      tokens: 3,
      first_seen_at: "2026-09-18T09:00:00.000Z",
      last_seen_at: "2026-09-18T11:58:00.000Z",
      expires_at: expires,
      ids: ["a", "b", "c"],
    });
    const view = (m: PanelMember | null, g = group()) => sessionAccessView(g, m, NOW);

    // The case the owner called useless: two hours of panel access under a month of sign-in.
    expect(view(member({ expires_at: "2026-09-18T14:00:00.000Z" }))).toMatchObject({
      effective_expires_at: "2026-09-18T14:00:00.000Z",
      limited_by: "member",
      blocked: false,
    });
    // Equal timestamps: nothing shortens anything, so the sign-in keeps the label.
    expect(view(member({ expires_at: "2026-10-18T12:00:00.000Z" }))).toMatchObject({
      effective_expires_at: "2026-10-18T12:00:00.000Z",
      limited_by: "token",
    });
    // No member expiry, and no member row at all: the sign-in is the only limit there is.
    for (const m of [member(), null])
      expect(view(m)).toMatchObject({
        effective_expires_at: "2026-10-18T12:00:00.000Z",
        limited_by: "token",
        blocked: false,
      });
    // Already over: the tokens are alive, the session is not.
    expect(view(member({ expires_at: "2026-09-18T10:00:00.000Z" }))).toMatchObject({
      effective_expires_at: "2026-09-18T10:00:00.000Z",
      limited_by: "member",
      blocked: true,
    });
    // Disabled and removed are blocked too, whatever the dates say.
    expect(view(member({ enabled: 0 })).blocked).toBe(true);
    expect(view(member({ removed_at: "2026-09-17T08:00:00.000Z" })).blocked).toBe(true);
    // An unparseable sign-in expiry cannot be compared, so a real member expiry wins over it…
    expect(
      view(member({ expires_at: "2026-09-18T14:00:00.000Z" }), group("not-a-date")),
    ).toMatchObject({ effective_expires_at: "2026-09-18T14:00:00.000Z", limited_by: "member" });
    // …and an unparseable member expiry never overrides a good one. (It also never denies:
    // memberDenied compares the same NaN, so the row stays usable until the owner fixes it.)
    expect(view(member({ expires_at: "whenever" }))).toMatchObject({
      effective_expires_at: "2026-10-18T12:00:00.000Z",
      limited_by: "token",
      blocked: false,
    });
    // The list form matches each group to its own member and leaves strangers on the token.
    expect(
      describePanelSessions(
        [group(), { ...group(), key: "other", email: OWNER }],
        [member({ expires_at: "2026-09-18T14:00:00.000Z" })],
        NOW,
      ).map((g) => g.limited_by),
    ).toEqual(["member", "token"]);
  });
  it("sends the effective session end and the blocked flag to the Team page", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    // One hour of panel access under an 8-hour app session — the member is the limit.
    expect((await save({ expiresAt })).status).toBe(200);
    expect((await requireDashboardAccess(request("/api/admin/data", memberToken), env)).ok).toBe(
      true,
    );
    const live = await (
      await team({ env, request: request("/api/admin/team", ownerToken) })
    ).json();
    expect(live.sessions.find((s: { email: string }) => s.email === MEMBER)).toMatchObject({
      effective_expires_at: expiresAt,
      limited_by: "member",
      blocked: false,
    });
    // The owner has no expiry of their own, so their own row still reads off the sign-in.
    expect(live.sessions.find((s: { email: string }) => s.email === OWNER).limited_by).toBe(
      "token",
    );
    // Switch the member off: the browser keeps its unexpired token rows, and the group has to
    // show up as ended rather than as one of the signed-in devices.
    await team({
      env,
      request: request("/api/admin/team", ownerToken, { action: "revoke", email: MEMBER }),
    });
    db.prepare("UPDATE panel_sessions SET revoked_at = NULL WHERE email = ?").run(MEMBER);
    const after = await (
      await team({ env, request: request("/api/admin/team", ownerToken) })
    ).json();
    expect(after.sessions.find((s: { email: string }) => s.email === MEMBER).blocked).toBe(true);
  });
  it("says whether panel access is removed, switched off or expired — and since when", async () => {
    const reason = async (token: string) => {
      const denied = await requireDashboardAccess(request("/api/admin/data", token), env);
      expect(denied.ok).toBe(false);
      if (denied.ok) throw new Error("unreachable");
      expect(denied.response.status).toBe(403);
      return (await denied.response.json()).error as string;
    };
    await save({ enabled: false });
    expect(await reason(memberToken)).toBe(
      "Panel access is switched off for this account. The panel owner can switch it back on.",
    );
    await save({ enabled: true, expiresAt: "2020-01-01T00:00:00Z" });
    // The date is in the message: "expired" alone leaves the member with nothing to ask for.
    expect(await reason(memberToken)).toBe(
      "Panel access for this account expired on 2020-01-01 00:00 UTC. The panel owner can extend it.",
    );
    await team({
      env,
      request: request("/api/admin/team", ownerToken, { action: "revoke", email: MEMBER }),
    });
    expect(await reason(memberToken)).toBe("Panel access has been removed for this account.");
    // The login route refuses with the same sentence, not a second wording of its own.
    const rejected = await login({
      env,
      request: request("/api/auth/login", "", { email: MEMBER, password: "Example-Password-123!" }),
    });
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).error).toBe("Panel access has been removed for this account.");
    expect(memberDeniedMessage(null)).toBe("Panel access is not available for this account.");
  });
  it("hands the refusal to the sign-in screen through /api/auth/session", async () => {
    await save({ enabled: true, expiresAt: "2020-01-01T00:00:00Z" });
    const denied = await (
      await session({ env, request: request("/api/auth/session", memberToken) })
    ).json();
    // The status code contract is untouched: the panel still answers 200 with authenticated
    // false, it just no longer swallows the reason on the way.
    expect(denied.authenticated).toBe(false);
    expect(denied.reason).toContain("expired on 2020-01-01 00:00 UTC");
    // Nobody signed in at all gets a 401 from the gate and no reason to show.
    const anonymous = await (
      await session({ env, request: request("/api/auth/session", "") })
    ).json();
    expect(anonymous).toMatchObject({ authenticated: false, reason: null });
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
