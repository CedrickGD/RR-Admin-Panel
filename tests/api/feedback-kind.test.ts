import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema, locateSchemaFile } from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { ensureFeedbackSchema, loadFeedbackUnread } from "../../functions/_lib/content";
import { DIAGNOSTIC_PROVIDER_IDS } from "../../functions/_lib/feedback-diagnostics";
import { ensureFeedbackReplies } from "../../functions/_lib/feedback-replies";
import { createAppSessionToken } from "../../functions/_lib/auth";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetTelemetrySchemaStateForTests } from "../../functions/_lib/storage";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import { onRequestGet as listFeedback } from "../../functions/api/admin/feedback/index";
import {
  onRequestDelete as deleteFeedback,
  onRequestPut as updateFeedback,
} from "../../functions/api/admin/feedback/[id]/index";
import { onRequest as adminData } from "../../functions/api/admin/data";
import { onRequestPost as submitFeedback } from "../../functions/api/feedback/index";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import {
  generateInstallKeyPair,
  signedHeaders,
  type InstallKeyPair,
} from "../helpers/install-signer";

const origin = "https://panel.test";
const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";

let handle: SqliteDatabaseHandle, env: RuntimeEnv, keys: InstallKeyPair, adminToken: string;

beforeEach(async () => {
  resetRateLimitsForTests();
  resetInstallsSchemaStateForTests();
  handle = createInMemoryDatabase();
  env = {
    DB: createD1Database(handle),
    AUTH_MODE: "app",
    JWT_SECRET: "feedback-kind-tests-secret-that-is-only-for-testing",
  };
  // The production path: the feedback, diagnostics, recipient and installs tables as rr-api
  // creates them on first use.
  await ensureFeedbackReplies(env);
  await ensureAuthSchema(env);
  await createUser(env, "admin@test.example", "admin", "unused");
  adminToken = (await createAppSessionToken(env.JWT_SECRET, "admin@test.example", "admin")).token;
  keys = await generateInstallKeyPair();
  handle
    .prepare("INSERT INTO installs(install_id,public_key_jwk,hwid,created_at) VALUES(?,?,?,?)")
    .run(INSTALL_ID, JSON.stringify(keys.publicKeyJwk), INSTALL_ID, new Date().toISOString());
});
afterEach(() => handle.close());

function diagnostics() {
  return {
    schema_version: 1,
    generated_at: "2026-09-17T12:00:00.000Z",
    consent: true,
    providers: DIAGNOSTIC_PROVIDER_IDS.map((provider) => ({
      provider,
      version: "1.5.3",
      status: "ok",
      duration_ms: 4,
      summary: `${provider} ready`,
      checks: [{ key: "ready", label: "Ready", status: "pass", value: true, detail: null }],
    })),
  };
}

/** One submission; signed unless `unsigned`, and never rate limited by the ones before it. */
async function submit(body: Record<string, unknown>, unsigned = false): Promise<number> {
  resetRateLimitsForTests();
  const bodyText = JSON.stringify({ message: "Please have a look", ...body });
  const headers = unsigned
    ? new Headers({ "content-type": "application/json" })
    : await signedHeaders(keys.privateKey, {
        installId: INSTALL_ID,
        method: "POST",
        pathname: "/api/feedback",
        timestamp: String(Math.floor(Date.now() / 1000)),
        bodyText,
      });
  headers.set("content-type", "application/json");
  const response = await submitFeedback({
    env,
    request: new Request(`${origin}/api/feedback`, { method: "POST", headers, body: bodyText }),
  });
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { ok: boolean; report_id: string; message: string };
  // The response contract is unchanged: no kind on the wire back to the client.
  expect(Object.keys(payload).sort()).toEqual(["message", "ok", "report_id"]);
  return Number(payload.report_id.slice(3));
}

function storedKind(id: number): string {
  return (handle.prepare("SELECT kind FROM feedback WHERE id = ?").get(id) as { kind: string })
    .kind;
}

function adminHeaders(): Headers {
  return new Headers({
    cookie: `rr_session=${adminToken}`,
    origin,
    "content-type": "application/json",
  });
}

