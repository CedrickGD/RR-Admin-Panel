import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerWorkspaceRouter } from "../src/components/CustomerWorkspaceRouter";
import { CustomerReturnLink } from "../src/components/CustomerReturnLink";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import type { AuthUser } from "../src/types/telemetry";
import { openCustomerWorkspace } from "../src/utils/customerNavigation";
import { PERMISSIONS } from "../shared/panel-policy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Customer 360 on a real jsdom session history: the router, the real workspace
 * view and its real dialogs. Only data fetching, the animated canvas and the
 * Licenses page chunk (which the workspace preloads) are stubbed.
 */
const fixtures = vi.hoisted(() => ({
  customer: {
    anchor: {
      requested_by: "hwid",
      requested_value: "device-1",
      requested_session_id: null,
      identity: "device-1",
      hwid: "device-1",
      install_id: "install-1",
      confidence: "device_only",
    },
    profile: {
      user_label: "Avery Stone",
      customer_name: "Avery Stone",
      email: "customer@example.test",
      discord: null,
      verified_discord: null,
      contact: null,
    },
    summary: {
      is_active: true,
      license_tier: "premium",
      app_version: "1.5.0",
      display_version: "1.5.0",
      platform: "Windows",
      os_version: "Windows 11",
      device_model: "Desktop PC",
      country: "DE",
      city: "Berlin",
      region: null,
      timezone: "Europe/Berlin",
      first_seen: "2026-01-01T12:00:00Z",
      last_seen: "2026-09-12T12:00:00Z",
      total_sessions: 12,
      total_duration_seconds: 7200,
      error_count: 0,
    },
    settings: { rpc_enabled: true, features: {} },
    diagnostics: null,
    activity: null,
    usage: [],
    orders: [],
    licenses: [],
    access: [],
    discord_links: [],
    feedback: [],
    errors: [],
    installs: [],
    sessions: [],
    section_errors: {},
  },
}));

vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchCustomer360: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: { ok: true, customer: fixtures.customer },
  })),
  fetchAdminSuspensions: vi.fn(async () => ({ ok: true, suspensions: [] })),
}));
vi.mock("../src/components/PanelBackground", () => ({ PanelBackground: () => null }));
vi.mock("../src/pages/LicensesPage", () => ({ LicensesPage: () => null }));

const OWNER: AuthUser = {
  email: "owner@example.test",
  role: "admin",
  panelRole: "owner",
  permissions: PERMISSIONS.map((permission) => permission.key),
};

const PAGE = "http://localhost:3000/#/customers";
const CUSTOMER = "http://localhost:3000/?customer=device-1&customerBy=hwid#/customers";

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  // The hand-off waits for the page underneath to finish animating in.
  if (!("getAnimations" in Element.prototype))
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
});

beforeEach(() => {
  resetHistoryLayers();
  history.replaceState(null, "", PAGE);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
  vi.restoreAllMocks();
  resetHistoryLayers();
});

async function mount() {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={OWNER}>
        <main>
          <div className="page-enter">Customers</div>
        </main>
        <CustomerWorkspaceRouter user={OWNER} />
      </PanelIdentity.Provider>,
    ),
  );
}

/** Lets React, the lazy workspace chunk, fetches and jsdom's async traversals settle. */
async function waitFor(check: () => boolean, what: string, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function buttonNamed(name: string): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === name,
    ) ?? null
  );
}

/** The live (not handed-off) Customer 360 with its record loaded. */
function workspaceShown(): boolean {
  const workspace = document.querySelector("section.customer-workspace");
  return Boolean(
    workspace &&
    !workspace.hasAttribute("inert") &&
    workspace.querySelector(".customer-action-bar"),
  );
}

/** The dialog that is open (not fading out), if any. */
function openDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-modal-root="true"][data-state="open"] [role="dialog"]',
  );
}

function layerOf(state: unknown) {
  return (state as { rrLayer?: { key: string | null; depth: number } } | null)?.rrLayer ?? null;
}

