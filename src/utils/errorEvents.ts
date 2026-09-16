import {
  BACKGROUND_REPORT_KINDS,
  SUPPRESSED_REPORT_KIND,
  type BackgroundReportKind,
} from "../../shared/telemetry-contract";
import type { TelemetryEvent } from "../types/telemetry";
import { formatNumber } from "./format";

/** The telemetry service every client-side error arrives under. */
export const APP_ERROR_SERVICE = "app_error";

/**
 * `error_kind = 'background'` is the desktop client reporting a fault in a
 * background task or a render update. It is noise from a known client bug, so
 * the panel lists it apart and never counts it as an error. The kind is the same
 * for every report_kind a client from 1.5.3 sends (first, rollup, suppressed).
 *
 * Every surface that decides "is this an error?" goes through this module. The
 * rule used to live in a copy per page and drifted, which is how the Overview
 * chart came to contradict the KPI directly above it.
 */
export const BACKGROUND_ERROR_KIND = "background";

/** Matched exactly like the KPI queries do in SQL (functions/_lib/storage.ts). */
export function isBackgroundErrorKind(kind: unknown): boolean {
  return kind === BACKGROUND_ERROR_KIND;
}

type ErrorKindEvent = Pick<TelemetryEvent, "metrics">;
type ServiceEvent = Pick<TelemetryEvent, "service" | "metrics">;

/** One raw telemetry event that counts as a real error: app_error, not background. */
export function isRealErrorEvent(event: ServiceEvent): boolean {
  return event.service === APP_ERROR_SERVICE && !isBackgroundErrorKind(event.metrics.error_kind);
}

/** A mapped error row (ErrorEventDetail and friends) that counts as a real error. */
export function isRealErrorRow(row: { kind?: string | null }): boolean {
  return !isBackgroundErrorKind(row.kind);
}

/** The Overview failure feed shows actionable errors, never background-task noise. */
export function isOverviewErrorInWindow(
  event: ErrorKindEvent & Pick<TelemetryEvent, "timestamp">,
  cutoffMs: number,
): boolean {
  return Date.parse(event.timestamp) >= cutoffMs && !isBackgroundErrorKind(event.metrics.error_kind);
}

/* ── what a listed background row stands for ──────────────────
   From client 1.5.3 one background row can stand for many faults (a first sighting, then
   5-minute rollups) or for suppressed Discord-pipe I/O that is not an app fault at all
   (shared/telemetry-contract.ts). The API attaches that as ErrorEventDetail.report; a row
   from an older client, or from an older API build, has none and is one fault. */

interface ListedReport {
  kind: BackgroundReportKind | null;
  occurrences: number;
  suppressedAbortedIo: number;
}

function readListedReport(value: unknown): ListedReport | null {
  if (typeof value !== "object" || value === null) return null;
  const report = value as Record<string, unknown>;
  const kind = typeof report.kind === "string" ? report.kind : null;
  const count = (raw: unknown, floor: number) =>
    typeof raw === "number" && Number.isFinite(raw) && raw >= floor ? raw : floor;
  return {
    kind:
      kind !== null && BACKGROUND_REPORT_KINDS.has(kind) ? (kind as BackgroundReportKind) : null,
    occurrences: count(report.occurrences, 1),
    suppressedAbortedIo: count(report.suppressedAbortedIo, 0),
  };
}

function faultCount(value: number): string {
  return `${formatNumber(value)} ${value === 1 ? "fault" : "faults"}`;
}

/**
 * The one sentence for suppressed Discord-pipe I/O, on the Errors page note and under a Customer
 * 360 row alike: exceptions the client dropped before reporting, and not app faults — so it never
 * calls them faults in one breath and not faults in the next.
 */
export function describeSuppressedIo(count: number): string {
  return `${formatNumber(count)} aborted Discord-pipe I/O ${
    count === 1 ? "exception" : "exceptions"
  } suppressed by the client, not app faults`;
}

/**
 * One calm phrase for the line under a listed background row, saying what it stands for.
 * null when it stands for one fault, which needs no explanation.
 */
export function describeBackgroundReport(report: unknown): string | null {
  const listed = readListedReport(report);
  if (!listed || listed.kind === null) return null;
  if (listed.kind === SUPPRESSED_REPORT_KIND)
    return describeSuppressedIo(listed.suppressedAbortedIo);
  return `${listed.kind === "first" ? "first sighting" : "5-minute rollup"}, ${faultCount(listed.occurrences)}`;
}

/**
 * The background rows in a customer's error list: how many rows, and how many faults they
 * stand for. A row without a report is one fault; a suppressed-I/O row is none.
 */
export function summarizeBackgroundRows(
  rows: ReadonlyArray<{ kind?: string | null; report?: unknown }>,
): { reports: number; faults: number } {
  let reports = 0;
  let faults = 0;
  for (const row of rows) {
    if (isRealErrorRow(row)) continue;
    reports += 1;
    const listed = readListedReport(row.report);
    if (!listed) faults += 1;
    else if (listed.kind !== SUPPRESSED_REPORT_KIND) faults += listed.occurrences;
  }
  return { reports, faults };
}
