/**
 * `POST /api/admin/releases/confirm` — the endpoint that mints a confirm token **and the effect
 * list the modal prints**. Design §6 ("Confirm effects are server-generated, always"), §11 and
 * §12.
 *
 * The invariant worth a suite of its own is the Discord line: every `publish` carries one,
 * prerelease included, and it is emitted even when `discord-release.yml` cannot be read, because a
 * surprise post is worse than a redundant warning. `make-current` carries the line that says
 * nothing is posted.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGithubReleaseStateForTests } from "../../functions/_lib/github-release";
import type { PanelMember } from "../../functions/_lib/panel-access";
import { resetConfirmTokenStateForTests } from "../../functions/_lib/release-confirm";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as confirm } from "../../functions/api/admin/releases/confirm";
import { hasDiscordEffect, type ConfirmEffect } from "../../shared/releases-contract";
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
const REPO = "CedrickGD/RazorReaper";

const MANIFEST = `GET /repos/${REPO}/contents/update.xml`;
const TAG = (tag: string) => `GET /repos/${REPO}/releases/tags/${tag}`;
const RELEASE = (id: number) => `GET /repos/${REPO}/releases/${id}`;
const DISCORD_YML = `GET /repos/${REPO}/contents/.github/workflows/discord-release.yml`;
const CSPROJ = `GET /repos/${REPO}/contents/RazorReaper/RazorReaper.csproj`;
const WORKFLOW_LIST = `GET /repos/${REPO}/actions/workflows`;

const UPDATE_XML = [
  "<item>",
  "  <version>1.5.2.0</version>",
  `  <url>https://github.com/${REPO}/releases/download/v1.5.2/RazorReaper-Setup.exe</url>`,
  "</item>",
].join("\n");

const DISCORD_YAML = [
  "name: Discord release",
  "on:",
  "  release:",
  "    types: [published, prereleased]",
].join("\n");

const ADOPTION_ROWS = [
  { version: "1.5.2", installs: 829 },
  { version: "1.5.1", installs: 171 },
];

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    version: "1.5.3",
    tag: "v1.5.3",
    title: "RazorReaper 1.5.3",
    notes_customer: "One calm bullet",
    notes_full_md: "",
    commit_message: "release: 1.5.3",
    mandatory: 0,
    prerelease: 0,
    status: "built",
    github_release_id: null,
    github_run_id: 555,
    asset_name: "RazorReaper-Setup.exe",
    asset_size: 42,
    created_by: EMAIL,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    published_at: null,
    ...overrides,
  };
}

function releaseBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    tag_name: "v1.5.2",
    name: "RazorReaper 1.5.2",
    draft: false,
    prerelease: false,
    assets: [{ id: 1, name: "RazorReaper-Setup.exe", size: 42 }],
    ...overrides,
  };
}

let github: FakeGitHub;

beforeAll(async () => {
  await getTestAccessSigner();
});

beforeEach(() => {
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
  github = new FakeGitHub();
  vi.stubGlobal("fetch", vi.fn(releasesFetch(github)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetGithubReleaseStateForTests();
  resetConfirmTokenStateForTests();
});

function db(
  draft: Record<string, unknown> | null = draftRow(),
  /** `null` is a seat with no `panel_members` row — no panel permissions at all. */
  member: PanelMember | null = panelMemberRow(EMAIL, "owner"),
  resolvers: MockD1Resolvers = {},
): MockD1 {
  return createMockD1({
    ...resolvers,
    first: [
      { match: PANEL_MEMBER_SQL, result: member },
      { match: /FROM release_drafts WHERE id = \?/, result: draft },
    ],
    all: [
      { match: /FROM ranked WHERE rn = 1 GROUP BY version/, result: { results: ADOPTION_ROWS } },
      ...(resolvers.all ?? []),
    ],
  });
}

function env(mock: MockD1, overrides: Partial<RuntimeEnv> = {}): RuntimeEnv {
  return testAccessEnv(EMAIL, {
    DB: mock.db,
    GITHUB_RELEASE_TOKEN: "github_pat_write",
    JWT_SECRET: "confirm-test-secret",
    ...overrides,
  });
}

