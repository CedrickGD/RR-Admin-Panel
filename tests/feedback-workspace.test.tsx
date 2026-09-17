import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackPage } from "../src/pages/FeedbackPage";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import type { AuthUser } from "../src/types/telemetry";
import { fetchApi } from "../src/utils/api";
import { navigateCustomerUrl } from "../src/utils/customerNavigation";
import { useRefreshSignal } from "../src/utils/refreshBus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchApi: vi.fn(),
}));
vi.mock("../src/utils/customerNavigation", () => ({ navigateCustomerUrl: vi.fn() }));
vi.mock("../src/components/FeedbackReplies", () => ({
  FeedbackReplies: ({ report }: { report: { id: number } }) => (
    <section role="dialog" aria-label={`Replies for report ${report.id}`}>
      Selected report {report.id}
    </section>
  ),
}));

const LICENSE_KEY = "RR-PRIVATE-ALPHA-1234";
const WRITER: AuthUser = {
  email: "support@example.test",
  role: "admin",
  permissions: ["support.read", "support.write", "customers.read"],
};
const READER: AuthUser = {
  email: "reader@example.test",
  role: "viewer",
  permissions: ["support.read", "customers.read"],
};

function record(
  id: number,
  status: "new" | "read" | "archived",
  machine_name: string,
  message: string,
  contact: string,
  kind: "feedback" | "support" = "feedback",
) {
  return {
    id,
    status,
    kind,
    machine_name,
    message,
    contact,
    hwid: `HWID-${id}`,
    install_id: `install-${id}`,
    license_key: id === 1 ? LICENSE_KEY : `RR-OTHER-${id}`,
    app_version: "1.5.0",
    platform: "Windows",
    created_at: `2026-09-${String(10 + id).padStart(2, "0")}T10:00:00Z`,
  };
}

const REPORTS = [
  record(1, "new", "Avery Desktop", "The preset does not save.", "avery@example.test"),
  record(2, "read", "Mara Laptop", "The screenshot shortcut needs an option.", "mara@example.test"),
  record(3, "archived", "Noah Desktop", "Resolved installation question.", "noah@example.test"),
  record(4, "new", "Jules Desktop", "The keyboard shortcut resets.", "jules@example.test"),
  record(5, "new", "Kim Desktop", "The overlay crashes on alt-tab.", "kim@example.test", "support"),
  record(6, "archived", "Lee Laptop", "Resolved: login loop.", "lee@example.test", "support"),
];
const SUPPORT_ONLY = REPORTS.filter((item) => item.kind === "support");
const FEEDBACK_ONLY = REPORTS.filter((item) => item.kind === "feedback");

let container: HTMLDivElement;
let root: Root;
const api = vi.mocked(fetchApi);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let reports: typeof REPORTS = REPORTS;

beforeEach(() => {
  resetHistoryLayers();
  reports = REPORTS;
  history.replaceState(null, "", "http://localhost:3000/#/feedback");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.mockReset();
  vi.mocked(navigateCustomerUrl).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  api.mockImplementation(async (input, init) => {
    const pathname = new URL(String(input), window.location.origin).pathname;
    const method = init?.method ?? "GET";
    if (method === "GET" && pathname === "/api/admin/feedback") {
      return json({ ok: true, feedback: reports, unread: { feedback: 2, support: 1, total: 3 } });
    }
    // The page re-pulls the list on the refresh bus after a change, so the mock keeps state.
    const target = /^\/api\/admin\/feedback\/(\d+)$/.exec(pathname);
    if (method === "PUT" && target) {
      const { status } = JSON.parse(String(init?.body)) as {
        status: (typeof REPORTS)[0]["status"];
      };
      reports = reports.map((item) => (item.id === Number(target[1]) ? { ...item, status } : item));
      return json({ ok: true });
    }
    if (method === "DELETE" && target) {
      reports = reports.filter((item) => item.id !== Number(target[1]));
      return json({ ok: true });
    }
    throw new Error(`Unexpected mocked request: ${method} ${pathname}`);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  // A closed dialog's history.back() lands asynchronously (useHistoryLayer); let its popstate
  // arrive now, on the unmounted page, instead of during the next case's mount.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  container.remove();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
  resetHistoryLayers();
  vi.restoreAllMocks();
});

async function mount(user = WRITER, beside: ReactNode = null) {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={user}>
        <main>
          <FeedbackPage summary={null} />
        </main>
        {beside}
      </PanelIdentity.Provider>,
    ),
  );
}

