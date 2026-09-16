import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APP_ERROR_SERVICE,
  BACKGROUND_ERROR_KIND,
  describeBackgroundReport,
  describeSuppressedIo,
  isBackgroundErrorKind,
  isOverviewErrorInWindow,
  isRealErrorEvent,
  isRealErrorRow,
  summarizeBackgroundRows,
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
    // The client from 1.5.3 keeps error_kind on every report kind, so a rollup standing for
    // 412 faults and a suppressed-I/O row are as invisible to the Live timeline, the Overview
    // feed and the charts as the one-row-per-fault shape was.
    expect(
      isRealErrorEvent({
        service: "app_error",
        metrics: { error_kind: "background", report_kind: "rollup", occurrences: 412 },
      }),
    ).toBe(false);
    expect(
      isRealErrorEvent({
        service: "app_error",
        metrics: { error_kind: "background", report_kind: "suppressed", occurrences: 17 },
      }),
    ).toBe(false);
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

/* From client 1.5.3 a listed background row can stand for many faults, or for suppressed
   Discord-pipe I/O that is no fault at all (ErrorEventDetail.report). The wording that says
   so lives here, next to the rule that keeps such rows out of every count. */
describe("what a listed background row stands for", () => {
  const report = (overrides: Record<string, unknown>) => ({
    kind: null,
    occurrences: 1,
    faultSource: "unobserved_task",
    suppressedAbortedIo: 0,
    ...overrides,
  });

  it("describes a first sighting, a rollup and a suppressed-I/O row", () => {
    expect(describeBackgroundReport(report({ kind: "first", occurrences: 1 }))).toBe(
      "first sighting, 1 fault",
    );
    expect(describeBackgroundReport(report({ kind: "rollup", occurrences: 412 }))).toBe(
      "5-minute rollup, 412 faults",
    );
    // Exceptions, not faults: the sentence never contradicts itself, and the Errors page note
    // prints the very same one (tests/errors-page.test.tsx).
    expect(
      describeBackgroundReport(
        report({ kind: "suppressed", occurrences: 17, suppressedAbortedIo: 17 }),
      ),
    ).toBe("17 aborted Discord-pipe I/O exceptions suppressed by the client, not app faults");
    expect(describeSuppressedIo(1)).toBe(
      "1 aborted Discord-pipe I/O exception suppressed by the client, not app faults",
    );
    expect(describeSuppressedIo(1204)).toBe(
      "1,204 aborted Discord-pipe I/O exceptions suppressed by the client, not app faults",
    );
  });

  it("says nothing for a row that is one fault, or that carries no report", () => {
    expect(describeBackgroundReport(report({}))).toBeNull();
    expect(describeBackgroundReport(null)).toBeNull();
    expect(describeBackgroundReport(undefined)).toBeNull();
    expect(describeBackgroundReport("rollup")).toBeNull();
    // An unknown kind is not explained away as something it is not.
    expect(describeBackgroundReport(report({ kind: "shutdown", occurrences: 9 }))).toBeNull();
  });

  it("sums the faults behind a customer's listed rows, suppressed I/O excluded", () => {
    const rows = [
      { kind: "unhandled", report: null },
      // An older API build sends no report at all: one fault.
      { kind: "background" },
      { kind: "background", report: report({}) },
      { kind: "background", report: report({ kind: "first", occurrences: 3 }) },
      { kind: "background", report: report({ kind: "rollup", occurrences: 412 }) },
      {
        kind: "background",
        report: report({ kind: "suppressed", occurrences: 17, suppressedAbortedIo: 17 }),
      },
    ];

    expect(summarizeBackgroundRows(rows)).toEqual({ reports: 5, faults: 417 });
    expect(summarizeBackgroundRows([])).toEqual({ reports: 0, faults: 0 });
    expect(summarizeBackgroundRows([{ kind: "unhandled" }])).toEqual({ reports: 0, faults: 0 });
  });
});
