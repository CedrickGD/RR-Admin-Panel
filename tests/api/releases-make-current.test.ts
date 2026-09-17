/**
 * `POST /api/admin/releases/:id/make-current` and `…/:id/unpublish-to-draft` — the governed
 * rollback and the refusal that leads to it. Design §6 and §12:
 *
 *   refuses a draft, a prerelease and an asset-less release; the effects carry the version change,
 *   an install count and a Discord line; a blocked unpublish returns `blockedBy: "manifest"` then
 *   succeeds after a `make-current`.
 *
 * The last case is run end to end against one `FakeGitHub` whose `update.xml` is whatever was last
 * committed to it, so "then succeeds" is the manifest actually having moved rather than a second
 * fixture asserting the same thing twice.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetConfirmTokenStateForTests } from "../../functions/_lib/release-confirm";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as confirm } from "../../functions/api/admin/releases/confirm";
import { onRequestPost as makeCurrent } from "../../functions/api/admin/releases/[id]/make-current";
import { onRequestPost as unpublish } from "../../functions/api/admin/releases/[id]/unpublish-to-draft";
import type {
  ConfirmEffect,
  MakeCurrentResponse,
  UnpublishBlockedResponse,
} from "../../shared/releases-contract";
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

const RELEASE = (id: number) => `GET /repos/${REPO}/releases/${id}`;
const PATCH_RELEASE = (id: number) => `PATCH /repos/${REPO}/releases/${id}`;
const RELEASES = `GET /repos/${REPO}/releases`;
const MANIFEST = `GET /repos/${REPO}/contents/update.xml`;
const REF = `GET /repos/${REPO}/git/ref/heads/master`;
const COMMIT_READ = `GET /repos/${REPO}/git/commits/head1`;
const BLOBS = `POST /repos/${REPO}/git/blobs`;
const TREES = `POST /repos/${REPO}/git/trees`;
const COMMITS = `POST /repos/${REPO}/git/commits`;
const PATCH_REF = `PATCH /repos/${REPO}/git/refs/heads/master`;

const INSTALLER = { id: 1, name: "RazorReaper-Setup.exe", size: 73_000_000 };

const ADOPTION_ROWS = [
  { version: "1.5.4", installs: 829 },
  { version: "1.5.3", installs: 171 },
];

function manifestFor(tag: string, version: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<item>",
    `    <version>${version}</version>`,
    `    <url>https://github.com/${REPO}/releases/download/${tag}/RazorReaper-Setup.exe</url>`,
    `    <changelog>https://github.com/${REPO}/releases/tag/${tag}</changelog>`,
    "    <mandatory>false</mandatory>",
    "    <args>/VERYSILENT /SUPPRESSMSGBOXES /NORESTART</args>",
    "    <notes>",
    "- The newest bullet.",
    "    </notes>",
    "</item>",
  ].join("\n");
}

function releaseBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    tag_name: "v1.5.3",
    name: "RazorReaper 1.5.3",
    draft: false,
    prerelease: false,
    assets: [INSTALLER],
    published_at: "2026-08-01T10:00:00.000Z",
    body: "## 1.5.3\n\n- A bullet the release body carries\n- And another\n\nProse that is not a bullet.",
    ...overrides,
  };
}

let github: FakeGitHub;
/** Whatever was last committed, so a make-current is visible to the next manifest read. */
let manifest: string;

beforeAll(async () => {
  await getTestAccessSigner();
});

beforeEach(() => {
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
  github = new FakeGitHub();
  manifest = manifestFor("v1.5.4", "1.5.4.0");
  github.on(MANIFEST, () => ({
    body: {
      path: "update.xml",
      sha: `sha-${manifest.length}`,
      size: manifest.length,
      encoding: "base64",
      content: base64(manifest),
    },
  }));
  github.on(REF, { body: { object: { sha: "head1" } } });
  github.on(COMMIT_READ, { body: { tree: { sha: "base1" } } });
  github.on(BLOBS, (call) => {
    manifest = (call.body as { content: string }).content;
    return { body: { sha: "blob1" } };
  });
  github.on(TREES, { body: { sha: "tree1" } });
  github.on(COMMITS, { body: { sha: "commitrollback" } });
  github.on(PATCH_REF, { body: {} });
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
});

function store(draft: Record<string, unknown> | null = null): ReleasesDb {
  return releasesDb({
    draft,
    member: panelMemberRow(EMAIL, "owner"),
    resolvers: {
      all: [
        { match: /FROM ranked WHERE rn = 1 GROUP BY version/, result: { results: ADOPTION_ROWS } },
      ],
    },
  });
}

function env(db: ReleasesDb, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, {
    DB: db.db,
    GITHUB_RELEASE_TOKEN: "github_pat_write",
    JWT_SECRET: "make-current-secret",
    ...overrides,
  });
}

