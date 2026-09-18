// A timezone with a real offset, set before anything in this file touches Date: the presets
// have to write LOCAL time into the datetime-local input, and at UTC that assertion is free.
process.env.TZ = "America/New_York";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelIdentity } from "../src/hooks/usePanelPermission";
import { TeamPage } from "../src/pages/TeamPage";
import type { AuthUser } from "../src/types/telemetry";
import { PERMISSIONS } from "../shared/panel-policy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * Panel access → the two places the Cloudflare Allow policy made the panel lie about itself:
 *
 * - "Active sessions" printed the sign-in expiry, which is a month out for everybody, next to
 *   a member whose panel access ends in two hours — the reading that made the owner call the
 *   per-user access time useless;
 * - "Access expires" was a bare datetime-local, so a two-hour grant meant typing a date.
 *
 * The real page against a stubbed /api/admin/team, so the rendered cells and the POST body are
 * the ones the panel actually produces.
 */
const HOUR = 3_600_000;
const OWNER = "owner@example.test";
/*
 * The hour America/New_York lives through twice: on 2026-11-01 the clock goes 01:59 EDT ->
 * 01:00 EST, so "2026-11-01T01:20" names two real instants an hour apart and `new Date(local)`
 * can only ever return the earlier one. Both constants below are the LATER (EST) instant, the
 * one a naive round trip through the datetime-local field silently loses.
 */
/** An expiry already stored on the second pass: 01:30 EST. */
const DST_SECOND_PASS = "2026-11-01T06:30:00.000Z";
/** A moment inside the first pass; one hour later (the "1 hour" preset) lands on the second. */
const DST_FIRST_PASS = Date.parse("2026-11-01T05:20:00.000Z");
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const ownerIdentity: AuthUser = {
  email: OWNER,
  role: "admin",
  panelRole: "owner",
  permissions: PERMISSIONS.map((permission) => permission.key),
};

function payload() {
  const member = (email: string, extra: Record<string, unknown> = {}) => ({
    email,
    display_name: email.split("@")[0],
    role: "viewer",
    enabled: 1,
    expires_at: null,
    removed_at: null,
    overrides: {},
    permissions: [],
    ...extra,
  });
  const group = (email: string, extra: Record<string, unknown> = {}) => ({
    key: `${email}|access|chrome`,
    email,
    auth_mode: "access",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
    tokens: 3,
    first_seen_at: iso(-4 * HOUR),
    last_seen_at: iso(-60_000),
    // One month, the way Cloudflare Access hands it out since the Allow policy.
    expires_at: iso(30 * 24 * HOUR),
    effective_expires_at: iso(30 * 24 * HOUR),
    limited_by: "token",
    blocked: false,
    ids: ["a", "b", "c"],
    ...extra,
  });
  return {
    ok: true,
    actor: OWNER,
    authMode: "access",
    members: [
      member(OWNER, { role: "owner", display_name: "Owner" }),
      member("short@example.test", { expires_at: iso(2 * HOUR) }),
      member("normal@example.test", { expires_at: iso(60 * 24 * HOUR) }),
      member("gone@example.test", { enabled: 0, expires_at: iso(-3 * HOUR) }),
      member("dst@example.test", { expires_at: DST_SECOND_PASS }),
    ],
    sessions: [
      group("short@example.test", {
        effective_expires_at: iso(2 * HOUR),
        limited_by: "member",
      }),
      group("normal@example.test"),
      group("gone@example.test", {
        effective_expires_at: iso(-3 * HOUR),
        limited_by: "member",
        blocked: true,
      }),
    ],
    audit: [],
  };
}

let root: Root;
let container: HTMLDivElement;
let posted: Record<string, unknown>[];

beforeAll(() => {
  // TableFrame measures itself and ds/Modal waits for animations; jsdom has neither.
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
  posted = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
      }
      return { ok: true, json: async () => payload() } as unknown as Response;
    }),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render() {
  await act(async () =>
    root.render(
      <PanelIdentity.Provider value={ownerIdentity}>
        <TeamPage />
      </PanelIdentity.Provider>,
    ),
  );
  await settle(() => rows().length > 0, "the members table");
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

const rows = () => [...container.querySelectorAll("tbody tr")];
const button = (name: string, scope: ParentNode = document.body) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) ?? null;
const click = async (element: Element | null) => {
  if (!element) throw new Error("control not found");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};
const dialog = () =>
  document.querySelector<HTMLElement>(
    '[data-modal-root="true"][data-state="open"] [role="dialog"]',
  );
const expiresInput = () => dialog()?.querySelector<HTMLInputElement>("#member-expires") ?? null;
/** The row of a member, by the address in its record cell. */
const rowOf = (email: string) =>
  rows().find((row) => row.textContent?.includes(email)) ?? null;
const cell = (row: Element | null, label: string) =>
  row?.querySelector(`td[data-label="${label}"]`)?.textContent?.trim() ?? "";

async function openSessions() {
  await click(button("Active sessions"));
  await settle(() => !!rowOf("short@example.test"), "the sessions table");
}

async function openEditor(email: string) {
  await click(button("Manage", rowOf(email) ?? container));
  await settle(() => !!expiresInput(), "the member editor");
}

