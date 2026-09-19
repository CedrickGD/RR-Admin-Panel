import { ensureAccessSchema } from "./access";
import { ensureFeedbackSchema, normalizeFeedbackKind, type FeedbackRow } from "./content";
import { MANUAL_LICENSE_KEY } from "./discord";
import {
  ensureFeedbackDiagnosticsSchema,
  fallbackFeedbackReportId,
  loadFeedbackDiagnostics,
  loadFeedbackReportMeta,
  type FeedbackDiagnostics,
} from "./feedback-diagnostics";
import { ensureLicenseOrderColumns } from "./licenses";
import { redactValue } from "./redaction";
import { SESSION_SELECT_COLUMNS, type D1SessionRow } from "./storage";
import type {
  AppSessionRecord,
  D1Database,
  ErrorEventDetail,
  RuntimeEnv,
  TelemetryStatus,
} from "./types";
import { ensureUsageSchema, FREE_LIMITS } from "./usage";
import { ensureInstallsSchema } from "../../shared/installs-store";
import {
  BACKGROUND_REPORT_METRIC_KEYS,
  readBackgroundFaultReport,
} from "../../shared/telemetry-contract";

/**
 * One customer, resolved once and read by every section — the machinery behind Customer 360
 * (`functions/api/admin/customer-360.ts`), lifted into _lib so the bot-facing Discord endpoints
 * answer from exactly the same rows instead of carrying a second copy of this SQL.
 *
 * `discord_id` is the selector the bot uses: a Discord account is not an anchor of its own, it
 * points at the license the member verified with, and the license branch already knows how to get
 * from there to hwid / install / session.
 */
export type CustomerSelector =
  | "session_id"
  | "install_id"
  | "hwid"
  | "license_key"
  | "order_id"
  | "feedback_id"
  | "discord_id";
export type CustomerConfidence = "verified_customer" | "linked_license" | "device_only";

export interface LicenseRow extends Record<string, unknown> {
  id: number;
  license_key: string;
  type: string;
  duration_days: number | null;
  hwid: string | null;
  max_uses: number;
  usage_count: number;
  status: string;
  custom_options: string;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  order_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_discord: string | null;
  order_source: string | null;
  order_note: string | null;
  order_meta: string | null;
  purchased_at: string | null;
}

export interface InstallRow {
  install_id: string;
  hwid: string | null;
  app_version: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  license_id: number | string | null;
}

interface ErrorRow {
  event_id: string;
  source: string;
  ts: string;
  metrics_json: string | null;
  message: string | null;
  received_at: string;
}

interface UsageRow {
  feature: string;
  period: string;
  count: number | string;
  updated_at: string | null;
}

export interface AnchorSeed {
  selector: CustomerSelector;
  value: string;
  identity: string;
  hwid: string | null;
  installId: string | null;
  requestedSessionId: string | null;
  confidence: CustomerConfidence;
  session: D1SessionRow | null;
  license: LicenseRow | null;
  feedbackId: number | null;
}

export const SIMPLE_ID_PATTERN = /^[^\p{Cc}\p{Cf}]{1,128}$/u;
export const HWID_PATTERN = /^[^\s\p{Cc}]{1,64}$/u;
const ERROR_LIMIT = 200;
/** Background faults are listed for context, on their own budget so they cannot crowd out a
    real error. Matches the kind the KPI queries exclude (functions/_lib/errors.ts). */
const BACKGROUND_ERROR_LIMIT = 40;
export const BACKGROUND_KIND = "background";