/** Stands in for the dashboard (useDashboard listens the same way) and any other mounted list. */
function RefreshProbe({ onRefresh }: { onRefresh: () => void }) {
  useRefreshSignal(onRefresh);
  return null;
}

async function waitFor(check: () => boolean, description: string) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function controlName(element: Element): string {
  return (
    element.getAttribute("aria-label")?.trim() ||
    element.textContent?.trim() ||
    element.getAttribute("title") ||
    ""
  );
}

function button(name: string, scope: ParentNode = document.body): HTMLButtonElement | null {
  return (
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => controlName(item) === name,
    ) ?? null
  );
}

function filter(name: string): HTMLButtonElement {
  const group = container.querySelector('[role="radiogroup"][aria-label="Filter by status"]');
  const item = [...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])].find(
    (candidate) => new RegExp(`^${name}(?:\\s*\\d+)?$`).test(controlName(candidate)),
  );
  expect(item, `${name} status filter`).toBeDefined();
  return item!;
}

function sectionTab(name: "Feedback" | "Support"): HTMLButtonElement {
  const list = container.querySelector('[role="tablist"][aria-label="Feedback sections"]');
  const item = [...(list?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])].find(
    (candidate) => new RegExp(`^${name}(?:\\s*·\\s*\\d+)?$`).test(controlName(candidate)),
  );
  expect(item, `${name} section tab`).toBeDefined();
  return item!;
}

function report(id: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`article[aria-label="Feedback report ${id}"]`);
}

function reportIds(): number[] {
  return [...container.querySelectorAll('article[aria-label^="Feedback report "]')]
    .map((item) => Number(item.getAttribute("aria-label")!.replace("Feedback report ", "")))
    .sort((left, right) => left - right);
}

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => element!.click());
}

async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search feedback"]');
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function requests(method: string) {
  return api.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
}

async function loaded(user = WRITER) {
  await mount(user);
  await waitFor(() => report(1) !== null, "the feedback inbox");
}

