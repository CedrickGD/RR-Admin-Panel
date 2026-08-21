import { describe, expect, it } from "vitest";

import { requireDashboardAccess } from "../../functions/_lib/admin";
import { createAppSessionToken } from "../../functions/_lib/auth";
import { createMockD1 } from "../helpers/mock-d1";
import {
  TEST_ACCESS_AUD,
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  mintAccessToken,
  testAccessDeps,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "admin@example.com";
const deps = testAccessDeps();

async function expectDenied(
  result: Awaited<ReturnType<typeof requireDashboardAccess>>,
  status: number,
  message?: string,
): Promise<void> {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.response.status).toBe(status);
  const body = (await result.response.json()) as { ok: boolean; error: string };
  expect(body.ok).toBe(false);
  if (message) {
    expect(body.error).toBe(message);
  }
}

describe("requireDashboardAccess (AUTH_MODE=access)", () => {
  it("returns 401 without a JWT even when the Access email header is present", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: { "cf-access-authenticated-user-email": EMAIL },
    });

    await expectDenied(await requireDashboardAccess(request, testAccessEnv(EMAIL), deps), 401);
  });

  it("returns 401 for a JWT that fails verification (wrong audience)", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: await accessIdentityHeaders(EMAIL, undefined, { aud: ["other-app"] }),
    });

    await expectDenied(await requireDashboardAccess(request, testAccessEnv(EMAIL), deps), 401);
  });

  it("returns 500 when Access verification is not configured", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: await accessIdentityHeaders(EMAIL),
    });
    const env = testAccessEnv(EMAIL, { ACCESS_TEAM_DOMAIN: undefined });

    await expectDenied(
      await requireDashboardAccess(request, env, deps),
      500,
      "Access verification is not configured.",
    );
  });

  it("returns 403 when the allow-list is empty (fail closed)", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: await accessIdentityHeaders(EMAIL),
    });

    await expectDenied(
      await requireDashboardAccess(request, testAccessEnv(""), deps),
      403,
      "Access allow-list is empty.",
    );
    await expectDenied(
      await requireDashboardAccess(request, testAccessEnv(" , ,"), deps),
      403,
      "Access allow-list is empty.",
    );
  });

  it("returns 403 when the verified email is not on the allow-list", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: await accessIdentityHeaders("intruder@example.com"),
    });

    await expectDenied(
      await requireDashboardAccess(request, testAccessEnv(EMAIL), deps),
      403,
      "Access identity is not allowed.",
    );
  });

  it("ignores the (spoofable) email header and uses the verified JWT email", async () => {
    const headers = await accessIdentityHeaders(EMAIL);
    headers.set("cf-access-authenticated-user-email", "intruder@example.com");
    const request = createSyntheticRequest({ path: "/api/admin/data", headers });

    const result = await requireDashboardAccess(request, testAccessEnv(EMAIL), deps);

    expect(result).toEqual({
      ok: true,
      access: {
        authMode: "access",
        user: { email: EMAIL, role: "admin" },
        accessIdentity: EMAIL,
        sessionExpiresAt: null,
      },
    });
  });

  it("lower-cases the JWT email before the allow-list and role checks", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: await accessIdentityHeaders("Admin@Example.COM"),
    });

    const result = await requireDashboardAccess(request, testAccessEnv(EMAIL), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access.user).toEqual({ email: EMAIL, role: "admin" });
  });

  it("resolves the viewer role for allow-listed identities that are not admins", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: await accessIdentityHeaders("viewer@example.com"),
    });
    const env = testAccessEnv(`${EMAIL},viewer@example.com`, { ACCESS_ADMIN_EMAIL: EMAIL });

    const result = await requireDashboardAccess(request, env, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access.user).toEqual({ email: "viewer@example.com", role: "viewer" });
  });

  it("returns 403 for a cross-site mutation even with a valid identity", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/licenses",
      json: { type: "lifetime" },
      headers: await accessIdentityHeaders(EMAIL, { "sec-fetch-site": "cross-site" }),
    });

    await expectDenied(await requireDashboardAccess(request, testAccessEnv(EMAIL), deps), 403);
  });

  it("returns 415 for a POST body that is not JSON", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/licenses",
      method: "POST",
      headers: await accessIdentityHeaders(EMAIL, {
        "content-type": "text/plain",
        "content-length": "5",
      }),
    });
    const withBody = new Request(request, { body: "hello" });

    await expectDenied(await requireDashboardAccess(withBody, testAccessEnv(EMAIL), deps), 415);
  });

  it("allows a same-origin JSON POST", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/licenses",
      json: { type: "lifetime" },
      headers: await accessIdentityHeaders(EMAIL, {
        "sec-fetch-site": "same-origin",
        origin: "https://admin.test",
      }),
    });

    const result = await requireDashboardAccess(request, testAccessEnv(EMAIL), deps);

    expect(result.ok).toBe(true);
  });

  it("allows a DELETE without a body and sec-fetch-site: same-origin", async () => {
    const request = createSyntheticRequest({
      path: "/api/admin/licenses/RR-TEST",
      method: "DELETE",
      headers: await accessIdentityHeaders(EMAIL, { "sec-fetch-site": "same-origin" }),
    });

    const result = await requireDashboardAccess(request, testAccessEnv(EMAIL), deps);

    expect(result.ok).toBe(true);
  });

  it("never reads the cf-access-authenticated-user-email header as an identity", async () => {
    // Spoofed header + no token + empty allow-list used to pass (empty list meant "allow all").
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: { "cf-access-authenticated-user-email": "anyone@example.com" },
    });

    await expectDenied(await requireDashboardAccess(request, testAccessEnv(""), deps), 401);
  });
});

