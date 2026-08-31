import type { TelemetryEvent } from "../types/telemetry";

type OverviewErrorEvent = Pick<TelemetryEvent, "metrics" | "timestamp">;

/** The Overview failure feed shows actionable errors, never background-task telemetry noise. */
export function isOverviewErrorInWindow(event: OverviewErrorEvent, cutoffMs: number): boolean {
  return Date.parse(event.timestamp) >= cutoffMs && event.metrics.error_kind !== "background";
}
