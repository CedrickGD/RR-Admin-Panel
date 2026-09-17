/**
 * `POST /api/admin/releases/drafts/:id/build` — the version bump and the dispatch. Design §6
 * step-by-step, §7 ("the version bump is made by the panel, not CI") and §12.
 *
 * Three things this suite exists to hold still:
 *
 *  - the bump is **one** commit over both files, so `build-installer.yml`'s guard step and
 *    `ReleaseReadinessTests` can never see a bumped `csproj` beside a stale `.iss`;
 *  - the commit is skipped when master already carries the version — §6's "unless" clause, and the
 *    reason a rebuild does not churn master;
 *  - the run id is resolved by *identity*, not by timestamp: the ids are read before the dispatch
 *    and the new one is whichever is not among them.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createGithubClient,
  resetGithubReleaseStateForTests,
} from "../../functions/_lib/github-release";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetConfirmTokenStateForTests } from "../../functions/_lib/release-confirm";
import { resolveDispatchedRun } from "../../functions/_lib/releases-build";
import { bumpCsproj, bumpIss } from "../../functions/_lib/release-version";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as build } from "../../functions/api/admin/releases/drafts/[id]/build";
import type { BuildResponse } from "../../shared/releases-contract";
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
const NOW = "2026-09-01T10:00:00.000Z";

const CSPROJ = `GET /repos/${REPO}/contents/RazorReaper/RazorReaper.csproj`;
const ISS = `GET /repos/${REPO}/contents/installer/RazorReaper.iss`;
const REF = `GET /repos/${REPO}/git/ref/heads/master`;
const COMMIT_READ = `GET /repos/${REPO}/git/commits/head1`;
const BLOBS = `POST /repos/${REPO}/git/blobs`;
const TREES = `POST /repos/${REPO}/git/trees`;
const COMMITS = `POST /repos/${REPO}/git/commits`;
const PATCH_REF = `PATCH /repos/${REPO}/git/refs/heads/master`;
const RUNS = `GET /repos/${REPO}/actions/runs`;
const DISPATCH = `POST /repos/${REPO}/actions/workflows/build-installer.yml/dispatches`;

const CSPROJ_XML = [
  "<Project>",
  "\t<PropertyGroup>",
  "\t\t<ApplicationDisplayVersion>1.5.3</ApplicationDisplayVersion>",
  "\t\t<ApplicationVersion>17</ApplicationVersion>",
  "\t\t<AssemblyVersion>1.5.3.0</AssemblyVersion>",
  "\t\t<FileVersion>1.5.3.0</FileVersion>",
  "\t\t<Version>1.5.3</Version>",
  "\t</PropertyGroup>",
  "</Project>",
].join("\n");

const ISS_TEXT = ['#define MyAppName "RazorReaper"', '#define MyAppVersion "1.5.3"'].join("\n");

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    version: "1.5.4",
    tag: "v1.5.4",
    title: "RazorReaper 1.5.4",
    notes_customer: "One calm bullet\nAnd a second",
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

function blob(path: string, content: string, sha: string) {
  return {
    body: { path, sha, size: content.length, encoding: "base64", content: base64(content) },
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
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
});

function wireFiles(csproj = CSPROJ_XML, iss = ISS_TEXT): void {
  github.on(CSPROJ, blob("RazorReaper/RazorReaper.csproj", csproj, "csproj-sha"));
  github.on(ISS, blob("installer/RazorReaper.iss", iss, "iss-sha"));
}

function wireGitData(): void {
  github.on(REF, { body: { object: { sha: "head1" } } });
  github.on(COMMIT_READ, { body: { tree: { sha: "base1" } } });
  let created = 0;
  github.on(BLOBS, () => {
    created += 1;
    return { body: { sha: `blob${created}` } };
  });
  github.on(TREES, { body: { sha: "tree1" } });
  github.on(COMMITS, { body: { sha: "commit1abcdef" } });
  github.on(PATCH_REF, { body: {} });
}

function wireDispatch(): void {
  github.once(RUNS, { body: { workflow_runs: [{ id: 500, run_number: 41 }] } });
  github.on(DISPATCH, { status: 204 });
  github.on(RUNS, {
    body: {
      workflow_runs: [
        { id: 501, run_number: 42, status: "queued", event: "workflow_dispatch" },
        { id: 500, run_number: 41 },
      ],
    },
  });
}

function env(store: ReleasesDb, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, {
    DB: store.db,
    GITHUB_RELEASE_TOKEN: "github_pat_write",
    JWT_SECRET: "build-test-secret",
    ...overrides,
  });
}

async function post(
  store: ReleasesDb,
  body: Record<string, unknown> = {},
  overrides: Partial<RuntimeEnv> = {},
): Promise<Response> {
  const runtime = env(store, overrides);
  const confirmToken =
    body.confirmToken === undefined
      ? await confirmTokenFor(runtime, "build", "7", EMAIL)
      : body.confirmToken;
  return build({
    request: createSyntheticRequest({
      path: "/api/admin/releases/drafts/7/build",
      json: { ...body, confirmToken },
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: runtime,
    params: { id: "7" },
  });
}

function store(overrides: Record<string, unknown> = {}): ReleasesDb {
  return releasesDb({ draft: draftRow(overrides), member: panelMemberRow(EMAIL, "owner") });
}

describe("the version bump", () => {
  it("rewrites the five csproj fields and the .iss define", () => {
    const bumped = bumpCsproj(CSPROJ_XML, "1.5.4");
    expect(bumped?.applicationVersion).toBe(18);
    expect(bumped?.content).toContain(
      "<ApplicationDisplayVersion>1.5.4</ApplicationDisplayVersion>",
    );
    expect(bumped?.content).toContain("<ApplicationVersion>18</ApplicationVersion>");
    expect(bumped?.content).toContain("<AssemblyVersion>1.5.4.0</AssemblyVersion>");
    expect(bumped?.content).toContain("<FileVersion>1.5.4.0</FileVersion>");
    expect(bumped?.content).toContain("<Version>1.5.4</Version>");
    expect(bumpIss(ISS_TEXT, "1.5.4")).toContain('#define MyAppVersion "1.5.4"');
  });

  it("refuses a project file missing one of the five, rather than committing four", () => {
    expect(
      bumpCsproj(CSPROJ_XML.replace(/\s*<FileVersion>.*<\/FileVersion>/, ""), "1.5.4"),
    ).toBeNull();
    expect(bumpIss('#define MyAppName "RazorReaper"', "1.5.4")).toBeNull();
  });
});

describe("POST /api/admin/releases/drafts/:id/build", () => {
  it("commits both files in one commit, dispatches, and records the run", async () => {
    wireFiles();
    wireGitData();
    wireDispatch();
    const db = store();

    const response = await post(db);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as BuildResponse;
    expect(payload.bumped).toBe(true);
    expect(payload.runId).toBe(501);
    expect(payload.draft.status).toBe("building");
    expect(payload.draft.githubRunId).toBe(501);

    // One tree, one commit, one ref move — both files or neither.
    expect(github.callsFor(TREES)).toHaveLength(1);
    expect(github.callsFor(COMMITS)[0]?.body).toMatchObject({ message: "release: 1.5.4" });
    expect(github.callsFor(PATCH_REF)[0]?.body).toEqual({ sha: "commit1abcdef", force: false });
    const written = github
      .callsFor(BLOBS)
      .map((call) => (call.body as { content: string }).content);
    expect(written[0]).toContain("<ApplicationVersion>18</ApplicationVersion>");
    expect(written[1]).toContain('#define MyAppVersion "1.5.4"');
  });

  it("dispatches build-installer.yml with version, notes and prerelease", async () => {
    wireFiles();
    wireGitData();
    wireDispatch();
    await post(store({ prerelease: 1 }));

    expect(github.callsFor(DISPATCH)[0]?.body).toEqual({
      ref: "master",
      inputs: {
        version: "1.5.4",
        notes: "One calm bullet\nAnd a second",
        prerelease: "true",
      },
    });
  });

  it("writes a version_bumped event, a build_dispatched event and one audit row", async () => {
    wireFiles();
    wireGitData();
    wireDispatch();
    const db = store();
    await post(db);

    expect(db.events().map((event) => event.kind)).toEqual(["version_bumped", "build_dispatched"]);
    expect(db.audits()).toHaveLength(1);
    expect(db.audits()[0]?.action).toBe("release.build");
  });

  it("makes no commit when master already carries the version", async () => {
    wireFiles(CSPROJ_XML.replace(/1\.5\.3/g, "1.5.4"), ISS_TEXT.replace("1.5.3", "1.5.4"));
    wireDispatch();
    const db = store();

    const payload = (await (await post(db)).json()) as BuildResponse;
    expect(payload.bumped).toBe(false);
    expect(github.keys()).not.toContain(BLOBS);
    expect(github.keys()).not.toContain(PATCH_REF);
    expect(db.events().map((event) => event.kind)).toEqual(["build_dispatched"]);
  });

  it("refuses a project file it cannot bump, before it dispatches anything", async () => {
    wireFiles(CSPROJ_XML.replace(/\s*<AssemblyVersion>.*<\/AssemblyVersion>/, ""));
    const response = await post(store());

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("five version fields");
    expect(github.keys()).not.toContain(DISPATCH);
  });

  it("refuses a second build while one is running unless rebuild is asked for", async () => {
    const response = await post(store({ status: "building" }));
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "status-mismatch" });
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a published draft", async () => {
    const response = await post(store({ status: "published" }));
    expect(response.status).toBe(409);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a confirmation minted for another draft", async () => {
    wireFiles();
    const db = store();
    const runtime = env(db);
    const response = await build({
      request: createSyntheticRequest({
        path: "/api/admin/releases/drafts/7/build",
        json: { confirmToken: await confirmTokenFor(runtime, "build", "9", EMAIL) },
        headers: await accessIdentityHeaders(EMAIL),
      }),
      env: runtime,
      params: { id: "7" },
    });

    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses without a write token, before the body is even read", async () => {
    const response = await post(store(), {}, { GITHUB_RELEASE_TOKEN: "" });
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "no-write-token" });
    expect(github.calls).toHaveLength(0);
  });
});

describe("resolveDispatchedRun", () => {
  function client(): ReturnType<typeof createGithubClient> {
    return createGithubClient(
      { GITHUB_RELEASE_TOKEN: "github_pat_write" },
      {
        fetch: github.fetch,
        repo: REPO,
      },
    );
  }

  it("returns the id that was not there before the dispatch", async () => {
    github.on(RUNS, { body: { workflow_runs: [{ id: 501 }, { id: 500 }] } });
    const runId = await resolveDispatchedRun(client(), { knownRunIds: new Set([500]) });
    expect(runId).toBe(501);
  });

  it("polls until the run appears, and gives up at the deadline", async () => {
    github.on(RUNS, { body: { workflow_runs: [{ id: 500 }] } });
    const slept: number[] = [];
    let clock = 0;
    const runId = await resolveDispatchedRun(client(), {
      knownRunIds: new Set([500]),
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    expect(runId).toBeNull();
    // 1.5 s a poll, and never past the 15 s §6 allows: ten waits, then it stops.
    expect(slept).toHaveLength(10);
    expect(slept.reduce((total, ms) => total + ms, 0)).toBe(15_000);
    expect(new Set(slept)).toEqual(new Set([1_500]));
  });

  it("treats an unreadable run list as an empty page rather than an error", async () => {
    github.on(RUNS, { status: 500, body: { message: "boom" } });
    const runId = await resolveDispatchedRun(client(), {
      knownRunIds: new Set(),
      deadlineMs: 0,
    });
    expect(runId).toBeNull();
  });
});