export async function resolveAnchor(
  env: RuntimeEnv,
  selector: CustomerSelector,
  value: string,
): Promise<AnchorSeed | null> {
  const db = env.DB as D1Database;
  let session: D1SessionRow | null = null;
  let license: LicenseRow | null = null;
  let hwid: string | null = null;
  let installId: string | null = null;
  let feedbackId: number | null = null;
  let confidence: CustomerConfidence = "device_only";

  // A Discord account resolves to the license it verified with; a staff grant ("MANUAL") has no
  // license row, so the machine recorded on the link is the only anchor it can offer.
  let lookup: CustomerSelector = selector;
  let lookupValue = value;
  let linkHwid: string | null = null;
  if (selector === "discord_id") {
    await ensureAccessSchema(env);
    const link = await db
      .prepare(
        `SELECT license_key, hwid FROM discord_links WHERE discord_id = ? AND is_active = 1 LIMIT 1`,
      )
      .bind(value)
      .first<{ license_key: string; hwid: string | null }>();
    if (!link) return null;
    linkHwid = link.hwid?.trim() || null;
    if (link.license_key === MANUAL_LICENSE_KEY) {
      if (!linkHwid) return null;
      lookup = "hwid";
      lookupValue = linkHwid;
    } else {
      lookup = "license_key";
      lookupValue = link.license_key;
    }
  }

  if (lookup === "session_id") {
    session = await db
      .prepare(`SELECT ${SESSION_SELECT_COLUMNS} FROM app_sessions WHERE session_id = ? LIMIT 1`)
      .bind(lookupValue)
      .first<D1SessionRow>();
    if (!session) return null;
    hwid = session.hwid?.trim() || null;
    installId = session.install_id;
  } else if (lookup === "install_id") {
    await ensureInstallsSchema(db);
    const install = await loadInstallById(db, lookupValue.toLowerCase());
    if (!install) return null;
    installId = install.install_id;
    hwid = install.hwid?.trim() || null;
    session = await latestSession(db, hwid, installId);
  } else if (lookup === "license_key" || lookup === "order_id") {
    await ensureLicenseOrderColumns(db);
    license = await db
      .prepare(
        `SELECT * FROM licenses WHERE ${lookup === "license_key" ? "license_key" : "order_id"} = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(lookupValue)
      .first<LicenseRow>();
    if (!license) return null;
    hwid = uniqueHwids(license.hwid)[0] ?? null;
    const install = await findInstallForLicense(db, license, hwid);
    installId = install?.install_id ?? null;
    hwid = hwid ?? install?.hwid?.trim() ?? null;
    session = await latestSession(db, hwid, installId);
    confidence = license.order_id ? "verified_customer" : "linked_license";
  } else if (lookup === "feedback_id") {
    await ensureFeedbackSchema(env);
    const row = await db
      .prepare(`SELECT * FROM feedback WHERE id = ? LIMIT 1`)
      .bind(Number(lookupValue))
      .first<FeedbackRow>();
    if (!row) return null;
    feedbackId = row.id;
    hwid = row.hwid?.trim() || null;
    installId = row.install_id?.trim().toLowerCase() || null;
    try {
      await ensureFeedbackDiagnosticsSchema(db);
      const meta = (await loadFeedbackReportMeta(db, [row.id])).get(row.id);
      installId = meta?.verified_install_id ?? installId;
    } catch {
      // The original feedback identity fields remain a low-confidence direct anchor.
    }
    if (row.license_key) {
      await ensureLicenseOrderColumns(db);
      license = await db
        .prepare(`SELECT * FROM licenses WHERE license_key = ? LIMIT 1`)
        .bind(row.license_key)
        .first<LicenseRow>();
      if (license) {
        hwid = hwid ?? uniqueHwids(license.hwid)[0] ?? null;
        confidence = license.order_id ? "verified_customer" : "linked_license";
      }
    }
    const install = installId ? await loadInstallById(db, installId) : null;
    hwid = hwid ?? install?.hwid?.trim() ?? null;
    session = await latestSession(db, hwid, installId);
  } else {
    hwid = lookupValue;
    session = await latestSession(db, hwid, null);
    await ensureInstallsSchema(db);
    const install = await db
      .prepare(
        `SELECT install_id, hwid, app_version, created_at, last_seen_at, revoked_at,
                revoke_reason, license_id
         FROM installs WHERE hwid = ? ORDER BY last_seen_at DESC, created_at DESC LIMIT 1`,
      )
      .bind(hwid)
      .first<InstallRow>();
    installId = session?.install_id ?? install?.install_id ?? null;
    await ensureLicenseOrderColumns(db);
    license = await db
      .prepare(
        `SELECT * FROM licenses
         WHERE instr(',' || replace(COALESCE(hwid, ''), ' ', '') || ',',
                     ',' || replace(?, ' ', '') || ',') > 0
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(hwid)
      .first<LicenseRow>();
    if (!session && !install && !license) {
      await ensureFeedbackSchema(env);
      const claimed = await db
        .prepare(`SELECT id FROM feedback WHERE hwid = ? ORDER BY id DESC LIMIT 1`)
        .bind(hwid)
        .first<{ id: number }>();
      if (!claimed) return null;
      feedbackId = claimed.id;
    }
    if (license) confidence = license.order_id ? "verified_customer" : "linked_license";
  }

  installId = installId ?? session?.install_id ?? null;
  hwid = hwid ?? session?.hwid?.trim() ?? linkHwid ?? null;
  const identity = hwid ?? installId;
  if (!identity) return null;
  return {
    selector,
    value,
    identity,
    hwid,
    installId,
    requestedSessionId: selector === "session_id" ? value : (session?.session_id ?? null),
    confidence,
    session,
    license,
    feedbackId,
  };
}

export async function loadSessions(
  db: D1Database,
  anchor: AnchorSeed,
): Promise<AppSessionRecord[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (anchor.hwid) {
    conditions.push("hwid = ?");
    values.push(anchor.hwid);
  }
  if (anchor.installId) {
    conditions.push("install_id = ?");
    values.push(anchor.installId);
  }
  if (anchor.requestedSessionId) {
    conditions.push("session_id = ?");
    values.push(anchor.requestedSessionId);
  }
  if (conditions.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT ${SESSION_SELECT_COLUMNS} FROM app_sessions
       WHERE ${conditions.map((item) => `(${item})`).join(" OR ")}
       ORDER BY last_seen_at DESC LIMIT 500`,
    )
    .bind(...values)
    .all<D1SessionRow>();
  return rows.results.map(mapSession);
}

export async function loadInstalls(db: D1Database, anchor: AnchorSeed): Promise<InstallRow[]> {
  await ensureInstallsSchema(db);
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (anchor.hwid) {
    conditions.push("hwid = ?");
    values.push(anchor.hwid);
  }
  if (anchor.installId) {
    conditions.push("install_id = ?");
    values.push(anchor.installId);
  }
  if (anchor.license) {
    conditions.push("license_id = ?");
    values.push(anchor.license.id);
  }
  if (conditions.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT install_id, hwid, app_version, created_at, last_seen_at, revoked_at,
              revoke_reason, license_id
       FROM installs WHERE ${conditions.join(" OR ")}
       ORDER BY last_seen_at DESC, created_at DESC LIMIT 200`,
    )
    .bind(...values)
    .all<InstallRow>();
  return rows.results;
}

export async function loadLicenses(
  db: D1Database,
  anchor: AnchorSeed,
  installs: InstallRow[],
): Promise<LicenseRow[]> {
  await ensureLicenseOrderColumns(db);
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (anchor.license?.license_key) {
    conditions.push("license_key = ?");
    values.push(anchor.license.license_key);
  }
  if (anchor.license?.order_id) {
    conditions.push("order_id = ?");
    values.push(anchor.license.order_id);
  }
  if (anchor.selector === "order_id") {
    conditions.push("order_id = ?");
    values.push(anchor.value);
  }
  if (anchor.hwid) {
    conditions.push(
      `instr(',' || replace(COALESCE(hwid, ''), ' ', '') || ',',
             ',' || replace(?, ' ', '') || ',') > 0`,
    );
    values.push(anchor.hwid);
  }
  const licenseIds = uniqueNumbers(installs.map((install) => install.license_id));
  if (licenseIds.length > 0) {
    conditions.push(`id IN (${licenseIds.map(() => "?").join(", ")})`);
    values.push(...licenseIds);
  }
  if (conditions.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT * FROM licenses WHERE ${conditions.map((item) => `(${item})`).join(" OR ")}
       ORDER BY id DESC LIMIT 200`,
    )
    .bind(...values)
    .all<LicenseRow>();
  return dedupeBy(rows.results, (row) => String(row.id));
}

export async function loadFeedback(
  env: RuntimeEnv,
  anchor: AnchorSeed,
  installIds: string[],
  licenseKeys: string[],
  sectionErrors: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const db = env.DB as D1Database;
  await ensureFeedbackSchema(env);
  let metadataAvailable = true;
  try {
    await ensureFeedbackDiagnosticsSchema(db);
  } catch {
    metadataAvailable = false;
    sectionErrors.diagnostics = "Structured diagnostics are temporarily unavailable.";
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (anchor.feedbackId) {
    conditions.push("f.id = ?");
    values.push(anchor.feedbackId);
  }
  if (metadataAvailable && installIds.length > 0) {
    conditions.push(`m.verified_install_id IN (${installIds.map(() => "?").join(", ")})`);
    values.push(...installIds);
  }
  // Historical clients have no metadata. Include exact claims for troubleshooting, but label
  // their confidence below so they are never mistaken for a verified identity merge.
  if (anchor.hwid) {
    conditions.push("(m.feedback_id IS NULL AND f.hwid = ?)");
    values.push(anchor.hwid);
  }
  if (anchor.installId) {
    conditions.push("(m.feedback_id IS NULL AND f.install_id = ?)");
    values.push(anchor.installId);
  }
  if (licenseKeys.length > 0) {
    conditions.push(
      `(m.feedback_id IS NULL AND f.license_key IN (${licenseKeys.map(() => "?").join(", ")}))`,
    );
    values.push(...licenseKeys);
  }
  if (conditions.length === 0) return [];

  const metaJoin = metadataAvailable
    ? "LEFT JOIN feedback_report_meta m ON m.feedback_id = f.id"
    : "LEFT JOIN (SELECT NULL AS feedback_id, NULL AS report_id, NULL AS auth_mode, NULL AS verified_install_id) m ON 0 = 1";
  const result = await db
    .prepare(
      `SELECT f.*, m.report_id, m.auth_mode, m.verified_install_id
       FROM feedback f ${metaJoin}
       WHERE ${conditions.map((item) => `(${item})`).join(" OR ")}
       ORDER BY f.id DESC LIMIT 200`,
    )
    .bind(...values)
    .all<FeedbackRow & Record<string, unknown>>();

  let diagnostics = new Map<number, FeedbackDiagnostics>();
  if (metadataAvailable) {
    try {
      diagnostics = await loadFeedbackDiagnostics(
        db,
        result.results.map((row) => Number(row.id)),
      );
    } catch {
      sectionErrors.diagnostics = "Structured diagnostics are temporarily unavailable.";
    }
  }

  return result.results.map((row) => {
    const verifiedInstallId = asString(row.verified_install_id);
    const reportId = asString(row.report_id) ?? fallbackFeedbackReportId(Number(row.id));
    const diagnostic = diagnostics.get(Number(row.id));
    return {
      ...row,
      kind: normalizeFeedbackKind(row.kind),
      report_id: reportId,
      auth_mode: asString(row.auth_mode),
      verified_install_id: verifiedInstallId,
      identity_confidence:
        anchor.feedbackId === Number(row.id)
          ? "direct_feedback"
          : verifiedInstallId
            ? "verified_install"
            : "claimed_identity",
      diagnostics: diagnostic
        ? {
            report_id: reportId,
            generated_at: diagnostic.generated_at,
            providers: diagnostic.providers,
          }
        : null,
    };
  });
}

export async function loadAccess(
  env: RuntimeEnv,
  anchor: AnchorSeed,
  installIds: string[],
): Promise<Array<Record<string, unknown>>> {
  await ensureAccessSchema(env);
  const db = env.DB as D1Database;
  const identities = uniqueText([anchor.identity, anchor.hwid, anchor.installId, ...installIds]);
  if (identities.length === 0) return [];
  const placeholders = identities.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT * FROM access_suspensions
       WHERE identity IN (${placeholders}) OR hwid IN (${placeholders}) OR install_id IN (${placeholders})
       ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(...identities, ...identities, ...identities)
    .all();
  return rows.results;
}

export async function loadDiscordLinks(
  env: RuntimeEnv,
  hwid: string | null,
  licenseKeys: string[],
): Promise<Array<Record<string, unknown>>> {
  await ensureAccessSchema(env);
  const db = env.DB as D1Database;
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (hwid) {
    conditions.push("hwid = ?");
    values.push(hwid);
  }
  if (licenseKeys.length > 0) {
    conditions.push(`license_key IN (${licenseKeys.map(() => "?").join(", ")})`);
    values.push(...licenseKeys);
  }
  if (conditions.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT * FROM discord_links WHERE ${conditions.join(" OR ")}
       ORDER BY verified_at DESC LIMIT 100`,
    )
    .bind(...values)
    .all();
  return rows.results;
}

export async function loadUsage(
  db: D1Database,
  hwid: string | null,
): Promise<Array<Record<string, unknown>>> {
  if (!hwid) return [];
  await ensureUsageSchema(db);
  const rows = await db
    .prepare(
      `SELECT feature, period, count, updated_at FROM feature_usage
       WHERE hwid = ? ORDER BY period DESC, feature ASC LIMIT 500`,
    )
    .bind(hwid)
    .all<UsageRow>();
  return rows.results.map((row) => {
    const count = toNumber(row.count);
    const limit = FREE_LIMITS[row.feature] ?? null;
    return {
      feature: row.feature,
      period: row.period,
      count,
      updated_at: row.updated_at,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - count),
    };
  });
}

