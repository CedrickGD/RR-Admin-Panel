/**
 * `functions/_lib/github-release.ts` — token resolution, the ETag/memoisation/stale machinery,
 * rate-limit tracking and the error mapping §5 specifies. Every request goes through `FakeGitHub`;
 * nothing here touches the network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GITHUB_API_VERSION,
  GITHUB_USER_AGENT,
  GithubApiError,
  RATE_LIMIT_FLOOR,
  apiErrorBody,
  createGithubClient,
  isGithubApiError,
  parseWorkflowDispatchInputs,
  parseWorkflowReleaseTrigger,
  resetGithubReleaseStateForTests,
  resolveGithubToken,
  tokenStatus,
} from "../../functions/_lib/github-release";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { FakeGitHub, base64 } from "../helpers/fake-github";

const REPO = "CedrickGD/RazorReaper";
const WRITE_TOKEN = "github_pat_11ABCDEF_writeonly";
const READ_TOKEN = "ghp_readonlyreadonly";
const PLACEHOLDER = "xxx";

const RELEASES_KEY = `GET /repos/${REPO}/releases`;

function client(env: RuntimeEnv, github: FakeGitHub, now?: () => number) {
  return createGithubClient(env, { fetch: github.fetch, repo: REPO, now });
}

let github: FakeGitHub;

beforeEach(() => {
  resetGithubReleaseStateForTests();
  github = new FakeGitHub();
});

afterEach(() => {
  resetGithubReleaseStateForTests();
});

describe("token resolution", () => {
  it("prefers GITHUB_RELEASE_TOKEN and reports mode write", () => {
    const status = tokenStatus({ GITHUB_RELEASE_TOKEN: WRITE_TOKEN, GITHUB_TOKEN: READ_TOKEN });
    expect(status).toMatchObject({
      mode: "write",
      source: "GITHUB_RELEASE_TOKEN",
      canWrite: true,
      message: null,
    });
    expect(resolveGithubToken({ GITHUB_RELEASE_TOKEN: WRITE_TOKEN }).token).toBe(WRITE_TOKEN);
  });

  it("accepts both fine-grained and classic prefixes", () => {
    expect(tokenStatus({ GITHUB_RELEASE_TOKEN: "ghp_classic_value" }).mode).toBe("write");
    expect(tokenStatus({ GITHUB_RELEASE_TOKEN: "github_pat_value" }).mode).toBe("write");
    // Whitespace around a secret pasted into an env file must not decide the mode.
    expect(tokenStatus({ GITHUB_RELEASE_TOKEN: `  ${WRITE_TOKEN}  ` }).mode).toBe("write");
  });

  it("falls back to the read-only GITHUB_TOKEN", () => {
    expect(tokenStatus({ GITHUB_TOKEN: READ_TOKEN })).toMatchObject({
      mode: "read-only",
      source: "GITHUB_TOKEN",
      canWrite: false,
    });
  });

  it("reports missing when neither variable carries a token", () => {
    expect(tokenStatus({})).toMatchObject({ mode: "missing", source: null, canWrite: false });
    expect(tokenStatus({ GITHUB_TOKEN: "   " }).mode).toBe("missing");
  });

  it("treats a non-token GITHUB_RELEASE_TOKEN as the placeholder decision 8 describes", () => {
    const status = tokenStatus({ GITHUB_RELEASE_TOKEN: PLACEHOLDER });
    expect(status.mode).toBe("placeholder");
    expect(status.canWrite).toBe(false);
    // The status line has to name the variable the owner must fix, and only the variable.
    expect(status.source).toBe("GITHUB_RELEASE_TOKEN");
    expect(status.message).toContain("GITHUB_RELEASE_TOKEN");
    expect(status.message).not.toContain(PLACEHOLDER);
  });

  it("still reads with GITHUB_TOKEN while GITHUB_RELEASE_TOKEN holds a placeholder", async () => {
    github.on(RELEASES_KEY, { body: [] });
    const env = { GITHUB_RELEASE_TOKEN: PLACEHOLDER, GITHUB_TOKEN: READ_TOKEN };
    const api = client(env, github);
    expect(api.tokenStatus().mode).toBe("placeholder");
    await api.listReleases();
    expect(github.calls[0]?.headers.authorization).toBe(`Bearer ${READ_TOKEN}`);
  });

  it("calls GitHub anonymously with no usable token at all", async () => {
    github.on(RELEASES_KEY, { body: [] });
    await client({}, github).listReleases();
    expect(github.calls[0]?.headers.authorization).toBeUndefined();
  });

  it("sends the API version and user agent on every call", async () => {
    github.on(RELEASES_KEY, { body: [] });
    await client({ GITHUB_TOKEN: READ_TOKEN }, github).listReleases();
    expect(github.calls[0]?.headers["x-github-api-version"]).toBe(GITHUB_API_VERSION);
    expect(github.calls[0]?.headers["user-agent"]).toBe(GITHUB_USER_AGENT);
  });

  it("refuses every mutation without a write token, before any request goes out", async () => {
    for (const env of [
      {},
      { GITHUB_TOKEN: READ_TOKEN },
      { GITHUB_RELEASE_TOKEN: PLACEHOLDER, GITHUB_TOKEN: READ_TOKEN },
    ] as RuntimeEnv[]) {
      const api = client(env, github);
      const refusal = await api.createRelease({ tag: "v1.5.4" }).catch((error: unknown) => error);
      expect(isGithubApiError(refusal)).toBe(true);
      expect((refusal as GithubApiError).status).toBe(409);
      expect((refusal as GithubApiError).code).toBe("no-write-token");
      expect((refusal as GithubApiError).message).not.toContain(READ_TOKEN);
    }
    expect(github.calls).toHaveLength(0);
  });

  it("never lets a token reach a status object or an error message", async () => {
    github.on(RELEASES_KEY, { status: 401, body: { message: `Bad credentials ${WRITE_TOKEN}` } });
    const api = client({ GITHUB_RELEASE_TOKEN: WRITE_TOKEN }, github);
    expect(JSON.stringify(api.tokenStatus())).not.toContain(WRITE_TOKEN);
    const failure = (await api.listReleases().catch((error: unknown) => error)) as GithubApiError;
    expect(failure.message).toBe("GitHub rejected the panel's token.");
    // Neither the token nor GitHub's own prose may travel back to the browser.
    expect(failure.message).not.toContain(WRITE_TOKEN);
    expect(failure.message).not.toContain("Bad credentials");
  });
});

describe("ETag caching and memoisation", () => {
  it("replays the stored ETag and serves the cached payload on a 304", async () => {
    let served = 0;
    github.on(RELEASES_KEY, (call) => {
      served += 1;
      if (call.headers["if-none-match"] === '"etag-1"') return { status: 304 };
      return { body: [release({ id: 1, tag_name: "v1.5.3" })], headers: { etag: '"etag-1"' } };
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);

    const first = await api.listReleases();
    const second = await api.listReleases();

    expect(served).toBe(2);
    expect(github.calls[1]?.headers["if-none-match"]).toBe('"etag-1"');
    expect(second).toEqual(first);
    // A 304 is a fresh read, not a stale one — the overview must not flag it.
    expect(api.stale).toBe(false);
  });

  it("skips the request entirely inside the memoisation window", async () => {
    github.on(RELEASES_KEY, { body: [], headers: { etag: '"etag-1"' } });
    let clock = 1_000;
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => clock);

    await api.listReleases({ memoiseMs: 60_000 });
    clock += 59_000;
    await api.listReleases({ memoiseMs: 60_000 });
    expect(github.calls).toHaveLength(1);

    clock += 2_000;
    await api.listReleases({ memoiseMs: 60_000 });
    expect(github.calls).toHaveLength(2);
  });

  it("keeps a separate cache entry per repo and per token source", async () => {
    github.on(RELEASES_KEY, { body: [], headers: { etag: '"etag-1"' } });
    await client({ GITHUB_TOKEN: READ_TOKEN }, github).listReleases();
    await client({ GITHUB_RELEASE_TOKEN: WRITE_TOKEN }, github).listReleases();
    // The second client authenticates as somebody else, so it may not inherit the first's ETag.
    expect(github.calls[1]?.headers["if-none-match"]).toBeUndefined();
  });
});

describe("rate limits and stale fallback", () => {
  it("reports the remaining budget and its reset from the response headers", async () => {
    github.on(RELEASES_KEY, {
      body: [],
      headers: { "x-ratelimit-remaining": "4321", "x-ratelimit-reset": "1780000000" },
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => 1_000);
    await api.listReleases();
    expect(api.tokenStatus().rateLimitRemaining).toBe(4321);
    expect(api.tokenStatus().rateLimitResetAt).toBe(new Date(1_780_000_000_000).toISOString());
  });

  it("serves a cached copy instead of a non-essential GET once the floor is crossed", async () => {
    github.on(RELEASES_KEY, {
      body: [release({ id: 1, tag_name: "v1.5.3" })],
      headers: {
        etag: '"etag-1"',
        "x-ratelimit-remaining": String(RATE_LIMIT_FLOOR - 1),
        "x-ratelimit-reset": "1780000000",
      },
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => 1_000);
    const first = await api.listReleases();
    expect(api.stale).toBe(false);

    const second = await api.listReleases();
    expect(github.calls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(api.stale).toBe(true);
  });

  it("refuses a non-essential GET below the floor when nothing is cached", async () => {
    github.on(`GET /repos/${REPO}/actions/workflows`, {
      body: { workflows: [] },
      headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "1780000000" },
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => 1_000);
    await api.listWorkflows();

    const refusal = (await api.listReleases().catch((e: unknown) => e)) as GithubApiError;
    expect(refusal.status).toBe(429);
    expect(refusal.code).toBe("rate-limited");
    expect(github.calls).toHaveLength(1);
  });

  it("lets an essential read through below the floor — a write may not stop half-done", async () => {
    github.on(`GET /repos/${REPO}/actions/workflows`, {
      body: { workflows: [] },
      headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "1780000000" },
    });
    github.on(`GET /repos/${REPO}/git/ref/heads/master`, { body: { object: { sha: "head1" } } });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => 1_000);
    await api.listWorkflows();
    await expect(api.getRef()).resolves.toBe("head1");
  });

  it("forgets the snapshot once the reset time has passed", async () => {
    github.on(RELEASES_KEY, {
      body: [],
      headers: { "x-ratelimit-remaining": "2", "x-ratelimit-reset": "2000" },
    });
    let clock = 1_000;
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => clock);
    await api.listReleases();
    expect(api.tokenStatus().rateLimitRemaining).toBe(2);
    clock = 2_000_001;
    expect(api.tokenStatus().rateLimitRemaining).toBeNull();
  });

  it("falls back to cache when GitHub 5xxs or is unreachable, and 502s when it cannot", async () => {
    github.once(RELEASES_KEY, { body: [release({ id: 9, tag_name: "v1.5.3" })] });
    github.on(RELEASES_KEY, { status: 503 });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => 1_000);
    const first = await api.listReleases();
    expect(await api.listReleases()).toEqual(first);
    expect(api.stale).toBe(true);

    resetGithubReleaseStateForTests();
    const cold = client({ GITHUB_TOKEN: READ_TOKEN }, new FakeGitHub());
    const failure = (await cold.listReleases().catch((e: unknown) => e)) as GithubApiError;
    expect(failure.status).toBe(502);
    expect(failure.message).toBe("GitHub is unreachable.");
  });

  // The Workflows tab reads every workflow file to learn its dispatch inputs. `getContent`
  // defaults to essential (publish reads through it mid-sequence), so this call site has to opt
  // out explicitly — otherwise a browser parked on that tab spends the hour a publish needs,
  // which is the exact scenario §5's floor exists to stop.
  it("throttles the Workflows tab's per-file reads below the floor", async () => {
    const workflowsKey = `GET /repos/${REPO}/actions/workflows`;
    const buildKey = `GET /repos/${REPO}/contents/.github/workflows/build-installer.yml`;
    const yaml = "on:\n  workflow_dispatch:\n    inputs:\n      version:\n        required: true\n";
    const listBody = {
      workflows: [
        { id: 1, name: "Build", path: ".github/workflows/build-installer.yml", state: "active" },
      ],
    };
    const healthy = { "x-ratelimit-remaining": "5000", "x-ratelimit-reset": "1780000000" };
    const exhausted = { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "1780000000" };
    github.once(workflowsKey, { body: listBody, headers: healthy });
    github.on(workflowsKey, { body: listBody, headers: exhausted });
    github.on(buildKey, {
      body: { path: "x", sha: "s", size: 10, encoding: "base64", content: base64(yaml) },
      headers: healthy,
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => 1_000);

    // First pass, budget healthy: the file is read and cached, inputs come back parsed.
    const first = await api.listWorkflows({ withInputs: true });
    expect(first[0]?.inputs.map((input) => input.name)).toContain("version");
    expect(github.callsFor(buildKey)).toHaveLength(1);
    expect(api.stale).toBe(false);

    // Second pass: the list read reports the exhausted budget, so the per-file read must serve
    // the cached copy instead of spending another call — the throttling a browser parked on the
    // Workflows tab has to be subject to.
    const second = await api.listWorkflows({ withInputs: true });
    expect(second).toEqual(first);
    expect(github.callsFor(buildKey)).toHaveLength(1);
    expect(api.stale).toBe(true);
  });

  it("does not spend the floor on workflow files it has never read", async () => {
    const workflowsKey = `GET /repos/${REPO}/actions/workflows`;
    const discordKey = `GET /repos/${REPO}/contents/.github/workflows/discord-release.yml`;
    github.on(workflowsKey, {
      body: {
        workflows: [
          {
            id: 2,
            name: "Discord",
            path: ".github/workflows/discord-release.yml",
            state: "active",
          },
        ],
      },
      headers: { "x-ratelimit-remaining": "3", "x-ratelimit-reset": "1780000000" },
    });
    github.on(discordKey, { body: {} });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github, () => 1_000);

    // The list read reports the exhausted budget; nothing is cached for the file, so the
    // per-workflow read is refused outright and the workflow keeps an empty input list.
    const workflows = await api.listWorkflows({ withInputs: true });
    expect(workflows[0]?.inputs).toEqual([]);
    expect(github.callsFor(discordKey)).toHaveLength(0);
  });
});

describe("release mutations", () => {
  const WRITE_ENV: RuntimeEnv = { GITHUB_RELEASE_TOKEN: WRITE_TOKEN };

  it("creates a draft release and defaults tag_name, name, body, draft and prerelease", async () => {
    const key = `POST /repos/${REPO}/releases`;
    github.on(key, (call) => ({
      body: release({
        id: 501,
        tag_name: (call.body as { tag_name: string }).tag_name,
        draft: true,
      }),
    }));
    const created = await client(WRITE_ENV, github).createRelease({ tag: "v1.5.4" });

    // draft: true is the load-bearing default — publishing is its own recorded step, and it is
    // the step that fires the Discord post.
    expect(github.callsFor(key)[0]?.body).toEqual({
      tag_name: "v1.5.4",
      name: "v1.5.4",
      body: "",
      draft: true,
      prerelease: false,
    });
    expect(created).toMatchObject({ id: 501, tag: "v1.5.4", state: "draft" });
  });

  it("sends the title, body and prerelease it was given, and never publishes on create", async () => {
    const key = `POST /repos/${REPO}/releases`;
    github.on(key, {
      body: release({ id: 502, tag_name: "v1.6.0", draft: true, prerelease: true }),
    });
    await client(WRITE_ENV, github).createRelease({
      tag: "v1.6.0",
      name: "RazorReaper 1.6.0",
      body: "## Notes\n- one\n",
      prerelease: true,
    });
    expect(github.callsFor(key)[0]?.body).toEqual({
      tag_name: "v1.6.0",
      name: "RazorReaper 1.6.0",
      body: "## Notes\n- one\n",
      draft: true,
      prerelease: true,
    });
  });

  it("honours an explicit draft: false on create rather than silently overriding it", async () => {
    const key = `POST /repos/${REPO}/releases`;
    github.on(key, { body: release({ id: 503, tag_name: "v1.6.1" }) });
    await client(WRITE_ENV, github).createRelease({ tag: "v1.6.1", draft: false });
    expect((github.callsFor(key)[0]?.body as { draft: boolean }).draft).toBe(false);
  });

  it("PATCHes only the fields the patch names, and maps them to GitHub's spelling", async () => {
    const key = `PATCH /repos/${REPO}/releases/77`;
    github.on(key, { body: release({ id: 77, tag_name: "v1.5.4" }) });
    const api = client(WRITE_ENV, github);

    // Publish step 2: the body write. `draft` is deliberately absent — it is step 3's job.
    await api.updateRelease(77, { name: "RazorReaper 1.5.4", body: "notes", prerelease: false });
    expect(github.callsFor(key)[0]?.body).toEqual({
      name: "RazorReaper 1.5.4",
      body: "notes",
      prerelease: false,
    });

    await api.updateRelease(77, { tag: "v1.5.5" });
    expect(github.callsFor(key)[1]?.body).toEqual({ tag_name: "v1.5.5" });

    // An empty patch sends an empty object: nothing is invented and no field is defaulted in.
    await api.updateRelease(77, {});
    expect(github.callsFor(key)[2]?.body).toEqual({});
  });

  it("publishes with a body of exactly { draft: false } and nothing else", async () => {
    const key = `PATCH /repos/${REPO}/releases/77`;
    github.on(key, { body: release({ id: 77, tag_name: "v1.5.4" }) });
    const published = await client(WRITE_ENV, github).publishRelease(77);

    // This is the one call in the panel that fires a GitHub release event, and so the Discord
    // post. Any extra key here — a body, a name, a prerelease flip — would be an unreviewed
    // rewrite riding along with the publish the owner actually confirmed.
    expect(github.keys()).toEqual([key]);
    expect(github.callsFor(key)[0]?.body).toEqual({ draft: false });
    expect(Object.keys(github.callsFor(key)[0]?.body as object)).toEqual(["draft"]);
    expect(published).toMatchObject({ id: 77, state: "published" });
  });

  it("unpublishes back to a draft with { draft: true }, keeping tag and assets", async () => {
    const key = `PATCH /repos/${REPO}/releases/77`;
    github.on(key, { body: release({ id: 77, tag_name: "v1.5.4", draft: true }) });
    const back = await client(WRITE_ENV, github).updateRelease(77, { draft: true });
    expect(github.callsFor(key)[0]?.body).toEqual({ draft: true });
    expect(back.state).toBe("draft");
    expect(back.assets.map((asset) => asset.name)).toEqual(["RazorReaper-Setup.exe"]);
  });

  it("lists a release's assets off the assets endpoint", async () => {
    const key = `GET /repos/${REPO}/releases/77/assets`;
    github.on(key, {
      body: [
        {
          id: 42,
          name: "RazorReaper-Setup.exe",
          size: 76_000,
          content_type: "application/octet-stream",
          download_count: 7,
          updated_at: "2026-09-01T10:04:00Z",
        },
        { id: 43, name: "notes.txt", size: 12 },
      ],
    });
    const assets = await client(WRITE_ENV, github).listAssets(77);
    expect(github.keys()).toEqual([key]);
    expect(assets[0]).toEqual({
      id: 42,
      name: "RazorReaper-Setup.exe",
      size: 76_000,
      contentType: "application/octet-stream",
      downloadCount: 7,
      updatedAt: "2026-09-01T10:04:00Z",
    });
    // A reply missing the optional fields still maps, so a thin asset never breaks the page.
    expect(assets[1]).toMatchObject({ contentType: "application/octet-stream", downloadCount: 0 });
  });

  it("deletes one asset by id and tolerates the 204 GitHub answers with", async () => {
    const key = `DELETE /repos/${REPO}/releases/assets/42`;
    github.on(key, { status: 204 });
    await expect(client(WRITE_ENV, github).deleteAsset(42)).resolves.toBeUndefined();
    expect(github.keys()).toEqual([key]);
    expect(github.callsFor(key)[0]?.body).toBeUndefined();
  });

  it("refuses every one of these mutations without a write token, before any request", async () => {
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["createRelease", () => api.createRelease({ tag: "v1.5.4" })],
      ["updateRelease", () => api.updateRelease(77, { body: "x" })],
      ["publishRelease", () => api.publishRelease(77)],
      ["deleteAsset", () => api.deleteAsset(42)],
    ];
    for (const [name, attempt] of attempts) {
      const refusal = (await attempt().catch((e: unknown) => e)) as GithubApiError;
      expect(isGithubApiError(refusal), name).toBe(true);
      expect(refusal.status, name).toBe(409);
      expect(refusal.code, name).toBe("no-write-token");
    }
    expect(github.calls).toHaveLength(0);
  });

  it("maps a failed publish onto the panel's own error, never GitHub's prose", async () => {
    github.on(`PATCH /repos/${REPO}/releases/77`, {
      status: 422,
      body: { message: `Validation Failed for ${WRITE_TOKEN}` },
    });
    const failure = (await client(WRITE_ENV, github)
      .publishRelease(77)
      .catch((e: unknown) => e)) as GithubApiError;
    expect(failure.status).toBe(422);
    expect(failure.message).toBe("GitHub refused the request as invalid.");
    expect(failure.message).not.toContain(WRITE_TOKEN);
    expect(failure.message).not.toContain("Validation Failed");
  });
});

describe("error mapping", () => {
  const cases: Array<[number, Record<string, string>, number, string]> = [
    [401, {}, 502, "GitHub rejected the panel's token."],
    [403, {}, 502, "GitHub rejected the panel's token."],
    [409, {}, 409, "GitHub reported a conflict — reload and retry."],
    [422, {}, 422, "GitHub refused the request as invalid."],
    [500, {}, 502, "GitHub is unavailable."],
    [418, {}, 502, "GitHub refused the request (418)."],
    [
      403,
      { "x-ratelimit-remaining": "0" },
      429,
      "GitHub's rate limit is exhausted; try again shortly.",
    ],
  ];

  it.each(cases)("maps %i to %i", async (status, headers, expected, message) => {
    github.on(RELEASES_KEY, { status, headers, body: { message: "secret detail" } });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);
    const failure = (await api.listReleases().catch((e: unknown) => e)) as GithubApiError;
    expect(failure.status).toBe(expected);
    expect(failure.message).toBe(message);
    expect(failure.githubStatus).toBe(status);
    expect(failure.message).not.toContain("secret detail");
  });

  it("names the tag in a 404, and hands the same 404 back as null where a null is meaningful", async () => {
    github.on(`GET /repos/${REPO}/releases/tags/v9.9.9`, { status: 404, body: {} });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);

    await expect(api.findReleaseByTag("v9.9.9")).resolves.toBeNull();
    const failure = (await api
      .getReleaseByTag("v9.9.9")
      .catch((e: unknown) => e)) as GithubApiError;
    expect(failure.status).toBe(404);
    expect(failure.message).toBe("GitHub has no release tagged v9.9.9.");
  });

  it("maps a 403 rate-limit refusal to the contract's rate-limited code", async () => {
    github.on(RELEASES_KEY, { status: 429, body: {} });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);
    const failure = (await api.listReleases().catch((e: unknown) => e)) as GithubApiError;
    expect(apiErrorBody(failure)).toEqual({
      status: 429,
      body: {
        ok: false,
        error: "GitHub's rate limit is exhausted; try again shortly.",
        code: "rate-limited",
      },
    });
  });

  it("collapses anything that is not a GithubApiError to a 502 body", () => {
    expect(apiErrorBody(new Error("stack trace with /home/runner"))).toEqual({
      status: 502,
      body: { ok: false, error: "GitHub is unavailable." },
    });
  });
});

describe("read models", () => {
  it("maps draft, prerelease and published releases onto ReleaseState", async () => {
    github.on(RELEASES_KEY, {
      body: [
        release({ id: 1, tag_name: "v1.5.4", draft: true, prerelease: true }),
        release({ id: 2, tag_name: "v1.5.3", prerelease: true }),
        release({ id: 3, tag_name: "v1.5.2" }),
      ],
    });
    const releases = await client({ GITHUB_TOKEN: READ_TOKEN }, github).listReleases();
    expect(releases.map((entry) => entry.state)).toEqual(["draft", "prerelease", "published"]);
    expect(releases[2]?.assets[0]).toMatchObject({ name: "RazorReaper-Setup.exe", size: 76_000 });
  });

  it("returns commits newest first and flags a truncated comparison", async () => {
    github.on(`GET /repos/${REPO}/compare/v1.5.3...master`, {
      body: {
        ahead_by: 3,
        commits: [
          commit("aaaaaaa1", "chore: one"),
          commit("bbbbbbb2", "fix: two\n\nbody"),
          commit("ccccccc3", "feat: three"),
        ],
      },
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);
    const compared = await api.compareSinceTag("v1.5.3", "master", 2);
    expect(compared.aheadBy).toBe(3);
    expect(compared.truncated).toBe(true);
    expect(compared.commits.map((entry) => entry.subject)).toEqual(["feat: three", "fix: two"]);
    expect(compared.commits[0]?.shortSha).toBe("ccccccc");
  });

  it("asks GitHub nothing when there is no tag to compare against", async () => {
    const compared = await client({ GITHUB_TOKEN: READ_TOKEN }, github).compareSinceTag(null);
    expect(compared).toEqual({ sinceTag: null, aheadBy: 0, commits: [], truncated: false });
    expect(github.calls).toHaveLength(0);
  });

  it("decodes a UTF-8 blob and flags the ones it will not decode", async () => {
    const path = `GET /repos/${REPO}/contents/update.xml`;
    github.once(path, {
      body: {
        path: "update.xml",
        sha: "blob1",
        size: 40,
        encoding: "base64",
        content: base64("<version>1.5.3.0</version>\n"),
      },
    });
    github.once(path, {
      body: { path: "update.xml", sha: "blob2", size: 900_000, encoding: "base64", content: "" },
    });
    github.once(path, {
      body: { path: "update.xml", sha: "blob3", size: 12, encoding: "none", content: "" },
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);

    expect((await api.getContent("update.xml"))?.content).toBe("<version>1.5.3.0</version>\n");
    expect(await api.getContent("update.xml")).toMatchObject({
      content: null,
      unreadable: "too-large",
    });
    expect(await api.getContent("update.xml")).toMatchObject({
      content: null,
      unreadable: "binary",
    });
  });

  it("reports the running step beside a job and tails a job log", async () => {
    github.on(`GET /repos/${REPO}/actions/runs/77/jobs`, {
      body: {
        jobs: [
          {
            id: 5,
            name: "build",
            status: "in_progress",
            steps: [
              { name: "checkout", status: "completed" },
              { name: "dotnet build", status: "in_progress" },
            ],
          },
        ],
      },
    });
    github.on(`GET /repos/${REPO}/actions/jobs/5/logs`, {
      text: ["one", "two", "three", ""].join("\n"),
    });
    const api = client({ GITHUB_TOKEN: READ_TOKEN }, github);
    expect((await api.listJobs(77))[0]).toMatchObject({
      status: "in_progress",
      conclusion: null,
      currentStep: "dotnet build",
    });
    expect(await api.getJobLogs(5, 2)).toEqual(["two", "three"]);
  });

  it("treats an unreadable job log as an empty tail rather than a failure", async () => {
    github.on(`GET /repos/${REPO}/actions/jobs/5/logs`, { status: 404, body: {} });
    await expect(client({ GITHUB_TOKEN: READ_TOKEN }, github).getJobLogs(5)).resolves.toEqual([]);
  });

  it("folds an unknown run status and conclusion into the contract's fallbacks", async () => {
    github.on(`GET /repos/${REPO}/actions/runs`, {
      body: { workflow_runs: [{ id: 1, status: "waiting", conclusion: "neutral" }] },
    });
    const runs = await client({ GITHUB_TOKEN: READ_TOKEN }, github).listRuns();
    expect(runs[0]).toMatchObject({ status: "unknown", conclusion: null });
  });

  it("dispatches a workflow with the branch and the declared inputs", async () => {
    github.on(`POST /repos/${REPO}/actions/workflows/build-installer.yml/dispatches`, {
      status: 204,
    });
    await client({ GITHUB_RELEASE_TOKEN: WRITE_TOKEN }, github).dispatchWorkflow(
      "build-installer.yml",
      { inputs: { version: "1.5.4", prerelease: "false" } },
    );
    expect(github.calls[0]?.body).toEqual({
      ref: "master",
      inputs: { version: "1.5.4", prerelease: "false" },
    });
  });
});

describe("workflow files", () => {
  const BUILD_INSTALLER = `name: Build installer

on:
  workflow_dispatch:
    inputs:
      version:
        description: "3-part version, e.g. 1.5.4"
        required: true
        type: string
      notes:
        description: "Customer bullets, one per line"
        required: false
        type: string
      prerelease:
        type: boolean
        default: false
      channel:
        type: choice
        default: stable
        options:
          - stable
          - beta

jobs:
  build:
    runs-on: windows-latest
    steps:
      - name: Guard
        run: |
          # a comment that is not YAML
          - not a list item
          echo "version: 1.2.3"
`;

  it("parses the declared workflow_dispatch inputs, block scalars and all", () => {
    expect(parseWorkflowDispatchInputs(BUILD_INSTALLER)).toEqual([
      {
        name: "version",
        description: "3-part version, e.g. 1.5.4",
        required: true,
        type: "string",
      },
      {
        name: "notes",
        description: "Customer bullets, one per line",
        required: false,
        type: "string",
      },
      { name: "prerelease", description: "", required: false, type: "boolean", default: "false" },
      {
        name: "channel",
        description: "",
        required: false,
        type: "choice",
        default: "stable",
        options: ["stable", "beta"],
      },
    ]);
  });

  it("returns no inputs for a workflow that declares none", () => {
    expect(parseWorkflowDispatchInputs("on:\n  push:\n    branches: [master]\n")).toEqual([]);
    expect(parseWorkflowDispatchInputs("")).toEqual([]);
  });

  it("resolves a workflow list's inputs from the files when asked", async () => {
    github.on(`GET /repos/${REPO}/actions/workflows`, {
      body: {
        workflows: [
          {
            id: 1,
            name: "Build installer",
            path: ".github/workflows/build-installer.yml",
            state: "active",
          },
          {
            id: 2,
            name: "Discord",
            path: ".github/workflows/discord-release.yml",
            state: "active",
          },
        ],
      },
    });
    github.on(`GET /repos/${REPO}/contents/.github/workflows/build-installer.yml`, {
      body: { path: "x", sha: "s", size: 10, encoding: "base64", content: base64(BUILD_INSTALLER) },
    });
    // A workflow whose file cannot be read keeps an empty input list instead of failing the page.
    github.on(`GET /repos/${REPO}/contents/.github/workflows/discord-release.yml`, {
      status: 500,
      body: {},
    });
    const workflows = await client({ GITHUB_TOKEN: READ_TOKEN }, github).listWorkflows({
      withInputs: true,
    });
    expect(workflows[0]?.inputs.map((input) => input.name)).toEqual([
      "version",
      "notes",
      "prerelease",
      "channel",
    ]);
    expect(workflows[1]?.inputs).toEqual([]);
  });

  it("reads the release trigger and its tag guard off the real discord workflow", () => {
    const trigger = parseWorkflowReleaseTrigger(DISCORD_RELEASE_YML);
    expect(trigger.wired).toBe(true);
    expect(trigger.excludedTags).toEqual(["v1.5.0"]);
  });

  it("reports a removed release trigger, and a release trigger with no types as wired", () => {
    expect(parseWorkflowReleaseTrigger("on:\n  push:\n    branches:\n      - master\n")).toEqual({
      wired: false,
      excludedTags: [],
    });
    expect(parseWorkflowReleaseTrigger("on:\n  release:\n").wired).toBe(true);
    expect(parseWorkflowReleaseTrigger("on:\n  release:\n    types: [created]\n").wired).toBe(
      false,
    );
    expect(
      parseWorkflowReleaseTrigger("on:\n  release:\n    types: [published, prereleased]\n").wired,
    ).toBe(true);
  });
});

/* ─────────────────────────────── fixtures ─────────────────────────────── */