async function call(
  handler: (context: {
    request: Request;
    env: RuntimeEnv;
    params: { id: string };
  }) => Promise<Response>,
  runtime: RuntimeEnv,
  id: number,
  json: Record<string, unknown>,
  path = "make-current",
): Promise<Response> {
  return handler({
    request: createSyntheticRequest({
      path: `/api/admin/releases/${id}/${path}`,
      json,
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: runtime,
    params: { id: String(id) },
  });
}

describe("POST /api/admin/releases/:id/make-current", () => {
  it("commits update.xml at the target tag, with the github.com shapes the C# test asserts", async () => {
    github.on(RELEASE(900), { body: releaseBody() });
    const db = store();
    const runtime = env(db);

    const response = await call(makeCurrent, runtime, 900, {
      commitMessage: "release: roll back to v1.5.3",
      confirmToken: await confirmTokenFor(runtime, "make-current", "900", EMAIL),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as MakeCurrentResponse;
    expect(payload).toMatchObject({
      tag: "v1.5.3",
      previousTag: "v1.5.4",
      commitSha: "commitrollback",
    });
    expect(payload.manifest.version).toBe("1.5.3.0");

    const committed = manifest;
    expect(committed).toContain("/releases/download/v1.5.3/RazorReaper-Setup.exe");
    expect(committed).toContain("/releases/tag/v1.5.3");
    expect(committed).toContain("<version>1.5.3.0</version>");
    // No draft row for the tag, so the release body's bullet lines are the notes — and its prose
    // is not.
    expect(committed).toContain("- A bullet the release body carries");
    expect(committed).not.toContain("Prose that is not a bullet");
    expect(github.callsFor(COMMITS)[0]?.body).toMatchObject({
      message: "release: roll back to v1.5.3",
    });
  });

  it("defaults the commit message and prefers the draft row's bullets and mandatory flag", async () => {
    github.on(RELEASE(900), { body: releaseBody() });
    const db = store({
      id: 4,
      version: "1.5.3",
      tag: "v1.5.3",
      title: "RazorReaper 1.5.3",
      notes_customer: "The bullet the panel wrote",
      notes_full_md: "",
      commit_message: "release: 1.5.3",
      mandatory: 1,
      prerelease: 0,
      status: "published",
      github_release_id: 900,
      github_run_id: null,
      asset_name: null,
      asset_size: null,
      created_by: EMAIL,
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-01T10:00:00.000Z",
      published_at: "2026-08-01T10:00:00.000Z",
    });
    const runtime = env(db);

    await call(makeCurrent, runtime, 900, {
      confirmToken: await confirmTokenFor(runtime, "make-current", "900", EMAIL),
    });

    const committed = manifest;
    expect(committed).toContain("- The bullet the panel wrote");
    expect(committed).toContain("<mandatory>true</mandatory>");
    expect(github.callsFor(COMMITS)[0]?.body).toMatchObject({
      message: "release: point update.xml at v1.5.3",
    });
    expect(db.events()[0]?.draftId).toBe(4);
    expect(db.audits()[0]?.action).toBe("release.make-current");
  });

  it.each([
    ["a draft", { id: 901, draft: true }, "still a draft"],
    ["a prerelease", { id: 902, prerelease: true }, "prerelease"],
    ["an asset-less release", { id: 903, assets: [] }, "RazorReaper-Setup.exe"],
  ])("refuses %s with nothing committed", async (_label, overrides, fragment) => {
    const id = overrides.id as number;
    github.on(RELEASE(id), { body: releaseBody(overrides) });
    const db = store();
    const runtime = env(db);

    const response = await call(makeCurrent, runtime, id, {
      confirmToken: await confirmTokenFor(runtime, "make-current", String(id), EMAIL),
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain(fragment);
    expect(github.keys()).not.toContain(PATCH_REF);
    expect(db.events()).toHaveLength(0);
  });

  it("refuses the tag update.xml already pins", async () => {
    github.on(RELEASE(904), { body: releaseBody({ id: 904, tag_name: "v1.5.4" }) });
    const db = store();
    const runtime = env(db);
    const response = await call(makeCurrent, runtime, 904, {
      confirmToken: await confirmTokenFor(runtime, "make-current", "904", EMAIL),
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "stale" });
  });

  it("refuses an expectedCurrentTag the manifest no longer carries", async () => {
    github.on(RELEASE(900), { body: releaseBody() });
    const db = store();
    const runtime = env(db);
    const response = await call(makeCurrent, runtime, 900, {
      expectedCurrentTag: "v1.5.2",
      confirmToken: await confirmTokenFor(runtime, "make-current", "900", EMAIL),
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "stale" });
    expect(github.keys()).not.toContain(PATCH_REF);
  });

  it("refuses without a write token, before a single GitHub call", async () => {
    const db = store();
    const response = await call(makeCurrent, env(db, { GITHUB_RELEASE_TOKEN: "xxx" }), 900, {
      confirmToken: "anything",
    });
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "no-write-token" });
    expect(github.calls).toHaveLength(0);
  });
});

describe("the confirm effects a make-current modal prints", () => {
  it("carry the version change, the install count and the Discord line", async () => {
    github.on(RELEASE(900), { body: releaseBody() });
    const db = store();
    const response = await confirm({
      request: createSyntheticRequest({
        path: "/api/admin/releases/confirm",
        json: { action: "make-current", subject: "900" },
        headers: await accessIdentityHeaders(EMAIL),
      }),
      env: env(db),
    });

    expect(response.status).toBe(200);
    const effects = ((await response.json()) as { effects: ConfirmEffect[] }).effects;
    expect(effects.map((effect) => effect.kind)).toEqual(["manifest", "installs", "discord"]);
    expect(effects[0]?.text).toBe("update.xml: 1.5.4 → 1.5.3.");
    expect(effects[1]?.text).toContain("829 installs are on 1.5.4");
    expect(effects[2]?.text).toBe("Discord: nothing is posted — update.xml only.");
  });
});

describe("POST /api/admin/releases/:id/unpublish-to-draft", () => {
  beforeEach(() => {
    github.on(RELEASE(910), { body: releaseBody({ id: 910, tag_name: "v1.5.4" }) });
    github.on(PATCH_RELEASE(910), {
      body: releaseBody({ id: 910, tag_name: "v1.5.4", draft: true }),
    });
    github.on(RELEASES, {
      body: [
        releaseBody({ id: 910, tag_name: "v1.5.4" }),
        releaseBody(),
        releaseBody({ id: 911, tag_name: "v1.5.2", assets: [] }),
        releaseBody({ id: 912, tag_name: "v1.5.1", prerelease: true }),
      ],
    });
    github.on(RELEASE(900), { body: releaseBody() });
  });

  it("is blocked while update.xml pins the tag, and offers the candidates that would work", async () => {
    const db = store();
    const runtime = env(db);
    const response = await call(
      unpublish,
      runtime,
      910,
      { confirmToken: await confirmTokenFor(runtime, "unpublish", "910", EMAIL) },
      "unpublish-to-draft",
    );

    expect(response.status).toBe(409);
    const payload = (await response.json()) as UnpublishBlockedResponse;
    expect(payload).toMatchObject({ code: "manifest-pinned", blockedBy: "manifest" });
    // v1.5.2 has no installer and v1.5.1 is a prerelease, so neither is offered.
    expect(payload.makeCurrentCandidates).toEqual([
      {
        releaseId: 900,
        tag: "v1.5.3",
        version: "1.5.3",
        publishedAt: "2026-08-01T10:00:00.000Z",
        hasInstallerAsset: true,
      },
    ]);
    expect(github.keys()).not.toContain(PATCH_RELEASE(910));
  });

  it("succeeds on the second click, after make-current moved the manifest", async () => {
    const db = store();
    const runtime = env(db);

    const blocked = await call(
      unpublish,
      runtime,
      910,
      { confirmToken: await confirmTokenFor(runtime, "unpublish", "910", EMAIL) },
      "unpublish-to-draft",
    );
    expect(blocked.status).toBe(409);

    const rolled = await call(makeCurrent, runtime, 900, {
      confirmToken: await confirmTokenFor(runtime, "make-current", "900", EMAIL),
    });
    expect(rolled.status).toBe(200);

    const response = await call(
      unpublish,
      runtime,
      910,
      { confirmToken: await confirmTokenFor(runtime, "unpublish", "910", EMAIL) },
      "unpublish-to-draft",
    );

    expect(response.status).toBe(200);
    expect(github.callsFor(PATCH_RELEASE(910))[0]?.body).toEqual({ draft: true });
    expect(db.events().map((event) => event.kind)).toEqual(["manifest_committed", "unpublished"]);
    expect(db.audits().map((audit) => audit.action)).toEqual([
      "release.make-current",
      "release.unpublish",
    ]);
  });

  it("refuses a release that is already a draft", async () => {
    github.on(RELEASE(913), { body: releaseBody({ id: 913, tag_name: "v1.4.9", draft: true }) });
    const db = store();
    const runtime = env(db);
    const response = await call(
      unpublish,
      runtime,
      913,
      { confirmToken: await confirmTokenFor(runtime, "unpublish", "913", EMAIL) },
      "unpublish-to-draft",
    );
    expect(response.status).toBe(409);
  });
});
