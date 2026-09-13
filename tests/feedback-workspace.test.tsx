import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackPage } from "../src/pages/FeedbackPage";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import type { AuthUser } from "../src/types/telemetry";
import { fetchApi } from "../src/utils/api";
import { navigateCustomerUrl } from "../src/utils/customerNavigation";

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
) {
  return {
    id,
    status,
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
];

let container: HTMLDivElement;
let root: Root;
const api = vi.mocked(fetchApi);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetHistoryLayers();
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
      return json({ ok: true, feedback: REPORTS });
    }
    if (
      (method === "PUT" || method === "DELETE") &&
      /^\/api\/admin\/feedback\/\d+$/.test(pathname)
    ) {
      return json({ ok: true });
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

async function mount(user = WRITER) {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={user}>
        <main>
          <FeedbackPage summary={null} />
        </main>
      </PanelIdentity.Provider>,
    ),
  );
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
});
