import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerRestrictions } from "../src/components/CustomerRestrictions";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { CustomersPage } from "../src/pages/CustomersPage";
import type { AuthUser, SuspensionRecord } from "../src/types/telemetry";
import { fetchAdminSuspensions, postLiftSuspension } from "../src/utils/api";
import { emitRefresh } from "../src/utils/refreshBus";
import { PERMISSIONS, effectivePermissions } from "../shared/panel-policy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Customers → Restrictions on jsdom: the real tab, its real dialog and the real page sections.
 * Only the network (list + lift) and the refresh bus are stubbed, so the lift flow — optimistic
 * row, notice, rollback on failure, refetch — is exercised without a server that fakes the lift.
 */
vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchAdminSuspensions: vi.fn(),
  postLiftSuspension: vi.fn(),
}));
vi.mock("../src/utils/refreshBus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/refreshBus")>()),
  emitRefresh: vi.fn(),
}));

const day = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
function record(id: number, overrides: Partial<SuspensionRecord> = {}): SuspensionRecord {
  return {
    id,
    identity: `device-${id}`,
    hwid: `device-${id}`,
    install_id: `install-${id}`,
    user_label: `Customer ${id}`,
    mode: "ban",
    reason: `Reason ${id}`,
    banned_until: null,
    is_active: 1,
    had_paid_license: 0,
    paid_license_keys: null,
    created_by: "issuer@example.test",
    created_at: iso(-10 * day),
    updated_at: iso(-id * day),
    lifted_at: null,
    lifted_by: null,
    ...overrides,
  };
}
const RECORDS = [
  record(1),
  record(2, { mode: "suspend", banned_until: iso(5 * day) }),
  record(3, { is_active: 0, lifted_at: iso(-day), lifted_by: "owner@example.test" }),
];

const OWNER: AuthUser = {
  email: "owner@example.test",
  role: "admin",
  panelRole: "owner",
  permissions: PERMISSIONS.map((permission) => permission.key),
};
const SUPPORT: AuthUser = {
  email: "support@example.test",
  role: "viewer",
  panelRole: "support",
  permissions: effectivePermissions("support", {}),
};
const NO_ACCESS: AuthUser = {
  ...SUPPORT,
  permissions: effectivePermissions("support", {
    "access.read": { effect: "deny", expiresAt: null },
  }),
};

let root: Root;
let container: HTMLDivElement;

