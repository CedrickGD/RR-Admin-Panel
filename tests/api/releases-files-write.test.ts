/**
 * `PUT /api/admin/releases/files` — the Files tab's commit. Design §6, §11 and §12
 * ("`api/releases-files` — denylist incl. `update.xml`, refused for an admin seat").
 *
 * The denylist is the point of the suite: `update.xml` is refused **even for an owner**, because a
 * free-text editor over the file that decides what every customer downloads is exactly the
 * ungoverned rollback path §6 removes — Publish and Make current own it, and they validate the tag
 * and the asset first. `.github/workflows/**` is the other special case: editable, but only with
 * its own confirmation and only on the token that carries the Workflows scope.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetConfirmTokenStateForTests } from "../../functions/_lib/release-confirm";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPut as commitFile } from "../../functions/api/admin/releases/files";
import type { FilePutResponse } from "../../shared/releases-contract";
import { FakeGitHub, base64 } from "../helpers/fake-github";
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

const ISS_PATH = "installer/RazorReaper.iss";
const WORKFLOW_PATH = ".github/workflows/build-installer.yml";

const ISS_BLOB = `GET /repos/${REPO}/contents/${ISS_PATH}`;
const WORKFLOW_BLOB = `GET /repos/${REPO}/contents/${WORKFLOW_PATH}`;
const REF = `GET /repos/${REPO}/git/ref/heads/master`;
const COMMIT_READ = `GET /repos/${REPO}/git/commits/head1`;
const BLOBS = `POST /repos/${REPO}/git/blobs`;
const TREES = `POST /repos/${REPO}/git/trees`;
const COMMITS = `POST /repos/${REPO}/git/commits`;
const PATCH_REF = `PATCH /repos/${REPO}/git/refs/heads/master`;

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

function wireBlob(key: string, path: string, content: string, sha: string): void {
  github.on(key, {
    body: { path, sha, size: content.length, encoding: "base64", content: base64(content) },
  });
}

function wireGitData(): void {
  github.on(REF, { body: { object: { sha: "head1" } } });
  github.on(COMMIT_READ, { body: { tree: { sha: "base1" } } });
  github.on(BLOBS, { body: { sha: "newblob" } });
  github.on(TREES, { body: { sha: "tree1" } });
  github.on(COMMITS, { body: { sha: "commitfile" } });
  github.on(PATCH_REF, { body: {} });
}

function store(role: "owner" | "admin" = "owner"): ReleasesDb {
  return releasesDb({ draft: null, member: panelMemberRow(EMAIL, role) });
}

function env(db: ReleasesDb, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, {
    DB: db.db,
    GITHUB_RELEASE_TOKEN: "github_pat_write",
    JWT_SECRET: "files-write-secret",
    ...overrides,
  });
}

async function put(
  runtime: RuntimeEnv,
  body: Record<string, unknown>,
  options: { token?: string | null; subject?: string } = {},
): Promise<Response> {
  const confirmToken =
    options.token === null
      ? undefined
      : (options.token ??
        (await confirmTokenFor(
          runtime,
          "commit",
          options.subject ?? String(body.path ?? ""),
          EMAIL,
        )));
  return commitFile({
    request: createSyntheticRequest({
      path: "/api/admin/releases/files",
      method: "PUT",
      json: { ...body, confirmToken },
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: runtime,
  });
}

describe("PUT /api/admin/releases/files", () => {
  it("commits the file through the Git Data sequence and records both audit rows", async () => {
    wireBlob(ISS_BLOB, ISS_PATH, '#define MyAppVersion "1.5.3"', "iss-sha");
    wireGitData();
    const db = store();
    const runtime = env(db);

    const response = await put(runtime, {
      path: ISS_PATH,
      content: '#define MyAppVersion "1.5.4"',
      baseSha: "iss-sha",
      commitMessage: "installer: bump the define",
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as FilePutResponse).toEqual({
      ok: true,
      commitSha: "commitfile",
      path: ISS_PATH,
      sha: "newblob",
    });
    expect(github.keys()).toEqual([ISS_BLOB, REF, COMMIT_READ, BLOBS, TREES, COMMITS, PATCH_REF]);
    expect(github.callsFor(COMMITS)[0]?.body).toMatchObject({
      message: "installer: bump the define",
    });
    expect(db.events()[0]).toMatchObject({ kind: "file_committed", draftId: null });
    expect(db.audits()[0]?.action).toBe("release.file.commit");
  });

  it("409s when the blob moved under the editor, before it writes anything", async () => {
    wireBlob(ISS_BLOB, ISS_PATH, '#define MyAppVersion "1.5.4"', "someone-elses-sha");
    wireGitData();
    const db = store();

    const response = await put(env(db), {
      path: ISS_PATH,
      content: "whatever",
      baseSha: "iss-sha",
      commitMessage: "installer: bump the define",
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "stale" });
    expect(github.keys()).not.toContain(PATCH_REF);
    expect(db.events()).toHaveLength(0);
  });

  it.each([
    ["update.xml", "update.xml", "Make current"],
    ["./update.xml", "update.xml", "Make current"],
    ["Self-Sign/RazorReaperCodeSign.pfx", "pfx", "Signing material"],
    ["rr-api.env", "env", "Environment files"],
    ["RazorReaper/appsettings.json", "appsettings", "Application settings"],
    [".git/config", "git", "Git's own directory"],
  ])("refuses %s with denied-path and no GitHub call", async (path, _label, fragment) => {
    const db = store();
    const response = await put(env(db), {
      path,
      content: "anything",
      baseSha: "sha",
      commitMessage: "no",
    });

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { code: string; error: string };
    expect(payload.code).toBe("denied-path");
    expect(payload.error).toContain(fragment);
    expect(github.calls).toHaveLength(0);
    expect(db.events()).toHaveLength(0);
  });

  it("refuses a path that leaves the repository", async () => {
    const response = await put(env(store()), {
      path: "../keys/secret.txt",
      content: "anything",
      baseSha: "sha",
      commitMessage: "no",
    });
    expect(response.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a workflow without its own confirmation", async () => {
    const db = store();
    const response = await put(env(db), {
      path: WORKFLOW_PATH,
      content: "on: workflow_dispatch\n",
      baseSha: "wf-sha",
      commitMessage: "ci: tweak",
    });

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { code: string; error: string };
    expect(payload.code).toBe("denied-path");
    expect(payload.error).toContain("own confirmation");
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a workflow on a token that does not carry the Workflows scope", async () => {
    const db = store();
    const response = await put(
      env(db, { GITHUB_RELEASE_TOKEN: "", GITHUB_TOKEN: "ghp_readonly" }),
      {
        path: WORKFLOW_PATH,
        content: "on: workflow_dispatch\n",
        baseSha: "wf-sha",
        commitMessage: "ci: tweak",
        workflowsConfirm: true,
      },
    );

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { code: string; error: string };
    expect(payload.code).toBe("denied-path");
    expect(payload.error).toContain("GITHUB_RELEASE_TOKEN");
    expect(payload.error).not.toContain("ghp_readonly");
    expect(github.calls).toHaveLength(0);
  });

  it("commits a workflow with the second confirmation and the release token", async () => {
    wireBlob(WORKFLOW_BLOB, WORKFLOW_PATH, "on: workflow_dispatch\n", "wf-sha");
    wireGitData();
    const db = store();

    const response = await put(env(db), {
      path: WORKFLOW_PATH,
      content: "on: workflow_dispatch\njobs: {}\n",
      baseSha: "wf-sha",
      commitMessage: "ci: tweak",
      workflowsConfirm: true,
    });

    expect(response.status).toBe(200);
    expect(github.callsFor(PATCH_REF)[0]?.body).toEqual({ sha: "commitfile", force: false });
  });

  it("refuses an admin seat: files are owner-only (decision 2)", async () => {
    const db = store("admin");
    const response = await put(env(db), {
      path: ISS_PATH,
      content: "anything",
      baseSha: "iss-sha",
      commitMessage: "installer: bump",
    });

    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a confirmation minted for another path", async () => {
    wireBlob(ISS_BLOB, ISS_PATH, "x", "iss-sha");
    const db = store();
    const runtime = env(db);
    const response = await put(
      runtime,
      { path: ISS_PATH, content: "y", baseSha: "iss-sha", commitMessage: "installer: bump" },
      { subject: "README.md" },
    );

    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a file over the 512 KB the panel edits", async () => {
    const db = store();
    const response = await put(env(db), {
      path: ISS_PATH,
      content: "x".repeat(512 * 1024 + 1),
      baseSha: "iss-sha",
      commitMessage: "installer: bump",
    });

    expect(response.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses without a write token", async () => {
    const db = store();
    const response = await put(env(db, { GITHUB_RELEASE_TOKEN: "xxx" }), {
      path: ISS_PATH,
      content: "y",
      baseSha: "iss-sha",
      commitMessage: "installer: bump",
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "no-write-token" });
    expect(github.calls).toHaveLength(0);
  });
});
