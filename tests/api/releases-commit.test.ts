/**
 * `commitFiles` — the atomic multi-file commit every panel write to the repo goes through.
 * Design §5 and §12 ("the six-call order, `force: false`, one retry, `409` when a path changed
 * under it"). Nothing here touches the network: the client takes its `fetch` from `FakeGitHub`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GithubApiError,
  createGithubClient,
  resetGithubReleaseStateForTests,
} from "../../functions/_lib/github-release";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { FakeGitHub, base64 } from "../helpers/fake-github";

const REPO = "CedrickGD/RazorReaper";
const WRITE_ENV: RuntimeEnv = { GITHUB_RELEASE_TOKEN: "github_pat_write" };

const REF = `GET /repos/${REPO}/git/ref/heads/master`;
const COMMIT_READ = (sha: string) => `GET /repos/${REPO}/git/commits/${sha}`;
const BLOBS = `POST /repos/${REPO}/git/blobs`;
const TREES = `POST /repos/${REPO}/git/trees`;
const COMMITS = `POST /repos/${REPO}/git/commits`;
const PATCH_REF = `PATCH /repos/${REPO}/git/refs/heads/master`;

/** The exact order §5 lists, for a two-file commit. */
const SEQUENCE = [REF, COMMIT_READ("head1"), BLOBS, BLOBS, TREES, COMMITS, PATCH_REF];

const FILES = [
  { path: "RazorReaper/RazorReaper.csproj", content: "<Project>1.5.4</Project>" },
  { path: "installer/RazorReaper.iss", content: '#define MyAppVersion "1.5.4"' },
];

let github: FakeGitHub;

function api(env: RuntimeEnv = WRITE_ENV) {
  return createGithubClient(env, { fetch: github.fetch, repo: REPO });
}

/** The happy path for one attempt: HEAD `head`, blobs, tree, commit `commitSha`. */
function wireGitData(head: string, commitSha: string, treeSha = `tree-${commitSha}`): void {
  github.on(REF, { body: { object: { sha: head } } });
  github.on(COMMIT_READ(head), { body: { tree: { sha: `base-${head}` } } });
  let blob = 0;
  github.on(BLOBS, () => {
    blob += 1;
    return { body: { sha: `blob${blob}` } };
  });
  github.on(TREES, { body: { sha: treeSha } });
  github.on(COMMITS, { body: { sha: commitSha } });
}

beforeEach(() => {
  resetGithubReleaseStateForTests();
  github = new FakeGitHub();
});

afterEach(() => {
  resetGithubReleaseStateForTests();
});

