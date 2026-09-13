import { nowIso } from "./http";
import { ensureTelemetrySchema } from "./storage";
import type {
  BackgroundFaultGroup,
  ErrorEventDetail,
  ErrorsPayload,
  ErrorUserGroup,
  RuntimeEnv,
} from "./types";

const APP_ERROR = "app_error";
const BACKGROUND_KIND = "background";
// One request scans at most this many REAL error rows, newest first — bounds the
// payload while still covering months of realistic error volume. Background
// faults are excluded from this scan (see loadBackgroundFaults), so a client
// stuck in a background-error loop can never fill the window.
const EVENT_SCAN_LIMIT = 4000;
// The ingest key ships inside the client binary, so ts is attacker-influencable:
// far-future timestamps would sort first forever (retention only prunes ts < cutoff)
// and permanently occupy the newest-first scan window. Tolerate honest clock skew,
// exclude the rest.
const FUTURE_SKEW_TOLERANCE_MS = 48 * 60 * 60 * 1000;
// Same threat, other axis: unique fabricated hwids mint one group per event and
// dodge the per-user caps — cap how many user groups one response ships.
const MAX_USER_GROUPS = 500;
// Per-user cap keeps one noisy install from flooding the payload.
const MAX_REAL_EVENTS_PER_USER = 100;
// Background faults ship as aggregates, never as rows, so no scan limit applies.
// Code, exception type and version are still client-supplied text: cap how many
// groups, versions per group and characters per value one response carries.
const MAX_BACKGROUND_FAULT_GROUPS = 50;
const MAX_VERSIONS_PER_FAULT = 12;
const MAX_FAULT_TEXT_LENGTH = 160;
const MAX_EXTRA_KEYS = 16;
const MAX_EXTRA_VALUE_LENGTH = 300;
const UNATTRIBUTED_IDENTITY = "unattributed";

const RANGE_PATTERN = /^(\d{1,4})([hd])$/;

// Metric keys already surfaced as dedicated fields (or per-user context) — the
// rest of the metrics object ships as `extras` so no error detail is lost.
const SURFACED_METRIC_KEYS = new Set([
  "install_id",
  "session_id",
  "hwid",
  "user_label",
  "machine_name",
  "app_name",
  "app_version",
  "app_display_version",
  "platform",
  "os",
  "os_platform",
  "os_version",
  "device_model",
  "exception_type",
  "error_kind",
  "error_code",
  "client_ip",
  "client_ip_version",
  "client_country",
  "client_city",
  "client_region",
  "client_latitude",
  "client_longitude",
  "client_timezone",
  "client_geo_source",
  "client_geo_signal_source",
  "client_accuracy_meters",
  "client_geo_captured_at",
  "session_started_at",
  "session_duration_seconds",
  "rpc_enabled",
  "discord_user",
  "discord_username",
  "discord_name",
]);

export interface ErrorsRange {
  key: string;
  cutoffIso: string | null;
}

/** Accepts `Nh` / `Nd` / `all` (e.g. 1h, 12h, 3d). Defaults to 24h. */
export function parseErrorsRange(url: URL): ErrorsRange {
  const raw = (url.searchParams.get("range") ?? "24h").trim().toLowerCase();
  if (raw === "all") {
    return { key: "all", cutoffIso: null };
  }

  const match = RANGE_PATTERN.exec(raw);
  if (!match) {
    return { key: "24h", cutoffIso: hoursAgoIso(24) };
  }

  const value = Number.parseInt(match[1], 10);
  const hours = match[2] === "d" ? value * 24 : value;
  const clamped = Math.min(Math.max(hours, 1), 24 * 366);
  return { key: raw, cutoffIso: hoursAgoIso(clamped) };
}

interface ErrorEventRow {
  event_id: string;
  source: string;
  ts: string;
  metrics_json: string | null;
  message: string | null;
  received_at: string;
}

interface BackgroundFaultRow {
  code: string | null;
  exception_type: string | null;
  events: number | string;
  installs: number | string;
  sessions: number | string;
  versions: string | null;
  first_seen: string;
  last_seen: string;
  total_events: number | string;
  total_groups: number | string;
}

interface EnrichSessionRow {
  session_id: string;
  install_id: string;
  hwid: string | null;
  user_label: string | null;
  discord_user: string | null;
  client_country: string | null;
  client_city: string | null;
  client_timezone: string | null;
  platform: string | null;
  os_version: string | null;
  device_model: string | null;
  app_version: string | null;
  display_version: string | null;
  last_seen_at: string;
  is_active: number | string;
}

interface IdentityContext {
  row: EnrichSessionRow;
  lastSeenTs: number;
  isActive: boolean;
}

