/**
 * The Releases page's surface (docs/release-management-design.md §9, §12 `releases-page`).
 *
 * What this suite exists to pin down, in the design's own words:
 *  - `Releases | Drafts | Workflows | Files`, with the last two **hidden entirely** without
 *    `releases.files` — absent, not disabled, so an admin seat is never shown a commit box.
 *  - A confirm modal prints the server's `ConfirmEffect[]` **verbatim and in order**, and the
 *    page composes no effect copy of its own.
 *  - While `token.canWrite` is false a persistent status line carries the server's sentence and
 *    every write button is disabled with that sentence as its title (decision 8).
 *  - Nothing in the page can scroll the viewport sideways: the editor collapses to one column
 *    below 900px and every table stacks into cards on a phone.
 *
 * The seam is the panel's own fetch helper, exactly as the customer and feedback suites use it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import { ReleasesPage } from "../src/pages/ReleasesPage";
import type { Permission } from "../shared/panel-policy";
import type { AuthUser } from "../src/types/telemetry";
import { fetchApi } from "../src/utils/api";
import {
  INSTALLER_ASSET_NAME,
  RELEASES_API_VERSION,
  type ConfirmEffect,
  type ConfirmTokenResponse,
  type GithubRelease,
  type ReleaseAsset,
  type ReleaseDraft,
  type ReleasesOverviewResponse,
  type RepoFile,
  type RepoTreeEntry,
  type TokenStatus,
  type WorkflowRunSummary,
} from "../shared/releases-contract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchApi: vi.fn(),
}));

const api = vi.mocked(fetchApi);

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

/* ───────────────────────────────── Fixtures ───────────────────────────────── */

const WRITE_TOKEN: TokenStatus = {
  mode: "write",
  source: "GITHUB_RELEASE_TOKEN",
  canWrite: true,
  message: null,
  rateLimitRemaining: 4821,
  rateLimitResetAt: "2026-09-17T12:00:00.000Z",
};

/** Decision 8: the NAS env carries the literal "xxx" today, so the panel says so and goes quiet. */
const PLACEHOLDER_MESSAGE =
  "GITHUB_RELEASE_TOKEN is set to a placeholder, so releases are read-only.";
const PLACEHOLDER_TOKEN: TokenStatus = {
  mode: "placeholder",
  source: "GITHUB_RELEASE_TOKEN",
  canWrite: false,
  message: PLACEHOLDER_MESSAGE,
  rateLimitRemaining: null,
  rateLimitResetAt: null,
};

function installer(): ReleaseAsset {
  return {
    id: 901,
    name: INSTALLER_ASSET_NAME,
    size: 78_000_000,
    contentType: "application/octet-stream",
    downloadCount: 412,
    updatedAt: "2026-09-10T08:00:00.000Z",
  };
}

function release(overrides: Partial<GithubRelease> & Pick<GithubRelease, "id" | "tag">) {
  const base: GithubRelease = {
    id: overrides.id,
    tag: overrides.tag,
    name: `RazorReaper ${overrides.tag.replace(/^v/, "")}`,
    state: "published",
    body: "- The first conversion downloads ffmpeg.\n- Smaller installer.",
    assets: [installer()],
    createdAt: "2026-09-01T08:00:00.000Z",
    publishedAt: "2026-09-10T08:00:00.000Z",
    htmlUrl: `https://github.com/CedrickGD/RazorReaper/releases/tag/${overrides.tag}`,
  };
  return { ...base, ...overrides };
}

const CURRENT = release({ id: 5301, tag: "v1.5.3" });
const PREVIOUS = release({ id: 5201, tag: "v1.5.2" });
const BETA = release({ id: 6001, tag: "v1.6.0-beta", state: "prerelease" });
const UNPUBLISHED = release({ id: 5401, tag: "v1.5.4", state: "draft", publishedAt: null });

