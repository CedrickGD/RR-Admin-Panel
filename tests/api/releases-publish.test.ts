/**
 * `POST /api/admin/releases/drafts/:id/publish` — the five-step, resumable publish. Design §6
 * ("Publish, step by step") and §12, which names exactly what this suite must prove:
 *
 *   the five steps in order; a failure at `manifest_committed` leaves `failed` with three recorded
 *   and a retry performs only 4–5; no asset → refused; a prerelease runs 1–3 and 5 and **never**
 *   writes `update.xml`; the committed manifest matches both substrings `ReleaseReadinessTests`
 *   asserts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { resetConfirmTokenStateForTests } from "../../functions/_lib/release-confirm";
import { renderUpdateXml } from "../../functions/_lib/update-manifest";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as publish } from "../../functions/api/admin/releases/drafts/[id]/publish";
import type { PublishResponse } from "../../shared/releases-contract";
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
const RELEASE_ID = 901;

const TAG_LOOKUP = `GET /repos/${REPO}/releases/tags/v1.5.4`;
const CREATE_RELEASE = `POST /repos/${REPO}/releases`;
const PATCH_RELEASE = `PATCH /repos/${REPO}/releases/${RELEASE_ID}`;
const MANIFEST = `GET /repos/${REPO}/contents/update.xml`;
const REF = `GET /repos/${REPO}/git/ref/heads/master`;
const COMMIT_READ = `GET /repos/${REPO}/git/commits/head1`;
const BLOBS = `POST /repos/${REPO}/git/blobs`;
const TREES = `POST /repos/${REPO}/git/trees`;
const COMMITS = `POST /repos/${REPO}/git/commits`;
const PATCH_REF = `PATCH /repos/${REPO}/git/refs/heads/master`;

const INSTALLER = { id: 1, name: "RazorReaper-Setup.exe", size: 73_000_000 };

const CURRENT_MANIFEST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<item>",
  "    <version>1.5.3.0</version>",
  `    <url>https://github.com/${REPO}/releases/download/v1.5.3/RazorReaper-Setup.exe</url>`,
  `    <changelog>https://github.com/${REPO}/releases/tag/v1.5.3</changelog>`,
  "    <mandatory>false</mandatory>",
  "    <args>/VERYSILENT /SUPPRESSMSGBOXES /NORESTART</args>",
  "    <notes>",
  "- An older bullet.",
  "    </notes>",
  "</item>",
].join("\n");

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    version: "1.5.4",
    tag: "v1.5.4",
    title: "RazorReaper 1.5.4",
    notes_customer: "Receive private support replies\nThe first conversion downloads ffmpeg",
    notes_full_md: "## 1.5.4\n\nThe long form.",
    commit_message: "release: 1.5.4",
    mandatory: 0,
    prerelease: 0,
    status: "built",
    github_release_id: null,
    github_run_id: 501,
    asset_name: "RazorReaper-Setup.exe",
    asset_size: 73_000_000,
    created_by: EMAIL,
    created_at: NOW,
    updated_at: NOW,
    published_at: null,
    ...overrides,
  };
}

let github: FakeGitHub;
/** The release as the fake holds it, so a PATCH is reflected by the next read. */
let release: { draft: boolean; prerelease: boolean; assets: Array<typeof INSTALLER> };

beforeAll(async () => {
  await getTestAccessSigner();
});

beforeEach(() => {
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
  github = new FakeGitHub();
  release = { draft: true, prerelease: false, assets: [INSTALLER] };
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  resetRateLimitsForTests();
});

function releaseBody() {
  return {
    id: RELEASE_ID,
    tag_name: "v1.5.4",
    name: "RazorReaper 1.5.4",
    draft: release.draft,
    prerelease: release.prerelease,
    assets: release.assets,
    html_url: `https://github.com/${REPO}/releases/tag/v1.5.4`,
  };
}