function release(overrides: Record<string, unknown>) {
  return {
    name: null,
    body: "notes",
    created_at: "2026-09-01T10:00:00Z",
    published_at: "2026-09-01T10:05:00Z",
    html_url: "https://github.com/CedrickGD/RazorReaper/releases/tag/v1.5.3",
    assets: [
      {
        id: 42,
        name: "RazorReaper-Setup.exe",
        size: 76_000,
        content_type: "application/octet-stream",
        download_count: 7,
        updated_at: "2026-09-01T10:04:00Z",
      },
    ],
    ...overrides,
  };
}

function commit(sha: string, message: string) {
  return {
    sha,
    commit: { message, author: { name: "Cedrick", date: "2026-09-02T08:00:00Z" } },
    author: { login: "CedrickGD" },
  };
}

/**
 * The shape `CedrickGD/RazorReaper/.github/workflows/discord-release.yml` carries today: a
 * `release` trigger, a `tag_name != 'v1.5.0'` guard, and a `run: |` block full of `#` comments
 * and `- ` lines that must not be mistaken for YAML.
 */
const DISCORD_RELEASE_YML = `name: Discord Notify

on:
  push:
    branches:
      - master
      - main
  release:
    types:
      - published
      - prereleased

jobs:
  notify:
    if: \${{ github.event_name != 'release' || github.event.release.tag_name != 'v1.5.0' }}
    runs-on: ubuntu-latest
    steps:
      - name: Send Discord notification
        shell: bash
        run: |
          # Deliberately not .release.html_url: the repository is going private.
          release_url="https://dl.razorreaper.app/release-notes/\${tag_name}"
          commit_lines="- No commit details provided by GitHub payload"
          # release:
          #   types:
          #     - deleted
`;
