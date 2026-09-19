import type { LicenseRow } from "./customer-anchor";
import type { DiagnosticProvider } from "./feedback-diagnostics";
import { redactValue } from "./redaction";
import type { AppSessionRecord, ErrorEventDetail } from "./types";

/**
 * What the Discord bot — and through it an AI model — is allowed to see about a customer.
 *
 * Both builders below are ALLOW-LISTS by construction: they name every output field, so a column
 * added to `licenses`, `app_sessions` or `feedback` later cannot leak by default. Nothing that
 * identifies the machine or the person leaves here: no hwid, install_id, machine_name, e-mail,
 * contact, IP/geo/timezone, license key, order id or Discord id.
 *
 * Pure on purpose — the endpoints do the database work, these functions do the deciding, and the
 * deciding is what the tests pin down.
 */

export interface SupportContextLicence {
  plan: string;
  status: string;
  expiresAt: string | null;
  lifetime: boolean;
  suspended: boolean;
}

export interface SupportContextError {
  code: string;
  count: number;
  last_at: string;
}

export interface SupportContextDiagnostic {
  provider: string;
  status: string;
  lines: string[];
}

export interface SupportContextReport {
  report_id: string;
  created_at: string | null;
  message: string;
  diagnostics: SupportContextDiagnostic[];
}

export interface SupportContext {
  app_version: string | null;
  platform: string | null;
  os_version: string | null;
  last_seen_at: string | null;
  installs: number;
  licence: SupportContextLicence | null;
  errors: SupportContextError[];
  report: SupportContextReport | null;
}

export interface SupportContextSources {
  /** Newest session of the anchor; only four of its fields are ever read. */
  session: AppSessionRecord | null;
  installs: number;
  /** null when the report anchor does not belong to the linked account (see the endpoint). */
  license: Pick<LicenseRow, "type" | "status" | "expires_at"> | null;
  suspended: boolean;
  errors: ErrorEventDetail[];
  report: {
    report_id: string;
    created_at: string | null;
    message: string | null;
    providers: DiagnosticProvider[];
  } | null;
}

/** Background RR-E noise is a known client bug, never a symptom — customer-360 splits it the same way. */
const BACKGROUND_KIND = "background";
const MAX_ERROR_CODES = 10;
const MAX_LINES_PER_PROVIDER = 12;
const MAX_LINE_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 2000;

export function buildSupportContext(sources: SupportContextSources): SupportContext {
  const session = sources.session;
  return {
    app_version: session?.appVersion ?? null,
    platform: session?.platform ?? null,
    os_version: session?.osVersion ?? null,
    last_seen_at: session?.lastSeenAt ?? null,
    installs: Math.max(0, Math.trunc(sources.installs)),
    licence: sources.license
      ? {
          plan: String(sources.license.type ?? "unknown"),
          status: String(sources.license.status ?? "unknown"),
          expiresAt: sources.license.expires_at ?? null,
          lifetime: sources.license.type === "lifetime",
          suspended: sources.suspended,
        }
      : null,
    errors: summarizeErrors(sources.errors),
    report: sources.report
      ? {
          report_id: sources.report.report_id,
          created_at: sources.report.created_at,
          message: safeText(sources.report.message ?? "", MAX_MESSAGE_LENGTH),
          diagnostics: sources.report.providers.map(providerLines),
        }
      : null,
  };
}

/** One entry per RR-E code, newest sighting first — the shape the bot puts in front of the model. */
function summarizeErrors(errors: ErrorEventDetail[]): SupportContextError[] {
  const byCode = new Map<string, SupportContextError>();
  for (const row of errors) {
    if (row.kind === BACKGROUND_KIND) continue;
    const code = (row.code ?? row.type ?? "unknown").trim() || "unknown";
    const existing = byCode.get(code);
    if (existing) {
      existing.count += 1;
      if (row.timestamp > existing.last_at) existing.last_at = row.timestamp;
    } else {
      byCode.set(code, { code, count: 1, last_at: row.timestamp });
    }
  }
  return [...byCode.values()]
    .sort((left, right) => (left.last_at < right.last_at ? 1 : -1))
    .slice(0, MAX_ERROR_CODES);
}

/** A provider's checks as short readable lines; values only, never the raw check objects. */
function providerLines(provider: DiagnosticProvider): SupportContextDiagnostic {
  const lines: string[] = [];
  if (provider.summary) lines.push(safeText(provider.summary, MAX_LINE_LENGTH));
  for (const check of provider.checks) {
    if (lines.length >= MAX_LINES_PER_PROVIDER) break;
    const value = check.value === null || check.value === undefined ? check.status : check.value;
    const detail = check.detail ? ` — ${check.detail}` : "";
    lines.push(safeText(`${check.label}: ${String(value)}${detail}`, MAX_LINE_LENGTH));
  }
  return { provider: String(provider.provider), status: String(provider.status), lines };
}

export interface Purchase {
  plan: string;
  durationDays: number | null;
  status: string;
  lifetime: boolean;
  purchasedAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  source: string | null;
  /** Order id with all but the last four characters masked; never the full id. */
  orderRef: string | null;
  /** Last four characters of the license key, so a customer can tell two keys apart. */
  keyLast4: string | null;
  seatsUsed: number;
  seatsMax: number;
}

export function buildPurchases(licenses: readonly LicenseRow[]): Purchase[] {
  return licenses.map((license) => ({
    plan: String(license.type ?? "unknown"),
    durationDays: numberOrNull(license.duration_days),
    status: String(license.status ?? "unknown"),
    lifetime: license.type === "lifetime",
    purchasedAt: license.purchased_at ?? null,
    activatedAt: license.activated_at ?? null,
    expiresAt: license.expires_at ?? null,
    source: license.order_source ?? null,
    orderRef: maskTail(license.order_id),
    keyLast4: lastFour(license.license_key),
    seatsUsed: Math.max(0, Math.trunc(Number(license.usage_count) || 0)),
    seatsMax: Math.trunc(Number(license.max_uses) || 0),
  }));
}

/** `••••` plus the last four characters; a value of four characters or fewer is masked entirely. */
export function maskTail(value: unknown, keep = 4): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.length <= keep ? "•".repeat(keep) : `••••${text.slice(-keep)}`;
}

function lastFour(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length >= 4 ? text.slice(-4) : null;
}

function numberOrNull(value: unknown): number | null {
  // Number(null) is 0, and a lifetime key with `duration_days = NULL` must not read as "0 days".
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/** The panel's own redactor, so a key or token a customer typed cannot ride along in free text. */
function safeText(value: string, maxLength: number): string {
  const redacted = redactValue(value, { maxDepth: 1, maxStringLength: maxLength });
  return typeof redacted === "string" ? redacted : "";
}