const DRAFT: ReleaseDraft = {
  id: 7,
  version: "1.5.4",
  tag: "v1.5.4",
  title: "RazorReaper 1.5.4",
  notesCustomer: "Faster preset loading.\nThe first conversion downloads ffmpeg.",
  notesFullMd: "## 1.5.4\n\nFaster preset loading.",
  commitMessage: "release: 1.5.4",
  mandatory: false,
  prerelease: false,
  status: "built",
  githubReleaseId: 5401,
  githubRunId: 99,
  assetName: INSTALLER_ASSET_NAME,
  assetSize: 78_000_000,
  createdBy: "owner@example.test",
  createdAt: "2026-09-14T08:00:00.000Z",
  updatedAt: "2026-09-15T08:00:00.000Z",
  publishedAt: null,
};

const RUN: WorkflowRunSummary = {
  id: 99,
  workflowId: 12,
  name: "build-installer",
  runNumber: 31,
  status: "completed",
  conclusion: "success",
  event: "workflow_dispatch",
  branch: "master",
  createdAt: "2026-09-15T07:00:00.000Z",
  updatedAt: "2026-09-15T07:22:00.000Z",
  htmlUrl: "https://github.com/CedrickGD/RazorReaper/actions/runs/99",
};

function overview(token: TokenStatus): ReleasesOverviewResponse {
  return {
    ok: true,
    apiVersion: RELEASES_API_VERSION,
    token,
    latestPublished: CURRENT,
    releases: [UNPUBLISHED, BETA, CURRENT, PREVIOUS],
    drafts: [DRAFT],
    recentRuns: [RUN],
    updateXml: {
      version: "1.5.3.0",
      url: `https://github.com/CedrickGD/RazorReaper/releases/download/v1.5.3/${INSTALLER_ASSET_NAME}`,
      changelog: "https://github.com/CedrickGD/RazorReaper/releases/tag/v1.5.3",
      mandatory: false,
      args: "/VERYSILENT",
      notes: ["Faster preset loading."],
      sha: "abc123",
      pinnedTag: "v1.5.3",
      pinnedTagIsLatest: true,
      fetchedAt: "2026-09-17T09:00:00.000Z",
    },
    adoption: {
      version: "1.5.3",
      installs: 829,
      totalInstalls: 1012,
      share: 829 / 1012,
      windowDays: 14,
    },
    stale: false,
  };
}

/** Exactly what the server would compute for a make-current onto v1.5.2 (§6). */
const MAKE_CURRENT_EFFECTS: ConfirmEffect[] = [
  { kind: "manifest", text: "update.xml: 1.5.3 → 1.5.2" },
  {
    kind: "installs",
    text: "829 installs are on 1.5.3; they are not downgraded, but every new check now resolves 1.5.2.",
  },
  { kind: "discord", text: "Discord: nothing is posted — update.xml only." },
];

/** `update.xml` is on the denylist: publish and make-current own it, so the Files tab may not. */
const GOVERNED_REFUSAL =
  "update.xml is written by Publish and Make current, which validate the tag and the asset first.";
const GOVERNED: RepoFile = {
  path: "update.xml",
  sha: "manifestsha",
  size: 412,
  content: "<update><version>1.5.3.0</version></update>",
  editable: false,
  editRefusal: GOVERNED_REFUSAL,
};

const ROOT_ENTRIES: RepoTreeEntry[] = [
  { path: ".github", type: "tree", sha: "t1", size: null, editable: true },
  { path: "installer", type: "tree", sha: "t2", size: null, editable: true },
  { path: "update.xml", type: "blob", sha: "manifestsha", size: 412, editable: false },
];

const MINTED: ConfirmTokenResponse = {
  ok: true,
  token: "confirm-token-1",
  expiresAt: "2026-09-17T09:02:00.000Z",
  effects: MAKE_CURRENT_EFFECTS,
};

/* ───────────────────────────────── Harness ───────────────────────────────── */

function seat(permissions: Permission[]): AuthUser {
  return { email: "owner@example.test", role: "admin", permissions };
}

