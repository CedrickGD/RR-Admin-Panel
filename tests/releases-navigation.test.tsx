import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "../src/components/Navbar";
import { PAGE_META } from "../src/pageMeta";
import { PAGE_KEYS } from "../src/utils/pageRouting";
import { canVisit, rolePermissions, type PanelRole } from "../shared/panel-policy";
import type { AuthUser, PageKey } from "../src/types/telemetry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom has no matchMedia; the rail reads its two width queries through it.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  // jsdom has no layout, so it has no scrollIntoView either; the rail keeps the active item in view.
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function user(role: PanelRole): AuthUser {
  return {
    email: `${role}@example.test`,
    role: role === "owner" || role === "admin" ? "admin" : "viewer",
    panelRole: role,
    permissions: rolePermissions(role),
  };
}

async function render(who: AuthUser, page: PageKey = "overview") {
  await act(async () => {
    root.render(
      <Navbar page={page} onNavigate={vi.fn()} user={who} onLogout={vi.fn()} counts={{}} />,
    );
  });
}

function railItems(): string[] {
  return [...host.querySelectorAll(".nav-children .sb-item span")].map(
    (span) => span.textContent ?? "",
  );
}

function releasesItem(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>(".nav-children .sb-item")].find(
    (button) => button.querySelector("span")?.textContent === "Releases",
  );
}

describe("the Releases rail item", () => {
  it("is offered to a seat holding releases.read", async () => {
    for (const role of ["owner", "admin", "support", "viewer"] as const) {
      await render(user(role));
      expect(releasesItem(), role).toBeDefined();
    }
  });

  it("is withheld from a seat without releases.read, even an admin one", async () => {
    await render({
      email: "monitor@example.test",
      role: "admin",
      panelRole: "admin",
      permissions: ["overview.read", "monitoring.read", "support.read"],
    });
    expect(releasesItem()).toBeUndefined();
    // The group itself survives: Settings needs no permission at all.
    expect(railItems()).toContain("Settings");
  });

  it("sits under Administration, above Panel access", async () => {
    await render(user("owner"));
    const items = railItems();
    expect(PAGE_META.releases).toEqual({ group: "Administration", label: "Releases" });
    expect(items.indexOf("Releases")).toBeGreaterThanOrEqual(0);
    expect(items.indexOf("Releases")).toBeLessThan(items.indexOf("Panel access"));
    expect(items.indexOf("Releases")).toBeGreaterThan(items.indexOf("Errors"));
  });

  it("names the page the same way in the rail, the breadcrumb, the H1 and the tab title", async () => {
    await render(user("owner"), "releases");
    // PAGE_META has no `heading`, so one label answers for all four surfaces.
    expect(PAGE_META.releases.heading).toBeUndefined();
    expect(releasesItem()?.getAttribute("aria-current")).toBe("page");
    const crumb = host.querySelector(".workspace-breadcrumb");
    expect(crumb?.textContent).toContain("Administration");
    expect(crumb?.querySelector(".workspace-breadcrumb-page")?.textContent).toBe("Releases");
  });
});

describe("#/releases is a real route", () => {
  it("is a page key the shell can render and resolve a hash to", () => {
    expect(PAGE_KEYS).toContain("releases");
    expect(canVisit("releases", user("viewer"))).toBe(true);
  });
});
