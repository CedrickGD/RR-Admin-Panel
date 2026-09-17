import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackReplies } from "../src/components/FeedbackReplies";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { resetHistoryLayers } from "../src/hooks/useHistoryLayer";
import type { AuthUser } from "../src/types/telemetry";
import { fetchApi } from "../src/utils/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/api")>()),
  fetchApi: vi.fn(),
}));

const WRITER: AuthUser = {
  email: "support@example.test",
  role: "admin",
  permissions: ["support.read", "support.write"],
};
const READER: AuthUser = {
  email: "reader@example.test",
  role: "viewer",
  permissions: ["support.read"],
};
const REPORT = { id: 7, message: "My preset does not save.", machine_name: "Avery Desktop" };
const OLDER = {
  id: 11,
  message: "Please send the preset name.",
  created_at: "2026-09-11T10:00:00Z",
  read_at: "2026-09-11T10:05:00Z",
};
const NEWER = {
  id: 32,
  message: "We have an update for you.",
  created_at: "2026-09-12T12:00:00Z",
  read_at: null,
};
const SENT = {
  id: 40,
  message: "Please try the updated preset.",
  created_at: "2026-09-13T12:00:00Z",
  read_at: null,
};

const api = vi.mocked(fetchApi);
let root: Root;
let container: HTMLDivElement;

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
  api.mockImplementation(async (input, init) => {
    const pathname = new URL(String(input), window.location.origin).pathname;
    const method = init?.method ?? "GET";
    if (pathname !== "/api/admin/feedback/7/replies")
      throw new Error(`Unexpected reply URL: ${pathname}`);
    if (method === "GET")
      return json({ ok: true, replies: [], can_reply: true, next_before: null });
    if (method === "POST") return json({ ok: true, reply: SENT });
    throw new Error(`Unexpected reply method: ${method}`);
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

type ReportProp = Parameters<typeof FeedbackReplies>[0]["report"];
async function mount(user = WRITER, report: ReportProp = REPORT) {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={user}>
        <main>Feedback workspace</main>
        <FeedbackReplies report={report} onClose={vi.fn()} />
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

function openDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-modal-root="true"][data-state="open"] [role="dialog"]',
  );
}

function dialog(): HTMLElement {
  const element = openDialog();
  if (!element) throw new Error("Expected the open reply dialog");
  return element;
}

function controlName(element: Element): string {
  return (
    element.getAttribute("aria-label")?.trim() ||
    element.textContent?.trim() ||
    element.getAttribute("title") ||
    ""
  );
}

function button(name: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => controlName(element) === name,
    ) ?? null
  );
}

async function click(element: HTMLElement | null) {
  if (!element) throw new Error("Expected an actionable control");
  await act(async () => element.click());
}

function composer(): HTMLTextAreaElement {
  const label = [...dialog().querySelectorAll<HTMLLabelElement>("label")].find((element) =>
    element.textContent?.includes("Your reply"),
  );
  if (!label?.htmlFor) throw new Error("Expected the Your reply field label");
  const field = document.getElementById(label.htmlFor);
  if (!(field instanceof HTMLTextAreaElement))
    throw new Error("Expected the labeled reply textarea");
  return field;
}