function wireRelease(): void {
  github.on(TAG_LOOKUP, () => ({ body: releaseBody() }));
  github.on(CREATE_RELEASE, () => ({ body: releaseBody() }));
  github.on(PATCH_RELEASE, (call) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    if (typeof body.draft === "boolean") release.draft = body.draft;
    if (typeof body.prerelease === "boolean") release.prerelease = body.prerelease;
    return { body: releaseBody() };
  });
}

function wireManifest(xml = CURRENT_MANIFEST): void {
  github.on(MANIFEST, {
    body: {
      path: "update.xml",
      sha: "manifest-sha",
      size: xml.length,
      encoding: "base64",
      content: base64(xml),
    },
  });
}

function wireGitData(): void {
  github.on(REF, { body: { object: { sha: "head1" } } });
  github.on(COMMIT_READ, { body: { tree: { sha: "base1" } } });
  github.on(BLOBS, { body: { sha: "blob1" } });
  github.on(TREES, { body: { sha: "tree1" } });
  github.on(COMMITS, { body: { sha: "commitmanifest" } });
  github.on(PATCH_REF, { body: {} });
}

function env(store: ReleasesDb, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, {
    DB: store.db,
    GITHUB_RELEASE_TOKEN: "github_pat_write",
    JWT_SECRET: "publish-test-secret",
    ...overrides,
  });
}

function store(overrides: Record<string, unknown> = {}): ReleasesDb {
  return releasesDb({ draft: draftRow(overrides), member: panelMemberRow(EMAIL, "owner") });
}

