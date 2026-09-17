/**
 * The Announcements editor's version-range fields (docs/release-management-design.md §10).
 *
 * What this suite exists to pin down:
 *  - Two **optional** `ds/Select` fields, their options built from `VersionsResponse.releases` —
 *    not from a hard-coded list and not from api.github.com, which is the call §10 removes.
 *  - "Other version…" turns the same field into free text, because the bound that matters most is
 *    1.4.8 and below (decision 5) and a tag that old is not in the releases list any more. A stored
 *    bound the list does not carry opens as free text and survives a save untouched.
 *  - Leaving both on "Any version" sends empty bounds, which is what every announcement written
 *    before targeting means: everyone sees it.
 *  - The list says which versions a targeted row is for, and says nothing at all for one that is
 *    for everyone.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsPage } from "../src/pages/AnnouncementsPage";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import type { AuthUser } from "../src/types/telemetry";
import { fetchApi } from "../src/utils/api";
import type { VersionsResponse } from "../shared/releases-contract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchApi: vi.fn(),
}));

const api = vi.mocked(fetchApi);

/* jsdom has no Popover API; the ds/Select popover needs the same stand-in glass-dropdown uses. */
type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };
const showing = new WeakSet<Element>();
const nativeMatches = Element.prototype.matches;
const proto = HTMLElement.prototype as PopoverElement;
const hadPopover = typeof proto.showPopover === "function";

/** What the versions endpoint returns; 1.4.7 is deliberately **not** in it. */
const VERSIONS: VersionsResponse = {
  ok: true,
  releases: ["1.5.3", "1.5.2", "1.5.0", "1.4.9"],
  latest: "1.5.3",
  ageSeconds: 12,
};

interface AnnouncementFixture {
  id: number;
  title: string;
  body: string;
  level: "info" | "warning" | "critical";
  is_active: number;
  starts_at: string | null;
  expires_at: string | null;
  min_version: string | null;
  max_version: string | null;
  created_at: string;
  updated_at: string;
}

function announcement(overrides: Partial<AnnouncementFixture> & Pick<AnnouncementFixture, "id">) {
  const base: AnnouncementFixture = {
    id: overrides.id,
    title: "Update available",
    body: "Please update.",
    level: "info",
    is_active: 1,
    starts_at: null,
    expires_at: null,
    min_version: null,
    max_version: null,
    created_at: "2026-09-10T08:00:00.000Z",
    updated_at: "2026-09-10T08:00:00.000Z",
  };
  return { ...base, ...overrides };
}

const EVERYONE = announcement({ id: 1, title: "Maintenance tonight" });
/** Capped at a release the list no longer carries: the free-text bound. */
const STRANDED = announcement({ id: 2, title: "You are out of date", max_version: "1.4.7" });

let container: HTMLDivElement;
let root: Root;
let rows: AnnouncementFixture[] = [];
let writes: Array<{ method: string; pathname: string; body: Record<string, unknown> }> = [];

const OWNER: AuthUser = {
  email: "owner@example.test",
  role: "admin",
  permissions: ["announcements.read", "announcements.write", "monitoring.read"],
};

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
  if (!hadPopover) {
    proto.showPopover = function (this: HTMLElement) {
      if (showing.has(this)) {
        throw new DOMException("The popover is already showing.", "InvalidStateError");
      }
      showing.add(this);
    };
    proto.hidePopover = function (this: HTMLElement) {
      showing.delete(this);
    };
    Element.prototype.matches = function (this: Element, selector: string) {
      if (selector === ":popover-open") return showing.has(this);
      return nativeMatches.call(this, selector);
    };
  }
});

afterAll(() => {
  if (!hadPopover) {
    Reflect.deleteProperty(proto, "showPopover");
    Reflect.deleteProperty(proto, "hidePopover");
    Element.prototype.matches = nativeMatches;
  }
});

beforeEach(() => {
  resetHistoryLayers();
  localStorage.clear();
  history.replaceState(null, "", "http://localhost:3000/#/announcements");
  rows = [EVERYONE, STRANDED];
  writes = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  api.mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input), window.location.origin);
    const method = init?.method ?? "GET";
    if (pathname === "/api/admin/releases/versions") return json(VERSIONS);
    if (pathname.startsWith("/api/admin/announcements")) {
      if (method === "GET") return json({ ok: true, announcements: rows });
      writes.push({
        method,
        pathname,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return json({ ok: true, id: 3 });
    }
    throw new Error(`Unexpected mocked request: ${method} ${pathname}`);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
  resetHistoryLayers();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={OWNER}>
        <main>
          <AnnouncementsPage />
        </main>
      </PanelIdentity.Provider>,
    ),
  );
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttons(name: string): HTMLButtonElement[] {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter(
    (item) => (item.getAttribute("aria-label")?.trim() || item.textContent?.trim()) === name,
  );
}