async function list(query = "") {
  const response = await listFeedback({
    env,
    request: new Request(`${origin}/api/admin/feedback${query}`, { headers: adminHeaders() }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function setStatus(id: number, status: string) {
  return updateFeedback({
    env,
    params: { id: String(id) },
    request: new Request(`${origin}/api/admin/feedback/${id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ status }),
    }),
  });
}

async function remove(id: number) {
  return deleteFeedback({
    env,
    params: { id: String(id) },
    request: new Request(`${origin}/api/admin/feedback/${id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    }),
  });
}

describe("POST /api/feedback kind", () => {
  it("files a report without a kind as support when it carries diagnostics, else as feedback", async () => {
    const withSnapshot = await submit({ diagnostics: diagnostics() });
    const signedPlain = await submit({});
    const legacyUnsigned = await submit({}, true);
    expect(storedKind(withSnapshot)).toBe("support");
    expect(storedKind(signedPlain)).toBe("feedback");
    expect(storedKind(legacyUnsigned)).toBe("feedback");
  });

  it("treats an invalid kind like a missing one", async () => {
    const withSnapshot = await submit({ kind: "bug", diagnostics: diagnostics() });
    const plain = await submit({ kind: 42 });
    const empty = await submit({ kind: "" }, true);
    expect(storedKind(withSnapshot)).toBe("support");
    expect(storedKind(plain)).toBe("feedback");
    expect(storedKind(empty)).toBe("feedback");
  });

  it("stores an explicit valid kind as sent, whatever came with it", async () => {
    const supportWithoutSnapshot = await submit({ kind: "support" });
    const feedbackWithSnapshot = await submit({ kind: "feedback", diagnostics: diagnostics() });
    const legacySupport = await submit({ kind: "support" }, true);
    expect(storedKind(supportWithoutSnapshot)).toBe("support");
    expect(storedKind(feedbackWithSnapshot)).toBe("feedback");
    expect(storedKind(legacySupport)).toBe("support");
  });
});

describe("GET /api/admin/feedback kind", () => {
  it("returns kind on every record, filters on ?kind and counts unread per inbox", async () => {
    const support = await submit({ diagnostics: diagnostics() });
    const feedback = await submit({});
    const readFeedback = await submit({ kind: "feedback" });
    expect((await setStatus(readFeedback, "read")).status).toBe(200);

    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body.feedback.map((row: any) => [row.id, row.kind])).toEqual([
      [readFeedback, "feedback"],
      [feedback, "feedback"],
      [support, "support"],
    ]);
    expect(all.body.unread).toEqual({ feedback: 1, support: 1, total: 2 });

    const onlySupport = await list("?kind=support");
    expect(onlySupport.body.feedback.map((row: any) => row.id)).toEqual([support]);
    const onlyFeedback = await list("?kind=feedback");
    expect(onlyFeedback.body.feedback.map((row: any) => row.id)).toEqual([readFeedback, feedback]);
    // The unread summary ignores the list filter, so the section tabs stay right.
    expect(onlySupport.body.unread).toEqual({ feedback: 1, support: 1, total: 2 });
    expect(onlyFeedback.body.unread).toEqual({ feedback: 1, support: 1, total: 2 });

    expect((await list("?kind=bug")).status).toBe(400);
  });

  it("rejects a malformed ?kind, a repeated one included", async () => {
    await submit({});
    for (const query of [
      "?kind=bug",
      "?kind=",
      "?kind=feedback&kind=support",
      "?kind=support&kind=support",
    ]) {
      expect((await list(query)).status, query).toBe(400);
    }
    expect((await list("?kind=feedback")).status).toBe(200);
  });

  it("changes status and deletes reports of either kind", async () => {
    const support = await submit({ diagnostics: diagnostics() });
    const feedback = await submit({});
    for (const [id, status] of [
      [support, "read"],
      [feedback, "archived"],
      [support, "archived"],
      [feedback, "new"],
    ] as const) {
      expect((await setStatus(id, status)).status).toBe(200);
      expect(
        (handle.prepare("SELECT status FROM feedback WHERE id = ?").get(id) as { status: string })
          .status,
      ).toBe(status);
    }
    expect((await setStatus(support, "bogus")).status).toBe(400);

    expect((await remove(support)).status).toBe(200);
    expect((await remove(feedback)).status).toBe(200);
    expect((await remove(feedback)).status).toBe(404);
    expect((await list()).body.feedback).toEqual([]);
    expect((await list()).body.unread).toEqual({ feedback: 0, support: 0, total: 0 });
  });

  it("adds the per-inbox unread counts to the dashboard summary for the rail badge", async () => {
    // The dashboard summary reads the telemetry tables too: the full schema, as rr-api boots it.
    resetTelemetrySchemaStateForTests();
    applySchema(handle, readFileSync(locateSchemaFile()!, "utf8"));
    await submit({ diagnostics: diagnostics() });
    await submit({});
    await submit({});
    const response = await adminData({
      env,
      request: new Request(`${origin}/api/admin/data`, { headers: adminHeaders() }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.summary.feedbackUnread).toEqual({ feedback: 2, support: 1, total: 3 });
  });
});

describe("ensureFeedbackSchema kind migration", () => {
  const LEGACY_FEEDBACK = `CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, contact TEXT, hwid TEXT,
    install_id TEXT, license_key TEXT, machine_name TEXT, app_version TEXT, platform TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
    created_at TEXT NOT NULL)`;
  const LEGACY_DIAGNOSTICS = `CREATE TABLE feedback_diagnostics (
    feedback_id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, generated_at TEXT NOT NULL,
    consent INTEGER NOT NULL CHECK (consent = 1), received_at TEXT NOT NULL)`;

  function legacyDatabase(withDiagnostics: boolean): SqliteDatabaseHandle {
    const legacy = createInMemoryDatabase();
    legacy.exec(LEGACY_FEEDBACK);
    const insert = legacy.prepare("INSERT INTO feedback(message, created_at) VALUES(?, ?)");
    insert.run("report with a snapshot", "2026-09-01T00:00:00.000Z");
    insert.run("plain idea", "2026-09-02T00:00:00.000Z");
    if (withDiagnostics) {
      legacy.exec(LEGACY_DIAGNOSTICS);
      legacy
        .prepare(
          "INSERT INTO feedback_diagnostics(feedback_id, schema_version, generated_at, consent, received_at) VALUES(1, 1, ?, 1, ?)",
        )
        .run("2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    }
    return legacy;
  }

  const kinds = (db: SqliteDatabaseHandle) =>
    (db.prepare("SELECT id, kind FROM feedback ORDER BY id").all() as any[]).map((row) => [
      row.id,
      row.kind,
    ]);

  it("adds the column to a table from before the field and backfills snapshot reports once", async () => {
    const legacy = legacyDatabase(true);
    try {
      await ensureFeedbackSchema({ DB: createD1Database(legacy) });
      expect(kinds(legacy)).toEqual([
        [1, "support"],
        [2, "feedback"],
      ]);
      expect(
        legacy
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
          .get("idx_feedback_kind_status"),
      ).toBeTruthy();
      expect(() => legacy.prepare("UPDATE feedback SET kind='bogus' WHERE id=1").run()).toThrow();

      // An admin moves the report to Feedback; the next process start (a fresh binding around the
      // same file) must leave that alone — the backfill ran once and left its schema_markers row.
      legacy.prepare("UPDATE feedback SET kind='feedback' WHERE id=1").run();
      await ensureFeedbackSchema({ DB: createD1Database(legacy) });
      expect(kinds(legacy)).toEqual([
        [1, "feedback"],
        [2, "feedback"],
      ]);
      expect(await loadFeedbackUnread(createD1Database(legacy))).toEqual({
        feedback: 2,
        support: 0,
        total: 2,
      });
    } finally {
      legacy.close();
    }
  });

  it("copes with a database that never saw a diagnostics table", async () => {
    const legacy = legacyDatabase(false);
    try {
      await ensureFeedbackSchema({ DB: createD1Database(legacy) });
      expect(kinds(legacy)).toEqual([
        [1, "feedback"],
        [2, "feedback"],
      ]);
    } finally {
      legacy.close();
    }
  });

  it("is a no-op on a database created from the current schema", async () => {
    // The beforeEach database was built by the current DDL: the column is already there.
    const id = await submit({ diagnostics: diagnostics() });
    handle.prepare("UPDATE feedback SET kind='feedback' WHERE id=?").run(id);
    await ensureFeedbackSchema({ DB: createD1Database(handle) });
    expect(storedKind(id)).toBe("feedback");
  });
});
