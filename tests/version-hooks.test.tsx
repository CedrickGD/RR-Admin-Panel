// @vitest-environment jsdom
/**
 * `src/hooks/useLatestVersion.ts` and `src/hooks/useReleaseVersions.ts` — the two hooks design §10
 * moved off `api.github.com` / `raw.githubusercontent.com` and onto
 * `GET /api/admin/releases/versions`. That move changed real client behaviour: a new endpoint, a
 * new response shape (`VersionsResponse`), a new fallback ("unknown" instead of a hard-coded
 * version), bumped cache keys, and no client-side tag normalisation any more.
 *
 * `tests/no-github-strings.test.ts` only scans source text for the two host names, and
 * `tests/version-workspace.test.tsx` mocks both hooks away — so neither one exercises what these
 * hooks actually do at runtime. This suite does, through the real `fetchApi`/`apiUrl` path with a
 * stubbed global `fetch`, so the URL it asserts is the URL the browser would request.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLatestVersion } from "../src/hooks/useLatestVersion";
import { matchReleaseVersion, useReleaseVersions } from "../src/hooks/useReleaseVersions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENDPOINT = "/api/admin/releases/versions";
/** The bumped keys — v1/v2 held data from a different source and must not be read back. */
const LATEST_KEY = "rr-latest-version-v2";
const VERSIONS_KEY = "rr-release-versions-v3";
const HOUR = 60 * 60 * 1000;

const BODY = { ok: true, releases: ["1.5.3", "1.5.2", "1.5.1"], latest: "1.5.3", ageSeconds: 12 };

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn(async () => reply(BODY));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The hook's current return value, serialised into the DOM so a render can be read back. */
function Probe({ hook }: { hook: () => string | string[] }) {
  const value = hook();
  return <span data-value={Array.isArray(value) ? value.join(",") : value} />;
}

function shown(): string {
  return container.querySelector("span")?.getAttribute("data-value") ?? "";
}

/**
 * Render, then let the effect's promise chain settle — a macrotask drains every microtask.
 * `waitMs` covers the one case that needs wall-clock time: `fetchApi` answers a rejected request
 * with a single 400 ms-delayed retry, and a test that asserted before that landed would be
 * reading an in-flight state rather than the settled one (and would leave the retry running past
 * the end of the test, against a restored global `fetch`).
 */
