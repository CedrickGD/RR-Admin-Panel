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
import {
  RELEASES_ACTIONS_WIDTH,
  RELEASES_FRAME_AT_1440,
  RELEASES_LEADING_COLUMNS,
  RELEASES_NOTES_FLOOR,
  RELEASES_NOTES_MIN,
  ReleasesPage,
} from "../src/pages/ReleasesPage";
import type { Permission } from "../shared/panel-policy";
import type { AuthUser } from "../src/types/telemetry";
import { fetchApi } from "../src/utils/api";
import {
  INSTALLER_ASSET_NAME,
  RELEASES_API_VERSION,
  type ConfirmAction,
  type ConfirmEffect,
  type ConfirmTokenResponse,
  type GithubRelease,
  type ReleaseAsset,
  type ReleaseDraft,
  type ReleaseDraftStatus,
  type ReleasesOverviewResponse,
  type RepoFile,
  type RepoTreeEntry,
  type TokenStatus,
  type WorkflowRunSummary,
  type WorkflowSummary,
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
    drafts: [
      draftStatus === DRAFT.status
        ? DRAFT
        : { ...DRAFT, status: draftStatus, updatedAt: "2026-09-15T09:00:00.000Z" },
    ],
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

/** An ordinary editable blob — the other half of the denylist, and the Commit tab's way in. */
const EDITABLE: RepoFile = {
  path: "installer/RazorReaper.iss",
  sha: "issblobsha",
  size: 2_400,
  content: '#define MyAppVersion "1.5.3"\n',
  editable: true,
};

const ROOT_ENTRIES: RepoTreeEntry[] = [
  { path: ".github", type: "tree", sha: "t1", size: null, editable: true },
  { path: "installer", type: "tree", sha: "t2", size: null, editable: true },
  { path: "update.xml", type: "blob", sha: "manifestsha", size: 412, editable: false },
];

const WORKFLOWS: WorkflowSummary[] = [
  {
    id: 12,
    name: "Build installer",
    path: ".github/workflows/build-installer.yml",
    state: "active",
    inputs: [
      { name: "version", description: "3-part version", required: true, type: "string" },
      { name: "prerelease", description: "Prerelease", required: false, type: "boolean" },
    ],
  },
];

/**
 * What the server would mint for each action. They differ on purpose: a modal that prints the
 * response is only demonstrably printing *the response* if a different response prints
 * differently, which a single shared fixture can never show.
 */
const MINTED_EFFECTS: Record<ConfirmAction, ConfirmEffect[]> = {
  "make-current": MAKE_CURRENT_EFFECTS,
  publish: [
    { kind: "github", text: "GitHub: v1.5.4 is published and its notes go live." },
    { kind: "manifest", text: "update.xml: 1.5.3 → 1.5.4" },
    { kind: "installs", text: "829 installs are on 1.5.3 and will be offered 1.5.4." },
    {
      kind: "discord",
      text: "Discord: a release post goes to the updates channel and the RIP webhook (discord-release.yml, on release published).",
    },
  ],
  build: [
    { kind: "github", text: "GitHub: one commit bumps RazorReaper.csproj and RazorReaper.iss." },
    { kind: "note", text: "build-installer.yml is dispatched on master." },
  ],
  unpublish: [{ kind: "github", text: "GitHub: v1.5.2 goes back to a draft; its tag stays." }],
  commit: [{ kind: "github", text: `GitHub: one commit rewrites ${EDITABLE.path} on master.` }],
  dispatch: [
    { kind: "github", text: "GitHub Actions: Build installer is dispatched on master." },
    { kind: "note", text: "A dispatched workflow runs with this repository's secrets." },
  ],
};

function minted(action: ConfirmAction): ConfirmTokenResponse {
  return {
    ok: true,
    token: `confirm-token-${action}`,
    expiresAt: "2026-09-17T09:02:00.000Z",
    effects: MINTED_EFFECTS[action],
  };
}

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
/** What the *server* says the open draft's status is — moved mid-test to simulate a finished run. */
let draftStatus: ReleaseDraftStatus = DRAFT.status;

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
  draftStatus = DRAFT.status;
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
    if (method === "POST" && pathname === "/api/admin/releases/confirm") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { action: ConfirmAction };
      return json(minted(body.action));
    }
    if (method === "GET" && pathname === "/api/admin/releases/files") {
      const path = searchParams.get("path") ?? "";
      if (path === GOVERNED.path) return json({ ok: true, ref: "master", path, file: GOVERNED });
      if (path === EDITABLE.path) return json({ ok: true, ref: "master", path, file: EDITABLE });
      return json({ ok: true, ref: "master", path, entries: ROOT_ENTRIES });
    }
    // The run panel polls while a draft is `building`. `pollAfterSeconds: 0` answers once and
    // stops, so the test drives the refresh itself instead of waiting on a real 10 s timer.
    if (method === "GET" && /\/drafts\/\d+\/run$/.test(pathname))
      return json({ ok: true, run: RUN, jobs: [], logTail: [], pollAfterSeconds: 0 });
    if (method === "GET" && pathname === "/api/admin/releases/workflows")
      return json({ ok: true, workflows: WORKFLOWS });
    if (method === "GET" && pathname === "/api/admin/releases/workflows/runs")
      return json({ ok: true, runs: [RUN] });
    // Every governed action's write route: the suite drives the modal, so only the mint body and
    // the fact that the write followed are of interest here.
    if (method === "POST" || method === "PUT") return json({ ok: true });
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

