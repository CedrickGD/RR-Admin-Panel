/**
 * Team → Access history: one `panel_audit` row as readable text.
 *
 * Two writers share that table. The Team endpoint records panel-member changes (label + the raw
 * permission JSON, shown behind "View permission changes"). The customer access endpoints record
 * suspend / change / lift with a JSON detail `{ customer, type, until, reason, previous? }`
 * (functions/_lib/access.ts, AccessAuditDetail) — those read as a sentence, never as JSON.
 */
import { formatDay as defaultFormatDay } from "./format";

export interface AuditRow {
  action: string;
  target: string;
  actor: string;
  detail: string;
}

export interface AuditEntryText {
  /** Picks the icon: a member change, a customer restricted, a customer restriction lifted. */
  kind: "member" | "customer-restrict" | "customer-lift";
  title: string;
  /** Who it happened to: the member's email, or "Customer name (identity)". */
  subject: string;
  /** Readable detail lines under the subject. */
  lines: string[];
  /** Pretty-printed JSON for member entries that carry a detail; null otherwise. */
  raw: string | null;
}

export const MEMBER_AUDIT_LABELS: Record<string, string> = {
  save: "Access updated",
  kick: "All sessions ended",
  revoke: "Access removed",
  restore: "Access restored",
  "end-session": "Session ended",
};

type RestrictionDetail = { type?: unknown; until?: unknown; reason?: unknown };

function parseDetail(detail: string): Record<string, unknown> | null {
  if (!detail) return null;
  try {
    const value: unknown = JSON.parse(detail);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function restrictionText(detail: RestrictionDetail, formatDay: (iso: string) => string): string {
  if (detail.type === "permanent") return "Permanent ban";
  return typeof detail.until === "string" && detail.until
    ? `Suspended until ${formatDay(detail.until)}`
    : "Suspended";
}

function reasonLine(detail: RestrictionDetail): string | null {
  return typeof detail.reason === "string" && detail.reason.trim()
    ? `Reason: ${detail.reason.trim()}`
    : null;
}

export function describeAuditEntry(
  row: AuditRow,
  formatDay: (iso: string) => string = defaultFormatDay,
): AuditEntryText {
  const detail = parseDetail(row.detail);

  if (row.action.startsWith("customer-")) {
    const restriction: RestrictionDetail = detail ?? {};
    const customer =
      typeof detail?.customer === "string" && detail.customer.trim() ? detail.customer.trim() : null;
    const subject = customer ? `${customer} (${row.target})` : row.target;
    const reason = reasonLine(restriction);
    const now = restrictionText(restriction, formatDay);
    const withReason = (first: string) => (reason ? [first, reason] : [first]);

    if (row.action === "customer-lift") {
      return {
        kind: "customer-lift",
        title: "Customer restriction lifted",
        subject,
        lines: withReason(`Was: ${now.charAt(0).toLowerCase()}${now.slice(1)}`),
        raw: null,
      };
    }
    if (row.action === "customer-suspend-change") {
      const previous =
        detail?.previous && typeof detail.previous === "object"
          ? restrictionText(detail.previous as RestrictionDetail, formatDay)
          : null;
      return {
        kind: "customer-restrict",
        title: "Customer restriction changed",
        subject,
        lines: withReason(previous ? `${previous} → ${now}` : now),
        raw: null,
      };
    }
    return {
      kind: "customer-restrict",
      title: restriction.type === "permanent" ? "Customer banned" : "Customer suspended",
      subject,
      lines: withReason(now),
      raw: null,
    };
  }

  return {
    kind: "member",
    title: MEMBER_AUDIT_LABELS[row.action] ?? "Access change",
    subject: row.target,
    lines: [],
    raw: detail ? JSON.stringify(detail, null, 2) : row.detail || null,
  };
}
