/**
 * `GET /api/admin/releases/versions` — the route that takes `api.github.com` and
 * `raw.githubusercontent.com` out of the browser. Design §6, §10 and §13 (the private-flip
 * checklist: "no `api.github.com` string remains in `src/`").
 *
 * It therefore has to keep the two hooks' semantics, not the release page's: non-draft tags
 * including prereleases, 3-part, and a filter that keeps a date-style tag out of a version
 * dropdown. It is `monitoring.read`, because support and viewer seats read the Versions page.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import type { RuntimeEnv } from "../../functions/_lib/types";
import {
  onRequestGet as versions,
  resetVersionsCacheForTests,
} from "../../functions/api/admin/releases/versions";
import { FakeGitHub, base64 } from "../helpers/fake-github";
import { createMockD1, type MockD1 } from "../helpers/mock-d1";
import { PANEL_MEMBER_SQL, panelMemberRow, releasesFetch } from "../helpers/releases-api";
import {
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "viewer@example.com";
const REPO = "CedrickGD/RazorReaper";
const RELEASES = `GET /repos/${REPO}/releases`;
const MANIFEST = `GET /repos/${REPO}/contents/update.xml`;

const RELEASE_ROWS = [
  { id: 5, tag_name: "v1.6.0-rc1", draft: false, prerelease: true },
  { id: 4, tag_name: "v1.6.0", draft: false, prerelease: true },
  { id: 3, tag_name: "v1.5.2", draft: false, prerelease: false },
  { id: 2, tag_name: "v1.5.10", draft: false, prerelease: false },
  { id: 1, tag_name: "26.12.2025", draft: false, prerelease: false },
  { id: 0, tag_name: "v9.9.9", draft: true, prerelease: false },
];

const UPDATE_XML = "<item><version>1.5.2.0</version></item>";

let github: FakeGitHub;

beforeAll(async () => {
  await getTestAccessSigner();
});

beforeEach(() => {
  resetGithubReleaseStateForTests();
  resetVersionsCacheForTests();
  github = new FakeGitHub();
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
  resetVersionsCacheForTests();
});

function db(member = panelMemberRow(EMAIL, "viewer")): MockD1 {
  return createMockD1({ first: [{ match: PANEL_MEMBER_SQL, result: member }] });
}

function env(mock: MockD1): RuntimeEnv {
  return testAccessEnv(EMAIL, { DB: mock.db, GITHUB_TOKEN: "ghp_read_only" });
}

async function get(mock: MockD1): Promise<Response> {
  return versions({
    request: createSyntheticRequest({
      path: "/api/admin/releases/versions",
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: env(mock),
  });
}

function wire(): void {
  github.on(RELEASES, { body: RELEASE_ROWS });
  github.on(MANIFEST, {
    body: {
      path: "update.xml",
      sha: "sha",
      size: UPDATE_XML.length,
      encoding: "base64",
      content: base64(UPDATE_XML),
    },
  });
}

describe("GET /api/admin/releases/versions", () => {
  it("returns non-draft versions newest first, and the version update.xml pins", async () => {
    wire();
    const response = await get(db());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      // A prerelease is a version people run, so v1.6.0 stays; 1.5.10 sorts above 1.5.2
      // numerically; and the draft, the `-rc1` suffix and the date-style tag never reach a
      // version dropdown — the same three exclusions the browser hook made.
      releases: ["1.6.0", "1.5.10", "1.5.2"],
      latest: "1.5.2",
      ageSeconds: 0,
    });
  });

  it("falls back to the newest release when the manifest cannot be read", async () => {
    github.on(RELEASES, { body: RELEASE_ROWS });
    github.on(MANIFEST, { status: 404, body: { message: "Not Found" } });
    const response = await get(db());
    expect((await response.json()) as { latest: string }).toMatchObject({ latest: "1.6.0" });
  });

  it("serves the next 15 minutes from cache and says how old the answer is", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
    wire();

    const mock = db();
    expect((await (await get(mock)).json()) as { ageSeconds: number }).toMatchObject({
      ageSeconds: 0,
    });
    const afterFirst = github.calls.length;

    vi.setSystemTime(new Date("2026-09-17T12:03:00.000Z"));
    const second = (await (await get(mock)).json()) as { ageSeconds: number };

    expect(second.ageSeconds).toBe(180);
    expect(github.calls.length).toBe(afterFirst);
  });

  it("re-reads once the 15 minutes are up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
    wire();

    const mock = db();
    await get(mock);
    const afterFirst = github.calls.length;

    vi.setSystemTime(new Date("2026-09-17T12:16:00.000Z"));
    const second = (await (await get(mock)).json()) as { ageSeconds: number };

    expect(second.ageSeconds).toBe(0);
    expect(github.calls.length).toBeGreaterThan(afterFirst);
  });

  it("says nothing about tokens, drafts or builds", async () => {
    wire();
    const text = await (await get(db())).text();
    expect(text).not.toContain("ghp_read_only");
    expect(Object.keys(JSON.parse(text) as Record<string, unknown>).sort()).toEqual([
      "ageSeconds",
      "latest",
      "ok",
      "releases",
    ]);
  });

  it("refuses a seat whose monitoring.read was denied", async () => {
    wire();
    const response = await get(
      db(
        panelMemberRow(EMAIL, "viewer", { "monitoring.read": { effect: "deny", expiresAt: null } }),
      ),
    );
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("lets a support seat read it — the Versions page is not a releases seat", async () => {
    wire();
    const response = await get(db(panelMemberRow(EMAIL, "support")));
    expect(response.status).toBe(200);
  });
});
