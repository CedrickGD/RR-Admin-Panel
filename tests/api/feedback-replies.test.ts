import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import {
  adminFeedbackReplies,
  customerFeedbackInbox,
  ensureFeedbackReplies,
} from "../../functions/_lib/feedback-replies";
import { onRequestPost as submitFeedback } from "../../functions/api/feedback/index";
import { createAppSessionToken } from "../../functions/_lib/auth";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import {
  generateInstallKeyPair,
  signedHeaders,
  type InstallKeyPair,
} from "../helpers/install-signer";
import type { RuntimeEnv } from "../../functions/_lib/types";

const origin = "https://panel.test";
const first = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const other = "7f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
let handle: SqliteDatabaseHandle,
  env: RuntimeEnv,
  keys: InstallKeyPair,
  adminToken: string,
  viewerToken: string;
beforeEach(async () => {
  resetRateLimitsForTests();
  resetInstallsSchemaStateForTests();
  handle = createInMemoryDatabase();
  env = {
    DB: createD1Database(handle),
    AUTH_MODE: "app",
    JWT_SECRET: "feedback-tests-secret-that-is-only-for-testing",
  };
  await ensureFeedbackReplies(env);
  await ensureAuthSchema(env);
  await createUser(env, "admin@test.example", "admin", "unused");
  await createUser(env, "viewer@test.example", "viewer", "unused");
  adminToken = (await createAppSessionToken(env.JWT_SECRET, "admin@test.example", "admin")).token;
  viewerToken = (await createAppSessionToken(env.JWT_SECRET, "viewer@test.example", "viewer"))
    .token;
  keys = await generateInstallKeyPair();
  for (const id of [first, other])
    handle
      .prepare("INSERT INTO installs(install_id,public_key_jwk,hwid,created_at) VALUES(?,?,?,?)")
      .run(id, JSON.stringify(keys.publicKeyJwk), id, new Date().toISOString());
});
afterEach(() => handle.close());
async function signed(path: string, body: unknown, installId = first) {
  const bodyText = JSON.stringify(body);
  const headers = await signedHeaders(keys.privateKey, {
    installId,
    method: "POST",
    pathname: path,
    timestamp: String(Math.floor(Date.now() / 1000)),
    bodyText,
  });
  headers.set("content-type", "application/json");
  return new Request(origin + path, { method: "POST", headers, body: bodyText });
}
async function report(installId = first, extra = {}) {
  const response = await submitFeedback({
    env,
    request: await signed(
      "/api/feedback",
      { message: "Please help with startup", ...extra },
      installId,
    ),
  });
  expect(response.status).toBe(201);
  return Number(((await response.json()) as { report_id: string }).report_id.slice(3));
}
async function inbox(body: unknown = { action: "list" }, installId = first) {
  return customerFeedbackInbox({
    env,
    request: await signed("/api/feedback/inbox", body, installId),
  });
}
async function admin(id: number, body?: unknown, token = adminToken, requestOrigin = origin) {
  const headers = new Headers({
    cookie: `rr_session=${token}`,
    origin: requestOrigin,
    "content-type": "application/json",
  });
  return adminFeedbackReplies({
    env,
    params: { id: String(id) },
    request: new Request(`${origin}/api/admin/feedback/${id}/replies`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  });
}
const answer = (message = "Please try the repair option.") => ({
  message,
  request_id: crypto.randomUUID(),
});

describe("private report replies", () => {
  it("delivers a reply only to the signed sender, retains unread state and supports idempotent reading", async () => {
    const id = await report(first, { install_id: other, hwid: other });
    const sent = await admin(id, answer());
    expect(sent.status).toBe(201);
    const item = ((await sent.json()) as any).reply;
    let own = (await (await inbox()).json()) as any;
    expect(own.unread).toBe(1);
    expect(own.replies[0].original_message).toContain("startup");
    expect(own.replies[0]).not.toHaveProperty("author_email");
    const foreign = (await (
      await inbox({ action: "list", install_id: first }, other)
    ).json()) as any;
    expect(foreign.replies).toEqual([]);
    expect(foreign.unread).toBe(0);
    expect((await inbox({ action: "read", id: item.id }, other)).status).toBe(404);
    expect((await inbox({ action: "read", id: item.id })).status).toBe(200);
    expect((await inbox({ action: "read", id: item.id })).status).toBe(200);
    own = (await (await inbox()).json()) as any;
    expect(own.unread).toBe(0);
    expect(own.replies[0].read_at).toBeTruthy();
    expect(((await (await admin(id)).json()) as any).replies[0].read_at).toBeTruthy();
  });
  it("deduplicates uncertain retries and rejects reuse for a different message", async () => {
    const id = await report();
    const body = answer();
    const a = (await (await admin(id, body)).json()) as any;
    const b = (await (await admin(id, body)).json()) as any;
    expect(a.reply.id).toBe(b.reply.id);
    expect((await admin(id, { ...body, message: "Changed" })).status).toBe(409);
    expect(((await (await inbox()).json()) as any).unread).toBe(1);
  });
  it("requires admin authentication, write permission and same-origin requests", async () => {
    const id = await report();
    expect((await admin(id, answer(), "")).status).toBe(401);
    expect((await admin(id, answer(), viewerToken)).status).toBe(403);
    expect((await admin(id, answer(), adminToken, "https://other.test")).status).toBe(403);
    expect((await admin(id, answer("  \n"))).status).toBe(400);
    expect((await admin(id, answer("x".repeat(4001)))).status).toBe(400);
    expect((await inbox({ action: "read", id: -1 })).status).toBe(400);
    expect(((await (await inbox()).json()) as any).unread).toBe(0);
  });
  it("refuses unsigned inbox requests and replies to unverified legacy reports", async () => {
    expect(
      (
        await customerFeedbackInbox({
          env,
          request: new Request(origin + "/api/feedback/inbox", {
            method: "POST",
            body: JSON.stringify({ action: "list", install_id: first }),
          }),
        })
      ).status,
    ).toBe(401);
    const created = await submitFeedback({
      env,
      request: new Request(origin + "/api/feedback", {
        method: "POST",
        body: JSON.stringify({ message: "Legacy report", install_id: first }),
      }),
    });
    const id = Number(((await created.json()) as any).report_id.slice(3));
    expect((await admin(id, answer())).status).toBe(409);
  });
  it("shares account replies with signed-in devices and hides them after sign-out or account switch", async () => {
    for (const id of ["account-a", "account-b"])
      handle
        .prepare(
          `INSERT INTO customer_accounts(id,discord_id,discord_username,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
        )
        .run(id, id, id, id, "2026-01-01", "2026-01-01");
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    for (const id of [first, other])
      handle
        .prepare("INSERT INTO customer_account_devices VALUES(?,?,?,?)")
        .run(id, "account-a", "2026-01-01", expiry);
    const id = await report();
    await admin(id, answer());
    expect(((await (await inbox({ action: "list" }, other)).json()) as any).unread).toBe(1);
    handle
      .prepare("UPDATE customer_account_devices SET expires_at=0 WHERE install_id=?")
      .run(first);
    expect(((await (await inbox()).json()) as any).replies).toEqual([]);
    handle
      .prepare("UPDATE customer_account_devices SET account_id=?,expires_at=? WHERE install_id=?")
      .run("account-b", expiry, first);
    expect(((await (await inbox()).json()) as any).replies).toEqual([]);
    handle
      .prepare("UPDATE customer_account_devices SET account_id=? WHERE install_id=?")
      .run("account-a", first);
    expect(((await (await inbox()).json()) as any).unread).toBe(1);
  });
  it("paginates without losing unread counts and removes replies when their report is deleted", async () => {
    const id = await report();
    for (let index = 0; index < 52; index++)
      handle
        .prepare(
          "INSERT INTO feedback_replies(feedback_id,message,author_email,request_id,created_at) VALUES(?,?,?,?,?)",
        )
        .run(id, `Answer ${index}`, "admin@test.example", String(index), new Date().toISOString());
    const page = (await (await inbox()).json()) as any;
    expect(page.replies).toHaveLength(50);
    expect(page.unread).toBe(52);
    const older = (await (await inbox({ action: "list", before: page.next_before })).json()) as any;
    expect(older.replies).toHaveLength(2);
    expect(older.next_before).toBeNull();
    handle.prepare("DELETE FROM feedback WHERE id=?").run(id);
    expect(((await (await inbox()).json()) as any).unread).toBe(0);
  });
});