const OWNER = seat(["releases.read", "releases.write", "releases.files"]);
const ADMIN = seat(["releases.read", "releases.write"]);
const VIEWER = seat(["releases.read"]);

let container: HTMLDivElement;
let root: Root;
let token: TokenStatus = WRITE_TOKEN;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(() => {
  if (!("ResizeObserver" in globalThis))
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  if (!("getAnimations" in Element.prototype))
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
});

beforeEach(() => {
  resetHistoryLayers();
  token = WRITE_TOKEN;
  history.replaceState(null, "", "http://localhost:3000/#/releases");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  api.mockImplementation(async (input, init) => {
    const { pathname, searchParams } = new URL(String(input), window.location.origin);
    const method = init?.method ?? "GET";
    if (method === "GET" && pathname === "/api/admin/releases") return json(overview(token));
    if (method === "POST" && pathname === "/api/admin/releases/confirm") return json(MINTED);
    if (method === "GET" && pathname === "/api/admin/releases/files") {
      const path = searchParams.get("path") ?? "";
      if (path === GOVERNED.path) return json({ ok: true, ref: "master", path, file: GOVERNED });
      return json({ ok: true, ref: "master", path, entries: ROOT_ENTRIES });
    }
    throw new Error(`Unexpected mocked request: ${method} ${pathname}`);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  container.remove();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
  resetHistoryLayers();
  vi.restoreAllMocks();
});

async function mount(user: AuthUser) {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={user}>
        <main>
          <ReleasesPage />
        </main>
      </PanelIdentity.Provider>,
    ),
  );
}

function tabNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"] span')].map(
    (span) => span.textContent ?? "",
  );
}

function controlName(element: Element): string {
  return (
    element.getAttribute("aria-label")?.trim() ||
    element.textContent?.trim() ||
    element.getAttribute("title") ||
    ""
  );
}

function buttons(name: string, scope: ParentNode = document.body): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(
    (item) => controlName(item) === name,
  );
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/* ───────────────────────────────── The cases ───────────────────────────────── */

describe("the Releases page's sections", () => {
  it("offers all four sections to a seat holding releases.files", async () => {
    await mount(OWNER);
    expect(tabNames()).toEqual(["Releases", "Drafts", "Workflows", "Files"]);
  });

  it("hides Workflows and Files entirely without releases.files", async () => {
    await mount(ADMIN);
    expect(tabNames()).toEqual(["Releases", "Drafts"]);
    // Absent, not merely disabled: no commit box is rendered anywhere on the page.
    expect(document.body.textContent).not.toContain("Commit message");
  });

  it("gives a read-only seat the same two sections and no write control", async () => {
    await mount(VIEWER);
    expect(tabNames()).toEqual(["Releases", "Drafts"]);
  });

  it("opens with the four KPI tiles the design names", async () => {
    await mount(OWNER);
    const labels = [...document.querySelectorAll(".stat-card .stat-label")].map(
      (node) => node.textContent ?? "",
    );
    expect(labels).toEqual(["Latest published", "Adoption of latest", "Draft", "Last build"]);
    const values = [...document.querySelectorAll(".stat-card .stat-value")].map((node) =>
      (node.textContent ?? "").trim(),
    );
    expect(values[0]).toBe("v1.5.3");
    expect(values[1]).toBe("82%");
  });

  it("makes exactly one read on load — the overview answers the whole page (§6)", async () => {
    await mount(OWNER);
    expect(api.mock.calls).toHaveLength(1);
    expect(String(api.mock.calls[0][0])).toContain("/api/admin/releases");
  });
});

describe("the write-token status line", () => {
  it("carries the server's own sentence and disables every write button with it", async () => {
    token = PLACEHOLDER_TOKEN;
    await mount(OWNER);

    const line = document.querySelector(".releases-token-line");
    expect(line?.textContent).toContain(PLACEHOLDER_MESSAGE);

    const makeCurrent = buttons("Make current");
    expect(makeCurrent.length).toBeGreaterThan(0);
    for (const button of makeCurrent) {
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(PLACEHOLDER_MESSAGE);
    }
    for (const button of buttons("Unpublish")) {
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(PLACEHOLDER_MESSAGE);
    }
  });

  it("stays away while the token can write", async () => {
    await mount(OWNER);
    expect(document.querySelector(".releases-token-line")).toBeNull();
  });
});

