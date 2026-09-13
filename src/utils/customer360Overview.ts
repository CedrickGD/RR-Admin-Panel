import type {
  AdminLicenseRecord,
  Customer360Customer,
  Customer360DatabaseRow,
  Customer360Feedback,
} from "../types/customer360";

export type Customer360OverviewTone = "success" | "warning" | "danger" | "muted" | "info";

export interface Customer360OverviewStatus {
  label: string;
  tone: Customer360OverviewTone;
  detail: string;
}

export interface Customer360OverviewModel {
  access: Customer360OverviewStatus;
  license: Customer360OverviewStatus;
  openReports: Customer360Feedback[];
  latestReport: Customer360Feedback | null;
  latestContact: string | null;
  /** The returned reports are only the interpretable records available, not a complete total. */
  reportsUnavailable: boolean;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): number | null {
  const valueText = text(value);
  const parsed = valueText ? Date.parse(valueText) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function status(
  label: string,
  tone: Customer360OverviewTone,
  detail: string,
): Customer360OverviewStatus {
  return { label, tone, detail };
}

function dateLabel(value: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}

function accessSummary(customer: Customer360Customer, now: number): Customer360OverviewStatus {
  if (customer.section_errors?.access) {
    return status("Unavailable", "muted", "App access records could not be loaded.");
  }
  if (!Array.isArray(customer.access)) {
    return status("Unknown", "muted", "App access records are unavailable.");
  }

  const active: Array<{ row: Customer360DatabaseRow; until: number | null }> = [];
  let unknown = false;
  for (const row of customer.access) {
    if (!isRecord(row) || (row.is_active !== 0 && row.is_active !== 1)) {
      unknown = true;
      continue;
    }
    if (row.is_active === 0) continue;
    const rawUntil = row.banned_until;
    const until = rawUntil == null || rawUntil === "" ? null : timestamp(rawUntil);
    if (rawUntil != null && rawUntil !== "" && until === null) {
      // An unreadable date must not become a reassuring "no restriction" summary.
      unknown = true;
      continue;
    }
    // Same expiry boundary as utils/restrictions.ts: an end equal to now has expired.
    if (until !== null && until <= now) continue;
    if (row.mode !== "ban" && row.mode !== "suspend") {
      unknown = true;
      continue;
    }
    active.push({ row, until });
  }
  if (unknown) {
    return status("Unknown", "muted", "Some app access records could not be interpreted.");
  }
  // Match findActiveSuspension: permanent first, otherwise the furthest expiry.
  active.sort((left, right) => {
    if (left.until === null) return right.until === null ? 0 : -1;
    if (right.until === null) return 1;
    return right.until - left.until;
  });
  const current = active[0];
  if (!current) {
    return status("No restriction", "success", "No active app restriction is recorded.");
  }
  const duration = current.until === null ? "No expiry" : `Until ${dateLabel(current.until)} (UTC)`;
  const reason = text(current.row.reason);
  return status(
    current.row.mode === "ban" ? "Banned" : "Suspended",
    current.row.mode === "ban" ? "danger" : "warning",
    reason ? `${reason}. ${duration}` : duration,
  );
}

function licenseSummary(customer: Customer360Customer, now: number): Customer360OverviewStatus {
  if (customer.section_errors?.licenses) {
    return status("Unavailable", "muted", "License records could not be loaded.");
  }
  if (!Array.isArray(customer.licenses)) {
    return status("Unknown", "muted", "License records are unavailable.");
  }
  if (customer.licenses.length === 0) {
    if (customer.section_errors?.summary) {
      return status("Unavailable", "muted", "The customer's license tier could not be loaded.");
    }
    if (customer.summary?.license_tier === "free") {
      return status("Free", "muted", "No linked license is recorded.");
    }
    return status(
      "Unknown",
      "muted",
      customer.summary?.license_tier === "premium"
        ? "Premium tier reported; license details are unavailable."
        : "No license details or reliable tier have been reported.",
    );
  }

  const active: Array<{ row: AdminLicenseRecord; until: number | null }> = [];
  let expired = 0;
  let revoked = 0;
  let unknown = false;
  for (const row of customer.licenses) {
    if (!isRecord(row)) {
      unknown = true;
      continue;
    }
    if (row.status === "revoked") {
      revoked += 1;
      continue;
    }
    if (row.status === "expired") {
      expired += 1;
      continue;
    }
    if (row.status !== "active") {
      unknown = true;
      continue;
    }
    const rawUntil = row.expires_at;
    const until = rawUntil == null || rawUntil === "" ? null : timestamp(rawUntil);
    if (rawUntil != null && rawUntil !== "" && until === null) {
      unknown = true;
      continue;
    }
    // Customer 360's API also requires active status and an unexpired (or absent) expiry.
    if (until !== null && until <= now) expired += 1;
    else active.push({ row, until });
  }
  active.sort((left, right) => {
    if (left.until === null && right.until !== null) return -1;
    if (left.until !== null && right.until === null) return 1;
    const lifetime = Number(right.row.type === "lifetime") - Number(left.row.type === "lifetime");
    return lifetime || (right.until ?? 0) - (left.until ?? 0);
  });
  const current = active[0];
  if (current) {
    const label =
      current.row.type === "lifetime"
        ? "Lifetime"
        : current.row.type === "trial"
          ? "Trial"
          : "Active";
    const detail =
      current.until !== null
        ? `Expires ${dateLabel(current.until)} (UTC)`
        : current.row.activated_at
          ? "Active license; no expiry"
          : "Ready to activate";
    return status(label, "success", detail);
  }
  if (unknown) {
    return status("Unknown", "muted", "Some license records could not be interpreted.");
  }
  if (expired > 0) {
    return status("Expired", "warning", "No active linked license remains.");
  }
  if (revoked > 0) {
    return status("Revoked", "danger", "All linked licenses have been revoked.");
  }
  return status("Unknown", "muted", "No license status could be determined.");
}

/** UI permissions remain the caller's responsibility; this helper never infers authorization. */
export function getCustomer360Overview(
  customer: Customer360Customer,
  now: number = Date.now(),
): Customer360OverviewModel {
  const currentTime = Number.isFinite(now) ? now : Date.now();
  const rawReports: unknown[] = Array.isArray(customer.feedback) ? customer.feedback : [];
  const reports = rawReports.filter(isRecord) as Customer360Feedback[];
  const reportsUnavailable =
    Boolean(customer.section_errors?.feedback) ||
    !Array.isArray(customer.feedback) ||
    reports.length !== rawReports.length ||
    reports.some((report) => !["new", "read", "archived"].includes(report.status ?? ""));
  const byDate = [...reports].sort((left, right) => {
    const leftTime = timestamp(left.created_at);
    const rightTime = timestamp(right.created_at);
    if (leftTime === null) return rightTime === null ? 0 : 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  });
  const latestReport = byDate.find((report) => timestamp(report.created_at) !== null) ?? null;

  return {
    access: accessSummary(customer, currentTime),
    license: licenseSummary(customer, currentTime),
    // The backend distinguishes new/read/archived; reading a report is not resolving it.
    openReports: byDate.filter((report) => report.status === "new" || report.status === "read"),
    latestReport,
    latestContact: latestReport ? text(latestReport.created_at) : null,
    reportsUnavailable,
  };
}