function setTextareaValue(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(area, value);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/* Each governed action, driven the way an operator reaches it, so a test can assert on the
   modal the server's mint actually produced rather than on the page's source text. */

async function openMakeCurrent() {
  await mount(OWNER);
  await click(buttons("Make current").find((button) => !button.disabled)!);
}

async function openUnpublish() {
  await mount(OWNER);
  // Scoped to v1.5.2's row: the prerelease above it is unpublishable too, so "the first enabled
  // Unpublish" would name a different release than the test says it does.
  await click(buttons("Unpublish", tagRow(PREVIOUS.tag))[0]);
}

/** The `<tbody>` row for a tag — a row action has to be reached through its own row. */
function tagRow(tag: string): HTMLTableRowElement {
  const row = [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")].find((tr) =>
    tr.querySelector(".releases-tag-cell")?.textContent?.includes(tag),
  );
  if (!row) throw new Error(`No release row for ${tag}.`);
  return row;
}

async function openDraftAction(label: "Build installer" | "Publish") {
  await mount(OWNER);
  await click(buttons("Drafts")[0]);
  await click(document.querySelector<HTMLButtonElement>(".releases-draft-open")!);
  await click(buttons(label)[0]);
}

async function openCommit() {
  await mount(OWNER);
  await click(buttons("Files")[0]);
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Repository path"]')!;
  await act(async () => setValue(field, EDITABLE.path));
  await click(buttons("Open")[0]);
  await click(buttons("Commit")[0]);
}

async function openDispatch() {
  await mount(OWNER);
  await click(buttons("Workflows")[0]);
  await click(buttons("Prepare")[0]);
  await click(buttons("Dispatch")[0]);
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

  /**
   * The editor holds a copy of the draft taken when it was opened. `status` is the one field on
   * it the server owns — `GET …/drafts/:id/run` writes `built` when the run finishes — so until
   * the copy followed it, a finished build left the header on "Building" and Publish disabled
   * with "Build the installer before publishing.", and only closing and reopening the draft fixed
   * it.
   */
  it("follows the server's status when a build finishes under the open editor", async () => {
    draftStatus = "building";
    await mount(OWNER);
    await click(buttons("Drafts")[0]);
    await click(document.querySelector<HTMLButtonElement>(".releases-draft-open")!);

    expect(document.querySelector(".releases-draft-editor .section-sub")?.textContent).toBe(
      "Building",
    );
    expect(buttons("Publish")[0].disabled).toBe(true);
    expect(buttons("Publish")[0].title).toBe("Build the installer before publishing.");

    // The run finished, so the next overview carries `built`.
    draftStatus = "built";
    await click(buttons("Refresh")[0]);

    expect(document.querySelector(".releases-draft-editor .section-sub")?.textContent).toBe(
      "Built",
    );
    expect(buttons("Publish")[0].disabled).toBe(false);
  });

  it("keeps notes the operator is part-way through typing when the status moves", async () => {
    draftStatus = "building";
    await mount(OWNER);
    await click(buttons("Drafts")[0]);
    await click(document.querySelector<HTMLButtonElement>(".releases-draft-open")!);

    const notes = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].find(
      (area) => area.value === DRAFT.notesCustomer,
    )!;
    await act(async () => setTextareaValue(notes, "A bullet still being written"));

    draftStatus = "built";
    await click(buttons("Refresh")[0]);

    // The status followed the server; the unsaved edit did not get thrown away with it.
    expect(buttons("Publish")[0].disabled).toBe(false);
    expect(
      [...document.querySelectorAll<HTMLTextAreaElement>("textarea")].map((area) => area.value),
    ).toContain("A bullet still being written");
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
    // Reached through the path field, which is the other way in. Found by its accessible name,
    // not by the row's class: what the test cares about is the field an operator types a path
    // into, not which wrapper the page happens to render it in.
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Repository path"]')!;
    await act(async () => setValue(field, GOVERNED.path));
    await click(buttons("Open")[0]);

    expect(document.body.textContent).toContain(GOVERNED_REFUSAL);
    const editor = document.querySelector<HTMLTextAreaElement>(".releases-file-editor")!;
    expect(editor.readOnly).toBe(true);
    const [commit] = buttons("Commit");
    expect(commit.disabled).toBe(true);
    expect(commit.title).toBe(GOVERNED_REFUSAL);
  });

  it("keeps Open and Up out of a toolbar slot documented as ds/Select only", async () => {
    await mount(OWNER);
    await click(buttons("Files")[0]);

    // ds/PageToolbar's `filters` slot takes ds/Select and nothing else — every other page in the
    // panel passes only Selects — so the path navigator renders its own row instead.
    expect(document.querySelectorAll(".page-toolbar-filters .btn")).toHaveLength(0);
    const row = document.querySelector(".releases-path-row")!;
    expect(row).not.toBeNull();
    expect(row.querySelector('input[aria-label="Repository path"]')).not.toBeNull();
    expect(buttons("Open", row).length).toBe(1);
    expect(buttons("Up", row).length).toBe(1);
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

  /**
   * Asserted on the rendered dialog, across three different effect lists, rather than on the
   * page's source text: grepping for `minted.effects` proves the identifier is present, not that
   * what reaches the screen is the response. Three lists of different lengths and kinds, each
   * printed verbatim and in order and with nothing added, is what proves it.
   */
  it.each([
    ["make-current", async () => openMakeCurrent()],
    ["unpublish", async () => openUnpublish()],
    ["build", async () => openDraftAction("Build installer")],
    ["publish", async () => openDraftAction("Publish")],
    ["commit", async () => openCommit()],
    ["dispatch", async () => openDispatch()],
  ] as Array<[ConfirmAction, () => Promise<void>]>)(
    "prints the server's %s effects verbatim, in order, and adds nothing",
    async (action, open) => {
      await open();
      const printed = [...dialog()!.querySelectorAll(".releases-effect")].map((node) =>
        (node.textContent ?? "").trim(),
      );
      expect(printed).toEqual(MINTED_EFFECTS[action].map((effect) => effect.text));
    },
  );

  it.each([
    ["make-current", String(PREVIOUS.id), async () => openMakeCurrent()],
    ["unpublish", String(PREVIOUS.id), async () => openUnpublish()],
    ["build", String(DRAFT.id), async () => openDraftAction("Build installer")],
    ["publish", String(DRAFT.id), async () => openDraftAction("Publish")],
    ["commit", EDITABLE.path, async () => openCommit()],
    ["dispatch", String(WORKFLOWS[0].id), async () => openDispatch()],
  ] as Array<[ConfirmAction, string, () => Promise<void>]>)(
    "mints a %s token naming the subject before the action runs",
    async (action, subject, open) => {
      await open();
      const mints = api.mock.calls.filter(([url]) => String(url).endsWith("/releases/confirm"));
      expect(mints).toHaveLength(1);
      expect(JSON.parse(String(mints[0]?.[1]?.body))).toEqual({ action, subject });
    },
  );
});

describe("the pinned action column leaves the Notes cell alone", () => {
  /*
   * DataTable pins this column (`stickyActions`), so the cell is laid over the columns to its
   * left the moment the table outgrows its frame — its declared width is a layout promise, not
   * a hint. It declared 260px while drawing four worded buttons at 449px, so a 1440px window
   * with the rail open (a 1130px frame, measured) stood the table at 1197px and put 67px of
   * pinned cell over the Notes column, the note's own ellipsis included.
   *
   * Measured after, at 1440 with the rail open: the table is 1130px and the frame does not
   * scroll; Notes runs 763→1054 and the action cell 1054→1407, so the gap between them is 0.
   * At 1920: 969→1384 and 1384→1887, gap 0. At 390 the table stacks into cards and the page's
   * scrollWidth is 390.
   */
  const css = source("../src/theme/releases-workspace.css");

  it("budgets every column inside the frame a 1440px window leaves beside the rail", () => {
    expect(RELEASES_LEADING_COLUMNS).toBe(468);
    expect(RELEASES_ACTIONS_WIDTH).toBe(340);
    expect(RELEASES_NOTES_FLOOR).toBe(280);
    expect(RELEASES_FRAME_AT_1440).toBe(1130);
    expect(
      RELEASES_LEADING_COLUMNS + RELEASES_NOTES_FLOOR + RELEASES_ACTIONS_WIDTH,
    ).toBeLessThanOrEqual(RELEASES_FRAME_AT_1440);
    // And the table's own scroll floor — DataTable sums the declared minimums — stays under it
    // too, so the frame has nothing to scroll at that width.
    expect(RELEASES_LEADING_COLUMNS + RELEASES_NOTES_MIN + RELEASES_ACTIONS_WIDTH).toBeLessThan(
      RELEASES_FRAME_AT_1440,
    );
  });

  it("declares the action column at the width it renders, not under it", async () => {
    await mount(OWNER);
    const header = [
      ...document.querySelectorAll<HTMLTableCellElement>("#releases-panel-releases thead th"),
    ].at(-1)!;
    expect(header.style.minWidth).toBe(`${RELEASES_ACTIONS_WIDTH}px`);
  });

  it("spends the row on two icon squares and keeps the words on the governed actions", async () => {
    await mount(OWNER);
    const row = tagRow(UNPUBLISHED.tag); // the one release with a draft behind it
    const icons = [...row.querySelectorAll<HTMLButtonElement>("button.releases-action-icon")];
    expect(icons.map((button) => button.getAttribute("aria-label"))).toEqual([
      `Notes for ${UNPUBLISHED.tag}`,
      `Edit notes for ${UNPUBLISHED.tag}`,
    ]);
    for (const button of icons) {
      // A tooltip on hover, and the word still in the markup: the stacked card prints it.
      expect(button.getAttribute("title")).toBeTruthy();
      const label = button.querySelector(".releases-action-label")?.textContent ?? "";
      expect(button.getAttribute("aria-label")).toContain(label);
    }
    expect(buttons("Make current", row)).toHaveLength(1);
    expect(buttons("Unpublish", row)).toHaveLength(1);
  });

  it("squares the icon buttons on desktop only and gives the word back below 900px", () => {
    const desktop = css.slice(css.indexOf("@media (min-width: 901px)"));
    expect(desktop).toContain(".releases-row-actions .releases-action-icon");
    expect(desktop.slice(0, desktop.indexOf("}"))).toContain("width: 30px");
    expect(css).toMatch(/\.releases-action-label \{\s*display: none;/);
    const narrow = css.slice(css.indexOf("@media (max-width: 900px)"));
    expect(narrow).toContain(".releases-action-label");
    expect(narrow.slice(narrow.indexOf(".releases-action-label"))).toContain("display: inline");
  });
});

describe("nothing scrolls sideways", () => {
  // Only the stylesheet is read as text here: the two remaining cases are about media queries and
  // colour literals, which have no DOM to assert against in jsdom.
  const css = source("../src/theme/releases-workspace.css");

  /**
   * Asserted on the rendered tables, not by counting `<DataTable` against `mobileLayout="stack"`
   * in the page's text: those two counts match just as happily when a stacked table is added and
   * an unstacked one somewhere else is what actually scrolls. Every table a seat can reach is
   * visited and every one of them has to carry the class that does the stacking.
   */
  it.each([
    ["Releases", 1],
    ["Workflows", 2],
    ["Files", 1],
  ])("stacks every table on the %s section into cards on a phone", async (tab, expected) => {
    await mount(OWNER);
    if (tab !== "Releases") await click(buttons(tab)[0]);

    const tables = [...document.querySelectorAll<HTMLTableElement>("table.data-table")];
    expect(tables).toHaveLength(expected);
    for (const table of tables) {
      expect(table.classList.contains("table-frame--stack"), table.caption?.textContent ?? "").toBe(
        true,
      );
    }
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
