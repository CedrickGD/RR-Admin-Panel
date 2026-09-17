/**
 * `GET /api/admin/releases/drafts/:id/run` and `…/events` — the two reads the draft editor polls.
 * Design §6 ("run, jobs, last ~200 log lines … sets `built` on success or `failed`") and §12.
 *
 * The run route is the only read in the feature that writes, so most of what is proven here is
 * *when it does not*: a run still going, a row already moved on, and a run GitHub has forgotten
 * all leave the draft alone.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestGet as draftEvents } from "../../functions/api/admin/releases/drafts/[id]/events";
import { onRequestGet as draftRun } from "../../functions/api/admin/releases/drafts/[id]/run";
import { FakeGitHub } from "../helpers/fake-github";
import {
  createMockD1,
  type MockD1,
  type MockD1Resolvers,
  type RecordedD1Operation,
} from "../helpers/mock-d1";
import { PANEL_MEMBER_SQL, panelMemberRow, releasesFetch } from "../helpers/releases-api";
import {
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "owner@example.com";
const REPO = "CedrickGD/RazorReaper";
const RUN_ID = 555;
const JOB_ID = 777;

const RUN = `GET /repos/${REPO}/actions/runs/${RUN_ID}`;
const JOBS = `GET /repos/${REPO}/actions/runs/${RUN_ID}/jobs`;
const LOGS = `GET /repos/${REPO}/actions/jobs/${JOB_ID}/logs`;
const TAG = `GET /repos/${REPO}/releases/tags/v1.5.3`;

const DRAFT_SELECT = /FROM release_drafts WHERE id = \?/;
const DRAFT_UPDATE = /^UPDATE release_drafts SET/;
const EVENT_INSERT = /INSERT INTO release_events/;
const EVENT_SELECT = /FROM release_events WHERE draft_id = \?/;

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    version: "1.5.3",
    tag: "v1.5.3",
    title: "RazorReaper 1.5.3",
    notes_customer: "",
    notes_full_md: "",
    commit_message: "release: 1.5.3",
    mandatory: 0,
    prerelease: 0,
    status: "building",
    github_release_id: null,
    github_run_id: RUN_ID,
    asset_name: null,
    asset_size: null,
    created_by: EMAIL,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
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
  github = new FakeGitHub();
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
});

function db(
  draft: Record<string, unknown> | null,
  resolvers: MockD1Resolvers = {},
  member = panelMemberRow(EMAIL, "owner"),
): MockD1 {
  return createMockD1({
    ...resolvers,
    first: [
      { match: PANEL_MEMBER_SQL, result: member },
      { match: DRAFT_SELECT, result: draft },
      ...(resolvers.first ?? []),
    ],
  });
}

function env(mock: MockD1): RuntimeEnv {
  return testAccessEnv(EMAIL, { DB: mock.db, GITHUB_RELEASE_TOKEN: "github_pat_write" });
}

async function context(mock: MockD1, id = "7") {
  return {
    request: createSyntheticRequest({
      path: `/api/admin/releases/drafts/${id}/run`,
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: env(mock),
    params: { id },
  };
}

function operations(mock: MockD1, match: RegExp): RecordedD1Operation[] {
  return mock.operations.filter((operation) => match.test(operation.normalizedSql));
}

function wireRun(status: string, conclusion: string | null): void {
  github.on(RUN, {
    body: {
      id: RUN_ID,
      workflow_id: 10,
      name: "Build installer",
      run_number: 12,
      status,
      conclusion,
      event: "workflow_dispatch",
      head_branch: "master",
    },
  });
  github.on(JOBS, {
    body: {
      jobs: [
        {
          id: JOB_ID,
          name: "build",
          status,
          conclusion,
          steps: [{ name: "ISCC", status: status === "completed" ? "completed" : "in_progress" }],
        },
      ],
    },
  });
  github.on(LOGS, { text: "line one\n\nline two\n" });
}

describe("GET /api/admin/releases/drafts/:id/run", () => {
  it("returns an empty panel, and calls nothing, while the draft has no run", async () => {
    const mock = db(draftRow({ github_run_id: null, status: "draft" }));
    const response = await draftRun(await context(mock));
    expect(await response.json()).toEqual({
      ok: true,
      run: null,
      jobs: [],
      logTail: [],
      pollAfterSeconds: 0,
    });
    expect(github.calls).toHaveLength(0);
  });

  it("asks for 10 more seconds while the run is alive, and leaves the draft alone", async () => {
    wireRun("in_progress", null);
    const mock = db(draftRow());
    const response = await draftRun(await context(mock));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload.pollAfterSeconds).toBe(10);
    expect(payload.logTail).toEqual(["line one", "line two"]);
    expect((payload.jobs as Array<{ currentStep: string }>)[0]?.currentStep).toBe("ISCC");
    expect(operations(mock, DRAFT_UPDATE)).toHaveLength(0);
    expect(operations(mock, EVENT_INSERT)).toHaveLength(0);
  });

  it("sets `built` with the installer's name and size when the run succeeds", async () => {
    wireRun("completed", "success");
    github.on(TAG, {
      body: {
        id: 900,
        tag_name: "v1.5.3",
        draft: true,
        assets: [{ id: 1, name: "RazorReaper-Setup.exe", size: 44_040_192 }],
      },
    });

    const mock = db(draftRow());
    const response = await draftRun(await context(mock));
    expect((await response.json()) as { pollAfterSeconds: number }).toMatchObject({
      pollAfterSeconds: 0,
    });

    const update = operations(mock, DRAFT_UPDATE)[0];
    expect(update?.normalizedSql).toContain("status = ?, asset_name = ?, asset_size = ?");
    expect(update?.values.slice(0, 3)).toEqual(["built", "RazorReaper-Setup.exe", 44_040_192]);

    const event = operations(mock, EVENT_INSERT)[0];
    expect(event?.values[1]).toBe("build_succeeded");
    expect(event?.values[2]).toBe(EMAIL);
    expect(String(event?.values[3])).toContain("RazorReaper-Setup.exe");
  });

  it("sets `failed` when the run does not succeed", async () => {
    wireRun("completed", "failure");
    const mock = db(draftRow());
    await draftRun(await context(mock));

    expect(operations(mock, DRAFT_UPDATE)[0]?.values[0]).toBe("failed");
    expect(operations(mock, EVENT_INSERT)[0]?.values[1]).toBe("build_failed");
    // No release read: a failed build has no asset to record.
    expect(github.keys()).toEqual([RUN, JOBS, LOGS]);
  });

  it("writes the outcome once — a row that already moved on is not moved back", async () => {
    wireRun("completed", "success");
    const mock = db(draftRow({ status: "built", asset_name: "RazorReaper-Setup.exe" }));
    await draftRun(await context(mock));
    expect(operations(mock, DRAFT_UPDATE)).toHaveLength(0);
    expect(operations(mock, EVENT_INSERT)).toHaveLength(0);
  });

  it("shows an empty panel for a run GitHub no longer has, instead of bricking the draft", async () => {
    github.on(RUN, { status: 404, body: { message: "Not Found" } });
    const mock = db(draftRow());
    const response = await draftRun(await context(mock));
    expect(response.status).toBe(200);
    expect((await response.json()) as { run: null }).toMatchObject({ run: null });
  });

  it("404s an unknown draft", async () => {
    const mock = db(null);
    const response = await draftRun(await context(mock));
    expect(response.status).toBe(404);
    expect(github.calls).toHaveLength(0);
  });

  it("400s an id that is not one", async () => {
    const mock = db(draftRow());
    const response = await draftRun(await context(mock, "nope"));
    expect(response.status).toBe(400);
  });

  it("refuses a seat whose releases.read was denied", async () => {
    wireRun("completed", "success");
    const mock = db(
      draftRow(),
      {},
      panelMemberRow(EMAIL, "support", { "releases.read": { effect: "deny", expiresAt: null } }),
    );
    const response = await draftRun(await context(mock));
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });
});

describe("GET /api/admin/releases/drafts/:id/events", () => {
  const EVENT_ROWS = [
    {
      id: 3,
      draft_id: 7,
      kind: "build_dispatched",
      actor: EMAIL,
      detail: "Run 12 dispatched.",
      created_at: "2026-09-02T10:00:00.000Z",
    },
    {
      id: 1,
      draft_id: 7,
      kind: "draft_created",
      actor: EMAIL,
      detail: "",
      created_at: "2026-09-01T10:00:00.000Z",
    },
  ];

  async function eventsContext(mock: MockD1, id = "7") {
    return {
      request: createSyntheticRequest({
        path: `/api/admin/releases/drafts/${id}/events`,
        headers: await accessIdentityHeaders(EMAIL),
      }),
      env: env(mock),
      params: { id },
    };
  }

  it("returns the draft's timeline, newest first", async () => {
    const mock = db(draftRow(), {
      all: [{ match: EVENT_SELECT, result: { results: EVENT_ROWS } }],
    });
    const response = await draftEvents(await eventsContext(mock));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      events: [
        {
          id: 3,
          draftId: 7,
          kind: "build_dispatched",
          actor: EMAIL,
          detail: "Run 12 dispatched.",
          createdAt: "2026-09-02T10:00:00.000Z",
        },
        {
          id: 1,
          draftId: 7,
          kind: "draft_created",
          actor: EMAIL,
          detail: "",
          createdAt: "2026-09-01T10:00:00.000Z",
        },
      ],
    });
    expect(github.calls).toHaveLength(0);
  });

  it("404s an unknown draft rather than returning an empty timeline", async () => {
    const mock = db(null);
    const response = await draftEvents(await eventsContext(mock));
    expect(response.status).toBe(404);
  });

  it("refuses a seat whose releases.read was denied", async () => {
    const mock = db(
      draftRow(),
      {},
      panelMemberRow(EMAIL, "viewer", { "releases.read": { effect: "deny", expiresAt: null } }),
    );
    const response = await draftEvents(await eventsContext(mock));
    expect(response.status).toBe(403);
  });
});