/**
 * Real errors and background faults on separate budgets.
 *
 * One shared cap let a client looping on RR-E1003 fill all 200 rows with
 * seconds of noise, so a real crash reported at any other moment was missing
 * from the one screen support opens to answer "what broke for this user".
 * Background faults stay in the list — the panel labels them and counts them
 * nowhere — but they can no longer evict a real error.
 */
export async function loadErrors(db: D1Database, anchor: AnchorSeed): Promise<ErrorEventDetail[]> {
  const safeMetrics = "CASE WHEN json_valid(metrics_json) THEN metrics_json ELSE '{}' END";
  const columns = "event_id, source, ts, metrics_json, message, received_at";
  const rows = await db
    .prepare(
      `WITH anchored AS (
         SELECT ${columns},
                COALESCE(json_extract(${safeMetrics}, '$.error_kind'), '') AS error_kind
         FROM telemetry_events
         WHERE service = 'app_error' AND (
           (? IS NOT NULL AND json_extract(${safeMetrics}, '$.hwid') = ?) OR
           (? IS NOT NULL AND json_extract(${safeMetrics}, '$.install_id') = ?) OR
           (? IS NOT NULL AND json_extract(${safeMetrics}, '$.session_id') = ?)
         )
       )
       SELECT * FROM (
         SELECT ${columns} FROM anchored WHERE error_kind != ? ORDER BY ts DESC LIMIT ${ERROR_LIMIT}
       )
       UNION ALL
       SELECT * FROM (
         SELECT ${columns} FROM anchored
         WHERE error_kind = ? ORDER BY ts DESC LIMIT ${BACKGROUND_ERROR_LIMIT}
       )
       ORDER BY ts DESC`,
    )
    .bind(
      anchor.hwid,
      anchor.hwid,
      anchor.installId,
      anchor.installId,
      anchor.requestedSessionId,
      anchor.requestedSessionId,
      BACKGROUND_KIND,
      BACKGROUND_KIND,
    )
    .all<ErrorRow>();
  return rows.results.map(mapError);
}