interface WorkingGroup {
  identity: string;
  metricHwid: string | null;
  metricInstallId: string | null;
  events: ErrorEventDetail[];
  errorCount: number;
  // Scan order is newest-first, so the first event seen is the latest.
  lastErrorAt: string;
  firstErrorAt: string;
}

// Client-supplied metric text, trimmed; json_extract hands numbers back as numbers.
const metricTextSql = (key: string) =>
  `NULLIF(TRIM(CAST(json_extract(metrics_json, '$.${key}') AS TEXT)), '')`;

/**
 * Background faults in range, one row per error code + base exception type.
 *
 * error_kind = 'background' is the desktop client reporting an unobserved task
 * exception (production: RR-E1003, an AggregateException wrapping the real
 * exception in `base_exception_type`). It loops hundreds of times per session,
 * so rows would be noise: the panel gets the aggregate — events, distinct
 * installs (hwid, else install_id — the session rollup's identity), distinct
 * sessions, versions, first/last seen. The cutoff is computed in JS and bound
 * (ts is ISO text with T and Z; SQLite's own clock functions format differently).
 * The window totals are taken before LIMIT, so they cover every group.
 */
async function loadBackgroundFaults(
  db: NonNullable<RuntimeEnv["DB"]>,
  cutoffIso: string | null,
  futureBoundIso: string,
): Promise<{ groups: BackgroundFaultGroup[]; totalEvents: number; totalGroups: number }> {
  const rows = await db
    .prepare(
      `WITH faults AS (
         SELECT ts,
           ${metricTextSql("error_code")} AS code,
           COALESCE(${metricTextSql("base_exception_type")}, ${metricTextSql("exception_type")}) AS exception_type,
           COALESCE(${metricTextSql("hwid")}, ${metricTextSql("install_id")}) AS install_key,
           ${metricTextSql("session_id")} AS session_id,
           ${metricTextSql("app_version")} AS app_version
         FROM telemetry_events
         WHERE service = ? AND ts >= ? AND ts <= ?
           AND json_extract(metrics_json, '$.error_kind') = ?
       )
       SELECT code, exception_type,
         COUNT(*) AS events,
         COUNT(DISTINCT install_key) AS installs,
         COUNT(DISTINCT session_id) AS sessions,
         GROUP_CONCAT(DISTINCT app_version) AS versions,
         MIN(ts) AS first_seen,
         MAX(ts) AS last_seen,
         SUM(COUNT(*)) OVER () AS total_events,
         COUNT(*) OVER () AS total_groups
       FROM faults
       GROUP BY code, exception_type
       ORDER BY events DESC, last_seen DESC
       LIMIT ?`,
    )
    .bind(APP_ERROR, cutoffIso ?? "", futureBoundIso, BACKGROUND_KIND, MAX_BACKGROUND_FAULT_GROUPS)
    .all<BackgroundFaultRow>();

  const first = rows.results[0];
  return {
    groups: rows.results.map((row) => ({
      code: clampText(row.code),
      exceptionType: clampText(row.exception_type),
      events: toNumber(row.events),
      installs: toNumber(row.installs),
      sessions: toNumber(row.sessions),
      versions: splitVersions(row.versions),
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
    })),
    totalEvents: first ? toNumber(first.total_events) : 0,
    totalGroups: first ? toNumber(first.total_groups) : 0,
  };
}

/**
 * Every retained real error event in range, grouped under the same user
 * identity the session rollup uses (hwid when known, else install_id).
 * Attribution reads the event's own metrics first, then canonicalizes through
 * the session table so an event that only carried an install_id still lands on
 * the same user as its hwid-bearing siblings. Background faults are not in the
 * user groups; they ship aggregated in `backgroundFaults`.
 */
