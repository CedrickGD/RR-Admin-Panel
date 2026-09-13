import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ACCESS_SEARCH_STORAGE_KEY,
  hashPageToken,
  isPageKey,
  PAGE_KEYS,
  resolvePageKey,
  takeAccessSearch,
} from "../src/utils/pageRouting";

function path(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}
function source(relative: string): string {
  return readFileSync(path(relative), "utf8");
}

const app = source("../src/App.tsx");
const pageMeta = source("../src/pageMeta.ts");
const telemetry = source("../src/types/telemetry.ts");
const nav = source("../src/components/Navbar.tsx");
const policy = source("../shared/panel-policy.ts");
const api = source("../src/utils/api.ts");

/** sessionStorage stand-in: the routing helpers take storage as an argument. */
function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    size: () => data.size,
  };
}

describe("the App access page is retired", () => {
  it("is gone from the source tree and from every route into it", () => {
    expect(existsSync(path("../src/pages/AccessPage.tsx"))).toBe(false);
    expect(app).not.toContain("AccessPage");
    expect(app).not.toContain('page === "access"');
  });

  it("is not a page: no key, no label, no navigation item", () => {
    expect(PAGE_KEYS).not.toContain("access");
    expect(isPageKey("access")).toBe(false);
    // Only the PageKey union: AuthMode's own `"app" | "access"` stays.
    expect(telemetry).not.toMatch(/^\s*\|\s*"access"\s*$/m);
    // PAGE_META is Record<PageKey, …>; an entry here would put the retired page
    // back in the sidebar rail, the breadcrumb and the browser tab title.
    expect(pageMeta).not.toMatch(/^\s*access:\s*\{/m);
    expect(nav).not.toMatch(/\["access",/);
  });
});

describe('"#/access" still resolves to the customer directory', () => {
  it("maps the retired key — from a hash or from stored rr:last-page", () => {
    expect(resolvePageKey(hashPageToken("#/access"))).toBe("customers");
    expect(resolvePageKey("access")).toBe("customers");
  });

  it("leaves every live page resolving to itself", () => {
    for (const key of PAGE_KEYS) expect(resolvePageKey(key)).toBe(key);
    expect(resolvePageKey(hashPageToken("#/licenses"))).toBe("licenses");
  });

  it.each([["#/nonsense"], ["#/"], [""], ["#/toString"]])(
    "refuses %s so the caller falls back to its own default",
    (hash) => {
      expect(resolvePageKey(hashPageToken(hash))).toBeNull();
    },
  );

  it("refuses a missing stored value", () => {
    expect(resolvePageKey(null)).toBeNull();
    expect(resolvePageKey(undefined)).toBeNull();
  });

  it("resolves without being a live page, so the alias URL is rewritten in place", () => {
    // App.tsx decides push-vs-replace on isPageKey, not on resolvePageKey: the
    // alias is normalized with replaceState so Back never lands on a redirect.
    expect(isPageKey(hashPageToken("#/access"))).toBe(false);
    expect(isPageKey(hashPageToken("#/customers"))).toBe(true);
    expect(app).toContain("function hashNamesItsPage()");
    expect(app).toContain('window.history.replaceState(window.history.state, "", `#/${key}`)');
  });
});

describe("rr:access-search is carried into the directory search", () => {
  it("hands the term over once and clears it", () => {
    const session = storage({ [ACCESS_SEARCH_STORAGE_KEY]: "chargeback buyer" });
    expect(takeAccessSearch(session)).toBe("chargeback buyer");
    expect(session.size()).toBe(0);
    expect(takeAccessSearch(session)).toBeNull();
  });

  it("has nothing to carry when the key is absent or empty", () => {
    expect(takeAccessSearch(storage())).toBeNull();
    expect(takeAccessSearch(storage({ [ACCESS_SEARCH_STORAGE_KEY]: "" }))).toBeNull();
  });

  it("is wired to the directory's own search field", () => {
    expect(app).toContain("takeAccessSearch(window.sessionStorage)");
    expect(app).toContain('setWorkspaceSearch("customers", search)');
  });
});

describe("the customer app-access feature is untouched", () => {
  it("keeps the access.* permissions and the /api/admin/access endpoints", () => {
    expect(policy).toContain('{ key: "access.read"');
    expect(policy).toContain('{ key: "access.write"');
    expect(policy).toContain('if (path.startsWith("/api/admin/access"))');
    expect(api).toContain('apiUrl("/api/admin/access")');
    expect(api).toContain('apiUrl("/api/admin/access/suspend")');
    expect(api).toContain('apiUrl("/api/admin/access/lift")');
  });

  it("has no page permission left for a page that cannot be visited", () => {
    expect(policy).not.toMatch(/^\s*access:\s*"access\.read",/m);
  });
});
