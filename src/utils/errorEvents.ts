import type { TelemetryEvent } from "../types/telemetry";

/** The telemetry service every client-side error arrives under. */
export const APP_ERROR_SERVICE = "app_error";

/**
 * `error_kind = 'background'` is the desktop client reporting an unobserved
 * background-task fault. It is noise from a known client bug, so the panel
 * lists it apart and never counts it as an error.
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
