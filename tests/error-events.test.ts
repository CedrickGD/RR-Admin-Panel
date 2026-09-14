import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_ERROR_SERVICE,
  BACKGROUND_ERROR_KIND,
  isBackgroundErrorKind,
  isOverviewErrorInWindow,
  isRealErrorEvent,
  isRealErrorRow,
} from "../src/utils/errorEvents";

const event = (service: string, errorKind?: string) => ({
  service,
  metrics: errorKind === undefined ? {} : { error_kind: errorKind },
});

describe("the shared real-error predicate", () => {
  it("names the service and kind the SQL side matches on", () => {
    expect(APP_ERROR_SERVICE).toBe("app_error");
    expect(BACKGROUND_ERROR_KIND).toBe("background");
  });

  it("counts an app_error that is not a background fault", () => {
    expect(isRealErrorEvent(event("app_error", "unhandled"))).toBe(true);
    // A client that reports no kind at all is a real error, exactly like
    // COALESCE(json_extract(...), '') != 'background' in SQL.
    expect(isRealErrorEvent(event("app_error"))).toBe(true);
  });

  it("counts neither background faults nor non-error services", () => {
    expect(isRealErrorEvent(event("app_error", "background"))).toBe(false);
    expect(isRealErrorEvent(event("session_start"))).toBe(false);
    expect(isRealErrorEvent(event("update_check"))).toBe(false);
    // Only the exact value is background; "Background" is some other kind.
    expect(isRealErrorEvent(event("app_error", "Background"))).toBe(true);
  });

  it("classifies mapped error rows by their kind", () => {
    expect(isRealErrorRow({ kind: "unhandled" })).toBe(true);
    expect(isRealErrorRow({ kind: null })).toBe(true);
    expect(isRealErrorRow({})).toBe(true);
    expect(isRealErrorRow({ kind: "background" })).toBe(false);
  });

  it("treats only the literal kind as background", () => {
    expect(isBackgroundErrorKind("background")).toBe(true);
    expect(isBackgroundErrorKind(null)).toBe(false);
    expect(isBackgroundErrorKind(undefined)).toBe(false);
    expect(isBackgroundErrorKind("")).toBe(false);
  });

  it("keeps the Overview feed rule on top of the same background test", () => {
    const cutoff = Date.parse("2026-08-31T12:00:00.000Z");
    const at = (timestamp: string, errorKind: string) => ({
      timestamp,
      metrics: { error_kind: errorKind },
    });

    expect(isOverviewErrorInWindow(at("2026-08-31T12:00:00.000Z", "unhandled"), cutoff)).toBe(true);
    expect(isOverviewErrorInWindow(at("2026-08-31T13:00:00.000Z", "background"), cutoff)).toBe(
      false,
    );
    expect(isOverviewErrorInWindow(at("2026-08-31T11:59:59.999Z", "unhandled"), cutoff)).toBe(
      false,
    );
  });
});

/* The rule used to live in a copy per page and drifted: the Overview chart and the
   Traffic timezone cards kept counting background faults long after the KPI beside
   them stopped. One home, and this guard so the next copy fails here first. */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const OWNER = join(SRC, "utils", "errorEvents.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("no second copy of the rule", () => {
  const files = sourceFiles(SRC).filter((path) => path !== OWNER);

  it("finds every source file", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each([
    ["reads metrics.error_kind directly", /metrics\s*(\[\s*["']error_kind["']\s*\]|\.error_kind)/],
    ["compares a kind against the background literal", /kind\s*(!==|===)\s*["']background["']/],
  ])("has no file that %s", (_label, pattern) => {
    const offenders = files.filter((path) => pattern.test(readFileSync(path, "utf8")));

    expect(offenders.map((path) => path.slice(SRC.length + 1).replace(/\\/g, "/"))).toEqual([]);
  });
});