/** The ds/Field whose label starts with `label` — the control its `<label for>` points at. */
function field(label: string): { label: HTMLLabelElement; control: HTMLElement } {
  const found = [...document.body.querySelectorAll<HTMLLabelElement>("label.ds-field-label")].find(
    (item) => item.textContent?.startsWith(label),
  );
  if (!found) throw new Error(`No field labelled "${label}".`);
  return { label: found, control: document.getElementById(found.htmlFor)! };
}

/** Opens the ds/Select for `label` and returns its option labels, in order. */
async function openOptions(label: string): Promise<string[]> {
  await click(field(label).control);
  const options = [
    ...document.body.querySelectorAll<HTMLElement>('.gdrop-menu [role="option"] span'),
  ].map((span) => span.textContent ?? "");
  return options;
}

async function chooseOption(label: string, option: string) {
  await click(field(label).control);
  const choice = [
    ...document.body.querySelectorAll<HTMLElement>('.gdrop-menu [role="option"]'),
  ].find((item) => item.querySelector("span")?.textContent === option);
  if (!choice) throw new Error(`No option "${option}" under "${label}".`);
  await click(choice);
}

function typedInput(label: string): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>(`input[aria-label="${label} (typed)"]`);
}

async function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function save() {
  const form = document.body.querySelector<HTMLFormElement>("form.announcement-form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/** The `<tbody>` row carrying `title` — never the header, whose cells are words like "Window". */
function bodyRow(title: string): HTMLTableRowElement {
  const row = [...document.body.querySelectorAll<HTMLTableRowElement>("tbody tr")].find((tr) =>
    tr.textContent?.includes(title),
  );
  if (!row) throw new Error(`No announcement row for "${title}".`);
  return row;
}

async function openEditor(title: string) {
  const row = bodyRow(title);
  await click([...row.querySelectorAll("button")].find((b) => b.title === "Edit")!);
}

describe("Announcements editor — version targeting", () => {
  it("offers both bounds as optional fields built from the releases endpoint", async () => {
    await mount();
    await click(buttons("New announcement")[0]);

    for (const label of ["Minimum version", "Maximum version"]) {
      expect(field(label).label.querySelector("em")?.textContent).toBe("optional");
      expect(await openOptions(label)).toEqual([
        "Any version",
        ...VERSIONS.releases,
        "Other version…",
      ]);
      // Closed again, so the next field's popover is the only one on screen.
      await click(field(label).control);
    }

    // Nothing was typed, so nothing is targeted: the row reaches every install, as before.
    await setValue(field("Title").control as HTMLInputElement, "Everyone");
    await setValue(field("Message").control as HTMLInputElement, "Body text");
    await save();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "POST" });
    expect(writes[0].body).toMatchObject({ min_version: "", max_version: "" });
  });

  it("sends the release picked from the dropdown, and clears it again on Any version", async () => {
    await mount();
    await click(buttons("New announcement")[0]);
    await setValue(field("Title").control as HTMLInputElement, "Modern only");
    await setValue(field("Message").control as HTMLInputElement, "Body text");

    await chooseOption("Minimum version", "1.5.0");
    await save();
    expect(writes[0].body).toMatchObject({ min_version: "1.5.0", max_version: "" });

    await click(buttons("New announcement")[0]);
    await setValue(field("Title").control as HTMLInputElement, "Modern only");
    await setValue(field("Message").control as HTMLInputElement, "Body text");
    await chooseOption("Minimum version", "1.5.0");
    await chooseOption("Minimum version", "Any version");
    await save();
    expect(writes[1].body).toMatchObject({ min_version: "" });
  });

  it("opens a stored bound the releases list does not carry as free text, and keeps it", async () => {
    await mount();
    await openEditor(STRANDED.title);

    const typed = typedInput("Maximum version");
    expect(typed?.value).toBe("1.4.7");
    // The dropdown itself stays on "Other version…", so the two are one control.
    expect(field("Maximum version").control.textContent).toContain("Other version…");
    // The other bound is untouched and still a plain dropdown.
    expect(typedInput("Minimum version")).toBeNull();

    await save();
    expect(writes[0]).toMatchObject({ method: "PUT", pathname: "/api/admin/announcements/2" });
    expect(writes[0].body).toMatchObject({ max_version: "1.4.7", min_version: "" });
  });

  it("takes a version the list has never heard of through Other version…", async () => {
    await mount();
    await openEditor(EVERYONE.title);
    expect(typedInput("Maximum version")).toBeNull();

    await chooseOption("Maximum version", "Other version…");
    await setValue(typedInput("Maximum version")!, " 1.4.8 ");
    await save();
    expect(writes[0].body).toMatchObject({ max_version: "1.4.8" });

    // And picking a release again leaves free text behind.
    await openEditor(EVERYONE.title);
    await chooseOption("Maximum version", "Other version…");
    await chooseOption("Maximum version", "1.4.9");
    expect(typedInput("Maximum version")).toBeNull();
    await save();
    expect(writes[1].body).toMatchObject({ max_version: "1.4.9" });
  });

  it("names the targeted versions in the list, and says nothing for a row that is for everyone", async () => {
    rows = [
      EVERYONE,
      STRANDED,
      announcement({ id: 3, title: "Modern", min_version: "1.5.0" }),
      announcement({ id: 4, title: "Range", min_version: "1.4.0", max_version: "1.4.8" }),
      announcement({ id: 5, title: "Pinned", min_version: "1.4.7", max_version: "1.4.7" }),
    ];
    await mount();

    const text = (title: string) => bodyRow(title).textContent!;
    expect(text(EVERYONE.title)).not.toContain("Versions:");
    expect(text(STRANDED.title)).toContain("Versions: 1.4.7 and below");
    expect(text("Modern")).toContain("Versions: 1.5.0 and up");
    expect(text("Range")).toContain("Versions: 1.4.0 – 1.4.8");
    expect(text("Pinned")).toContain("Versions: 1.4.7 only");
  });

  /**
   * `useReleaseVersions()` fetches, so on a cold cache the list is empty for the first paint and
   * the editor can be opened before it lands. Deciding free-text-or-dropdown once, at mount, read
   * that empty list and called every stored bound unknown — leaving a bound that names a real
   * release stuck as free text for the rest of the editing session.
   */
  it("moves a stored bound from free text to the dropdown when the list arrives late", async () => {
    let deliver: () => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      deliver = () => resolve(json(VERSIONS));
    });
    api.mockImplementation(async (input, init) => {
      const { pathname } = new URL(String(input), window.location.origin);
      const method = init?.method ?? "GET";
      if (pathname === "/api/admin/releases/versions") return pending;
      if (pathname.startsWith("/api/admin/announcements")) {
        if (method === "GET") return json({ ok: true, announcements: rows });
        writes.push({
          method,
          pathname,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        });
        return json({ ok: true, id: 3 });
      }
      throw new Error(`Unexpected mocked request: ${method} ${pathname}`);
    });

    rows = [announcement({ id: 6, title: "Modern only", max_version: "1.5.0" })];
    await mount();
    await openEditor("Modern only");

    // The list has not answered yet, so 1.5.0 looks unknown and opens as free text.
    expect(typedInput("Maximum version")?.value).toBe("1.5.0");

    deliver();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 1.5.0 is a real release after all: the same field is a dropdown sitting on it.
    expect(typedInput("Maximum version")).toBeNull();
    expect(field("Maximum version").control.textContent).toContain("1.5.0");
    await save();
    expect(writes[0].body).toMatchObject({ max_version: "1.5.0" });
  });

  it("keeps an explicit Other version… free text even once the list carries that value", async () => {
    await mount();
    await openEditor(EVERYONE.title);

    // The user chose free text themselves. Typing a bound that happens to name a release must
    // not yank the input away mid-keystroke, so the pick outranks the list.
    await chooseOption("Maximum version", "Other version…");
    await setValue(typedInput("Maximum version")!, "1.5.0");
    expect(typedInput("Maximum version")?.value).toBe("1.5.0");

    await save();
    expect(writes[0].body).toMatchObject({ max_version: "1.5.0" });
  });
});