describe("Panel access · when access really ends", () => {
  it("shows the member's own limit in the sessions table, not the month-long sign-in", async () => {
    await render();
    await openSessions();
    const limited = cell(rowOf("short@example.test"), "Expires");
    // Two hours out, and the row says which of the two expiries that is.
    expect(limited).toContain(new Date(Date.now() + 2 * HOUR).toLocaleString().slice(0, 10));
    expect(limited).toContain("access limit");
    const normal = cell(rowOf("normal@example.test"), "Expires");
    expect(normal).toContain("sign-in");
    expect(normal).not.toContain("access limit");
  });

  it("renders a blocked group as ended and leaves it out of the active count", async () => {
    await render();
    await openSessions();
    const ended = cell(rowOf("gone@example.test"), "Expires");
    expect(ended).toContain("Ended");
    // Not a date: a session the panel already refuses must not read as one that is still running.
    expect(ended).not.toContain(new Date().getFullYear().toString());
    // Three groups in the table, two of them live.
    expect(rows()).toHaveLength(3);
    expect(container.querySelector(".team-summary")?.textContent).toContain("2active sessions");
  });

  it("adds a relative hint to a Valid until inside the next 48 hours", async () => {
    await render();
    expect(cell(rowOf("short@example.test"), "Valid until")).toContain("in 2 h");
    // Two months out is not urgent, and already over keeps the plain date under "Expired".
    expect(cell(rowOf("normal@example.test"), "Valid until")).not.toContain("in ");
    expect(cell(rowOf("gone@example.test"), "Valid until")).not.toContain("in ");
    expect(cell(rowOf("gone@example.test"), "Access")).toContain("Disabled");
  });
});

describe("Panel access · the Access expires presets", () => {
  it("fills the field in local time and clears it again", async () => {
    await render();
    await openEditor("normal@example.test");
    const input = expiresInput()!;
    const at = Date.now();
    await click(button("8 hours", dialog()!));
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // A datetime-local value is read back as LOCAL time — parsing it has to land on now + 8h,
    // which it only does if the preset wrote local time rather than the ISO/UTC string.
    expect(Math.abs(new Date(input.value).getTime() - (at + 8 * HOUR))).toBeLessThan(60_000);
    if (new Date().getTimezoneOffset() !== 0)
      expect(input.value).not.toBe(new Date(at + 8 * HOUR).toISOString().slice(0, 16));

    await click(button("1 hour", dialog()!));
    expect(Math.abs(new Date(input.value).getTime() - (at + HOUR))).toBeLessThan(60_000);

    await click(button("No expiry", dialog()!));
    expect(input.value).toBe("");
  });

  it("saves the same ISO string — or null — the hand-typed field always sent", async () => {
    await render();
    await openEditor("normal@example.test");
    const at = Date.now();
    await click(button("1 day", dialog()!));
    await click(button("Save access", dialog()!));
    await settle(() => posted.length > 0, "the save request");
    const saved = posted[0];
    expect(saved.action).toBe("save");
    expect(saved.email).toBe("normal@example.test");
    expect(String(saved.expiresAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Math.abs(Date.parse(String(saved.expiresAt)) - (at + 24 * HOUR))).toBeLessThan(60_000);

    await openEditor("normal@example.test");
    await click(button("No expiry", dialog()!));
    await click(button("Save access", dialog()!));
    await settle(() => posted.length > 1, "the second save request");
    expect(posted[1].expiresAt).toBeNull();
  });

  it("describes the datetime-local input itself, not the box the presets share with it", async () => {
    await render();
    await openEditor("normal@example.test");
    const describedBy = expiresInput()!.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The one sentence that explains why this field matters now that the sign-in lasts a month.
    const help = describedBy!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(help).toContain("every single request");
  });
});

/*
 * Local wall-clock time is not a moment: at a DST fall-back one local string names two instants
 * an hour apart, and parsing it always yields the earlier one. A grant the owner never touched
 * must not move, and "1 hour" must not hand out an expiry of zero minutes.
 */
describe("Panel access · the hour the clock repeats", () => {
  it("keeps a stored expiry the owner never touched", async () => {
    await render();
    await openEditor("dst@example.test");
    // The field shows the wall-clock time of the second pass — which reads the same as the first.
    expect(expiresInput()!.value).toBe("2026-11-01T01:30");
    await click(button("Save access", dialog()!));
    await settle(() => posted.length > 0, "the save request");
    expect(posted[0].expiresAt).toBe(DST_SECOND_PASS);
  });

  it("grants a full hour from a '1 hour' preset clicked inside that window", async () => {
    await render();
    await openEditor("normal@example.test");
    const clock = vi.spyOn(Date, "now").mockReturnValue(DST_FIRST_PASS);
    await click(button("1 hour", dialog()!));
    clock.mockRestore();
    expect(expiresInput()!.value).toBe("2026-11-01T01:20");
    await click(button("Save access", dialog()!));
    await settle(() => posted.length > 0, "the save request");
    // Re-parsing the field would save DST_FIRST_PASS itself: an hour granted, zero minutes given.
    expect(Date.parse(String(posted[0].expiresAt))).toBe(DST_FIRST_PASS + HOUR);
  });
});