async function post(
  mock: MockD1,
  json: unknown,
  overrides: Partial<RuntimeEnv> = {},
): Promise<Response> {
  return confirm({
    request: createSyntheticRequest({
      path: "/api/admin/releases/confirm",
      json,
      headers: await accessIdentityHeaders(EMAIL),
    }),
    env: env(mock, overrides),
  });
}

async function effectsOf(response: Response): Promise<ConfirmEffect[]> {
  const payload = (await response.json()) as { effects?: ConfirmEffect[] };
  return payload.effects ?? [];
}

function wireManifest(): void {
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

function wireDiscordWorkflow(): void {
  github.on(DISCORD_YML, {
    body: {
      path: ".github/workflows/discord-release.yml",
      sha: "yml",
      size: DISCORD_YAML.length,
      encoding: "base64",
      content: base64(DISCORD_YAML),
    },
  });
}

describe("POST /api/admin/releases/confirm — publish", () => {
  beforeEach(() => {
    wireManifest();
    wireDiscordWorkflow();
    github.on(TAG("v1.5.3"), {
      body: releaseBody({ id: 901, tag_name: "v1.5.3", draft: true }),
    });
  });

  it("mints a token with a server-generated effect list, in order", async () => {
    const response = await post(db(), { action: "publish", subject: "7" });
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      ok: boolean;
      token: string;
      expiresAt: string;
      effects: ConfirmEffect[];
    };
    expect(payload.ok).toBe(true);
    expect(payload.token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.now());

    expect(payload.effects.map((effect) => effect.kind)).toEqual([
      "github",
      "manifest",
      "installs",
      "discord",
    ]);
    expect(payload.effects[1]?.text).toContain("update.xml: 1.5.2 → 1.5.3");
    expect(payload.effects[2]?.text).toContain("829");
    expect(payload.effects[3]?.text).toContain("discord-release.yml");
  });

  it("warns that the release has no installer yet, from live state", async () => {
    github.on(TAG("v1.5.3"), { body: releaseBody({ id: 901, tag_name: "v1.5.3", assets: [] }) });
    const effects = await effectsOf(await post(db(), { action: "publish", subject: "7" }));
    expect(effects.find((effect) => effect.kind === "note")?.text).toContain(
      "RazorReaper-Setup.exe",
    );
  });

  it("says the manifest is skipped for a prerelease, and still carries the Discord line", async () => {
    const effects = await effectsOf(
      await post(db(draftRow({ prerelease: 1 })), { action: "publish", subject: "7" }),
    );
    expect(effects.find((effect) => effect.kind === "manifest")?.text).toContain("not rewritten");
    expect(effects.some((effect) => effect.kind === "installs")).toBe(false);
    expect(hasDiscordEffect(effects)).toBe(true);
  });

  it("emits the Discord line even when discord-release.yml cannot be read", async () => {
    github.on(DISCORD_YML, { status: 500, body: { message: "boom" } });
    const effects = await effectsOf(await post(db(), { action: "publish", subject: "7" }));
    expect(hasDiscordEffect(effects)).toBe(true);
  });

  it("404s a draft that is not there", async () => {
    const response = await post(db(null), { action: "publish", subject: "7" });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/admin/releases/confirm — make-current", () => {
  beforeEach(() => {
    wireManifest();
  });

  it("prints the version change, the install count and the line saying nothing is posted", async () => {
    github.on(RELEASE(880), { body: releaseBody({ id: 880, tag_name: "v1.5.1" }) });
    const effects = await effectsOf(await post(db(), { action: "make-current", subject: "880" }));

    expect(effects).toEqual([
      { kind: "manifest", text: "update.xml: 1.5.2 → 1.5.1." },
      {
        kind: "installs",
        text: "829 installs are on 1.5.2; they are not downgraded, but every new check now resolves 1.5.1.",
      },
      { kind: "discord", text: "Discord: nothing is posted — update.xml only." },
    ]);
  });

  it.each([
    ["a draft", { id: 881, tag_name: "v1.5.1", draft: true }, "still a draft"],
    ["a prerelease", { id: 882, tag_name: "v1.5.1", prerelease: true }, "prerelease"],
    ["an asset-less release", { id: 883, tag_name: "v1.5.1", assets: [] }, "RazorReaper-Setup.exe"],
  ])("refuses %s at mint, with nothing minted", async (_label, overrides, fragment) => {
    const id = overrides.id as number;
    github.on(RELEASE(id), { body: releaseBody(overrides) });
    const response = await post(db(), { action: "make-current", subject: String(id) });

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { ok: boolean; error: string; token?: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain(fragment);
    expect(payload.token).toBeUndefined();
  });

  it("refuses the tag update.xml already pins", async () => {
    github.on(RELEASE(900), { body: releaseBody() });
    const response = await post(db(), { action: "make-current", subject: "900" });
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "stale" });
  });

  // A manifest whose <url> carries no /releases/download/<tag>/ segment — a legacy file, or one
  // already rewritten to a NAS URL — leaves <version> as the only usable signal, and <version> is
  // the 4-part number. `pinnedTag()` has to normalise "1.5.2.0" to "v1.5.2"; prefixing a `v`
  // straight onto it would compare "v1.5.2.0" against "v1.5.2" and never match, so the already-
  // pinned refusal would silently stop firing and a no-op rollback would mint a token.
  describe("with a manifest whose url pins no tag", () => {
    beforeEach(() => {
      const legacy = [
        "<item>",
        "  <version>1.5.2.0</version>",
        "  <url>https://dl.razorreaper.app/update/download</url>",
        "</item>",
      ].join("\n");
      github.on(MANIFEST, {
        body: {
          path: "update.xml",
          sha: "sha",
          size: legacy.length,
          encoding: "base64",
          content: base64(legacy),
        },
      });
    });

    it("still refuses the release <version> resolves to, via the 4-part fallback", async () => {
      github.on(RELEASE(900), { body: releaseBody() });
      const response = await post(db(), { action: "make-current", subject: "900" });
      expect(response.status).toBe(409);
      expect((await response.json()) as { code: string; error: string }).toMatchObject({
        code: "stale",
        error: "update.xml already pins v1.5.2.",
      });
    });

    it("reads the from-version off <version> and mints for a different release", async () => {
      github.on(RELEASE(880), { body: releaseBody({ id: 880, tag_name: "v1.5.1" }) });
      const effects = await effectsOf(await post(db(), { action: "make-current", subject: "880" }));
      expect(effects[0]).toEqual({ kind: "manifest", text: "update.xml: 1.5.2 → 1.5.1." });
      expect(effects[1]?.text).toContain("829 installs are on 1.5.2");
    });
  });
});

describe("POST /api/admin/releases/confirm — unpublish", () => {
  it("says the tag and its assets stay, and warns while the manifest pins it", async () => {
    wireManifest();
    github.on(RELEASE(900), { body: releaseBody() });
    const effects = await effectsOf(await post(db(), { action: "unpublish", subject: "900" }));

    expect(effects[0]?.kind).toBe("github");
    expect(effects[0]?.text).toContain("goes back to a draft");
    expect(effects[1]?.text).toContain("Make current");
    // The block itself belongs to the action, which answers with makeCurrentCandidates.
    expect(effects.some((effect) => effect.kind === "discord")).toBe(false);
  });

  it("mints without a warning for a release the manifest does not pin", async () => {
    wireManifest();
    github.on(RELEASE(880), { body: releaseBody({ id: 880, tag_name: "v1.5.1" }) });
    const effects = await effectsOf(await post(db(), { action: "unpublish", subject: "880" }));
    expect(effects).toHaveLength(1);
  });
});

describe("POST /api/admin/releases/confirm — build", () => {
  it("describes the version-bump commit and the dispatch", async () => {
    github.on(CSPROJ, {
      body: {
        path: "RazorReaper/RazorReaper.csproj",
        sha: "c",
        size: 40,
        encoding: "base64",
        content: base64("<ApplicationDisplayVersion>1.5.2</ApplicationDisplayVersion>"),
      },
    });
    const effects = await effectsOf(await post(db(), { action: "build", subject: "7" }));
    expect(effects[0]?.text).toContain("installer/RazorReaper.iss");
    expect(effects[0]?.text).toContain("release: 1.5.3");
    expect(effects[1]?.text).toContain("build-installer.yml");
  });

  it("says no commit is made when master already carries the version", async () => {
    github.on(CSPROJ, {
      body: {
        path: "RazorReaper/RazorReaper.csproj",
        sha: "c",
        size: 40,
        encoding: "base64",
        content: base64("<ApplicationDisplayVersion>1.5.3</ApplicationDisplayVersion>"),
      },
    });
    const effects = await effectsOf(await post(db(), { action: "build", subject: "7" }));
    expect(effects[0]?.text).toContain("no version-bump commit");
  });
});

describe("POST /api/admin/releases/confirm — commit and dispatch", () => {
  it("refuses a denylisted path with denied-path and no GitHub call", async () => {
    const response = await post(db(), { action: "commit", subject: "update.xml" });
    expect(response.status).toBe(403);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "denied-path" });
    expect(github.calls).toHaveLength(0);
  });

  it("warns that a workflow edit is remote code execution on the runner", async () => {
    const effects = await effectsOf(
      await post(db(), { action: "commit", subject: ".github/workflows/build-installer.yml" }),
    );
    expect(effects[1]?.text).toContain("remote code execution");
  });

  it("names the workflow a dispatch will start", async () => {
    github.on(WORKFLOW_LIST, {
      body: {
        workflows: [
          { id: 10, name: "Build installer", path: ".github/workflows/build-installer.yml" },
        ],
      },
    });
    const effects = await effectsOf(await post(db(), { action: "dispatch", subject: "10" }));
    expect(effects[0]?.text).toContain("Build installer");
    expect(effects[0]?.text).toContain("master");
  });

  it("404s an unknown workflow", async () => {
    github.on(WORKFLOW_LIST, { body: { workflows: [] } });
    const response = await post(db(), { action: "dispatch", subject: "10" });
    expect(response.status).toBe(404);
  });

  it("refuses an admin seat: files and workflows are owner-only in both directions", async () => {
    const response = await post(db(draftRow(), panelMemberRow(EMAIL, "admin")), {
      action: "commit",
      subject: "installer/RazorReaper.iss",
    });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  // A seat with no `panel_members` row carries no permissions at all, and `requireDashboardAccess`
  // lets exactly one such seat this far: an AppUserRole admin, whose `!member` branch exempts
  // admins from the `.write` denial. Unknown permissions are not permission — the gate has to
  // fail closed rather than skip itself because there is nothing to check.
  it.each(["commit", "dispatch"] as const)(
    "refuses a seat with no panel permissions at all (%s)",
    async (action) => {
      github.on(WORKFLOW_LIST, {
        body: {
          workflows: [
            { id: 10, name: "Build installer", path: ".github/workflows/build-installer.yml" },
          ],
        },
      });
      const subject = action === "commit" ? "installer/RazorReaper.iss" : "10";
      const response = await post(db(draftRow(), null), { action, subject });

      expect(response.status).toBe(403);
      // Refused before any state is read, so the effect list never tells such a seat what is on
      // master — the second half of "owner-only in both directions".
      expect(github.calls).toHaveLength(0);
      expect((await response.json()) as { token?: string }).not.toHaveProperty("token");
    },
  );
});

describe("POST /api/admin/releases/confirm — guards", () => {
  it("refuses a seat without releases.write", async () => {
    const response = await post(db(draftRow(), panelMemberRow(EMAIL, "support")), {
      action: "publish",
      subject: "7",
    });
    expect(response.status).toBe(403);
    expect(github.calls).toHaveLength(0);
  });

  it("refuses an action it does not know", async () => {
    const response = await post(db(), { action: "delete-everything", subject: "7" });
    expect(response.status).toBe(400);
  });

  it("refuses a request with no subject", async () => {
    const response = await post(db(), { action: "publish" });
    expect(response.status).toBe(400);
  });

  it("says so plainly when JWT_SECRET is missing, after the effects were computed", async () => {
    wireManifest();
    wireDiscordWorkflow();
    github.on(TAG("v1.5.3"), { body: releaseBody({ id: 901, tag_name: "v1.5.3", draft: true }) });

    const response = await post(db(), { action: "publish", subject: "7" }, { JWT_SECRET: "" });
    expect(response.status).toBe(500);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: "Server is missing JWT_SECRET.",
    });
  });

  it("never echoes the token", async () => {
    wireManifest();
    wireDiscordWorkflow();
    github.on(TAG("v1.5.3"), { body: releaseBody({ id: 901, tag_name: "v1.5.3", draft: true }) });
    const response = await post(db(), { action: "publish", subject: "7" });
    expect(await response.text()).not.toContain("github_pat_write");
  });
});