beforeAll(() => {
  // TableFrame measures itself; jsdom has no layout, so a no-op observer is enough.
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
  history.replaceState(null, "", "http://localhost:3000/#/customers");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(fetchAdminSuspensions).mockResolvedValue({
    ok: true,
    status: 200,
    suspensions: RECORDS,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  resetHistoryLayers();
});

/** The tab with its records held the way CustomersPage holds them. */
function Harness({ initial }: { initial: SuspensionRecord[] }) {
  const [records, setRecords] = useState<SuspensionRecord[] | null>(initial);
  return (
    <CustomerRestrictions
      records={records}
      loadError={null}
      users={null}
      onReload={() => undefined}
      onRecordsChange={(update) => setRecords((current) => (current ? update(current) : current))}
    />
  );
}

async function render(user: AuthUser, node: React.ReactNode) {
  await act(async () =>
    root.render(<PanelIdentity.Provider value={user}>{node}</PanelIdentity.Provider>),
  );
}

async function settle(check: () => boolean, what: string, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const rowNames = () =>
  [...container.querySelectorAll("tbody .record-link")].map((link) => link.textContent?.trim());
const button = (name: string, scope: ParentNode = document.body) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) ?? null;
const openDialog = () =>
  document.querySelector<HTMLElement>(
    '[data-modal-root="true"][data-state="open"] [role="dialog"]',
  );

describe("the Restrictions tab", () => {
  it("lists active restrictions newest first and lifts one after a confirmation", async () => {
    let answer!: (value: { ok: boolean; status: number }) => void;
    vi.mocked(postLiftSuspension).mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    await render(OWNER, <Harness initial={RECORDS} />);
    expect(rowNames()).toEqual(["Customer 1", "Customer 2"]);

    await act(async () => container.querySelector<HTMLButtonElement>("tbody button.btn")!.click());
    const dialog = openDialog();
    expect(dialog?.textContent).toContain("Customer 1");
    expect(dialog?.textContent).toContain("Permanent ban, issued by issuer@example.test");
    expect(postLiftSuspension).not.toHaveBeenCalled();

    await act(async () => button("Lift restriction", dialog!)!.click());
    // Optimistic: the row leaves the Active list before the server answers.
    expect(postLiftSuspension).toHaveBeenCalledWith("device-1");
    expect(rowNames()).toEqual(["Customer 2"]);

    await act(async () => answer({ ok: true, status: 200 }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Restriction lifted for Customer 1",
    );
    expect(emitRefresh).toHaveBeenCalledTimes(1);

    // It is listed under Lifted now, with who lifted it.
    await act(async () => button("Lifted", container)!.click());
    expect(rowNames()).toEqual(["Customer 1", "Customer 3"]);
    expect(container.querySelector("tbody")?.textContent).toContain("owner@example.test");
  });

  it("puts the row back and says so when the lift fails", async () => {
    vi.mocked(postLiftSuspension).mockResolvedValue({ ok: false, status: 500 });
    await render(OWNER, <Harness initial={RECORDS} />);
    await act(async () => container.querySelector<HTMLButtonElement>("tbody button.btn")!.click());
    await act(async () => button("Lift restriction", openDialog()!)!.click());

    expect(rowNames()).toEqual(["Customer 1", "Customer 2"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The restriction for Customer 1 could not be lifted",
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(emitRefresh).toHaveBeenCalledTimes(1);
  });

  it("offers no Lift without access.write", async () => {
    await render(SUPPORT, <Harness initial={RECORDS} />);
    expect(rowNames()).toEqual(["Customer 1", "Customer 2"]);
    expect(button("Lift")).toBeNull();
  });

  it("says when a search matches nothing, and Reset brings the list back", async () => {
    await render(OWNER, <Harness initial={RECORDS} />);
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search restrictions"]',
    )!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(search, "zz-no-such-customer");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(() => container.textContent!.includes("No restrictions match"), "empty state");

    await act(async () => button("Reset", container.querySelector(".empty-state")!)!.click());
    await settle(() => rowNames().length === 2, "the list to return");
  });
});

describe("Customers page sections", () => {
  it("opens Restrictions from ?section=restrictions and drops the parameter on leaving", async () => {
    history.replaceState(null, "", "http://localhost:3000/?section=restrictions#/customers");
    await render(OWNER, <CustomersPage users={[]} />);
    await settle(() => rowNames().length === 2, "the restrictions list");

    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Directory", "Restrictions · 2"]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#customers-panel-restrictions")).not.toBeNull();
    // The KPI tiles belong to the Directory section.
    expect(container.querySelector(".stat-card")).toBeNull();

    await act(async () => (tabs[0] as HTMLButtonElement).click());
    expect(new URL(location.href).searchParams.has("section")).toBe(false);
    expect(container.querySelector("#customers-panel-directory")).not.toBeNull();

    await act(async () => (tabs[1] as HTMLButtonElement).click());
    expect(new URL(location.href).searchParams.get("section")).toBe("restrictions");

    await act(async () => root.unmount());
    root = createRoot(container);
    expect(new URL(location.href).searchParams.has("section")).toBe(false);
    expect(location.hash).toBe("#/customers");
  });

  it("has no Restrictions section, request or tab row without access.read", async () => {
    history.replaceState(null, "", "http://localhost:3000/?section=restrictions#/customers");
    await render(NO_ACCESS, <CustomersPage users={[]} />);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector("#customers-panel-restrictions")).toBeNull();
    expect(fetchAdminSuspensions).not.toHaveBeenCalled();
  });
});