async function mount(hook: () => string | string[], waitMs = 0): Promise<void> {
  await act(async () => {
    root.render(<Probe hook={hook} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  });
}

/** Longer than `fetchApi`'s RETRY_DELAY_MS, so the retry has been made and has failed. */
const AFTER_RETRY_MS = 600;

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

describe("useLatestVersion", () => {
  it("asks the panel's own versions endpoint, and no GitHub host", async () => {
    await mount(useLatestVersion);
    expect(requestedUrls()).toEqual([ENDPOINT]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
  });

  it("surfaces `latest` from a well-formed VersionsResponse and caches it", async () => {
    await mount(useLatestVersion);
    expect(shown()).toBe("1.5.3");
    expect(JSON.parse(localStorage.getItem(LATEST_KEY) ?? "{}")).toMatchObject({
      version: "1.5.3",
    });
  });

  it("shows `unknown` before the fetch resolves — never a guessed version", async () => {
    let release: () => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(reply(BODY));
        }),
    );
    await act(async () => {
      root.render(<Probe hook={useLatestVersion} />);
    });
    expect(shown()).toBe("unknown");

    release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(shown()).toBe("1.5.3");
  });

  it("skips the network entirely on a fresh cache hit", async () => {
    localStorage.setItem(LATEST_KEY, JSON.stringify({ version: "1.5.0", fetchedAt: Date.now() }));
    await mount(useLatestVersion);
    expect(shown()).toBe("1.5.0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches once the cached copy is older than the TTL", async () => {
    localStorage.setItem(
      LATEST_KEY,
      JSON.stringify({ version: "1.5.0", fetchedAt: Date.now() - 2 * HOUR }),
    );
    await mount(useLatestVersion);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("1.5.3");
  });

  it("keeps the fallback and writes no cache when the response is not ok", async () => {
    fetchMock.mockImplementation(async () => reply({ ok: false, error: "nope" }, 403));
    await mount(useLatestVersion);
    expect(shown()).toBe("unknown");
    expect(localStorage.getItem(LATEST_KEY)).toBeNull();
  });

  it("keeps the fallback when the body is not JSON at all", async () => {
    fetchMock.mockImplementation(async () => new Response("<html>nope</html>", { status: 200 }));
    await mount(useLatestVersion);
    expect(shown()).toBe("unknown");
    expect(localStorage.getItem(LATEST_KEY)).toBeNull();
  });

  it("keeps the fallback after fetchApi's one retry has also failed", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    await mount(useLatestVersion, AFTER_RETRY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(shown()).toBe("unknown");
    expect(localStorage.getItem(LATEST_KEY)).toBeNull();
  });

  it.each([
    ["a blank latest", { ...BODY, latest: "   " }],
    ["a non-string latest", { ...BODY, latest: 153 }],
    ["no latest at all", { ok: true, releases: [] }],
  ])("keeps the fallback and caches nothing for %s", async (_label, body) => {
    fetchMock.mockImplementation(async () => reply(body));
    await mount(useLatestVersion);
    expect(shown()).toBe("unknown");
    expect(localStorage.getItem(LATEST_KEY)).toBeNull();
  });

  it("trims the version it caches, so a padded value never reaches a comparison", async () => {
    fetchMock.mockImplementation(async () => reply({ ...BODY, latest: "  1.5.4  " }));
    await mount(useLatestVersion);
    expect(shown()).toBe("1.5.4");
  });
});

describe("useReleaseVersions", () => {
  it("asks the same versions endpoint and surfaces `releases` in order", async () => {
    await mount(useReleaseVersions);
    expect(requestedUrls()).toEqual([ENDPOINT]);
    expect(shown()).toBe("1.5.3,1.5.2,1.5.1");
  });

  it("caches the list under the v3 key", async () => {
    await mount(useReleaseVersions);
    expect(JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? "{}")).toMatchObject({
      versions: ["1.5.3", "1.5.2", "1.5.1"],
    });
  });

  it("skips the network entirely on a fresh cache hit", async () => {
    localStorage.setItem(
      VERSIONS_KEY,
      JSON.stringify({ versions: ["1.4.9"], fetchedAt: Date.now() }),
    );
    await mount(useReleaseVersions);
    expect(shown()).toBe("1.4.9");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches once the cached copy is older than the TTL", async () => {
    localStorage.setItem(
      VERSIONS_KEY,
      JSON.stringify({ versions: ["1.4.9"], fetchedAt: Date.now() - 2 * HOUR }),
    );
    await mount(useReleaseVersions);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("1.5.3,1.5.2,1.5.1");
  });

  it.each([
    ["a non-ok response", async () => reply({ ok: false }, 403), 0],
    ["a body that is not JSON", async () => new Response("<html>nope</html>", { status: 200 }), 0],
    [
      "a fetch that rejects twice",
      async () => {
        throw new TypeError("Failed to fetch");
      },
      AFTER_RETRY_MS,
    ],
  ])("keeps the empty fallback and writes no cache for %s", async (_label, impl, waitMs) => {
    fetchMock.mockImplementation(impl as () => Promise<Response>);
    await mount(useReleaseVersions, waitMs as number);
    expect(shown()).toBe("");
    expect(localStorage.getItem(VERSIONS_KEY)).toBeNull();
  });

  it("falls back to an empty list when the body carries no releases array", async () => {
    fetchMock.mockImplementation(async () => reply({ ok: true, latest: "1.5.3" }));
    await mount(useReleaseVersions);
    expect(shown()).toBe("");
    // A well-formed reply that simply lists nothing is an answer, not a failure, so it is
    // cached — unlike the three failure modes above, which leave the key untouched.
    expect(JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? "{}")).toMatchObject({ versions: [] });
  });

  it("passes the server's versions through verbatim — the server normalises now, not the client", async () => {
    // Design §10: the endpoint already returns 3-part versions, newest first, so the hook must
    // not re-shape them. matchReleaseVersion is what reconciles a 4-part session version.
    fetchMock.mockImplementation(async () => reply({ ...BODY, releases: ["1.5.3", "1.4.10"] }));
    await mount(useReleaseVersions);
    expect(shown()).toBe("1.5.3,1.4.10");
    expect(matchReleaseVersion("1.5.3.0", ["1.5.3", "1.4.10"])).toBe("1.5.3");
    expect(matchReleaseVersion("1.4.10.2", ["1.5.3", "1.4.10"])).toBe("1.4.10");
    expect(matchReleaseVersion("1.2.0.0", ["1.5.3", "1.4.10"])).toBeNull();
  });
});
