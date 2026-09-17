/**
 * `POST /api/admin/releases/drafts` and `PUT` / `DELETE …/drafts/:id` — the draft half of §6's
 * write API. Design §12 names this suite and what it must prove: "version must increase, duplicate
 * tag → 409, the `"placeholder"` refusal".
 *
 * The placeholder is the one worth stating plainly: `GITHUB_RELEASE_TOKEN` carries the literal
 * `"xxx"` on the NAS today (decision 8), and §5 says every mutating handler refuses with
 * `409 { code: "no-write-token" }` with anything but a real token — a draft included, so the
 * editor is refused once and loudly rather than three clicks later at publish.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetConfirmTokenStateForTests } from "../../functions/_lib/release-confirm";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as createDraft } from "../../functions/api/admin/releases/drafts/index";
import {
  onRequestDelete as deleteDraft,
  onRequestPut as updateDraft,
} from "../../functions/api/admin/releases/drafts/[id]/index";
import type { ReleaseDraft } from "../../shared/releases-contract";
import { FakeGitHub } from "../helpers/fake-github";
import { releasesFetch } from "../helpers/releases-api";
import { panelMemberRow, releasesDb, type ReleasesDb } from "../helpers/releases-write";
import {
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "owner@example.com";
const REPO = "CedrickGD/RazorReaper";
const RELEASES = `GET /repos/${REPO}/releases`;

const NOW = "2026-09-01T10:00:00.000Z";

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    version: "1.5.4",
    tag: "v1.5.4",
    title: "RazorReaper 1.5.4",
    notes_customer: "One calm bullet",
    notes_full_md: "",
    commit_message: "release: 1.5.4",
    mandatory: 0,
    prerelease: 0,
    status: "draft",
    github_release_id: null,
    github_run_id: null,
    asset_name: null,
    asset_size: null,
    created_by: EMAIL,
    created_at: NOW,
    updated_at: NOW,
    published_at: null,
    ...overrides,
  };
}

let github: FakeGitHub;

beforeAll(async () => {
  await getTestAccessSigner();
});

beforeEach(() => {
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
  github = new FakeGitHub();
  github.on(RELEASES, {
    body: [
      {
        id: 900,
        tag_name: "v1.5.3",
        name: "RazorReaper 1.5.3",
        draft: false,
        prerelease: false,
        assets: [],
      },
    ],
  });
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
});

function env(store: ReleasesDb, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, {
    DB: store.db,
    GITHUB_RELEASE_TOKEN: "github_pat_write",
    JWT_SECRET: "draft-test-secret",
    ...overrides,
  });
}

async function call(
  handler: (context: {
    request: Request;
    env: RuntimeEnv;
    params: { id: string };
  }) => Promise<Response>,
  store: ReleasesDb,
  options: { path: string; method?: string; json?: unknown; id?: string } & {
    envOverrides?: Partial<RuntimeEnv>;
  },
): Promise<Response> {
  return handler({
    request: createSyntheticRequest({
      path: options.path,
      method: options.method,
      json: options.json,
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: env(store, options.envOverrides ?? {}),
    params: { id: options.id ?? "7" },
  });
}

describe("POST /api/admin/releases/drafts", () => {
  it("creates a draft with §6's defaults", async () => {
    const store = releasesDb({ draft: null, member: panelMemberRow(EMAIL, "owner") });
    const response = await call(createDraft, store, {
      path: "/api/admin/releases/drafts",
      json: { version: "1.5.4" },
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { ok: boolean; draft: ReleaseDraft };
    expect(payload.ok).toBe(true);
    expect(payload.draft).toMatchObject({
      version: "1.5.4",
      tag: "v1.5.4",
      title: "RazorReaper 1.5.4",
      commitMessage: "release: 1.5.4",
      status: "draft",
      createdBy: EMAIL,
    });
  });

  it("writes both audit rows", async () => {
    const store = releasesDb({ draft: null, member: panelMemberRow(EMAIL, "owner") });
    await call(createDraft, store, {
      path: "/api/admin/releases/drafts",
      json: { version: "1.5.4" },
    });

    expect(store.events().map((event) => event.kind)).toEqual(["draft_created"]);
    expect(store.audits()).toEqual([
      {
        actor: EMAIL,
        target: "v1.5.4",
        action: "release.draft.create",
        detail: "Draft v1.5.4 created.",
      },
    ]);
  });

  it("refuses a version that is not newer than the latest published release", async () => {
    const store = releasesDb({ draft: null, member: panelMemberRow(EMAIL, "owner") });
    const response = await call(createDraft, store, {
      path: "/api/admin/releases/drafts",
      json: { version: "1.5.3" },
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("1.5.3");
    expect(store.draft()).toBeNull();
  });

  it("409s a tag another draft already holds", async () => {
    const store = releasesDb({ draft: draftRow(), member: panelMemberRow(EMAIL, "owner") });
    const response = await call(createDraft, store, {
      path: "/api/admin/releases/drafts",
      json: { version: "1.5.4" },
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("v1.5.4");
  });

  it("refuses a placeholder token with no-write-token, before any GitHub call", async () => {
    const store = releasesDb({ draft: null, member: panelMemberRow(EMAIL, "owner") });
    const response = await call(createDraft, store, {
      path: "/api/admin/releases/drafts",
      json: { version: "1.5.4" },
      envOverrides: { GITHUB_RELEASE_TOKEN: "xxx" },
    });

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { code: string; error: string };
    expect(payload.code).toBe("no-write-token");
    expect(payload.error).toContain("GITHUB_RELEASE_TOKEN");
    expect(payload.error).not.toContain("xxx");
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a version that is not a 3-part number", async () => {
    const store = releasesDb({ draft: null, member: panelMemberRow(EMAIL, "owner") });
    const response = await call(createDraft, store, {
      path: "/api/admin/releases/drafts",
      json: { version: "1.5" },
    });
    expect(response.status).toBe(400);
  });

  it("refuses a seat without releases.write", async () => {
    const store = releasesDb({ draft: null, member: panelMemberRow(EMAIL, "support") });
    const response = await call(createDraft, store, {
      path: "/api/admin/releases/drafts",
      json: { version: "1.5.4" },
    });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });
});

describe("PUT /api/admin/releases/drafts/:id", () => {
  it("applies a partial update and moves updated_at", async () => {
    const store = releasesDb({ draft: draftRow(), member: panelMemberRow(EMAIL, "owner") });
    const response = await call(updateDraft, store, {
      path: "/api/admin/releases/drafts/7",
      method: "PUT",
      json: { notesCustomer: "A calmer bullet", expectedUpdatedAt: NOW },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { draft: ReleaseDraft };
    expect(payload.draft.notesCustomer).toBe("A calmer bullet");
    expect(payload.draft.updatedAt).not.toBe(NOW);
    expect(store.events().map((event) => event.kind)).toEqual(["draft_updated"]);
    expect(store.audits()[0]?.action).toBe("release.draft.update");
  });

  it("409s a stale expectedUpdatedAt and hands the row back", async () => {
    const store = releasesDb({ draft: draftRow(), member: panelMemberRow(EMAIL, "owner") });
    const response = await call(updateDraft, store, {
      path: "/api/admin/releases/drafts/7",
      method: "PUT",
      json: { title: "Something else", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
    });

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { code: string; draft: ReleaseDraft };
    expect(payload.code).toBe("stale");
    expect(payload.draft.title).toBe("RazorReaper 1.5.4");
    expect(store.events()).toHaveLength(0);
  });

  it("refuses a published draft — GitHub is the source of truth once it is out", async () => {
    const store = releasesDb({
      draft: draftRow({ status: "published" }),
      member: panelMemberRow(EMAIL, "owner"),
    });
    const response = await call(updateDraft, store, {
      path: "/api/admin/releases/drafts/7",
      method: "PUT",
      json: { title: "Renamed" },
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "status-mismatch" });
  });

  it("404s a draft that is not there", async () => {
    const store = releasesDb({ draft: null, member: panelMemberRow(EMAIL, "owner") });
    const response = await call(updateDraft, store, {
      path: "/api/admin/releases/drafts/7",
      method: "PUT",
      json: { title: "Renamed" },
    });
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/admin/releases/drafts/:id", () => {
  it.each([["draft"], ["failed"]])("drops a %s row and never calls GitHub", async (status) => {
    const store = releasesDb({
      draft: draftRow({ status }),
      member: panelMemberRow(EMAIL, "owner"),
    });
    const response = await call(deleteDraft, store, {
      path: "/api/admin/releases/drafts/7",
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(store.draft()).toBeNull();
    expect(store.events().map((event) => event.kind)).toEqual(["draft_deleted"]);
    expect(store.audits()[0]?.action).toBe("release.draft.delete");
    expect(github.calls).toHaveLength(0);
  });

  it.each([["building"], ["built"], ["published"]])("refuses a %s row", async (status) => {
    const store = releasesDb({
      draft: draftRow({ status }),
      member: panelMemberRow(EMAIL, "owner"),
    });
    const response = await call(deleteDraft, store, {
      path: "/api/admin/releases/drafts/7",
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    expect(store.draft()).not.toBeNull();
  });
});