describe("feedback workspace", () => {
  it("keeps read reports in Inbox, excludes archived reports, and shows actual status counts", async () => {
    await loaded();
    expect(reportIds()).toEqual([1, 2, 4]);
    expect(filter("Inbox").getAttribute("aria-checked")).toBe("true");
    expect(filter("Inbox").textContent).toMatch(/Inbox\s*3/);
    expect(filter("New").textContent).toMatch(/New\s*2/);
    expect(filter("Read").textContent).toMatch(/Read\s*1/);
    expect(filter("Archived").textContent).toMatch(/Archived\s*1/);

    await click(filter("New"));
    expect(reportIds()).toEqual([1, 4]);
    await click(filter("Read"));
    expect(reportIds()).toEqual([2]);
    await click(filter("Archived"));
    expect(reportIds()).toEqual([3]);
    await click(filter("Inbox"));
    expect(reportIds()).toEqual([1, 2, 4]);
  });

  it.each([
    ["preset", [1]],
    ["MARA@EXAMPLE.TEST", [2]],
    [LICENSE_KEY, [1]],
  ])("searches actual feedback and identity data: %s", async (query, expected) => {
    await loaded();
    await search(String(query));
    expect(reportIds()).toEqual(expected);
    await search("");
    expect(reportIds()).toEqual([1, 2, 4]);
  });

  it("shows the customer and contact while keeping raw technical data inside collapsed details", async () => {
    await loaded();
    const item = report(1)!;
    expect(item.querySelector("h2, h3, h4")?.textContent).toContain("Avery Desktop");
    const details = item.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.querySelector("summary")?.textContent?.trim()).toBe("Report details");

    const visible = item.cloneNode(true) as HTMLElement;
    visible.querySelectorAll("details").forEach((element) => element.remove());
    expect(visible.textContent).toContain("avery@example.test");
    expect(visible.textContent).not.toContain(LICENSE_KEY);
    for (const element of [visible, ...visible.querySelectorAll("*")]) {
      for (const attribute of element.attributes) {
        if (attribute.name === "title" || attribute.name.startsWith("aria-")) {
          expect(attribute.value).not.toContain(LICENSE_KEY);
        }
      }
    }
    expect(button("Delete report", visible)).toBeNull();
    expect(button("Delete report", details!)).not.toBeNull();
  });

  it("allows read-only support to inspect and reply-view without mutation controls", async () => {
    await loaded(READER);
    expect(button("Replies", report(1)!)).not.toBeNull();
    expect(button("Mark read", report(1)!)).toBeNull();
    expect(button("Archive", report(1)!)).toBeNull();
    expect(button("Delete report", report(1)!)).toBeNull();
    await click(filter("Archived"));
    expect(button("Move to inbox", report(3)!)).toBeNull();
    expect(button("Delete report", report(3)!)).toBeNull();
    expect(requests("PUT")).toHaveLength(0);
    expect(requests("DELETE")).toHaveLength(0);
  });

  it("marks a new report read without removing it from Inbox and archives only when requested", async () => {
    await loaded();
    await click(button("Mark read", report(1)!));
    expect(reportIds()).toEqual([1, 2, 4]);
    expect(button("Mark read", report(1)!)).toBeNull();
    expect(filter("New").textContent).toMatch(/New\s*1/);
    expect(filter("Read").textContent).toMatch(/Read\s*2/);
    expect(JSON.parse(String(requests("PUT")[0][1]?.body))).toEqual({ status: "read" });

    await click(button("Archive", report(1)!));
    expect(reportIds()).toEqual([2, 4]);
    await click(filter("Archived"));
    expect(reportIds()).toEqual([1, 3]);
    await click(button("Move to inbox", report(1)!));
    expect(reportIds()).toEqual([3]);
    await click(filter("Inbox"));
    expect(reportIds()).toEqual([1, 2, 4]);
  });

  it("signals the refresh bus after a status change or a delete, never after a failed one", async () => {
    const refreshed = vi.fn();
    await mount(WRITER, <RefreshProbe onRefresh={refreshed} />);
    await waitFor(() => report(1) !== null, "the feedback inbox");
    expect(refreshed).not.toHaveBeenCalled();
    expect(requests("GET")).toHaveLength(1);

    // The dashboard summary (the rail's unread count) and this list re-pull right away.
    await click(button("Mark read", report(1)!));
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(requests("GET")).toHaveLength(2);
    await waitFor(() => button("Mark read", report(1)!) === null, "the re-pulled list");
    expect(filter("New").textContent).toMatch(/New\s*1/);

    api.mockResolvedValueOnce(json({ ok: false, error: "Update rejected" }, 500));
    await click(button("Mark read", report(4)!));
    await waitFor(
      () => Boolean(container.querySelector('[role="alert"]')?.textContent?.trim()),
      "the action error",
    );
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(requests("GET")).toHaveLength(2);

    const details = report(2)!.querySelector("details")!;
    await click(details.querySelector("summary"));
    await click(
      [...details.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
        /^Delete (report|feedback)$/.test(controlName(item)),
      ) ?? null,
    );
    await waitFor(() => document.querySelector('[role="dialog"]') !== null, "the confirmation");
    const dialog = document.querySelector('[role="dialog"]')!;
    await click(
      [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
        /^Delete (report|feedback)$/.test(controlName(item)),
      ) ?? null,
    );
    expect(requests("DELETE")).toHaveLength(1);
    expect(refreshed).toHaveBeenCalledTimes(2);
    expect(requests("GET")).toHaveLength(3);
    await waitFor(() => report(2) === null, "the re-pulled list without the deleted row");
    expect(reportIds()).toEqual([1, 4]);
  });

  it("opens replies for the selected report and preserves the Customer 360 feedback lookup", async () => {
    await loaded();
    await click(button("Replies", report(2)!));
    expect(
      container.querySelector('[role="dialog"][aria-label="Replies for report 2"]'),
    ).not.toBeNull();
    const link = report(1)!.querySelector<HTMLAnchorElement>('a[href*="customerBy=feedback_id"]');
    expect(link).not.toBeNull();
    await click(link);
    const destination = vi.mocked(navigateCustomerUrl).mock.calls[0]?.[0];
    expect(destination).toBeInstanceOf(URL);
    if (!(destination instanceof URL)) throw new Error("Customer navigation must receive a URL.");
    expect(destination.searchParams.get("customerBy")).toBe("feedback_id");
    expect(destination.searchParams.get("customer")).toBe("1");
    expect(destination.hash).toBe("#/feedback");
  });

  it("shows an initial network failure as unavailable and retries instead of claiming an empty inbox", async () => {
    api.mockRejectedValueOnce(new Error("Network offline"));
    await mount();
    await waitFor(
      () => container.textContent?.includes("Feedback unavailable") === true,
      "the loading error",
    );
    expect(container.textContent).not.toContain("No feedback");
    expect(reportIds()).toEqual([]);
    await click(button("Retry"));
    await waitFor(() => report(1) !== null, "the retry result");
    expect(reportIds()).toEqual([1, 2, 4]);
    expect(container.textContent).not.toContain("Feedback unavailable");
    expect(requests("GET")).toHaveLength(2);
  });

  it.each(["http", "network"])(
    "retains a report and its status when the update fails: %s",
    async (failure) => {
      await loaded();
      if (failure === "http")
        api.mockResolvedValueOnce(json({ ok: false, error: "Update rejected" }, 500));
      else api.mockRejectedValueOnce(new Error("Network offline"));
      await click(button("Mark read", report(1)!));
      await waitFor(
        () => Boolean(container.querySelector('[role="alert"]')?.textContent?.trim()),
        "the action error",
      );
      expect(reportIds()).toEqual([1, 2, 4]);
      expect(button("Mark read", report(1)!)).not.toBeNull();
      expect(filter("New").textContent).toMatch(/New\s*2/);
      expect(filter("Read").textContent).toMatch(/Read\s*1/);
      await click(filter("Read"));
      expect(reportIds()).toEqual([2]);
    },
  );

  it("requires confirmation before permanently deleting a report", async () => {
    await loaded();
    const details = report(1)!.querySelector("details")!;
    await click(details.querySelector("summary"));
    await click(button("Delete report", details));
    await waitFor(
      () => document.querySelector('[role="dialog"]') !== null,
      "the delete confirmation",
    );
    expect(requests("DELETE")).toHaveLength(0);
    expect(report(1)).not.toBeNull();
    const dialog = document.querySelector('[role="dialog"]')!;
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      /^Delete (report|feedback)$/.test(controlName(item)),
    );
    await click(confirm ?? null);
    expect(requests("DELETE")).toHaveLength(1);
    expect(reportIds()).toEqual([2, 4]);
  });

  it("splits the page into Feedback and Support sections with per-inbox unread counts", async () => {
    await loaded();
    // Feedback opens first: the four feedback rows, none of the support ones.
    expect(sectionTab("Feedback").getAttribute("aria-selected")).toBe("true");
    expect(sectionTab("Feedback").textContent).toBe("Feedback · 2");
    expect(sectionTab("Support").textContent).toBe("Support · 1");
    expect(reportIds()).toEqual([1, 2, 4]);
    expect(container.querySelector("h2#support-inbox-title")?.textContent).toBe("Feedback inbox");
    expect(container.querySelector(".support-result-count")?.textContent).toBe(
      "3 of 4 loaded reports",
    );
    expect(new URLSearchParams(window.location.search).get("section")).toBeNull();

    await click(sectionTab("Support"));
    expect(sectionTab("Support").getAttribute("aria-selected")).toBe("true");
    expect(reportIds()).toEqual([5]);
    expect(container.querySelector("h2#support-inbox-title")?.textContent).toBe("Support inbox");
    expect(container.querySelector(".support-result-count")?.textContent).toBe(
      "1 of 2 loaded reports",
    );
    expect(filter("Inbox").textContent).toMatch(/Inbox\s*1$/);
    expect(filter("New").textContent).toMatch(/New\s*1$/);
    expect(filter("Archived").textContent).toMatch(/Archived\s*1$/);
    expect(new URLSearchParams(window.location.search).get("section")).toBe("support");
    expect(window.location.hash).toBe("#/feedback");
    await click(filter("Archived"));
    expect(reportIds()).toEqual([6]);

    // The status filter belongs to the page, not the section; the list re-scopes.
    await click(sectionTab("Feedback"));
    expect(reportIds()).toEqual([3]);
    expect(new URLSearchParams(window.location.search).get("section")).toBeNull();
  });

  it("opens the Support section from a deep link and leaves the parameter behind on unmount", async () => {
    history.replaceState(null, "", "http://localhost:3000/?section=support#/feedback");
    await mount();
    await waitFor(() => report(5) !== null, "the support inbox");
    expect(sectionTab("Support").getAttribute("aria-selected")).toBe("true");
    expect(reportIds()).toEqual([5]);
    await act(async () => root.unmount());
    expect(new URLSearchParams(window.location.search).get("section")).toBeNull();
    root = createRoot(container);
  });

  it("carries the open section on the Customer 360 link, so closing the workspace lands back on it", async () => {
    history.replaceState(
      null,
      "",
      "http://localhost:3000/?section=support&customerTab=history#/feedback",
    );
    await mount();
    await waitFor(() => report(5) !== null, "the support inbox");
    const customerLink = (id: number) =>
      new URL(
        report(id)!.querySelector<HTMLAnchorElement>('a[href*="customerBy=feedback_id"]')!.href,
      );
    expect(customerLink(5).searchParams.get("section")).toBe("support");
    expect(customerLink(5).searchParams.get("customer")).toBe("5");
    expect(customerLink(5).searchParams.get("customerBy")).toBe("feedback_id");
    // A stale tab from an earlier workspace is not carried into a different customer's.
    expect(customerLink(5).searchParams.get("customerTab")).toBeNull();
    expect(customerLink(5).hash).toBe("#/feedback");
    await click(report(5)!.querySelector("a"));
    const destination = vi.mocked(navigateCustomerUrl).mock.calls[0]?.[0] as URL;
    expect(destination.searchParams.get("section")).toBe("support");
    expect(destination.searchParams.get("customer")).toBe("5");

    // Switching sections by tab re-addresses the links in the same render as the list.
    await click(sectionTab("Feedback"));
    expect(customerLink(1).searchParams.get("section")).toBeNull();
    expect(customerLink(1).searchParams.get("customer")).toBe("1");
    await click(sectionTab("Support"));
    expect(customerLink(5).searchParams.get("section")).toBe("support");
  });

  it("keeps every row action in the Support section, including the delete confirmation", async () => {
    await loaded();
    await click(sectionTab("Support"));
    const item = report(5)!;
    expect(button("Mark read", item)).not.toBeNull();
    expect(button("Archive", item)).not.toBeNull();
    expect(button("Replies", item)).not.toBeNull();

    await click(button("Mark read", item));
    expect(JSON.parse(String(requests("PUT")[0][1]?.body))).toEqual({ status: "read" });
    expect(button("Mark read", report(5)!)).toBeNull();
    expect(sectionTab("Support").textContent).toBe("Support");
    expect(sectionTab("Feedback").textContent).toBe("Feedback · 2");

    await click(button("Replies", report(5)!));
    expect(
      container.querySelector('[role="dialog"][aria-label="Replies for report 5"]'),
    ).not.toBeNull();

    const details = report(5)!.querySelector("details")!;
    await click(details.querySelector("summary"));
    await click(button("Delete report", details));
    await waitFor(
      () => document.querySelector('[data-modal-root="true"] [role="dialog"]') !== null,
      "the delete confirmation",
    );
    const dialog = document.querySelector('[data-modal-root="true"] [role="dialog"]')!;
    expect(dialog.textContent).toContain("Delete report");
    expect(dialog.textContent).toContain("support report");
    expect(requests("DELETE")).toHaveLength(0);
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      /^Delete report$/.test(controlName(entry)),
    );
    await click(confirm ?? null);
    expect(requests("DELETE")).toHaveLength(1);
    expect(String(requests("DELETE")[0][0])).toContain("/api/admin/feedback/5");
    expect(reportIds()).toEqual([]);
    expect(container.textContent).toContain("Everything in this section is archived.");
  });

  it("shows a read-only Support section without mutation controls", async () => {
    await loaded(READER);
    await click(sectionTab("Support"));
    expect(button("Replies", report(5)!)).not.toBeNull();
    expect(button("Mark read", report(5)!)).toBeNull();
    expect(button("Archive", report(5)!)).toBeNull();
    expect(button("Delete report", report(5)!)).toBeNull();
  });

  it.each([
    ["support", SUPPORT_ONLY, "Feedback", "No feedback yet", [5]],
    ["feedback", FEEDBACK_ONLY, "Support", "No support reports yet", [1, 2, 4]],
  ] as const)(
    "has its own empty state per section when only %s rows exist",
    async (_kind, rows, emptySection, title, otherIds) => {
      reports = rows;
      await mount();
      await waitFor(() => container.querySelector(".support-result-count") !== null, "the load");
      if (emptySection === "Feedback") {
        expect(container.textContent).toContain(title);
        expect(sectionTab("Feedback").textContent).toBe("Feedback");
        await click(sectionTab("Support"));
        expect(reportIds()).toEqual(otherIds);
      } else {
        expect(reportIds()).toEqual(otherIds);
        await click(sectionTab("Support"));
        expect(container.textContent).toContain(title);
        expect(sectionTab("Support").textContent).toBe("Support");
        expect(reportIds()).toEqual([]);
      }
    },
  );

  it("treats a row without a kind as feedback", async () => {
    reports = [
      { ...record(9, "new", "Old Client", "Sent by 1.5.2.", "old@example.test"), kind: undefined },
    ] as unknown as typeof REPORTS;
    await mount();
    await waitFor(() => report(9) !== null, "the legacy row");
    expect(sectionTab("Feedback").textContent).toBe("Feedback · 1");
    expect(sectionTab("Support").textContent).toBe("Support");
  });
});
