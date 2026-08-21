import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FUNCTIONS_DIR,
  OUTPUT_FILE,
  collectRoutes,
  compareRoutes,
  filePathToPattern,
  readHandlerExports,
  renderRoutesModule,
} from "../../deploy/nas/rr-api/scripts/generate-routes.mjs";
import { matchPattern, matchRoute } from "../../deploy/nas/rr-api/src/router";
import { routes } from "../../deploy/nas/rr-api/src/routes.generated";

function has(method: string | null, pattern: string): boolean {
  return routes.some((route) => route.method === method && route.pattern === pattern);
}

describe("generated route table", () => {
  it("contains the expected Pages routes", () => {
    expect(has("GET", "/api/admin/installs")).toBe(true);
    expect(has("POST", "/api/admin/installs/:id/revoke")).toBe(true);
    expect(has("GET", "/api/announcements/active")).toBe(true);
    expect(has("POST", "/api/license/activate")).toBe(true);
    expect(has("PATCH", "/api/admin/licenses/:key")).toBe(true);
    expect(has("DELETE", "/api/admin/licenses/:key")).toBe(true);
    expect(has("POST", "/api/admin/licenses/:key/revoke")).toBe(true);
    expect(has(null, "/api/admin/data")).toBe(true);
    expect(has(null, "/v1/telemetry/event")).toBe(true);
    expect(has(null, "/api/ingest")).toBe(true);
  });

  it("binds every handler to a function", () => {
    for (const route of routes) {
      expect(typeof route.handler, `${route.method ?? "ANY"} ${route.pattern}`).toBe("function");
    }
  });

  it("orders static segments before params (Pages precedence)", () => {
    const staticIndex = routes.findIndex(
      (route) => route.method === "GET" && route.pattern === "/api/admin/licenses",
    );
    const paramIndex = routes.findIndex(
      (route) => route.method === "PATCH" && route.pattern === "/api/admin/licenses/:key",
    );
    expect(staticIndex).toBeGreaterThanOrEqual(0);
    expect(paramIndex).toBeGreaterThanOrEqual(0);
    // Deeper routes sort first (more segments), so the param route legitimately comes first here;
    // the precedence that matters is within the same depth:
    const sameDepth = [
      { method: "GET", pattern: "/api/admin/licenses/:key" },
      { method: "GET", pattern: "/api/admin/licenses/index" },
      { method: "GET", pattern: "/api/admin/licenses/:rest*" },
    ].sort(compareRoutes);
    expect(sameDepth.map((route) => route.pattern)).toEqual([
      "/api/admin/licenses/index",
      "/api/admin/licenses/:key",
      "/api/admin/licenses/:rest*",
    ]);
  });

  it("prefers method-specific handlers over onRequest for the same pattern", () => {
    const post = routes.findIndex(
      (route) => route.method === "POST" && route.pattern === "/api/access/status",
    );
    const any = routes.findIndex(
      (route) => route.method === null && route.pattern === "/api/access/status",
    );
    expect(post).toBeGreaterThanOrEqual(0);
    expect(any).toBeGreaterThan(post);
    const match = matchRoute(routes, "POST", "/api/access/status");
    expect(match?.route.method).toBe("POST");
    expect(matchRoute(routes, "GET", "/api/access/status")?.route.method).toBeNull();
  });

  it("is up to date with functions/** (run `npm run routes` in deploy/nas/rr-api)", () => {
    const expected = renderRoutesModule(collectRoutes(FUNCTIONS_DIR), "../../../../functions");
    const committed = readFileSync(resolve(OUTPUT_FILE), "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(expected);
  });
});

describe("file routing rules", () => {
  it("maps files onto patterns like Pages", () => {
    expect(filePathToPattern("api/health")).toBe("/api/health");
    expect(filePathToPattern("api/feedback/index")).toBe("/api/feedback");
    expect(filePathToPattern("api/admin/licenses/[key]/revoke")).toBe(
      "/api/admin/licenses/:key/revoke",
    );
    expect(filePathToPattern("api/admin/licenses/[key]/index")).toBe("/api/admin/licenses/:key");
    expect(filePathToPattern("api/docs/[[path]]")).toBe("/api/docs/:path*");
  });

  it("reads declared and re-exported handlers", () => {
    expect(
      readHandlerExports(
        "export async function onRequestGet(c) {}\nexport function onRequestPost(c) {}\nexport const helper = 1;",
      ).sort(),
    ).toEqual(["onRequestGet", "onRequestPost"]);
    expect(readHandlerExports('export { onRequest } from "../../api/ingest";')).toEqual([
      "onRequest",
    ]);
    expect(readHandlerExports("export { handle as onRequestPut, other };")).toEqual([
      "onRequestPut",
    ]);
  });
});

describe("matchPattern", () => {
  it("captures raw (still URL-encoded) params", () => {
    expect(matchPattern("/api/admin/licenses/:key", "/api/admin/licenses/RR%2FABC")).toEqual({
      key: "RR%2FABC",
    });
    expect(matchPattern("/api/admin/licenses/:key", "/api/admin/licenses")).toBeNull();
    expect(matchPattern("/api/admin/licenses/:key", "/api/admin/licenses/a/b")).toBeNull();
  });

  it("ignores a trailing slash and captures catch-alls as arrays", () => {
    expect(matchPattern("/api/health", "/api/health/")).toEqual({});
    expect(matchPattern("/api/docs/:path*", "/api/docs/a/b")).toEqual({ path: ["a", "b"] });
    expect(matchPattern("/api/docs/:path*", "/api/docs")).toEqual({ path: [] });
  });

  it("lets HEAD fall back to a GET handler", () => {
    expect(matchRoute(routes, "HEAD", "/api/announcements/active")?.route.method).toBe("GET");
    expect(matchRoute(routes, "PUT", "/api/announcements/active")).toBeNull();
  });
});