describe("commitFiles — the six calls", () => {
  it("runs them in the design's order and returns the new commit", async () => {
    wireGitData("head1", "commit1");
    github.on(PATCH_REF, { body: { object: { sha: "commit1" } } });

    const result = await api().commitFiles({ files: FILES, message: "release: 1.5.4" });

    expect(github.keys()).toEqual(SEQUENCE);
    expect(result).toEqual({
      commitSha: "commit1",
      treeSha: "tree-commit1",
      parentSha: "head1",
      blobShas: {
        "RazorReaper/RazorReaper.csproj": "blob1",
        "installer/RazorReaper.iss": "blob2",
      },
      retried: false,
    });
    expect(github.unexpected).toEqual([]);
  });

  it("reads HEAD before it writes anything — nothing precedes step 1", async () => {
    wireGitData("head1", "commit1");
    github.on(PATCH_REF, { body: {} });
    await api().commitFiles({ files: FILES, message: "release: 1.5.4" });
    expect(github.keys()[0]).toBe(REF);
  });

  it("sends utf-8 blobs, a based tree of 100644 entries and a single-parent commit", async () => {
    wireGitData("head1", "commit1");
    github.on(PATCH_REF, { body: {} });
    await api().commitFiles({ files: FILES, message: "release: 1.5.4" });

    expect(github.callsFor(BLOBS).map((call) => call.body)).toEqual([
      { content: FILES[0]!.content, encoding: "utf-8" },
      { content: FILES[1]!.content, encoding: "utf-8" },
    ]);
    expect(github.callsFor(TREES)[0]?.body).toEqual({
      base_tree: "base-head1",
      tree: [
        { path: FILES[0]!.path, mode: "100644", type: "blob", sha: "blob1" },
        { path: FILES[1]!.path, mode: "100644", type: "blob", sha: "blob2" },
      ],
    });
    expect(github.callsFor(COMMITS)[0]?.body).toEqual({
      message: "release: 1.5.4",
      tree: "tree-commit1",
      parents: ["head1"],
    });
  });

  it("moves the ref with force: false — the concurrency guard is never optional", async () => {
    wireGitData("head1", "commit1");
    github.on(PATCH_REF, { body: {} });
    await api().commitFiles({ files: FILES, message: "release: 1.5.4" });
    expect(github.callsFor(PATCH_REF)[0]?.body).toEqual({ sha: "commit1", force: false });
  });

  it("refuses without a write token, before a single call goes out", async () => {
    const refusal = (await api({ GITHUB_TOKEN: "ghp_read" })
      .commitFiles({ files: FILES, message: "release: 1.5.4" })
      .catch((error: unknown) => error)) as GithubApiError;
    expect(refusal.status).toBe(409);
    expect(refusal.code).toBe("no-write-token");
    expect(github.calls).toHaveLength(0);
  });

  it("refuses an empty commit", async () => {
    const refusal = (await api()
      .commitFiles({ files: [], message: "release: 1.5.4" })
      .catch((error: unknown) => error)) as GithubApiError;
    expect(refusal.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });
});

describe("commitFiles — the one retry", () => {
  /** A 422 is what GitHub answers a non-fast-forward `PATCH …/git/refs/*` with. */
  const NOT_FAST_FORWARD = {
    status: 422,
    body: { message: "Update is not a fast forward" },
  };

  it("re-reads HEAD, rebuilds on the new base and PATCHes again", async () => {
    github.once(REF, { body: { object: { sha: "head1" } } });
    github.on(REF, { body: { object: { sha: "head2" } } });
    github.on(COMMIT_READ("head1"), { body: { tree: { sha: "base-head1" } } });
    github.on(COMMIT_READ("head2"), { body: { tree: { sha: "base-head2" } } });
    let blob = 0;
    github.on(BLOBS, () => ({ body: { sha: `blob${(blob += 1)}` } }));
    github.on(TREES, { body: { sha: "tree2" } });
    github.on(COMMITS, { body: { sha: "commit2" } });
    github.once(PATCH_REF, NOT_FAST_FORWARD);
    github.on(PATCH_REF, { body: {} });

    const result = await api().commitFiles({ files: FILES, message: "release: 1.5.4" });

    expect(result).toMatchObject({ commitSha: "commit2", parentSha: "head2", retried: true });
    // The whole sequence runs again — blobs and tree are rebuilt on the *new* base, not reused.
    expect(github.keys()).toEqual([
      ...SEQUENCE,
      REF,
      COMMIT_READ("head2"),
      BLOBS,
      BLOBS,
      TREES,
      COMMITS,
      PATCH_REF,
    ]);
    expect(github.callsFor(TREES)[1]?.body).toMatchObject({ base_tree: "base-head2" });
    expect(github.callsFor(COMMITS)[1]?.body).toMatchObject({ parents: ["head2"] });
  });

  it("gives up after a second non-fast-forward — no third attempt, no backoff", async () => {
    wireGitData("head1", "commit1");
    github.on(PATCH_REF, NOT_FAST_FORWARD);

    const refusal = (await api()
      .commitFiles({ files: FILES, message: "release: 1.5.4" })
      .catch((error: unknown) => error)) as GithubApiError;

    expect(refusal.status).toBe(409);
    expect(refusal.code).toBe("stale");
    expect(refusal.message).toBe(
      "master moved twice while this was being written — reload and retry.",
    );
    expect(github.callsFor(PATCH_REF)).toHaveLength(2);
  });

  it("abandons the retry when a guarded path changed on the new HEAD", async () => {
    github.once(REF, { body: { object: { sha: "head1" } } });
    github.on(REF, { body: { object: { sha: "head2" } } });
    github.on(COMMIT_READ("head1"), { body: { tree: { sha: "base-head1" } } });
    github.on(COMMIT_READ("head2"), { body: { tree: { sha: "base-head2" } } });
    github.on(BLOBS, { body: { sha: "blob1" } });
    github.on(TREES, { body: { sha: "tree1" } });
    github.on(COMMITS, { body: { sha: "commit1" } });
    github.once(PATCH_REF, NOT_FAST_FORWARD);
    // update.xml was rewritten by whoever moved master: the retry's content is now based on a
    // blob that no longer exists, so it must not be replayed onto the new head.
    github.on(`GET /repos/${REPO}/contents/update.xml`, {
      body: {
        path: "update.xml",
        sha: "blob-new",
        size: 20,
        encoding: "base64",
        content: base64("x"),
      },
    });

    const refusal = (await api()
      .commitFiles({
        files: [{ path: "update.xml", content: "<item/>", baseSha: "blob-old" }],
        message: "release: point update.xml at v1.5.3",
      })
      .catch((error: unknown) => error)) as GithubApiError;

    expect(refusal.status).toBe(409);
    expect(refusal.code).toBe("stale");
    expect(refusal.message).toBe(
      "update.xml changed on master while this commit was being written — reload and retry.",
    );
    // Abandoned before anything was rebuilt: exactly one PATCH, and no second blob.
    expect(github.callsFor(PATCH_REF)).toHaveLength(1);
    expect(github.callsFor(BLOBS)).toHaveLength(1);
  });

  it("retries when the guarded path is untouched on the new HEAD", async () => {
    github.once(REF, { body: { object: { sha: "head1" } } });
    github.on(REF, { body: { object: { sha: "head2" } } });
    github.on(COMMIT_READ("head1"), { body: { tree: { sha: "base-head1" } } });
    github.on(COMMIT_READ("head2"), { body: { tree: { sha: "base-head2" } } });
    github.on(BLOBS, { body: { sha: "blob1" } });
    github.on(TREES, { body: { sha: "tree1" } });
    github.on(COMMITS, { body: { sha: "commit1" } });
    github.once(PATCH_REF, NOT_FAST_FORWARD);
    github.on(PATCH_REF, { body: {} });
    github.on(`GET /repos/${REPO}/contents/update.xml`, {
      body: {
        path: "update.xml",
        sha: "blob-old",
        size: 20,
        encoding: "base64",
        content: base64("x"),
      },
    });

    const result = await api().commitFiles({
      files: [{ path: "update.xml", content: "<item/>", baseSha: "blob-old" }],
      message: "release: point update.xml at v1.5.3",
    });
    expect(result.retried).toBe(true);
    expect(github.callsFor(PATCH_REF)).toHaveLength(2);
  });

  it("treats a baseSha of null as must-not-exist", async () => {
    github.once(REF, { body: { object: { sha: "head1" } } });
    github.on(REF, { body: { object: { sha: "head2" } } });
    github.on(COMMIT_READ("head1"), { body: { tree: { sha: "base-head1" } } });
    github.on(COMMIT_READ("head2"), { body: { tree: { sha: "base-head2" } } });
    github.on(BLOBS, { body: { sha: "blob1" } });
    github.on(TREES, { body: { sha: "tree1" } });
    github.on(COMMITS, { body: { sha: "commit1" } });
    github.once(PATCH_REF, NOT_FAST_FORWARD);
    github.on(PATCH_REF, { body: {} });
    github.on(`GET /repos/${REPO}/contents/docs/new.md`, { status: 404, body: {} });

    await expect(
      api().commitFiles({
        files: [{ path: "docs/new.md", content: "# new", baseSha: null }],
        message: "docs: add new",
      }),
    ).resolves.toMatchObject({ retried: true });
  });

  it("lets a caller's own precondition abandon the retry", async () => {
    github.once(REF, { body: { object: { sha: "head1" } } });
    github.on(REF, { body: { object: { sha: "head2" } } });
    github.on(COMMIT_READ("head1"), { body: { tree: { sha: "base-head1" } } });
    github.on(COMMIT_READ("head2"), { body: { tree: { sha: "base-head2" } } });
    github.on(BLOBS, { body: { sha: "blob1" } });
    github.on(TREES, { body: { sha: "tree1" } });
    github.on(COMMITS, { body: { sha: "commit1" } });
    github.once(PATCH_REF, NOT_FAST_FORWARD);

    const seen: string[] = [];
    const refusal = (await api()
      .commitFiles({
        files: FILES,
        message: "release: 1.5.4",
        verify: (headSha) => {
          seen.push(headSha);
          return "master already carries 1.5.4 — reload the draft.";
        },
      })
      .catch((error: unknown) => error)) as GithubApiError;

    expect(seen).toEqual(["head2"]);
    expect(refusal.status).toBe(409);
    expect(refusal.code).toBe("stale");
    expect(refusal.message).toBe("master already carries 1.5.4 — reload the draft.");
  });

  it("does not verify anything on the first attempt", async () => {
    wireGitData("head1", "commit1");
    github.on(PATCH_REF, { body: {} });
    let verified = 0;
    await api().commitFiles({
      files: [{ path: "update.xml", content: "<item/>", baseSha: "blob-old" }],
      message: "release: 1.5.4",
      verify: () => {
        verified += 1;
        return null;
      },
    });
    expect(verified).toBe(0);
    expect(github.keys()).not.toContain(`GET /repos/${REPO}/contents/update.xml`);
  });

  it("never retries a failure that is not a non-fast-forward", async () => {
    wireGitData("head1", "commit1");
    github.on(PATCH_REF, { status: 401, body: {} });

    const failure = (await api()
      .commitFiles({ files: FILES, message: "release: 1.5.4" })
      .catch((error: unknown) => error)) as GithubApiError;

    expect(failure.status).toBe(502);
    expect(failure.message).toBe("GitHub rejected the panel's token.");
    expect(github.callsFor(PATCH_REF)).toHaveLength(1);
  });

  it("does not reuse a cached HEAD — step 1 exists to prevent exactly that", async () => {
    github.once(REF, { body: { object: { sha: "head1" } }, headers: { etag: '"ref-1"' } });
    github.on(REF, (call) => {
      // A replayed ETag here would let GitHub answer 304 and hand back the stale parent.
      expect(call.headers["if-none-match"]).toBeUndefined();
      return { body: { object: { sha: "head2" } } };
    });
    github.on(COMMIT_READ("head1"), { body: { tree: { sha: "base-head1" } } });
    github.on(COMMIT_READ("head2"), { body: { tree: { sha: "base-head2" } } });
    github.on(BLOBS, { body: { sha: "blob1" } });
    github.on(TREES, { body: { sha: "tree1" } });
    github.on(COMMITS, { body: { sha: "commit1" } });
    github.on(PATCH_REF, { body: {} });

    const first = await api().commitFiles({ files: [FILES[0]!], message: "one" });
    const second = await api().commitFiles({ files: [FILES[0]!], message: "two" });
    expect(first.parentSha).toBe("head1");
    expect(second.parentSha).toBe("head2");
  });
});