describe("requireDashboardAccess (AUTH_MODE=app)", () => {
  const JWT_SECRET = "test-secret-that-is-long-enough-0123456789";

  async function appEnv(overrides: Record<string, unknown> = {}) {
    const mock = createMockD1({
      first: [
        {
          match: "FROM admin_users",
          result: {
            id: 1,
            email: EMAIL,
            role: "admin",
            password_hash:
              "pbkdf2$sha256$50000$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            last_login_at: null,
          },
        },
      ],
    });
    const env = {
      AUTH_MODE: "app",
      JWT_SECRET,
      ACCESS_ENFORCEMENT: "off",
      DB: mock.db,
      ...overrides,
    };
    const session = await createAppSessionToken(JWT_SECRET, EMAIL, "admin");
    return { env, mock, cookie: `rr_session=${session.token}` };
  }

  it("keeps cookie sessions working for same-origin requests", async () => {
    const { env, cookie } = await appEnv();
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: { cookie },
    });

    const result = await requireDashboardAccess(request, env);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.access.authMode).toBe("app");
    expect(result.access.user).toEqual({ email: EMAIL, role: "admin" });
  });

  it("returns 401 without a session cookie", async () => {
    const { env } = await appEnv();
    const request = createSyntheticRequest({ path: "/api/admin/data" });

    await expectDenied(await requireDashboardAccess(request, env), 401);
  });

  it("applies the CSRF guard to app-mode mutations too", async () => {
    const { env, cookie } = await appEnv();
    const request = createSyntheticRequest({
      path: "/api/admin/licenses",
      json: { type: "lifetime" },
      headers: { cookie, "sec-fetch-site": "cross-site" },
    });

    await expectDenied(await requireDashboardAccess(request, env), 403);
  });

  it("fails closed on the Access allow-list when enforcement is on", async () => {
    const { env, cookie } = await appEnv({
      ACCESS_ENFORCEMENT: "strict",
      ACCESS_ALLOWED_EMAIL: "",
    });
    const request = createSyntheticRequest({
      path: "/api/admin/data",
      headers: { cookie, "cf-access-authenticated-user-email": EMAIL },
    });

    await expectDenied(
      await requireDashboardAccess(request, env),
      403,
      "Access allow-list is empty.",
    );
  });

  describe("ACCESS_ENFORCEMENT with a verifiable JWT", () => {
    const verifying = {
      ACCESS_ENFORCEMENT: "strict",
      ACCESS_TEAM_DOMAIN: TEST_ACCESS_TEAM_DOMAIN,
      ACCESS_AUD: TEST_ACCESS_AUD,
      ACCESS_ALLOWED_EMAIL: EMAIL,
    };

    it("identifies the user from the JWT alone (the proxy shells drop the email header)", async () => {
      const { env, cookie } = await appEnv(verifying);
      const request = createSyntheticRequest({
        path: "/api/admin/data",
        headers: { cookie, "cf-access-jwt-assertion": await mintAccessToken(EMAIL) },
      });

      const result = await requireDashboardAccess(request, env, deps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.access.accessIdentity).toBe(EMAIL);
    });

    it("prefers the verified JWT over a spoofed email header", async () => {
      const { env, cookie } = await appEnv(verifying);
      const headers = await accessIdentityHeaders("other@example.com", { cookie });
      headers.set("cf-access-authenticated-user-email", EMAIL);
      const request = createSyntheticRequest({ path: "/api/admin/data", headers });

      await expectDenied(
        await requireDashboardAccess(request, env, deps),
        403,
        "Access identity is not allowed.",
      );
    });

    it("refuses an invalid JWT even when the email header matches the allow-list", async () => {
      const { env, cookie } = await appEnv(verifying);
      const headers = await accessIdentityHeaders(EMAIL, { cookie }, { aud: ["other-app"] });
      const request = createSyntheticRequest({ path: "/api/admin/data", headers });

      await expectDenied(await requireDashboardAccess(request, env, deps), 401);
    });

    it("keeps the header path when verification is not configured", async () => {
      const { env, cookie } = await appEnv({
        ACCESS_ENFORCEMENT: "strict",
        ACCESS_ALLOWED_EMAIL: EMAIL,
      });
      const request = createSyntheticRequest({
        path: "/api/admin/data",
        headers: { cookie, "cf-access-authenticated-user-email": EMAIL },
      });

      const result = await requireDashboardAccess(request, env, deps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.access.accessIdentity).toBe(EMAIL);
    });
  });
});