describe("Make current is the rollback UI", () => {
  it("is refused with a reason on a draft, a prerelease and the tag update.xml already pins", async () => {
    await mount(OWNER);
    const titles = buttons("Make current").map((button) => ({
      disabled: button.disabled,
      title: button.title ?? "",
    }));
    // Rows are v1.5.4 (draft), v1.6.0-beta (prerelease), v1.5.3 (current), v1.5.2.
    expect(titles[0]).toEqual({ disabled: true, title: "v1.5.4 is still a draft." });
    expect(titles[1]).toEqual({ disabled: true, title: "v1.6.0-beta is a prerelease." });
    expect(titles[2]).toEqual({
      disabled: true,
      title: "update.xml already points at v1.5.3.",
    });
    expect(titles[3].disabled).toBe(false);
  });
});

describe("a confirm modal prints the server's effects", () => {
  it("shows the minted ConfirmEffect list verbatim and in order, and nothing else", async () => {
    await mount(OWNER);
    const target = buttons("Make current").find((button) => !button.disabled);
    expect(target).toBeDefined();
    await click(target!);

    const open = dialog();
    expect(open).not.toBeNull();
    const printed = [...open!.querySelectorAll(".releases-effect")].map((node) =>
      (node.textContent ?? "").trim(),
    );
    expect(printed).toEqual(MAKE_CURRENT_EFFECTS.map((effect) => effect.text));

    // The mint is the only extra call, and it names the action and the release id.
    const mint = api.mock.calls.find(([url]) => String(url).endsWith("/releases/confirm"));
    expect(mint).toBeDefined();
    expect(JSON.parse(String(mint?.[1]?.body))).toEqual({
      action: "make-current",
      subject: String(PREVIOUS.id),
    });
  });

  it("holds the confirming button until the target tag is typed, because it moves customers back", async () => {
    await mount(OWNER);
    await click(buttons("Make current").find((button) => !button.disabled)!);

    const open = dialog()!;
    const confirm = buttons("Make current", open)[0];
    expect(confirm.disabled).toBe(true);

    // The field the dialog labels "Type v1.5.2 to confirm" — §9's guard on the one action that
    // moves customers backwards.
    const label = [...open.querySelectorAll("label")].find((node) =>
      (node.textContent ?? "").startsWith(`Type ${PREVIOUS.tag} to confirm`),
    );
    expect(label).toBeDefined();
    const field = document.getElementById(label!.htmlFor) as HTMLInputElement;
    expect(field).not.toBeNull();
    await act(async () => setValue(field, PREVIOUS.tag));
    expect(buttons("Make current", dialog()!)[0].disabled).toBe(false);
  });
});

describe("the Drafts editor", () => {
  async function openDraft() {
    await mount(OWNER);
    await click(buttons("Drafts")[0]);
    const open = document.querySelector<HTMLButtonElement>(".releases-draft-open");
    expect(open).not.toBeNull();
    await click(open!);
  }

  it("loads the draft's fields and previews the customer notes as the app's list", async () => {
    await openDraft();
    const values = [...document.querySelectorAll<HTMLInputElement>("input")].map(
      (input) => input.value,
    );
    expect(values).toContain(DRAFT.version);
    expect(values).toContain(DRAFT.tag);
    expect(values).toContain(DRAFT.commitMessage);

    const preview = [...document.querySelectorAll(".releases-notes-preview > li")].map((line) =>
      (line.textContent ?? "").trim(),
    );
    expect(preview).toEqual(["Faster preset loading.", "The first conversion downloads ffmpeg."]);
  });

  it("offers Save, Build installer and Publish on a built draft", async () => {
    await openDraft();
    for (const name of ["Save", "Build installer", "Publish"]) {
      const [button] = buttons(name);
      expect(button, name).toBeDefined();
      expect(button.disabled, name).toBe(false);
    }
  });

  it("disables all three with the token's own sentence while the panel cannot write", async () => {
    token = PLACEHOLDER_TOKEN;
    await mount(OWNER);
    await click(buttons("Drafts")[0]);
    await click(document.querySelector<HTMLButtonElement>(".releases-draft-open")!);
    for (const name of ["Save", "Build installer", "Publish"]) {
      const [button] = buttons(name);
      expect(button.disabled, name).toBe(true);
      expect(button.title, name).toBe(PLACEHOLDER_MESSAGE);
    }
  });
});