export async function loadErrorsByUser(
  env: RuntimeEnv,
  range: ErrorsRange,
): Promise<ErrorsPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("The errors rollup requires the D1 storage backend.");
  }

  await ensureTelemetrySchema(db);

  const futureBoundIso = new Date(Date.now() + FUTURE_SKEW_TOLERANCE_MS).toISOString();
  // `ts >= ''` holds for every ISO timestamp, so "all" needs no second statement.
  const eventsStatement = db
    .prepare(
      `SELECT event_id, source, ts, metrics_json, message, received_at
       FROM telemetry_events
       WHERE service = ? AND ts >= ? AND ts <= ?
         AND COALESCE(json_extract(metrics_json, '$.error_kind'), '') != ?
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .bind(APP_ERROR, range.cutoffIso ?? "", futureBoundIso, BACKGROUND_KIND, EVENT_SCAN_LIMIT + 1);

  const [eventRows, sessionRows, licenseRows, background] = await Promise.all([
    eventsStatement.all<ErrorEventRow>(),
    // app_sessions has no retention (only telemetry_events is pruned), so an
    // unbounded scan degrades forever. Newest rows carry the identity/context
    // that matters; idx_sessions_updated makes this ordered read cheap.
    db
      .prepare(
        `SELECT session_id, install_id, hwid, user_label, discord_user, client_country, client_city, client_timezone,
           platform, os_version, device_model, app_version, display_version, last_seen_at, is_active
         FROM app_sessions
         ORDER BY updated_at DESC
         LIMIT 5000`,
      )
      .all<EnrichSessionRow>(),
    // License tier is enrichment only — a database without the licenses table
    // (created by the licensing endpoints, not the telemetry schema) still serves errors.
    db
      .prepare(`SELECT hwid FROM licenses WHERE hwid IS NOT NULL AND status = 'active'`)
      .all<{ hwid: string }>()
      .catch(() => ({ results: [] as Array<{ hwid: string }> })),
    loadBackgroundFaults(db, range.cutoffIso, futureBoundIso),
  ]);

  const scanTruncated = eventRows.results.length > EVENT_SCAN_LIMIT;
  const events = scanTruncated ? eventRows.results.slice(0, EVENT_SCAN_LIMIT) : eventRows.results;
  const premiumHwids = new Set(licenseRows.results.map((row) => row.hwid));

  const byIdentity = new Map<string, IdentityContext>();
  const installToIdentity = new Map<string, { identity: string; lastSeenTs: number }>();
  const sessionToIdentity = new Map<string, string>();

  for (const row of sessionRows.results) {
    const installId = row.install_id?.trim() ?? "";
    const hwid = row.hwid?.trim() || null;
    const identity = hwid ?? (installId || null);
    if (!identity) {
      continue;
    }

    const parsedTs = Date.parse(row.last_seen_at);
    const lastSeenTs = Number.isFinite(parsedTs) ? parsedTs : 0;
    const active = toNumber(row.is_active) === 1;

    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, { row, lastSeenTs, isActive: active });
    } else {
      existing.isActive = existing.isActive || active;
      if (lastSeenTs > existing.lastSeenTs) {
        existing.row = row;
        existing.lastSeenTs = lastSeenTs;
      }
    }

    if (installId) {
      const mapped = installToIdentity.get(installId);
      if (!mapped || lastSeenTs > mapped.lastSeenTs) {
        installToIdentity.set(installId, { identity, lastSeenTs });
      }
    }
    if (row.session_id) {
      sessionToIdentity.set(row.session_id, identity);
    }
  }

  const working = new Map<string, WorkingGroup>();

  for (const row of events) {
    const metrics = safeParseMetrics(row.metrics_json);
    const hwid = metricText(metrics, "hwid");
    const installId = metricText(metrics, "install_id");
    const sessionId = metricText(metrics, "session_id");

    const identity = resolveIdentity(
      hwid,
      installId,
      sessionId,
      installToIdentity,
      sessionToIdentity,
    );

    let group = working.get(identity);
    if (!group) {
      group = {
        identity,
        metricHwid: null,
        metricInstallId: null,
        events: [],
        errorCount: 0,
        lastErrorAt: row.ts,
        firstErrorAt: row.ts,
      };
      working.set(identity, group);
    }

    group.metricHwid = group.metricHwid ?? hwid;
    group.metricInstallId = group.metricInstallId ?? installId;
    group.firstErrorAt = row.ts;
    group.errorCount += 1;

    if (group.events.length < MAX_REAL_EVENTS_PER_USER) {
      group.events.push({
        id: row.event_id,
        timestamp: row.ts,
        receivedAt: row.received_at,
        message: row.message ?? null,
        type: metricText(metrics, "exception_type"),
        kind: metricText(metrics, "error_kind"),
        code: metricText(metrics, "error_code"),
        sessionId,
        appVersion: metricText(metrics, "app_version"),
        source: row.source,
        extras: buildExtras(metrics, row.message ?? null),
      });
    }
  }

  const allUsers: ErrorUserGroup[] = [...working.values()]
    .map((group) => {
      const context = byIdentity.get(group.identity) ?? null;
      const row = context?.row ?? null;
      const hwid = row?.hwid?.trim() || group.metricHwid;

      return {
        identity: group.identity,
        userLabel: row?.user_label?.trim() || null,
        discordUser: row?.discord_user?.trim() || null,
        hwid: hwid ?? null,
        installId: row?.install_id?.trim() || group.metricInstallId,
        licenseTier: (premiumHwids.has(group.identity) || (hwid && premiumHwids.has(hwid))
          ? "premium"
          : "free") as "premium" | "free",
        country: row?.client_country ?? null,
        city: row?.client_city ?? null,
        timezone: row?.client_timezone ?? null,
        platform: row?.platform ?? null,
        osVersion: row?.os_version ?? null,
        deviceModel: row?.device_model ?? null,
        appVersion: row?.app_version ?? null,
        displayVersion: row?.display_version ?? null,
        isActive: context?.isActive ?? false,
        lastSeen: row?.last_seen_at ?? null,
        errorCount: group.errorCount,
        firstErrorAt: group.firstErrorAt,
        lastErrorAt: group.lastErrorAt,
        // Scan order is newest-first, so the list already is.
        events: group.events,
        truncated: group.errorCount > group.events.length,
      };
    })
    .sort((left, right) => Date.parse(right.lastErrorAt) - Date.parse(left.lastErrorAt));

  const usersTruncated = allUsers.length > MAX_USER_GROUPS;
  const users = usersTruncated ? allUsers.slice(0, MAX_USER_GROUPS) : allUsers;

  // Totals cover the full scan, not just the groups that ship.
  let totalErrors = 0;
  let lastErrorAt: string | null = null;
  for (const user of allUsers) {
    totalErrors += user.errorCount;
    if (lastErrorAt === null || Date.parse(user.lastErrorAt) > Date.parse(lastErrorAt)) {
      lastErrorAt = user.lastErrorAt;
    }
  }

  return {
    generatedAt: nowIso(),
    range: range.key,
    cutoff: range.cutoffIso,
    scanTruncated,
    usersTruncated,
    totals: {
      errors: totalErrors,
      backgroundErrors: background.totalEvents,
      affectedUsers: allUsers.length,
      lastErrorAt,
    },
    users,
    backgroundFaults: background.groups,
    backgroundFaultsTruncated: background.totalGroups > background.groups.length,
  };
}

function clampText(value: string | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  return text.length > MAX_FAULT_TEXT_LENGTH ? `${text.slice(0, MAX_FAULT_TEXT_LENGTH)}…` : text;
}

/** GROUP_CONCAT(DISTINCT …) list → unique versions, newest first, capped. */
function splitVersions(value: string | null): string[] {
  if (!value) {
    return [];
  }
  const unique = new Set<string>();
  for (const part of value.split(",")) {
    const text = clampText(part);
    if (text) {
      unique.add(text);
    }
  }
  return [...unique].sort(compareVersionsDesc).slice(0, MAX_VERSIONS_PER_FAULT);
}

function compareVersionsDesc(left: string, right: string): number {
  const a = left.split(/[.\-+]/);
  const b = right.split(/[.\-+]/);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = Number.parseInt(a[index] ?? "", 10);
    const y = Number.parseInt(b[index] ?? "", 10);
    const bothNumeric = Number.isFinite(x) && Number.isFinite(y);
    if (bothNumeric && x !== y) {
      return y - x;
    }
    if (!bothNumeric && (a[index] ?? "") !== (b[index] ?? "")) {
      return (b[index] ?? "").localeCompare(a[index] ?? "");
    }
  }
  return 0;
}

function resolveIdentity(
  hwid: string | null,
  installId: string | null,
  sessionId: string | null,
  installToIdentity: Map<string, { identity: string; lastSeenTs: number }>,
  sessionToIdentity: Map<string, string>,
): string {
  if (hwid) {
    return hwid;
  }
  if (installId) {
    return installToIdentity.get(installId)?.identity ?? installId;
  }
  if (sessionId) {
    const mapped = sessionToIdentity.get(sessionId);
    if (mapped) {
      return mapped;
    }
  }
  return UNATTRIBUTED_IDENTITY;
}

function buildExtras(
  metrics: Record<string, unknown>,
  message: string | null,
): Record<string, string> {
  const extras: Record<string, string> = {};
  let count = 0;

  for (const [key, value] of Object.entries(metrics)) {
    if (SURFACED_METRIC_KEYS.has(key) || value === null || value === undefined) {
      continue;
    }
    // Legacy ingest copies properties.message into metrics AND derives the event
    // message from it — drop the exact duplicate, keep a differing value.
    if (key === "message" && typeof value === "string" && value.trim() === (message ?? "").trim()) {
      continue;
    }
    if (count >= MAX_EXTRA_KEYS) {
      break;
    }
    const text =
      typeof value === "string"
        ? value
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    extras[key] =
      trimmed.length > MAX_EXTRA_VALUE_LENGTH
        ? `${trimmed.slice(0, MAX_EXTRA_VALUE_LENGTH)}…`
        : trimmed;
    count += 1;
  }

  return extras;
}

function safeParseMetrics(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function metricText(metrics: Record<string, unknown>, key: string): string | null {
  const value = metrics[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}