async function post(
  runtime: RuntimeEnv,
  body: Record<string, unknown>,
): Promise<PublishResponse & { code?: string; error?: string }> {
  const response = await publish({
    request: createSyntheticRequest({
      path: "/api/admin/releases/drafts/7/publish",
      json: body,
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: runtime,
    params: { id: "7" },
  });
  return (await response.json()) as PublishResponse & { code?: string; error?: string };
}

async function statusOf(runtime: RuntimeEnv, body: Record<string, unknown>): Promise<number> {
  const response = await publish({
    request: createSyntheticRequest({
      path: "/api/admin/releases/drafts/7/publish",
      json: body,
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: runtime,
    params: { id: "7" },
  });
  return response.status;
}

describe("the five steps, in order", () => {
  it("upserts, writes the body, publishes, commits the manifest and records", async () => {
    wireRelease();
    wireManifest();
    wireGitData();
    const db = store();
    const runtime = env(db);

    const payload = await post(runtime, {
      expectedStatus: "built",
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    expect(payload.ok).toBe(true);
    expect(payload.failedStep).toBeUndefined();
    expect(payload.completedSteps).toEqual([
      "release_upserted",
      "body_written",
      "release_published",
      "manifest_committed",
      "recorded",
    ]);
    expect(github.keys()).toEqual([
      TAG_LOOKUP,
      PATCH_RELEASE,
      PATCH_RELEASE,
      MANIFEST,
      REF,
      COMMIT_READ,
      BLOBS,
      TREES,
      COMMITS,
      PATCH_REF,
    ]);
    expect(payload.draft.status).toBe("published");
    expect(payload.draft.publishedAt).not.toBeNull();
  });

  it("creates the release when the tag has none yet", async () => {
    wireRelease();
    github.on(TAG_LOOKUP, { status: 404, body: { message: "Not Found" } });
    wireManifest();
    wireGitData();
    const db = store();
    const runtime = env(db);

    await post(runtime, {
      expectedStatus: "built",
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    expect(github.callsFor(CREATE_RELEASE)[0]?.body).toMatchObject({
      tag_name: "v1.5.4",
      name: "RazorReaper 1.5.4",
      draft: true,
      prerelease: false,
    });
    expect(db.draft()?.github_release_id).toBe(RELEASE_ID);
  });

  it("publishes with draft: false, and that is the only call that does", async () => {
    wireRelease();
    wireManifest();
    wireGitData();
    const db = store();
    const runtime = env(db);
    await post(runtime, {
      expectedStatus: "built",
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    const patches = github.callsFor(PATCH_RELEASE).map((call) => call.body);
    expect(patches[0]).toEqual({
      name: "RazorReaper 1.5.4",
      body: "## 1.5.4\n\nThe long form.",
      prerelease: false,
    });
    expect(patches[1]).toEqual({ draft: false });
  });

  it("records every step and one audit row", async () => {
    wireRelease();
    wireManifest();
    wireGitData();
    const db = store();
    const runtime = env(db);
    await post(runtime, {
      expectedStatus: "built",
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    expect(db.eventDetails().map((detail) => detail.split(" ")[0])).toEqual([
      "publish:release_upserted",
      "publish:body_written",
      "publish:release_published",
      "publish:manifest_committed",
      "publish:recorded",
    ]);
    expect(db.audits()).toHaveLength(1);
    expect(db.audits()[0]).toMatchObject({ target: "v1.5.4", action: "release.publish" });
  });
});

describe("the committed manifest", () => {
  it("carries the two substrings ReleaseReadinessTests asserts, and keeps the args", async () => {
    wireRelease();
    wireManifest();
    wireGitData();
    const db = store({ mandatory: 1 });
    const runtime = env(db);
    await post(runtime, {
      expectedStatus: "built",
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    const committed = (github.callsFor(BLOBS)[0]?.body as { content: string }).content;
    expect(committed).toContain("/releases/download/v1.5.4/RazorReaper-Setup.exe");
    expect(committed).toContain("/releases/tag/v1.5.4");
    expect(committed).toContain("<version>1.5.4.0</version>");
    expect(committed).toContain("<mandatory>true</mandatory>");
    expect(committed).toContain("<args>/VERYSILENT /SUPPRESSMSGBOXES /NORESTART</args>");
    expect(committed).toContain("- Receive private support replies");
    expect(committed).not.toContain("An older bullet");
    expect(github.callsFor(COMMITS)[0]?.body).toMatchObject({ message: "release: 1.5.4" });
    expect(github.callsFor(PATCH_REF)[0]?.body).toEqual({ sha: "commitmanifest", force: false });
  });

  it("escapes what a customer bullet may legitimately contain", () => {
    const xml = renderUpdateXml({
      version: "1.5.4.0",
      url: "https://example.test/a",
      changelog: "https://example.test/b",
      mandatory: false,
      args: "/VERYSILENT",
      notes: ["Fixes < & > in names"],
    });
    expect(xml).toContain("- Fixes &lt; &amp; &gt; in names");
    expect(xml.endsWith("</item>\n")).toBe(true);
  });
});

describe("a prerelease", () => {
  it("runs 1–3 and 5 and never writes update.xml", async () => {
    wireRelease();
    wireManifest();
    wireGitData();
    const db = store({ prerelease: 1 });
    const runtime = env(db);

    const payload = await post(runtime, {
      expectedStatus: "built",
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    expect(payload.completedSteps).toEqual([
      "release_upserted",
      "body_written",
      "release_published",
      "recorded",
    ]);
    expect(payload.manifest).toBeNull();
    expect(github.keys()).not.toContain(MANIFEST);
    expect(github.keys()).not.toContain(PATCH_REF);
    expect(db.draft()?.status).toBe("published");
  });

  it("skips it for skipManifest too, and says so in the audit line", async () => {
    wireRelease();
    wireManifest();
    wireGitData();
    const db = store();
    const runtime = env(db);

    const payload = await post(runtime, {
      expectedStatus: "built",
      skipManifest: true,
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    expect(payload.completedSteps).not.toContain("manifest_committed");
    expect(github.keys()).not.toContain(PATCH_REF);
    expect(db.audits()[0]?.detail).toContain("without rewriting update.xml");
  });
});

describe("refusals and resumption", () => {
  it("refuses to publish a release with no installer, and never sends draft: false", async () => {
    release.assets = [];
    wireRelease();
    wireManifest();
    const db = store();
    const runtime = env(db);

    const payload = await post(runtime, {
      expectedStatus: "built",
      confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
    });

    expect(payload.failedStep).toBe("release_published");
    expect(payload.failureReason).toContain("RazorReaper-Setup.exe");
    expect(payload.completedSteps).toEqual(["release_upserted", "body_written"]);
    expect(github.callsFor(PATCH_RELEASE)).toHaveLength(1);
    expect(db.draft()?.status).toBe("failed");
  });

  it("leaves three steps recorded when the manifest commit fails, then resumes with 4 and 5", async () => {
    wireRelease();
    github.on(MANIFEST, { status: 500, body: { message: "boom" } });
    wireGitData();
    const db = store();
    const runtime = env(db);
    const confirmToken = await confirmTokenFor(runtime, "publish", "7", EMAIL);

    const first = await post(runtime, { expectedStatus: "built", confirmToken });
    expect(first.failedStep).toBe("manifest_committed");
    expect(first.completedSteps).toEqual(["release_upserted", "body_written", "release_published"]);
    expect(db.draft()?.status).toBe("failed");

    // The same token, because §6 says a retry resumes rather than starting again.
    github.reset();
    wireManifest();
    const second = await post(runtime, { expectedStatus: "failed", confirmToken });

    expect(second.failedStep).toBeUndefined();
    expect(second.completedSteps).toEqual([
      "release_upserted",
      "body_written",
      "release_published",
      "manifest_committed",
      "recorded",
    ]);
    // Only steps 4 and 5 ran: nothing touched the release itself a second time.
    expect(github.keys()).toEqual([MANIFEST, REF, COMMIT_READ, BLOBS, TREES, COMMITS, PATCH_REF]);
    expect(db.draft()?.status).toBe("published");
  });

  it("burns the confirmation once the run reaches recorded", async () => {
    wireRelease();
    wireManifest();
    wireGitData();
    const db = store();
    const runtime = env(db);
    const confirmToken = await confirmTokenFor(runtime, "publish", "7", EMAIL);

    expect(await statusOf(runtime, { expectedStatus: "built", confirmToken })).toBe(200);
    expect(await statusOf(runtime, { expectedStatus: "published", confirmToken })).toBe(403);
  });

  it("409s an expectedStatus the row no longer has", async () => {
    const db = store();
    const runtime = env(db);
    const response = await publish({
      request: createSyntheticRequest({
        path: "/api/admin/releases/drafts/7/publish",
        json: {
          expectedStatus: "draft",
          confirmToken: await confirmTokenFor(runtime, "publish", "7", EMAIL),
        },
        headers: await accessIdentityHeaders(EMAIL),
      }),
      env: runtime,
      params: { id: "7" },
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "status-mismatch" });
    expect(github.calls).toHaveLength(0);
  });

  it("refuses without a write token, before anything is read", async () => {
    const db = store();
    const runtime = env(db, { GITHUB_RELEASE_TOKEN: "xxx" });
    const response = await publish({
      request: createSyntheticRequest({
        path: "/api/admin/releases/drafts/7/publish",
        json: { expectedStatus: "built", confirmToken: "anything" },
        headers: await accessIdentityHeaders(EMAIL),
      }),
      env: runtime,
      params: { id: "7" },
    });

    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "no-write-token" });
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a seat without releases.write", async () => {
    const db = releasesDb({ draft: draftRow(), member: panelMemberRow(EMAIL, "support") });
    const runtime = env(db);
    const response = await publish({
      request: createSyntheticRequest({
        path: "/api/admin/releases/drafts/7/publish",
        json: { expectedStatus: "built", confirmToken: "anything" },
        headers: await accessIdentityHeaders(EMAIL),
      }),
      env: runtime,
      params: { id: "7" },
    });

    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });
});
