import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerWorkspaceRouter } from "../src/components/CustomerWorkspaceRouter";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import type { AuthUser } from "../src/types/telemetry";
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

function layerOf(state: unknown) {
  return (state as { rrLayer?: { key: string | null; depth: number } } | null)?.rrLayer ?? null;
}

describe("Customer 360 on the session history", () => {
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
