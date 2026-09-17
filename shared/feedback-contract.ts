// Feedback wire contract shared by the Pages Functions / rr-api (functions/api/feedback/index.ts,
// functions/api/admin/feedback/*) and the panel (src/types/telemetry.ts). Runtime-agnostic.
//
// POST /api/feedback body (JSON object; only `message` is required):
//   message       string, 1–4000 characters
//   kind          "feedback" | "support" — optional, see FeedbackKind
//   contact       optional Discord/email handle the customer typed
//   hwid, install_id, license_key, machine_name, app_version, platform
//                 best-effort context the client attaches (each ≤ 256 characters)
//   diagnostics   optional v1 snapshot (functions/_lib/feedback-diagnostics.ts); needs the install
//                 signature
// Response: 201 { ok, message, report_id }. The report id is the same with or without `kind`.

/**
 * Which inbox a report belongs to.
 *   "support"  — the client's "report a problem" flow: the submission that carries the
 *                diagnostics snapshot.
 *   "feedback" — ideas and opinions.
 * The field is optional on the wire. When it is missing or not one of the two values, the server
 * applies defaultFeedbackKind: "support" if the submission carries a diagnostics snapshot, else
 * "feedback" — so clients that predate the field (1.5.2 and below) land in the right inbox
 * without an update.
 */
export type FeedbackKind = "feedback" | "support";

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ["feedback", "support"];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return value === "feedback" || value === "support";
}

/** The server default when the client sent no (valid) kind: diagnostics attached → support. */
export function defaultFeedbackKind(hasDiagnostics: boolean): FeedbackKind {
  return hasDiagnostics ? "support" : "feedback";
}

/** A stored row's kind; anything unexpected (a row read before the column existed) is feedback. */
export function normalizeFeedbackKind(value: unknown): FeedbackKind {
  return value === "support" ? "support" : "feedback";
}

/**
 * GET /api/admin/feedback → { ok, feedback, unread }. `unread` counts status = new per inbox;
 * `total` is what the rail badge shows. It replaces the former plain number (which nothing in the
 * panel read) and ignores the optional `?kind=feedback|support` list filter.
 */
export interface FeedbackUnread {
  feedback: number;
  support: number;
  total: number;
}
