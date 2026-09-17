/**
 * `GET /api/admin/releases/files` — the Files tab's reader. Design §6, §9 and §11.
 *
 * What this suite is really for is the denylist: it has to hold in the read direction too, or the
 * panel becomes a way to read a signing certificate out of the repository. `update.xml` is the one
 * governed path that still opens, read-only, with the reason that points at Publish and Make
 * current.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestGet as files } from "../../functions/api/admin/releases/files";
import { FakeGitHub, base64 } from "../helpers/fake-github";
import { createMockD1, type MockD1 } from "../helpers/mock-d1";
import { PANEL_MEMBER_SQL, panelMemberRow, releasesFetch } from "../helpers/releases-api";
import {
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

const EMAIL = "owner@example.com";
const REPO = "CedrickGD/RazorReaper";

const TREE = `GET /repos/${REPO}/git/trees/master`;
const contents = (path: string) => `GET /repos/${REPO}/contents/${path}`;

const ROOT_TREE = [
  { path: "README.md", type: "blob", sha: "b1", size: 120 },
  { path: "installer", type: "tree", sha: "t1" },
  { path: "update.xml", type: "blob", sha: "b2", size: 800 },
  { path: ".github", type: "tree", sha: "t2" },
];

const RECURSIVE_TREE = [
  ...ROOT_TREE,
  { path: "installer/RazorReaper.iss", type: "blob", sha: "b3", size: 4_000 },
  { path: "installer/assets", type: "tree", sha: "t3" },
  { path: "installer/assets/icon.ico", type: "blob", sha: "b4", size: 9_000 },
];

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

function db(member = panelMemberRow(EMAIL, "owner")): MockD1 {
  return createMockD1({ first: [{ match: PANEL_MEMBER_SQL, result: member }] });
}

function env(mock: MockD1): RuntimeEnv {
  return testAccessEnv(EMAIL, { DB: mock.db, GITHUB_RELEASE_TOKEN: "github_pat_write" });
}

async function get(mock: MockD1, path?: string): Promise<Response> {
  return files({
    request: createSyntheticRequest({
      path: "/api/admin/releases/files",
      query: path === undefined ? {} : { path },
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: env(mock),
  });
}

/** One tree route that answers both the root listing and the recursive walk. */
function wireTrees(): void {
  github.on(TREE, (call) => ({
    body: { tree: call.url.includes("recursive=1") ? RECURSIVE_TREE : ROOT_TREE },
  }));
}

function blobReply(path: string, content: string, size = content.length) {
  return { body: { path, sha: `sha-${path}`, size, encoding: "base64", content: base64(content) } };
}

describe("GET /api/admin/releases/files — listings", () => {
  it("lists the repository root, trees first, with the denylist already applied", async () => {
    wireTrees();
    const response = await get(db());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ref: "master",
      path: "",
      entries: [
        { path: ".github", type: "tree", sha: "t2", size: null, editable: true },
        { path: "installer", type: "tree", sha: "t1", size: null, editable: true },
        { path: "README.md", type: "blob", sha: "b1", size: 120, editable: true },
        { path: "update.xml", type: "blob", sha: "b2", size: 800, editable: false },
      ],
    });
  });

  it("lists one directory's immediate children, not the whole walk below it", async () => {
    wireTrees();
    github.on(contents("installer"), { status: 404, body: { message: "Not Found" } });

    const response = await get(db(), "installer");
    const payload = (await response.json()) as { entries: Array<{ path: string }> };
    expect(payload.entries.map((entry) => entry.path)).toEqual([
      "installer/assets",
      "installer/RazorReaper.iss",
    ]);
  });

  it("404s a path that is neither a file nor a directory", async () => {
    wireTrees();
    github.on(contents("nope.txt"), { status: 404, body: { message: "Not Found" } });
    const response = await get(db(), "nope.txt");
    expect(response.status).toBe(404);
  });
});

describe("GET /api/admin/releases/files — blobs", () => {
  it("returns a readable, editable file", async () => {
    github.on(
      contents("installer/RazorReaper.iss"),
      blobReply("installer/RazorReaper.iss", '#define MyAppVersion "1.5.3"'),
    );
    const response = await get(db(), "installer/RazorReaper.iss");
    expect(await response.json()).toEqual({
      ok: true,
      ref: "master",
      path: "installer/RazorReaper.iss",
      file: {
        path: "installer/RazorReaper.iss",
        sha: "sha-installer/RazorReaper.iss",
        size: 28,
        content: '#define MyAppVersion "1.5.3"',
        editable: true,
      },
    });
  });

  it("opens update.xml read-only, with the reason pointing at the governed actions", async () => {
    github.on(contents("update.xml"), blobReply("update.xml", "<item></item>"));
    const response = await get(db(), "update.xml");
    const payload = (await response.json()) as { file: Record<string, unknown> };
    expect(payload.file.content).toBe("<item></item>");
    expect(payload.file.editable).toBe(false);
    expect(String(payload.file.editRefusal)).toContain("Publish and Make current");
  });

  it("marks a blob over the size threshold unreadable and not editable", async () => {
    github.on(contents("docs/big.md"), {
      body: { path: "docs/big.md", sha: "big", size: 900_000, encoding: "base64", content: "" },
    });
    const response = await get(db(), "docs/big.md");
    const payload = (await response.json()) as { file: Record<string, unknown> };
    expect(payload.file).toMatchObject({
      content: null,
      unreadable: "too-large",
      editable: false,
    });
    expect(String(payload.file.editRefusal)).toContain("512 KB");
  });

  it("marks a blob that is not UTF-8 text unreadable", async () => {
    github.on(contents("assets/icon.ico"), {
      body: {
        path: "assets/icon.ico",
        sha: "ico",
        size: 8,
        encoding: "base64",
        content: Buffer.from([0xff, 0xfe, 0x00, 0x01]).toString("base64"),
      },
    });
    const response = await get(db(), "assets/icon.ico");
    const payload = (await response.json()) as { file: Record<string, unknown> };
    expect(payload.file).toMatchObject({ content: null, unreadable: "binary", editable: false });
  });
});

describe("GET /api/admin/releases/files — refusals", () => {
  it.each([
    ["Self-Sign/RazorReaperCodeSign.pfx", "Signing material"],
    ["deploy/nas/admin.env", "Environment files"],
    ["RazorReaper/appsettings.Production.json", "Application settings"],
    [".git/config", "Git's own directory"],
  ])("refuses %s with denied-path, before a single GitHub call", async (path, fragment) => {
    const response = await get(db(), path);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: expect.stringContaining(fragment),
      code: "denied-path",
    });
    expect(github.calls).toHaveLength(0);
  });

  it("refuses a path that escapes the repository root", async () => {
    const response = await get(db(), "../../etc/passwd");
    expect(response.status).toBe(400);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses an admin seat — reading a repository file is as owner-only as writing one", async () => {
    wireTrees();
    const response = await get(db(panelMemberRow(EMAIL, "admin")));
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("lets an owner through", async () => {
    wireTrees();
    const response = await get(db(panelMemberRow(EMAIL, "owner")));
    expect(response.status).toBe(200);
  });
});
