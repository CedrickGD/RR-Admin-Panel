import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { createAppSessionToken, hashPassword } from "../../functions/_lib/auth";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import { onRequest } from "../../functions/api/auth/appearance";
import { DEFAULT_APPEARANCE } from "../../shared/appearance";
import type { RuntimeEnv } from "../../functions/_lib/types";
let db: SqliteDatabaseHandle, env: RuntimeEnv, one: string, two: string;
const SECRET = "local-appearance-test-secret";
const IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkS8AAAAASUVORK5CYII=";
function req(token: string, body?: unknown, origin = "https://panel.test") {
  return new Request("https://panel.test/api/auth/appearance", {
    method: body ? "PUT" : "GET",
    headers: { cookie: `rr_session=${token}`, origin, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
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
  const hash = await hashPassword("Local-Example-Password!");
  await createUser(env, "one@example.test", "admin", hash);
  await createUser(env, "two@example.test", "viewer", hash);
  one = (await createAppSessionToken(SECRET, "one@example.test", "admin")).token;
  two = (await createAppSessionToken(SECRET, "two@example.test", "viewer")).token;
});
afterEach(() => db.close());
describe("account appearance storage on the NAS", () => {
  it("persists the image and theme for the authenticated account across sessions", async () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      theme: "light",
      background: "image",
      image: IMAGE,
      sidebarTransparency: 55,
    };
    expect((await onRequest({ env, request: req(one, appearance) })).status).toBe(200);
    const newSession = (await createAppSessionToken(SECRET, "one@example.test", "admin")).token;
    expect((await (await onRequest({ env, request: req(newSession) })).json()).appearance).toEqual(
      appearance,
    );
  });
  it("isolates users and allows a viewer to save their own preferences", async () => {
    await onRequest({ env, request: req(one, { ...DEFAULT_APPEARANCE, hue: 10 }) });
    expect((await (await onRequest({ env, request: req(two) })).json()).appearance).toBeNull();
    expect(
      (await onRequest({ env, request: req(two, { ...DEFAULT_APPEARANCE, hue: 190 }) })).status,
    ).toBe(200);
    expect((await (await onRequest({ env, request: req(one) })).json()).appearance.hue).toBe(10);
  });
  it("does not accept an account selector or an untrusted image", async () => {
    for (const body of [
      { ...DEFAULT_APPEARANCE, email: "two@example.test" },
      { ...DEFAULT_APPEARANCE, image: "data:image/svg+xml;base64,PHN2Zz4=" },
      { ...DEFAULT_APPEARANCE, image: "data:image/png;base64,aGVsbG8=" },
      { ...DEFAULT_APPEARANCE, hue: 999 },
      { ...DEFAULT_APPEARANCE, sidebarTransparency: 101 },
    ]) {
      expect((await onRequest({ env, request: req(one, body) })).status).toBe(400);
    }
  });
  it("rejects unauthenticated reads and cross-origin writes", async () => {
    expect((await onRequest({ env, request: req("") })).status).toBe(401);
    expect(
      (await onRequest({ env, request: req(one, DEFAULT_APPEARANCE, "https://other.test") }))
        .status,
    ).toBe(403);
  });
});
