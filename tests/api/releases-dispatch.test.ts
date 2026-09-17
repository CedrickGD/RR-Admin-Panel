/**
 * `POST /api/admin/releases/workflows/:id/dispatch` — running an arbitrary workflow. Design §4,
 * §6 and §11.
 *
 * The permission is the headline: this is `releases.files`, the owner-only key, because
 * dispatching an arbitrary workflow is remote code execution on a runner that holds the release
 * token. An admin seat keeps drafts, build, publish and rollback and is refused here — the same
 * line `routePermissions` draws for the Files tab.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetConfirmTokenStateForTests } from "../../functions/_lib/release-confirm";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as dispatch } from "../../functions/api/admin/releases/workflows/[id]/dispatch";
import { FakeGitHub } from "../helpers/fake-github";
import { releasesFetch } from "../helpers/releases-api";
import {
  confirmTokenFor,
  panelMemberRow,
  releasesDb,
  type ReleasesDb,
} from "../helpers/releases-write";
import {
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "owner@example.com";
const REPO = "CedrickGD/RazorReaper";
const DISPATCH = (id: string) => `POST /repos/${REPO}/actions/workflows/${id}/dispatches`;

let github: FakeGitHub;

beforeAll(async () => {
  await getTestAccessSigner();
});

beforeEach(() => {
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
  github = new FakeGitHub();
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
});

function store(role: "owner" | "admin" = "owner"): ReleasesDb {
  return releasesDb({ draft: null, member: panelMemberRow(EMAIL, role) });
}

function env(db: ReleasesDb, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, {
    DB: db.db,
    GITHUB_RELEASE_TOKEN: "github_pat_write",
    JWT_SECRET: "dispatch-test-secret",
    ...overrides,
  });
}

async function post(
  runtime: RuntimeEnv,
  id: string,
  body: Record<string, unknown>,
  options: { subject?: string } = {},
): Promise<Response> {
  const confirmToken =
    body.confirmToken ?? (await confirmTokenFor(runtime, "dispatch", options.subject ?? id, EMAIL));
  return dispatch({
    request: createSyntheticRequest({
      path: `/api/admin/releases/workflows/${id}/dispatch`,
      json: { ...body, confirmToken },
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: runtime,
    params: { id },
  });
}

describe("POST /api/admin/releases/workflows/:id/dispatch", () => {
  it("dispatches on the default branch with the declared inputs", async () => {
    github.on(DISPATCH("10"), { status: 204 });
    const db = store();

    const response = await post(env(db), "10", { inputs: { version: "1.5.4", prerelease: false } });

    expect(response.status).toBe(200);
    expect(github.callsFor(DISPATCH("10"))[0]?.body).toEqual({
      ref: "master",
      inputs: { version: "1.5.4", prerelease: "false" },
    });
    expect(db.events()[0]).toMatchObject({ kind: "workflow_dispatched", draftId: null });
    expect(db.audits()[0]?.action).toBe("release.workflow.dispatch");
  });

  it("names the inputs but never their values in the audit line", async () => {
    github.on(DISPATCH("10"), { status: 204 });
    const db = store();
    await post(env(db), "10", { inputs: { version: "1.5.4", notes: "a customer bullet" } });

    const detail = db.audits()[0]?.detail ?? "";
    expect(detail).toContain("notes, version");
    expect(detail).not.toContain("a customer bullet");
  });

  it("accepts a workflow file name and an explicit ref", async () => {
    github.on(DISPATCH("update-manifest.yml"), { status: 204 });
    const db = store();

    const response = await post(env(db), "update-manifest.yml", {
      ref: "master",
      inputs: { tag_name: "v1.5.3" },
    });

    expect(response.status).toBe(200);
    expect(github.callsFor(DISPATCH("update-manifest.yml"))[0]?.body).toMatchObject({
      ref: "master",
    });
  });

  it("refuses an admin seat: a free-form dispatch is owner-only", async () => {
    const db = store("admin");
    const response = await post(env(db), "10", { inputs: {} });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a confirmation minted for another workflow", async () => {
    const db = store();
    const response = await post(env(db), "10", { inputs: {} }, { subject: "11" });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses an id that is not a workflow", async () => {
    const db = store();
    const response = await post(env(db), "..%2F..%2Fsecrets", { inputs: {} });
    expect(response.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a ref that is not a branch or tag name", async () => {
    const db = store();
    const response = await post(env(db), "10", { ref: "not a ref", inputs: {} });
    expect(response.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses an input that is not text, a number or a flag", async () => {
    const db = store();
    const response = await post(env(db), "10", { inputs: { version: { nested: true } } });
    expect(response.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses without a write token", async () => {
    const db = store();
    const response = await post(env(db, { GITHUB_RELEASE_TOKEN: "xxx" }), "10", { inputs: {} });
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "no-write-token" });
    expect(github.calls).toHaveLength(0);
  });

  it("stops the eleventh dispatch in an hour", async () => {
    github.on(DISPATCH("10"), { status: 204 });
    const db = store();
    const runtime = env(db);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await post(runtime, "10", { inputs: {} })).status).toBe(200);
    }

    const response = await post(runtime, "10", { inputs: {} });
    expect(response.status).toBe(429);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "rate-limited" });
    expect(response.headers.get("retry-after")).not.toBeNull();
  });
});
