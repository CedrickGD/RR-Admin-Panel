/**
 * `GET /api/admin/releases`, `GET …/commits` and `GET …/workflows[/runs]` — the reads the
 * Releases page loads with. Design §6 ("One call — the page makes no others on load") and §12.
 *
 * Every GitHub call is served by `FakeGitHub` through the stubbed global `fetch`, so the assertion
 * that matters most is cheap to make: the token never appears in a response, and the overview is
 * exactly three GitHub calls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestGet as commits } from "../../functions/api/admin/releases/commits";
import { onRequestGet as overview } from "../../functions/api/admin/releases/index";
import { onRequestGet as workflows } from "../../functions/api/admin/releases/workflows/index";
import { onRequestGet as workflowRuns } from "../../functions/api/admin/releases/workflows/runs";
import { RELEASES_API_VERSION } from "../../shared/releases-contract";
import { FakeGitHub, base64 } from "../helpers/fake-github";
import { createMockD1, type MockD1, type MockD1Resolvers } from "../helpers/mock-d1";
import { PANEL_MEMBER_SQL, panelMemberRow, releasesFetch } from "../helpers/releases-api";
import {
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "owner@example.com";
const TOKEN = "github_pat_never_echoed";
const REPO = "CedrickGD/RazorReaper";

const RELEASES = `GET /repos/${REPO}/releases`;
const RUNS = `GET /repos/${REPO}/actions/runs`;
const MANIFEST = `GET /repos/${REPO}/contents/update.xml`;
const COMPARE = `GET /repos/${REPO}/compare/v1.5.2...master`;
const WORKFLOW_LIST = `GET /repos/${REPO}/actions/workflows`;
const BUILD_WORKFLOW = `GET /repos/${REPO}/contents/.github/workflows/build-installer.yml`;

const DRAFT_ROWS = [
  {
    id: 7,
    version: "1.5.3",
    tag: "v1.5.3",
    title: "RazorReaper 1.5.3",
    notes_customer: "One calm bullet",
    notes_full_md: "",
    commit_message: "release: 1.5.3",
    mandatory: 0,
    prerelease: 0,
    status: "draft",
    github_release_id: null,
    github_run_id: null,
    asset_name: null,
    asset_size: null,
    created_by: EMAIL,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    published_at: null,
  },
];

const RELEASE_ROWS = [
  {
    id: 900,
    tag_name: "v1.5.2",
    name: "RazorReaper 1.5.2",
    body: "notes",
    draft: false,
    prerelease: false,
    assets: [{ id: 1, name: "RazorReaper-Setup.exe", size: 42, content_type: "application/exe" }],
    created_at: "2026-08-01T00:00:00.000Z",
    published_at: "2026-08-01T00:00:00.000Z",
    html_url: "https://github.com/CedrickGD/RazorReaper/releases/tag/v1.5.2",
  },
  {
    id: 899,
    tag_name: "v1.5.3-rc1",
    draft: false,
    prerelease: true,
    assets: [],
  },
];

const UPDATE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<item>",
  "  <version>1.5.2.0</version>",
  `  <url>https://github.com/${REPO}/releases/download/v1.5.2/RazorReaper-Setup.exe</url>`,
  `  <changelog>https://github.com/${REPO}/releases/tag/v1.5.2</changelog>`,
  "  <mandatory>false</mandatory>",
  "  <args>/VERYSILENT /NORESTART</args>",
  "  <notes>",
  "- Receive private support replies &amp; more.",
  "- Includes the latest fixes.",
  "  </notes>",
  "</item>",
].join("\n");

const ADOPTION_ROWS = [
  { version: "1.5.2", installs: 829 },
  { version: "1.5.1", installs: 171 },
  { version: "1.4.8", installs: 0 },
];

let github: FakeGitHub;

// The shared RSA signer is generated once per process; warming it here keeps the first case from
// paying for it.
beforeAll(async () => {
  await getTestAccessSigner();
});

beforeEach(() => {
  resetGithubReleaseStateForTests();
  github = new FakeGitHub();
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function db(resolvers: MockD1Resolvers = {}, member = panelMemberRow(EMAIL, "owner")): MockD1 {
  return createMockD1({
    ...resolvers,
    first: [{ match: PANEL_MEMBER_SQL, result: member }, ...(resolvers.first ?? [])],
    all: [
      { match: /FROM release_drafts ORDER BY id DESC/, result: { results: DRAFT_ROWS } },
      { match: /FROM ranked WHERE rn = 1 GROUP BY version/, result: { results: ADOPTION_ROWS } },
      ...(resolvers.all ?? []),
    ],
  });
}

function env(mock: MockD1, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, { DB: mock.db, GITHUB_RELEASE_TOKEN: TOKEN, ...overrides });
}

async function request(path: string, query: Record<string, string> = {}): Promise<Request> {
  return createSyntheticRequest({
    path,
    query,
    headers: await accessIdentityHeaders(EMAIL),
  });
}

function wireOverview(): void {
  github.on(RELEASES, { body: RELEASE_ROWS });
  github.on(RUNS, {
    body: {
      workflow_runs: [
        {
          id: 555,
          workflow_id: 10,
          name: "build-installer",
          run_number: 12,
          status: "completed",
          conclusion: "success",
          event: "workflow_dispatch",
          head_branch: "master",
        },
      ],
    },
  });
  github.on(MANIFEST, {
    body: {
      path: "update.xml",
      sha: "blob-sha",
      size: UPDATE_XML.length,
      encoding: "base64",
      content: base64(UPDATE_XML),
    },
  });
}

async function body(response: Response): Promise<Record<string, never>> {
  return (await response.json()) as Record<string, never>;
}

describe("GET /api/admin/releases", () => {
  it("returns 401 without an Access JWT", async () => {
    const mock = db();
    const response = await overview({
      request: createSyntheticRequest({ path: "/api/admin/releases" }),
      env: env(mock),
    });
    expect(response.status).toBe(401);
    expect(github.calls).toHaveLength(0);
  });

  it("answers the whole page in one call: token, releases, drafts, runs, manifest, adoption", async () => {
    wireOverview();
    const mock = db();
    const response = await overview({
      request: await request("/api/admin/releases"),
      env: env(mock),
    });
    expect(response.status).toBe(200);

    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.apiVersion).toBe(RELEASES_API_VERSION);
    expect(payload.token).toEqual({
      mode: "write",
      source: "GITHUB_RELEASE_TOKEN",
      canWrite: true,
      message: null,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
    });
    expect((payload.releases as unknown[]).length).toBe(2);
    expect((payload.latestPublished as { tag: string }).tag).toBe("v1.5.2");
    expect((payload.drafts as Array<{ tag: string }>)[0]?.tag).toBe("v1.5.3");
    expect((payload.recentRuns as Array<{ id: number }>)[0]?.id).toBe(555);
    expect(payload.stale).toBe(false);

    // Exactly the three GitHub reads §6 allows the page on load.
    expect(github.keys().sort()).toEqual([RELEASES, RUNS, MANIFEST].sort());
    expect(github.unexpected).toEqual([]);
  });

  it("reports what update.xml pins, the bullets it carries and that it is the latest tag", async () => {
    wireOverview();
    const mock = db();
    const response = await overview({
      request: await request("/api/admin/releases"),
      env: env(mock),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload.updateXml).toEqual({
      version: "1.5.2.0",
      url: `https://github.com/${REPO}/releases/download/v1.5.2/RazorReaper-Setup.exe`,
      changelog: `https://github.com/${REPO}/releases/tag/v1.5.2`,
      mandatory: false,
      args: "/VERYSILENT /NORESTART",
      notes: ["Receive private support replies & more.", "Includes the latest fixes."],
      sha: "blob-sha",
      pinnedTag: "v1.5.2",
      pinnedTagIsLatest: true,
      fetchedAt: expect.any(String),
    });
  });

  it("counts installs on the latest version, not sessions", async () => {
    wireOverview();
    const mock = db();
    const response = await overview({
      request: await request("/api/admin/releases"),
      env: env(mock),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload.adoption).toEqual({
      version: "1.5.2",
      installs: 829,
      totalInstalls: 1000,
      share: 0.829,
      windowDays: 30,
    });
  });

  it("never puts the token, or any of it, in the response", async () => {
    wireOverview();
    const mock = db();
    const response = await overview({
      request: await request("/api/admin/releases"),
      env: env(mock),
    });
    expect(await response.text()).not.toContain(TOKEN);
  });

  it("names GITHUB_RELEASE_TOKEN and refuses writes when it holds a placeholder", async () => {
    wireOverview();
    const mock = db();
    const response = await overview({
      request: await request("/api/admin/releases"),
      env: env(mock, { GITHUB_RELEASE_TOKEN: "xxx" }),
    });
    const payload = (await response.json()) as { token: Record<string, unknown> };
    expect(payload.token.mode).toBe("placeholder");
    expect(payload.token.canWrite).toBe(false);
    expect(payload.token.source).toBe("GITHUB_RELEASE_TOKEN");
    expect(String(payload.token.message)).toContain("GITHUB_RELEASE_TOKEN");
  });

  it("refuses a seat whose releases.read was denied", async () => {
    wireOverview();
    const mock = db(
      {},
      panelMemberRow(EMAIL, "support", { "releases.read": { effect: "deny", expiresAt: null } }),
    );
    const response = await overview({
      request: await request("/api/admin/releases"),
      env: env(mock),
    });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("lets a support seat read it — the page is read-only for them, not hidden", async () => {
    wireOverview();
    const mock = db({}, panelMemberRow(EMAIL, "support"));
    const response = await overview({
      request: await request("/api/admin/releases"),
      env: env(mock),
    });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/admin/releases/commits", () => {
  const COMMIT_BODY = {
    ahead_by: 2,
    commits: [
      {
        sha: "bbbbbbbbbbbbbbbb",
        commit: { message: "fix: second\n\nbody", author: { name: "Ced", date: "2026-09-02" } },
      },
      {
        sha: "aaaaaaaaaaaaaaaa",
        commit: { message: "feat: first", author: { name: "Ced", date: "2026-09-01" } },
        author: { login: "CedrickGD" },
      },
    ],
  };

  it("defaults `since` to the latest published tag and returns subjects only", async () => {
    github.on(RELEASES, { body: RELEASE_ROWS });
    github.on(COMPARE, { body: COMMIT_BODY });

    const mock = db();
    const response = await commits({
      request: await request("/api/admin/releases/commits"),
      env: env(mock),
    });
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      ok: true,
      sinceTag: "v1.5.2",
      aheadBy: 2,
      truncated: false,
      commits: [
        {
          sha: "aaaaaaaaaaaaaaaa",
          shortSha: "aaaaaaa",
          subject: "feat: first",
          author: "CedrickGD",
          date: "2026-09-01",
        },
        {
          sha: "bbbbbbbbbbbbbbbb",
          shortSha: "bbbbbbb",
          subject: "fix: second",
          author: "Ced",
          date: "2026-09-02",
        },
      ],
    });
  });

  it("uses an explicit `since` without asking GitHub for the release list", async () => {
    github.on(COMPARE, { body: COMMIT_BODY });
    const mock = db();
    const response = await commits({
      request: await request("/api/admin/releases/commits", { since: "v1.5.2" }),
      env: env(mock),
    });
    expect(response.status).toBe(200);
    expect(github.keys()).toEqual([COMPARE]);
  });

  it("refuses a `since` that is not a tag name, before any call", async () => {
    const mock = db();
    const response = await commits({
      request: await request("/api/admin/releases/commits", { since: "../../etc/passwd" }),
      env: env(mock),
    });
    expect(response.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });
});

describe("GET /api/admin/releases/workflows", () => {
  const WORKFLOW_YAML = [
    "name: Build installer",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      version:",
    "        description: Three-part version",
    "        required: true",
    "        type: string",
    "      prerelease:",
    "        type: boolean",
    "        default: false",
  ].join("\n");

  it("returns each workflow with the dispatch inputs its file declares", async () => {
    github.on(WORKFLOW_LIST, {
      body: {
        workflows: [
          {
            id: 10,
            name: "Build installer",
            path: ".github/workflows/build-installer.yml",
            state: "active",
          },
        ],
      },
    });
    github.on(BUILD_WORKFLOW, {
      body: {
        path: ".github/workflows/build-installer.yml",
        sha: "yaml-sha",
        size: WORKFLOW_YAML.length,
        encoding: "base64",
        content: base64(WORKFLOW_YAML),
      },
    });

    const mock = db();
    const response = await workflows({
      request: await request("/api/admin/releases/workflows"),
      env: env(mock),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { workflows: Array<Record<string, unknown>> };
    expect(payload.workflows[0]?.inputs).toEqual([
      { name: "version", description: "Three-part version", required: true, type: "string" },
      { name: "prerelease", description: "", required: false, type: "boolean", default: "false" },
    ]);
  });

  it("refuses a seat without releases.read — §4 gates only the write direction on releases.files", async () => {
    const mock = db(
      {},
      panelMemberRow(EMAIL, "viewer", { "releases.read": { effect: "deny", expiresAt: null } }),
    );
    const response = await workflows({
      request: await request("/api/admin/releases/workflows"),
      env: env(mock),
    });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });
});

describe("GET /api/admin/releases/workflows/runs", () => {
  it("returns the recent runs, bounded by `limit`", async () => {
    github.on(RUNS, (call) => {
      expect(call.url).toContain("per_page=5");
      return { body: { workflow_runs: [{ id: 1, status: "in_progress", conclusion: null }] } };
    });
    const mock = db();
    const response = await workflowRuns({
      request: await request("/api/admin/releases/workflows/runs", { limit: "5" }),
      env: env(mock),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { runs: Array<{ id: number; status: string }> };
    expect(payload.runs).toEqual([
      expect.objectContaining({ id: 1, status: "in_progress", conclusion: null }),
    ]);
  });
});