describe("Customer 360 on the session history", () => {
  it("Manage licenses hands off as a navigation; Back returns to the same Customer 360 and tab, Back again closes it", async () => {
    await mount();
    await act(async () => openCustomerWorkspace({ selector: "hwid", value: "device-1" }));
    await waitFor(workspaceShown, "Customer 360");
    expect(location.href).toBe(CUSTOMER);
    expect(layerOf(history.state)).toMatchObject({ key: "customer", depth: 1 });
    // State the entry carries besides the layer record survives the hand-off.
    history.replaceState({ ...history.state, scrollY: 40 }, "");
    await act(async () => buttonNamed("Support & history")!.click());
    const length = history.length;

    await act(async () => buttonNamed("Manage licenses")!.click());
    expect(history.length).toBe(length + 1);
    const licenses = new URL(location.href);
    expect(licenses.hash).toBe("#/licenses");
    expect(licenses.searchParams.get("customerReturn")).toContain("customerTab=activity");
    expect(history.state).toEqual({ scrollY: 40 });
    // The workspace is held on top, inert, until the page underneath has content.
    expect(document.querySelector("section.customer-workspace")?.hasAttribute("inert")).toBe(true);
    await waitFor(
      () => !document.querySelector("section.customer-workspace"),
      "the hand-off to finish",
    );

    history.back();
    await waitFor(workspaceShown, "Customer 360 after Back from Licenses");
    expect(location.href).toBe(
      "http://localhost:3000/?customer=device-1&customerBy=hwid&customerTab=activity#/customers",
    );
    expect(history.state).toMatchObject({ scrollY: 40, rrLayer: { key: "customer", depth: 1 } });
    // Adopted, not pushed again: the Licenses entry is still the one ahead.
    expect(history.length).toBe(length + 1);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Support & history",
    );

    history.back();
    await waitFor(
      () => location.href === PAGE && !document.querySelector("section.customer-workspace"),
      "the page after the second Back",
    );
    expect(layerOf(history.state)).toBeNull();
  });

  it("a dialog over Customer 360 closes on Back, and the next Back closes Customer 360", async () => {
    await mount();
    await act(async () => openCustomerWorkspace({ selector: "hwid", value: "device-1" }));
    await waitFor(workspaceShown, "Customer 360");
    const length = history.length;

    await act(async () => buttonNamed("Raw data")!.click());
    await waitFor(() => openDialog() !== null, "the Raw data dialog");
    expect(history.length).toBe(length + 1);
    expect(location.href).toBe(CUSTOMER);
    expect(history.state).toMatchObject({
      rrLayer: { key: null, depth: 2, chain: [{ key: "customer" }, { key: null }] },
    });

    history.back();
    await waitFor(() => openDialog() === null, "the dialog to close on Back");
    expect(workspaceShown()).toBe(true);
    expect(location.href).toBe(CUSTOMER);
    expect(layerOf(history.state)).toMatchObject({ key: "customer", depth: 1 });

    history.back();
    await waitFor(
      () => location.href === PAGE && !document.querySelector("section.customer-workspace"),
      "the page after the second Back",
    );
    expect(layerOf(history.state)).toBeNull();
  });

  it('"Back to customer" on Licenses opens the same Customer 360 and tab again', async () => {
    const saved = new URL(CUSTOMER);
    saved.searchParams.set("customerTab", "activity");
    const returnPath = saved.pathname + saved.search + saved.hash;
    history.replaceState(
      null,
      "",
      `http://localhost:3000/?customerReturn=${encodeURIComponent(returnPath)}#/licenses`,
    );
    await act(async () =>
      root.render(
        <PanelIdentity.Provider value={OWNER}>
          <main>
            <div className="page-enter">
              <CustomerReturnLink />
            </div>
          </main>
          <CustomerWorkspaceRouter user={OWNER} />
        </PanelIdentity.Provider>,
      ),
    );
    // history.length also counts forward entries earlier tests left behind; count pushes.
    const push = vi.spyOn(history, "pushState");

    await act(async () => buttonNamed("Back to customer")!.click());
    await waitFor(workspaceShown, "Customer 360");
    expect(location.href).toBe(
      "http://localhost:3000/?customer=device-1&customerBy=hwid&customerTab=activity#/customers",
    );
    expect(layerOf(history.state)).toMatchObject({ key: "customer", depth: 1 });
    // The customer's page as a new entry, the workspace one above it.
    expect(push).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Support & history",
    );

    history.back();
    await waitFor(
      () => location.href === PAGE && !document.querySelector("section.customer-workspace"),
      "the customer's page after Back",
    );
  });

  it("Back on the access dialog with unsaved changes asks first: Keep editing keeps Back on the dialog, Discard leaves Customer 360 open", async () => {
    await mount();
    await act(async () => openCustomerWorkspace({ selector: "hwid", value: "device-1" }));
    await waitFor(workspaceShown, "Customer 360");
    const length = history.length;

    await act(async () => buttonNamed("Manage app access")!.click());
    await waitFor(
      () => Boolean(openDialog()?.querySelector(".gdrop-trigger:not([disabled])")),
      "the access dialog to load",
    );
    // Unsaved work: Access switched from Allowed to Permanent ban.
    await act(async () =>
      openDialog()!.querySelector<HTMLButtonElement>(".gdrop-trigger")!.click(),
    );
    await act(async () =>
      [...openDialog()!.querySelectorAll<HTMLButtonElement>('[role="option"]')]
        .find((option) => option.textContent?.trim() === "Permanent ban")!
        .click(),
    );
    expect(history.length).toBe(length + 1);
    expect(layerOf(history.state)).toMatchObject({ key: null, depth: 2 });

    history.back();
    await waitFor(() => buttonNamed("Keep editing") !== null, "the discard prompt");
    expect(openDialog()).not.toBeNull();
    expect(workspaceShown()).toBe(true);
    expect(layerOf(history.state)).toMatchObject({ key: "customer", depth: 1 });

    await act(async () => buttonNamed("Keep editing")!.click());
    // The dialog has its own entry again, pushed in place of the one Back left ahead.
    expect(history.length).toBe(length + 1);
    expect(location.href).toBe(CUSTOMER);
    expect(layerOf(history.state)).toMatchObject({ key: null, depth: 2 });

    // So Back targets the dialog again: the prompt, not Customer 360 closing.
    history.back();
    await waitFor(() => buttonNamed("Keep editing") !== null, "the discard prompt again");
    expect(workspaceShown()).toBe(true);
    expect(layerOf(history.state)).toMatchObject({ key: "customer", depth: 1 });

    const back = vi.spyOn(history, "back");
    const go = vi.spyOn(history, "go");
    await act(async () => buttonNamed("Discard")!.click());
    await waitFor(() => openDialog() === null, "the dialog to close");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Its entry was already spent: nothing steps back again, and Customer 360 stays.
    expect(back).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(workspaceShown()).toBe(true);
    expect(location.href).toBe(CUSTOMER);
    expect(layerOf(history.state)).toMatchObject({ key: "customer", depth: 1 });
  });

  it("after a reload with a keyless dialog open above it, adopts its own entry without pushing or rewriting", async () => {
    const customer = { id: 9001, key: "customer" };
    const dialog = { id: 9002, key: null };
    history.pushState({ rrLayer: { ...customer, depth: 1, chain: [customer] } }, "", CUSTOMER);
    history.pushState(
      { rrLayer: { ...dialog, depth: 2, chain: [customer, dialog] } },
      "",
      CUSTOMER,
    );
    const length = history.length;
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");

    await mount();
    await waitFor(workspaceShown, "Customer 360");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(history.length).toBe(length);
    expect(location.href).toBe(CUSTOMER);
    expect(layerOf(history.state)).toMatchObject({ key: null, depth: 2 });

    // "Back to workspace" steps over the dead dialog entry and the customer's own, onto the page.
    await act(async () => buttonNamed("Back to workspace")!.click());
    await waitFor(() => location.href === PAGE, "the page underneath");
    expect(layerOf(history.state)).toBeNull();
    expect(workspaceShown()).toBe(false);
  });
});
