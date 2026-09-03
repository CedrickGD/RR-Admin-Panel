import { redactValue } from "./redaction";
import type { D1Database } from "./types";

export const DIAGNOSTICS_SCHEMA_VERSION = 1;
export const MAX_DIAGNOSTICS_BYTES = 12 * 1024;
export const MAX_DIAGNOSTIC_PROVIDERS = 12;
export const MAX_CHECKS_PER_PROVIDER = 32;

export const DIAGNOSTIC_PROVIDER_IDS = [
  "app_runtime",
  "windows_host",
  "identity_license_access",
  "ark_environment",
  "core_features",
  "ark_tweaks",
  "custom_ark",
  "automation",
  "mods_intel",
  "utilities",
  "help_support",
  "settings_operations",
] as const;

export type DiagnosticProviderId = (typeof DIAGNOSTIC_PROVIDER_IDS)[number];
export type DiagnosticProviderStatus = "ok" | "warning" | "error" | "unavailable";
export type DiagnosticCheckStatus = "pass" | "warning" | "fail" | "unknown";
export type DiagnosticCheckValue = string | number | boolean | null;

export interface DiagnosticCheck {
  key: string;
  label: string;
  status: DiagnosticCheckStatus;
  value: DiagnosticCheckValue;
  detail: string | null;
}

export interface DiagnosticProvider {
  provider: DiagnosticProviderId;
  version: string | null;
  status: DiagnosticProviderStatus;
  duration_ms: number | null;
  summary: string | null;
  checks: DiagnosticCheck[];
}

export interface FeedbackDiagnostics {
  schema_version: 1;
  generated_at: string;
  consent: true;
  providers: DiagnosticProvider[];
}

export type DiagnosticsValidationResult =
  | { ok: true; value: FeedbackDiagnostics | null }
  | { ok: false; message: string };

const PROVIDER_IDS = new Set<string>(DIAGNOSTIC_PROVIDER_IDS);
const PROVIDER_STATUSES = new Set<string>(["ok", "warning", "error", "unavailable"]);
const CHECK_STATUSES = new Set<string>(["pass", "warning", "fail", "unknown"]);
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/u;
const TEXT_ENCODER = new TextEncoder();

const ROOT_KEYS = new Set(["schema_version", "generated_at", "consent", "providers"]);
const PROVIDER_KEYS = new Set([
  "provider",
  "version",
  "status",
  "duration_ms",
  "summary",
  "checks",
]);
const CHECK_KEYS = new Set(["key", "label", "status", "value", "detail"]);

const DIAGNOSTICS_DDL = [
  `CREATE TABLE IF NOT EXISTS feedback_report_meta (
    feedback_id INTEGER PRIMARY KEY,
    report_id TEXT NOT NULL UNIQUE,
    auth_mode TEXT NOT NULL CHECK (auth_mode IN ('signed', 'legacy_unsigned')),
    verified_install_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS feedback_diagnostics (
    feedback_id INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    generated_at TEXT NOT NULL,
    consent INTEGER NOT NULL CHECK (consent = 1),
    received_at TEXT NOT NULL,
    FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS feedback_diagnostic_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id INTEGER NOT NULL,
    provider_index INTEGER NOT NULL,
    provider TEXT NOT NULL,
    version TEXT,
    status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error', 'unavailable')),
    duration_ms INTEGER,
    summary TEXT,
    checks_json TEXT NOT NULL,
    FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
    UNIQUE (feedback_id, provider)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_diagnostics_generated ON feedback_diagnostics(generated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_diagnostic_providers_feedback ON feedback_diagnostic_providers(feedback_id, provider_index)`,
];

interface DiagnosticsRow {
  feedback_id: number;
  schema_version: number;
  generated_at: string;
  consent: number;
}

interface ProviderRow {
  feedback_id: number;
  provider: DiagnosticProviderId;
  version: string | null;
  status: DiagnosticProviderStatus;
  duration_ms: number | null;
  summary: string | null;
  checks_json: string;
}

