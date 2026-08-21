import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FUNCTIONS_DIR,
  OUTPUT_FILE,
  collectRoutes,
  compareRoutes,
  filePathToPattern,
  isRouteFile,
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

  it("contains no _middleware entries (the proxy switch is not a route)", () => {
    expect(routes.some((route) => route.pattern.includes("_middleware"))).toBe(false);
    expect(
      routes.some((route) => route.pattern.split("/").some((segment) => segment.startsWith("_"))),
    ).toBe(false);
    // Sanity: the middleware files exist and would have been picked up without the skip.
    expect(readFileSync(resolve(FUNCTIONS_DIR, "api/_middleware.ts"), "utf8")).toContain(
      "export async function onRequest",
    );
    expect(readFileSync(resolve(FUNCTIONS_DIR, "v1/_middleware.ts"), "utf8")).toContain(
      "export async function onRequest",
    );
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

  it("skips _-prefixed files and declaration files", () => {
    expect(isRouteFile("_middleware.ts")).toBe(false);
    expect(isRouteFile("_helpers.ts")).toBe(false);
    expect(isRouteFile("health.d.ts")).toBe(false);
    expect(isRouteFile("health.ts")).toBe(true);
    expect(isRouteFile("[key].ts")).toBe(true);
    expect(isRouteFile("event.mjs")).toBe(true);
    expect(isRouteFile("notes.md")).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "rr-routes-"));
    try {
      mkdirSync(join(dir, "api", "nested"), { recursive: true });
      mkdirSync(join(dir, "v1"), { recursive: true });
      writeFileSync(join(dir, "api", "_middleware.ts"), "export async function onRequest() {}\n");
      writeFileSync(
        join(dir, "api", "nested", "_middleware.ts"),
        "export function onRequest() {}\n",
      );
      writeFileSync(join(dir, "api", "nested", "_shared.ts"), "export const onRequestGet = 1;\n");
      writeFileSync(join(dir, "api", "health.ts"), "export async function onRequestGet() {}\n");
      writeFileSync(join(dir, "v1", "_middleware.ts"), "export const onRequest = () => {};\n");
      writeFileSync(join(dir, "v1", "event.ts"), "export async function onRequest() {}\n");
      const collected = collectRoutes(dir);
      expect(collected.map((route) => `${route.method ?? "ANY"} ${route.pattern}`)).toEqual([
        "GET /api/health",
        "ANY /v1/event",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
