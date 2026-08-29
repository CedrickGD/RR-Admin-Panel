import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_HOST,
  redirectLegacyPagesHost,
  type BrowserLocation,
} from "../src/utils/legacyPagesRedirect";
import { PAGES_ROUTES } from "../vite.config";

function location(overrides: Partial<BrowserLocation> = {}): BrowserLocation {
  return {
    hostname: "rr-admin-panel.pages.dev",
    pathname: "/",
    search: "",
    hash: "#/live",
    replace: vi.fn(),
    ...overrides,
  };
}

describe("legacy Pages migration", () => {
  it("redirects the production Pages hostname and preserves path, query, and hash", () => {
    const browserLocation = location({
      pathname: "/index.html",
      search: "?range=week",
      hash: "#/announcements",
    });

    expect(redirectLegacyPagesHost(browserLocation)).toBe(true);
    expect(browserLocation.replace).toHaveBeenCalledWith(
      `https://${ADMIN_HOST}/index.html?range=week#/announcements`,
    );
  });

  it.each(["admin.razorreaper.app", "localhost", "0628541e.rr-admin-panel.pages.dev"])(
    "does not redirect host %s",
    (hostname) => {
      const browserLocation = location({ hostname });

      expect(redirectLegacyPagesHost(browserLocation)).toBe(false);
      expect(browserLocation.replace).not.toHaveBeenCalled();
    },
  );

  it("keeps static Pages traffic outside the Functions invocation set", () => {
    expect(PAGES_ROUTES).toEqual({
      version: 1,
      include: ["/api/*", "/v1/*"],
      exclude: [],
    });
  });
});