async function latestSession(
  db: D1Database,
  hwid: string | null,
  installId: string | null,
): Promise<D1SessionRow | null> {
  if (!hwid && !installId) return null;
  return db
    .prepare(
      `SELECT ${SESSION_SELECT_COLUMNS} FROM app_sessions
       WHERE (? IS NOT NULL AND hwid = ?) OR (? IS NOT NULL AND install_id = ?)
       ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .bind(hwid, hwid, installId, installId)
    .first<D1SessionRow>();
}

async function loadInstallById(db: D1Database, installId: string): Promise<InstallRow | null> {
  await ensureInstallsSchema(db);
  return db
    .prepare(
      `SELECT install_id, hwid, app_version, created_at, last_seen_at, revoked_at,
              revoke_reason, license_id
       FROM installs WHERE install_id = ? LIMIT 1`,
    )
    .bind(installId)
    .first<InstallRow>();
}

async function findInstallForLicense(
  db: D1Database,
  license: LicenseRow,
  hwid: string | null,
): Promise<InstallRow | null> {
  await ensureInstallsSchema(db);
  return db
    .prepare(
      `SELECT install_id, hwid, app_version, created_at, last_seen_at, revoked_at,
              revoke_reason, license_id
       FROM installs
       WHERE license_id = ? OR (? IS NOT NULL AND hwid = ?)
       ORDER BY last_seen_at DESC, created_at DESC LIMIT 1`,
    )
    .bind(license.id, hwid, hwid)
    .first<InstallRow>();
}

export function mapSession(row: D1SessionRow): AppSessionRecord {
  return {
    id: row.session_id,
    installId: row.install_id,
    hwid: row.hwid ?? null,
    source: row.source,
    userLabel: row.user_label ?? null,
    clientIp: row.client_ip ?? null,
    clientCountry: row.client_country ?? null,
    clientCity: row.client_city ?? null,
    clientRegion: row.client_region ?? null,
    clientLatitude: toNullableNumber(row.client_latitude),
    clientLongitude: toNullableNumber(row.client_longitude),
    clientTimezone: row.client_timezone ?? null,
    clientGeoSource: row.client_geo_source ?? null,
    clientGeoSignalSource: row.client_geo_signal_source ?? null,
    clientAccuracyMeters: toNullableNumber(row.client_accuracy_meters),
    clientGeoCapturedAt: row.client_geo_captured_at ?? null,
    appVersion: row.app_version ?? null,
    displayVersion: row.display_version ?? null,
    platform: row.platform ?? null,
    osVersion: row.os_version ?? null,
    deviceModel: row.device_model ?? null,
    rpcEnabled:
      row.rpc_enabled === null || row.rpc_enabled === undefined
        ? null
        : toNumber(row.rpc_enabled) === 1,
    discordUser: row.discord_user ?? null,
    featuresJson: row.features_json ?? null,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at ?? null,
    durationSeconds: toNullableNumber(row.duration_seconds),
    isActive: toNumber(row.is_active) === 1,
    lastEvent: row.last_event ?? null,
    lastStatus: normalizeStatus(row.last_status),
    errorCount: toNumber(row.error_count),
  };
}

export function mapInstall(row: InstallRow): Record<string, unknown> {
  return {
    installId: row.install_id,
    hwid: row.hwid ?? null,
    appVersion: row.app_version ?? null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    revokedAt: row.revoked_at ?? null,
    revokeReason: row.revoke_reason ?? null,
    licenseId: toNullableInteger(row.license_id),
  };
}

function mapError(row: ErrorRow): ErrorEventDetail {
  const metrics = parseObject(row.metrics_json);
  const kind = metricText(metrics, "error_kind");
  const background = kind === BACKGROUND_KIND;
  // A background row's report keys ship as `report`, so they are not repeated in the extras
  // (which are capped at 16 keys and would otherwise cut them off behind the base metrics). Any
  // other row keeps them: a real error carrying base_exception_type has no report to show it in.
  const surfaced = new Set([
    "hwid",
    "install_id",
    "session_id",
    "exception_type",
    "error_kind",
    "error_code",
    "app_version",
    ...(background ? BACKGROUND_REPORT_METRIC_KEYS : []),
  ]);
  const extras = Object.fromEntries(
    Object.entries(metrics)
      .filter(([key]) => !surfaced.has(key))
      .slice(0, 16)
      .map(([key, value]) => [key, value]),
  );
  const redacted = redactValue(extras, {
    maxDepth: 4,
    maxObjectKeys: 16,
    maxArrayItems: 16,
    maxStringLength: 300,
  });
  return {
    id: row.event_id,
    timestamp: row.ts,
    receivedAt: row.received_at,
    message: row.message ?? null,
    type: metricText(metrics, "exception_type"),
    kind,
    code: metricText(metrics, "error_code"),
    sessionId: metricText(metrics, "session_id"),
    appVersion: metricText(metrics, "app_version"),
    source: row.source,
    extras: toStringRecord(redacted),
    // What a listed background row stands for: one fault (older client), a first sighting, a
    // 5-minute rollup, or suppressed I/O. Real errors carry none of it.
    report: background ? readBackgroundFaultReport(metrics) : null,
  };
}

export function isActiveLicense(license: LicenseRow): boolean {
  return (
    license.status === "active" &&
    (!license.expires_at || Date.parse(license.expires_at) > Date.now())
  );
}

/** Never let one failing data source empty the whole answer; it reports itself instead. */
export async function section<T>(
  errors: Record<string, string>,
  name: string,
  fallback: T,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch {
    errors[name] = "This data source is temporarily unavailable.";
    return fallback;
  }
}

export function uniqueHwids(value: string | null): string[] {
  return uniqueText(value?.split(",").map((item) => item.trim()) ?? []).filter((item) =>
    HWID_PATTERN.test(item),
  );
}

export function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}

function uniqueNumbers(values: unknown[]): number[] {
  return [
    ...new Set(values.map(toNullableInteger).filter((value): value is number => value !== null)),
  ];
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function parseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function metricText(metrics: Record<string, unknown>, key: string): string | null {
  const value = metrics[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      typeof entry === "string" ? entry : JSON.stringify(entry),
    ]),
  );
}

export function earliest(values: Array<string | null | undefined>): string | null {
  return sortDates(values, 1);
}

export function latestDate(values: Array<string | null | undefined>): string | null {
  return sortDates(values, -1);
}

function sortDates(values: Array<string | null | undefined>, direction: 1 | -1): string | null {
  const valid = values.filter(
    (value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)),
  );
  valid.sort((left, right) => (Date.parse(left) - Date.parse(right)) * direction);
  return valid[0] ?? null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toNullableInteger(value: unknown): number | null {
  const parsed = toNullableNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function normalizeStatus(value: unknown): TelemetryStatus {
  return value === "degraded" || value === "down" ? value : "ok";
}