async function typeReply(value: string) {
  const field = composer();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("The native textarea setter is unavailable");
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function historyRegion(): HTMLElement {
  // A named section has the implicit region role, including in the real Modal portal.
  const region = dialog().querySelector<HTMLElement>(
    'section[aria-label="Reply history"], [role="region"][aria-label="Reply history"]',
  );
  if (!region) throw new Error("Expected the Reply history region");
  return region;
}

function postCalls() {
  return api.mock.calls.filter(([, init]) => init?.method === "POST");
}

function postBody(index: number): { message: string; request_id: string } {
  const body = postCalls()[index]?.[1]?.body;
  if (typeof body !== "string") throw new Error(`Expected JSON body for reply POST ${index}`);
  return JSON.parse(body) as { message: string; request_id: string };
}

async function ready(user = WRITER, report = REPORT) {
  await mount(user, report);
  await waitFor(
    () => Boolean(openDialog()?.textContent?.includes("No replies recorded yet.")),
    "the initial reply history",
  );
}

describe("feedback reply dialog", () => {
  it("waits for a verified recipient before offering the permitted composer", async () => {
    let answer: ((response: Response) => void) | undefined;
    api.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    await mount();
    expect(button("Send reply")).toBeNull();
    expect(openDialog()?.querySelector("textarea")).toBeNull();
    if (!answer) throw new Error("Expected the initial replies request");
    const resolveRequest = answer;
    await act(async () =>
      resolveRequest(json({ ok: true, replies: [], can_reply: true, next_before: null })),
    );
    await waitFor(() => button("Send reply") !== null, "the verified composer");
    expect(composer().value).toBe("");
    expect(button("Send reply")?.disabled).toBe(true);
    await typeReply("A helpful answer");
    expect(button("Send reply")?.disabled).toBe(false);
  });

  it("lets read-only support read existing history without a composer or Send action", async () => {
    await ready(READER);
    expect(historyRegion()).toBeTruthy();
    expect(dialog().textContent).toContain("Read-only access");
    expect(dialog().querySelector("textarea")).toBeNull();
    expect(button("Send reply")).toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it("does not offer Send for an unverified report even to support writers", async () => {
    api.mockResolvedValueOnce(json({ ok: true, replies: [], can_reply: false, next_before: null }));
    await ready();
    expect(dialog().textContent).toContain("no verified recipient");
    expect(dialog().querySelector("textarea")).toBeNull();
    expect(button("Send reply")).toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it("renders preexisting replies in chronological order with actual app read states", async () => {
    api.mockResolvedValueOnce(
      json({ ok: true, replies: [NEWER, OLDER], can_reply: true, next_before: null }),
    );
    await mount();
    await waitFor(
      () => Boolean(openDialog()?.querySelector('article[aria-label="Support reply 11"]')),
      "the existing replies",
    );
    const history = historyRegion();
    const replies = [...history.querySelectorAll("article")];
    expect(replies.map((element) => element.getAttribute("aria-label"))).toEqual([
      "Support reply 11",
      "Support reply 32",
    ]);
    expect(replies[0]?.textContent).toContain(OLDER.message);
    expect(replies[0]?.querySelector("time")?.dateTime).toBe(OLDER.created_at);
    expect(replies[0]?.textContent).toContain("Read in app");
    expect(replies[1]?.textContent).toContain("Unread in app");
    expect(history.textContent).not.toContain("Delivered");
  });

  it.each(["network", "http"])(
    "shows a reply-load error and recovers through Retry: %s",
    async (failure) => {
      if (failure === "network") api.mockRejectedValueOnce(new Error("Offline"));
      else api.mockResolvedValueOnce(json({ ok: false }, 503));
      await mount();
      await waitFor(() => button("Retry") !== null, "the reply loading error");
      expect(historyRegion().querySelector('[role="alert"]')?.textContent).toContain(
        "could not be loaded",
      );
      expect(historyRegion().textContent).not.toContain("No replies recorded yet.");
      expect(button("Send reply")).toBeNull();
      await click(button("Retry"));
      await waitFor(() => button("Send reply") !== null, "the reply history retry");
      expect(historyRegion().textContent).toContain("No replies recorded yet.");
      expect(button("Retry")).toBeNull();
      expect(api.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET")).toHaveLength(
        2,
      );
    },
  );

  it.each(["network", "http"])(
    "retains the draft and request ID on an unchanged failed-send retry: %s",
    async (failure) => {
      await ready();
      const draft = `  ${SENT.message}  `;
      await typeReply(draft);
      if (failure === "network") api.mockRejectedValueOnce(new Error("Connection dropped"));
      else api.mockResolvedValueOnce(json({ ok: false }, 500));
      await click(button("Send reply"));
      await waitFor(
        () =>
          Boolean(
            openDialog()
              ?.querySelector('[role="alert"]')
              ?.textContent?.includes("draft is still here"),
          ),
        "the send error",
      );
      expect(composer().value).toBe(draft);
      expect(postCalls()).toHaveLength(1);
      expect(postBody(0).message).toBe(SENT.message);
      expect(postBody(0).request_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(historyRegion().querySelectorAll("article")).toHaveLength(0);

      await click(button("Send reply"));
      await waitFor(
        () => Boolean(openDialog()?.querySelector('article[aria-label="Support reply 40"]')),
        "the successful reply retry",
      );
      expect(postCalls()).toHaveLength(2);
      expect(postBody(1)).toEqual(postBody(0));
      expect(composer().value).toBe("");
      expect(
        historyRegion().querySelectorAll('article[aria-label="Support reply 40"]'),
      ).toHaveLength(1);
      expect(historyRegion().textContent).toContain("Unread in app");
      expect(dialog().querySelector('[role="alert"]')).toBeNull();
    },
  );

  it("uses a new request ID when the failed draft is edited before retry", async () => {
    await ready();
    await typeReply("First answer");
    api.mockRejectedValueOnce(new Error("Offline"));
    await click(button("Send reply"));
    await waitFor(
      () => Boolean(openDialog()?.querySelector('[role="alert"]')),
      "the failed answer",
    );
    const original = postBody(0);
    await typeReply(SENT.message);
    await click(button("Send reply"));
    await waitFor(() => postCalls().length === 2 && composer().value === "", "the edited retry");
    expect(postBody(1).message).toBe(SENT.message);
    expect(postBody(1).request_id).not.toBe(original.request_id);
  });

  it("expands and collapses a long customer report with an accessible DS control", async () => {
    const message = "A detailed report describing the preset problem. ".repeat(15);
    await ready(WRITER, { ...REPORT, message });
    const expand = button("Show full report");
    if (!expand) throw new Error("Expected the long-report expansion control");
    const sourceId = expand.getAttribute("aria-controls");
    if (!sourceId) throw new Error("Expected the report content relationship");
    const source = document.getElementById(sourceId);
    if (!source) throw new Error("Expected the report content");
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(source.textContent).toBe(message);
    expect(source.classList.contains("support-source-clamped")).toBe(true);
    await click(expand);
    expect(button("Show less")?.getAttribute("aria-expanded")).toBe("true");
    expect(source.classList.contains("support-source-clamped")).toBe(false);
    await click(button("Show less"));
    expect(button("Show full report")?.getAttribute("aria-expanded")).toBe("false");
    expect(source.classList.contains("support-source-clamped")).toBe(true);
    expect(postCalls()).toHaveLength(0);
  });
});

describe("report kind in the reply dialog", () => {
  it("labels a support report and a feedback entry, and stays silent without a kind", async () => {
    await mount(WRITER, { ...REPORT, kind: "support" });
    await waitFor(() => openDialog() !== null, "the dialog");
    const label = dialog().querySelector(".support-conversation-label")!;
    expect(label.querySelector(".badge")?.textContent).toBe("Support");
    expect(label.querySelector(".badge")?.className).toContain("badge-info");

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(WRITER, { ...REPORT, kind: "feedback" });
    await waitFor(() => openDialog() !== null, "the dialog again");
    expect(dialog().querySelector(".support-conversation-label .badge")?.textContent).toBe(
      "Feedback",
    );

    await act(async () => root.unmount());
    root = createRoot(container);
    await mount(WRITER, REPORT);
    await waitFor(() => openDialog() !== null, "the dialog once more");
    expect(dialog().querySelector(".support-conversation-label .badge")).toBeNull();
  });
});