describe("the Files tab", () => {
  it("browses master and renders a governed path read-only with its reason", async () => {
    await mount(OWNER);
    await click(buttons("Files")[0]);

    const listed = [...document.querySelectorAll(".releases-entry")].map((entry) =>
      (entry.textContent ?? "").trim(),
    );
    expect(listed).toEqual([".github", "installer", "update.xml"]);

    // update.xml is on the denylist, so the row cannot even be opened for editing.
    const openButtons = buttons("Open");
    const manifestRow = openButtons[openButtons.length - 1];
    expect(manifestRow.disabled).toBe(true);
    expect(manifestRow.title).toBe("This path is not editable.");
  });

  it("shows the server's refusal and no enabled Commit once a governed file is opened", async () => {
    await mount(OWNER);
    await click(buttons("Files")[0]);
    // Reached through the path field, which is the other way in.
    const field = document.querySelector<HTMLInputElement>(".page-toolbar-search input")!;
    await act(async () => setValue(field, GOVERNED.path));
    await click(buttons("Open")[0]);

    expect(document.body.textContent).toContain(GOVERNED_REFUSAL);
    const editor = document.querySelector<HTMLTextAreaElement>(".releases-file-editor")!;
    expect(editor.readOnly).toBe(true);
    const [commit] = buttons("Commit");
    expect(commit.disabled).toBe(true);
    expect(commit.title).toBe(GOVERNED_REFUSAL);
  });
});

describe("the page carries no effect copy of its own", () => {
  const page = source("../src/pages/ReleasesPage.tsx");

  it("never writes a Discord, manifest or install-count line into the client", () => {
    // §6: the Discord line is mandatory and server-generated; a hard-coded one in the page
    // would be a second author for the sentence an operator reads before publishing.
    expect(page).not.toMatch(/Discord:/);
    expect(page).not.toMatch(/update\.xml:\s/);
    expect(page).not.toMatch(/are not downgraded/);
    expect(page).not.toMatch(/release post goes to/);
  });

  it("renders the effect list from the response and only from it", () => {
    expect(page).toContain("minted.effects");
    expect(page).toContain("<span>{effect.text}</span>");
  });

  it("asks the server for a token before every governed action", () => {
    for (const action of [
      '"make-current"',
      '"unpublish"',
      '"build"',
      '"publish"',
      '"commit"',
      '"dispatch"',
    ]) {
      expect(page, action).toContain(`action: ${action}`);
    }
  });
});

describe("nothing scrolls sideways", () => {
  const page = source("../src/pages/ReleasesPage.tsx");
  const css = source("../src/theme/releases-workspace.css");

  it("stacks every table into cards on a phone, like the customer directory", () => {
    const tables = page.match(/<DataTable/g) ?? [];
    const stacked = page.match(/mobileLayout="stack"/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    expect(stacked).toHaveLength(tables.length);
  });

  it("collapses the editor to one column below 900px", () => {
    expect(css).toMatch(/@media \(max-width: 900px\)/);
    const narrow = css.slice(css.indexOf("@media (max-width: 900px)"));
    expect(narrow).toContain(".releases-editor-layout");
    expect(narrow).toContain(".releases-notes-split");
    expect(narrow).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  it("uses tokens only — no colour literal enters the workspace stylesheet", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