export async function ensureFeedbackDiagnosticsSchema(db: D1Database): Promise<void> {
  for (const statement of DIAGNOSTICS_DDL) {
    await db.prepare(statement).run();
  }
}

export function makeFeedbackReportId(): string {
  return `FB-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function fallbackFeedbackReportId(feedbackId: number): string {
  return `FB-${String(feedbackId).padStart(6, "0")}`;
}

export function validateFeedbackDiagnostics(value: unknown): DiagnosticsValidationResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isPlainObject(value) || hasUnexpectedKeys(value, ROOT_KEYS)) {
    return invalid("diagnostics must be a JSON object with only supported fields.");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return invalid("diagnostics must be JSON serializable.");
  }
  if (TEXT_ENCODER.encode(serialized).byteLength > MAX_DIAGNOSTICS_BYTES) {
    return invalid(`diagnostics must be <= ${MAX_DIAGNOSTICS_BYTES} bytes.`);
  }

  if (value.schema_version !== DIAGNOSTICS_SCHEMA_VERSION) {
    return invalid(`diagnostics.schema_version must be ${DIAGNOSTICS_SCHEMA_VERSION}.`);
  }
  if (value.consent !== true) {
    return invalid("diagnostics.consent must be true when diagnostics are attached.");
  }
  const generatedAt = requiredText(value.generated_at, 64);
  if (
    !generatedAt ||
    !ISO_TIMESTAMP_PATTERN.test(generatedAt) ||
    !Number.isFinite(Date.parse(generatedAt))
  ) {
    return invalid("diagnostics.generated_at must be a valid ISO-8601 timestamp.");
  }
  if (!Array.isArray(value.providers) || value.providers.length !== MAX_DIAGNOSTIC_PROVIDERS) {
    return invalid(
      `diagnostics.providers must contain all ${MAX_DIAGNOSTIC_PROVIDERS} v1 providers.`,
    );
  }

  const seen = new Set<string>();
  const providers: DiagnosticProvider[] = [];
  for (let index = 0; index < value.providers.length; index += 1) {
    const parsed = validateProvider(value.providers[index], index);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.provider)) {
      return invalid(
        `diagnostics.providers contains duplicate provider '${parsed.value.provider}'.`,
      );
    }
    seen.add(parsed.value.provider);
    providers.push(parsed.value);
  }
  for (const expected of DIAGNOSTIC_PROVIDER_IDS) {
    if (!seen.has(expected)) {
      return invalid(`diagnostics.providers is missing '${expected}'.`);
    }
  }

  return {
    ok: true,
    value: {
      schema_version: 1,
      generated_at: new Date(generatedAt).toISOString(),
      consent: true,
      providers,
    },
  };
}

function validateProvider(
  value: unknown,
  index: number,
): { ok: true; value: DiagnosticProvider } | { ok: false; message: string } {
  const path = `diagnostics.providers[${index}]`;
  if (!isPlainObject(value) || hasUnexpectedKeys(value, PROVIDER_KEYS)) {
    return invalid(`${path} must be an object with only supported fields.`);
  }
  const provider = requiredText(value.provider, 64);
  if (!provider || !IDENTIFIER_PATTERN.test(provider) || !PROVIDER_IDS.has(provider)) {
    return invalid(`${path}.provider is not a supported v1 provider.`);
  }
  if (typeof value.status !== "string" || !PROVIDER_STATUSES.has(value.status)) {
    return invalid(`${path}.status is invalid.`);
  }
  const version = optionalText(value.version, 64);
  if (version === false) return invalid(`${path}.version must be a string or null.`);
  const summary = optionalSafeText(value.summary, 500);
  if (summary === false) return invalid(`${path}.summary must be a string or null.`);
  const duration = optionalInteger(value.duration_ms, 0, 120_000);
  if (duration === false)
    return invalid(`${path}.duration_ms must be an integer from 0 to 120000.`);
  if (!Array.isArray(value.checks) || value.checks.length > MAX_CHECKS_PER_PROVIDER) {
    return invalid(`${path}.checks must be an array of at most ${MAX_CHECKS_PER_PROVIDER} checks.`);
  }

  const checkKeys = new Set<string>();
  const checks: DiagnosticCheck[] = [];
  for (let checkIndex = 0; checkIndex < value.checks.length; checkIndex += 1) {
    const check = validateCheck(value.checks[checkIndex], `${path}.checks[${checkIndex}]`);
    if (!check.ok) return check;
    if (checkKeys.has(check.value.key)) {
      return invalid(`${path}.checks contains duplicate key '${check.value.key}'.`);
    }
    checkKeys.add(check.value.key);
    checks.push(check.value);
  }

  return {
    ok: true,
    value: {
      provider: provider as DiagnosticProviderId,
      version: version ?? null,
      status: value.status as DiagnosticProviderStatus,
      duration_ms: duration ?? null,
      summary: summary ?? null,
      checks,
    },
  };
}

function validateCheck(
  value: unknown,
  path: string,
): { ok: true; value: DiagnosticCheck } | { ok: false; message: string } {
  if (!isPlainObject(value) || hasUnexpectedKeys(value, CHECK_KEYS)) {
    return invalid(`${path} must be an object with only supported fields.`);
  }
  const key = requiredText(value.key, 64);
  const label = requiredText(value.label, 120);
  if (!key || !IDENTIFIER_PATTERN.test(key)) return invalid(`${path}.key is invalid.`);
  if (!label || CONTROL_PATTERN.test(label)) return invalid(`${path}.label is invalid.`);
  if (typeof value.status !== "string" || !CHECK_STATUSES.has(value.status)) {
    return invalid(`${path}.status is invalid.`);
  }

  const detail = optionalSafeText(value.detail, 500);
  if (detail === false) return invalid(`${path}.detail must be a string or null.`);
  const rawValue = value.value;
  let checkValue: DiagnosticCheckValue = null;
  if (rawValue !== undefined && rawValue !== null) {
    if (typeof rawValue === "string") {
      if (codePointLength(rawValue) > 256) return invalid(`${path}.value string is too long.`);
      checkValue = safeText(rawValue, 256);
    } else if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue)) return invalid(`${path}.value number must be finite.`);
      checkValue = rawValue;
    } else if (typeof rawValue === "boolean") {
      checkValue = rawValue;
    } else {
      return invalid(`${path}.value must be a string, number, boolean, or null.`);
    }
  }

  return {
    ok: true,
    value: {
      key,
      label,
      status: value.status as DiagnosticCheckStatus,
      value: checkValue,
      detail: detail ?? null,
    },
  };
}

export async function storeFeedbackDiagnostics(
  db: D1Database,
  feedbackId: number,
  reportId: string,
  authMode: "signed" | "legacy_unsigned",
  verifiedInstallId: string | null,
  diagnostics: FeedbackDiagnostics,
  receivedAt: string,
): Promise<void> {
  const statements = [
    db
      .prepare(
        `INSERT INTO feedback_report_meta
          (feedback_id, report_id, auth_mode, verified_install_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(feedbackId, reportId, authMode, verifiedInstallId, receivedAt),
    db
      .prepare(
        `INSERT INTO feedback_diagnostics
          (feedback_id, schema_version, generated_at, consent, received_at)
         VALUES (?, ?, ?, 1, ?)`,
      )
      .bind(feedbackId, diagnostics.schema_version, diagnostics.generated_at, receivedAt),
    ...diagnostics.providers.map((provider, index) =>
      db
        .prepare(
          `INSERT INTO feedback_diagnostic_providers
            (feedback_id, provider_index, provider, version, status, duration_ms, summary, checks_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          feedbackId,
          index,
          provider.provider,
          provider.version,
          provider.status,
          provider.duration_ms,
          provider.summary,
          JSON.stringify(provider.checks),
        ),
    ),
  ];
  await db.batch(statements);
}

export async function storeFeedbackReportMeta(
  db: D1Database,
  feedbackId: number,
  reportId: string,
  authMode: "signed" | "legacy_unsigned",
  verifiedInstallId: string | null,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO feedback_report_meta
        (feedback_id, report_id, auth_mode, verified_install_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(feedbackId, reportId, authMode, verifiedInstallId, createdAt)
    .run();
}

export interface FeedbackReportMeta {
  feedback_id: number;
  report_id: string;
  auth_mode: "signed" | "legacy_unsigned";
  verified_install_id: string | null;
}

export async function loadFeedbackReportMeta(
  db: D1Database,
  feedbackIds: readonly number[],
): Promise<Map<number, FeedbackReportMeta>> {
  const uniqueIds = [...new Set(feedbackIds.filter((id) => Number.isInteger(id) && id > 0))];
  const output = new Map<number, FeedbackReportMeta>();
  if (uniqueIds.length === 0) return output;
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT feedback_id, report_id, auth_mode, verified_install_id
       FROM feedback_report_meta WHERE feedback_id IN (${placeholders})`,
    )
    .bind(...uniqueIds)
    .all<FeedbackReportMeta>();
  for (const row of rows.results) output.set(row.feedback_id, row);
  return output;
}

export async function loadFeedbackDiagnostics(
  db: D1Database,
  feedbackIds: readonly number[],
): Promise<Map<number, FeedbackDiagnostics>> {
  const uniqueIds = [...new Set(feedbackIds.filter((id) => Number.isInteger(id) && id > 0))];
  const output = new Map<number, FeedbackDiagnostics>();
  if (uniqueIds.length === 0) return output;
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [roots, providerRows] = await Promise.all([
    db
      .prepare(
        `SELECT feedback_id, schema_version, generated_at, consent
         FROM feedback_diagnostics WHERE feedback_id IN (${placeholders})`,
      )
      .bind(...uniqueIds)
      .all<DiagnosticsRow>(),
    db
      .prepare(
        `SELECT feedback_id, provider, version, status, duration_ms, summary, checks_json
         FROM feedback_diagnostic_providers WHERE feedback_id IN (${placeholders})
         ORDER BY feedback_id, provider_index`,
      )
      .bind(...uniqueIds)
      .all<ProviderRow>(),
  ]);

  const providersByFeedback = new Map<number, DiagnosticProvider[]>();
  for (const row of providerRows.results) {
    const list = providersByFeedback.get(row.feedback_id) ?? [];
    list.push({
      provider: row.provider,
      version: row.version ?? null,
      status: row.status,
      duration_ms: nullableInteger(row.duration_ms),
      summary: row.summary ?? null,
      checks: parseChecks(row.checks_json),
    });
    providersByFeedback.set(row.feedback_id, list);
  }
  for (const row of roots.results) {
    if (row.schema_version !== DIAGNOSTICS_SCHEMA_VERSION || row.consent !== 1) continue;
    output.set(row.feedback_id, {
      schema_version: 1,
      generated_at: row.generated_at,
      consent: true,
      providers: providersByFeedback.get(row.feedback_id) ?? [],
    });
  }
  return output;
}

function parseChecks(raw: string): DiagnosticCheck[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DiagnosticCheck[]) : [];
  } catch {
    return [];
  }
}

function safeText(value: string, maxLength: number): string {
  const redacted = redactValue(value, { maxDepth: 1, maxStringLength: maxLength });
  return typeof redacted === "string" ? redacted : "[REDACTED]";
}

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || codePointLength(trimmed) > maxLength) return null;
  return trimmed;
}

function optionalText(value: unknown, maxLength: number): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return codePointLength(trimmed) <= maxLength ? trimmed : false;
}

function optionalSafeText(value: unknown, maxLength: number): string | null | false {
  const parsed = optionalText(value, maxLength);
  return typeof parsed === "string" ? safeText(parsed, maxLength) : parsed;
}

function optionalInteger(value: unknown, minimum: number, maximum: number): number | null | false {
  if (value === undefined || value === null) return null;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : false;
}

function nullableInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnexpectedKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}

function invalid(message: string): { ok: false; message: string } {
  return { ok: false, message };
}
