import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../deploy/nas/rr-api/src/d1-adapter";
import {
  accountApi,
  accountAuthorize,
  accountCallback,
  accountHash,
  ensureCustomerAccounts,
  validateAccountUpdate,
} from "../functions/_lib/customer-accounts";
import type { RuntimeEnv } from "../functions/_lib/types";
import { resetRateLimitsForTests } from "../functions/_lib/ratelimit";
import {
  generateInstallKeyPair,
  signedHeaders,
  type InstallKeyPair,
} from "./helpers/install-signer";
import { resetInstallsSchemaStateForTests } from "../shared/installs-store";

const origin = "https://panel.test";
const install = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const other = "7f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
let handle: SqliteDatabaseHandle, env: RuntimeEnv, keys: InstallKeyPair;
beforeEach(async () => {
  resetRateLimitsForTests();
  resetInstallsSchemaStateForTests();
  handle = createInMemoryDatabase();
  env = {
    DB: createD1Database(handle),
    DISCORD_CLIENT_ID: "client",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_REDIRECT_URI: origin + "/api/discord/callback",
  };
  keys = await generateInstallKeyPair();
  await ensureCustomerAccounts(env.DB!);
  for (const id of [install, other])
    handle
      .prepare("INSERT INTO installs(install_id,public_key_jwk,hwid,created_at) VALUES(?,?,?,?)")
      .run(
        id,
        JSON.stringify(keys.publicKeyJwk),
        id === install ? "DEVICE-A" : "DEVICE-B",
        new Date().toISOString(),
      );
});
afterEach(() => {
  vi.unstubAllGlobals();
  handle.close();
});
async function api(action: string, body?: unknown, method = "POST", id = install) {
  const path = "/api/discord/account/" + action;
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const headers = await signedHeaders(keys.privateKey, {
    installId: id,
    method,
    pathname: path,
    timestamp: String(Math.floor(Date.now() / 1000)),
    bodyText,
  });
  headers.set("content-type", "application/json");
  return accountApi(
    {
      env,
      request: new Request(origin + path, {
        method,
        headers,
        body: method === "GET" ? undefined : bodyText,
      }),
    },
    action,
  );
}
async function beginBrowser() {
  const start = (await (await api("start", {})).json()) as {
    requestId: string;
    verificationUrl: string;
    userCode: string;
  };
  const landing = await accountAuthorize({ env, request: new Request(start.verificationUrl) });
  const cookie = landing.headers.get("set-cookie")!.split(";")[0];
  const nonce = cookie.split("=")[1];
  const redirect = await accountAuthorize({
    env,
    request: new Request(origin + "/api/discord/account/authorize", {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: start.requestId, csrf: nonce }),
    }),
  });
  expect(redirect.status).toBe(302);
  const oauth = new URL(redirect.headers.get("location")!);
  expect(oauth.searchParams.get("scope")).toBe("identify");
  return { ...start, cookie, state: oauth.searchParams.get("state")! };
}
async function approveBrowser() {
  const login = await beginBrowser();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/oauth2/token")
              ? { access_token: "provider-token", scope: "identify" }
              : {
                  id: "123456789123456789",
                  username: "test.member",
                  global_name: "Test Member",
                  avatar: "0123456789abcdef0123456789abcdef",
                },
          ),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const response = await accountCallback({
    env,
    request: new Request(`${origin}/api/discord/callback?state=${login.state}&code=provider-code`, {
      headers: { cookie: login.cookie },
    }),
  });
  expect(await response.text()).toContain("Return to RazorReaper");
  return login;
}
describe("customer accounts", () => {
  it("requires signed install proof, not a claimed ID or legacy shared key", async () => {
    const response = await accountApi(
      {
        env,
        request: new Request(origin + "/api/discord/account/start", {
          method: "POST",
          body: JSON.stringify({ installId: install }),
          headers: { "x-api-key": "legacy" },
        }),
      },
      "start",
    );
    expect(response.status).toBe(401);
    expect(handle.prepare("SELECT COUNT(*) AS n FROM customer_account_logins").get()).toEqual({
      n: 0,
    });
  });
  it("binds browser consent to its CSRF cookie and rejects foreign origins", async () => {
    const start = (await (await api("start", {})).json()) as { requestId: string };
    const request = new Request(origin + "/api/discord/account/authorize", {
      method: "POST",
      headers: { origin: "https://other.test", cookie: "rr_account_browser=" + "a".repeat(64) },
      body: new URLSearchParams({ request: start.requestId, csrf: "a".repeat(64) }),
    });
    expect((await accountAuthorize({ env, request })).status).toBe(403);
    expect(handle.prepare("SELECT state_hash FROM customer_account_logins").get()).toEqual({
      state_hash: null,
    });
  });
  it("creates a Discord account only after verified OAuth and requires confirmation in the requesting app", async () => {
    const login = await approveBrowser();
    expect((await api("me", undefined, "GET")).status).toBe(403);
    expect((await api("poll", { requestId: login.requestId }, "POST", other)).status).toBe(410);
    const pending = (await (await api("poll", { requestId: login.requestId })).json()) as any;
    expect(pending.status).toBe("confirm");
    expect(pending.account.discordUsername).toBe("test.member");
    expect((await api("confirm", { requestId: login.requestId })).status).toBe(200);
    expect((await api("confirm", { requestId: login.requestId })).status).toBe(410);
    const own = (await (await api("me", undefined, "GET")).json()) as any;
    expect(own.account.displayName).toBe("Test Member");
    expect(own.devices).toHaveLength(1);
    expect(JSON.stringify(own)).not.toContain("provider-token");
    expect((await api("me", undefined, "GET", other)).status).toBe(403);
  });
  it("rejects a callback from another browser and consumes OAuth state once", async () => {
    const login = await beginBrowser();
    const request = new Request(`${origin}/api/discord/callback?state=${login.state}&code=x`);
    expect(await (await accountCallback({ env, request })).text()).toContain(
      "could not be completed",
    );
    expect(handle.prepare("SELECT COUNT(*) AS n FROM customer_accounts").get()).toEqual({ n: 0 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 400 })),
    );
    const callback = () =>
      accountCallback({
        env,
        request: new Request(request.url, { headers: { cookie: login.cookie } }),
      });
    await callback();
    await callback();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("expires pending sign-ins and rejects revoked install proofs", async () => {
    const start = (await (await api("start", {})).json()) as any;
    handle.prepare("UPDATE customer_account_logins SET expires_at=0").run();
    expect((await api("poll", { requestId: start.requestId })).status).toBe(410);
    handle
      .prepare("UPDATE installs SET revoked_at=? WHERE install_id=?")
      .run(new Date().toISOString(), install);
    expect((await api("start", {})).status).toBe(401);
  });
  it("shares a profile across linked installations, saves images and signs out only this device", async () => {
    const login = await approveBrowser();
    await api("confirm", { requestId: login.requestId });
    const account = handle.prepare("SELECT id FROM customer_accounts").get() as { id: string };
    handle
      .prepare("INSERT INTO customer_account_devices VALUES(?,?,?,?)")
      .run(other, account.id, new Date().toISOString(), Math.floor(Date.now() / 1000) + 1000);
    const avatar =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=";
    expect((await api("me", { displayName: "New Name", avatar }, "PUT")).status).toBe(200);
    const peer = (await (await api("me", undefined, "GET", other)).json()) as any;
    expect(peer.account.displayName).toBe("New Name");
    expect(peer.account.avatar).toBe(avatar);
    expect((await api("me", undefined, "DELETE")).status).toBe(200);
    expect((await api("me", undefined, "GET")).status).toBe(403);
    expect((await api("me", undefined, "GET", other)).status).toBe(200);
    expect(handle.prepare("SELECT COUNT(*) AS n FROM customer_accounts").get()).toEqual({ n: 1 });
  });
  it("prevents account IDs, Discord identities and remote image URLs from being edited", () => {
    expect(() => validateAccountUpdate({ displayName: "User", id: "someone-else" })).toThrow();
    expect(() =>
      validateAccountUpdate({ displayName: "User", discordId: "someone-else" }),
    ).toThrow();
    expect(() =>
      validateAccountUpdate({ displayName: "User", avatar: "https://evil.test/image" }),
    ).toThrow();
    expect(() =>
      validateAccountUpdate({ displayName: "User", avatar: "data:image/svg+xml;base64,PHN2Zz4=" }),
    ).toThrow();
    expect(() =>
      validateAccountUpdate({ displayName: "User", avatar: "data:image/png;base64,ZmFrZQ==" }),
    ).toThrow();
    expect(() => validateAccountUpdate({ displayName: "A" })).toThrow();
  });
  it("stores only hashed sign-in tokens", async () => {
    const start = (await (await api("start", {})).json()) as any;
    const saved = handle.prepare("SELECT request_hash FROM customer_account_logins").get() as any;
    expect(saved.request_hash).toBe(await accountHash(start.requestId));
    expect(saved.request_hash).not.toBe(start.requestId);
  });
});
