import { nowIso } from "./http";
import { ensureTelemetrySchema } from "./storage";
import type { ErrorEventDetail, ErrorsPayload, ErrorUserGroup, RuntimeEnv } from "./types";

const APP_ERROR = "app_error";
const BACKGROUND_KIND = "background";
// One request scans at most this many error rows, newest first — bounds the
// payload while still covering months of realistic error volume.
const EVENT_SCAN_LIMIT = 4000;
// The ingest key ships inside the client binary, so ts is attacker-influencable:
// far-future timestamps would sort first forever (retention only prunes ts < cutoff)
// and permanently occupy the newest-first scan window. Tolerate honest clock skew,
// exclude the rest.
const FUTURE_SKEW_TOLERANCE_MS = 48 * 60 * 60 * 1000;
// Same threat, other axis: unique fabricated hwids mint one group per event and
// dodge the per-user caps — cap how many user groups one response ships.
const MAX_USER_GROUPS = 500;
// Per-user caps keep one noisy install from flooding the payload. Real and
// background errors are capped separately so a burst of background noise can
// never crowd the real failures out of the detail list.
const MAX_REAL_EVENTS_PER_USER = 100;
const MAX_BACKGROUND_EVENTS_PER_USER = 40;
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
  real: ErrorEventDetail[];
  background: ErrorEventDetail[];
  errorCount: number;
  backgroundCount: number;
  // Scan order is newest-first, so the first event seen is the latest.
  lastRealAt: string | null;
  firstRealAt: string | null;
  lastAnyAt: string;
  firstAnyAt: string;
}

/**
 * Every retained error event in range, grouped under the same user identity
 * the session rollup uses (hwid when known, else install_id). Attribution
 * reads the event's own metrics first, then canonicalizes through the session
 * table so an event that only carried an install_id still lands on the same
 * user as its hwid-bearing siblings.
 */
export async function loadErrorsByUser(env: RuntimeEnv, range: ErrorsRange): Promise<ErrorsPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("The errors rollup requires the D1 storage backend.");
  }

  await ensureTelemetrySchema(db);

  const futureBoundIso = new Date(Date.now() + FUTURE_SKEW_TOLERANCE_MS).toISOString();
  const eventsStatement = range.cutoffIso
    ? db
        .prepare(
          `SELECT event_id, source, ts, metrics_json, message, received_at
           FROM telemetry_events
           WHERE service = ? AND ts >= ? AND ts <= ?
           ORDER BY ts DESC
           LIMIT ?`
        )
        .bind(APP_ERROR, range.cutoffIso, futureBoundIso, EVENT_SCAN_LIMIT + 1)
    : db
        .prepare(
          `SELECT event_id, source, ts, metrics_json, message, received_at
           FROM telemetry_events
           WHERE service = ? AND ts <= ?
           ORDER BY ts DESC
           LIMIT ?`
        )
        .bind(APP_ERROR, futureBoundIso, EVENT_SCAN_LIMIT + 1);

  const [eventRows, sessionRows, licenseRows] = await Promise.all([
    eventsStatement.all<ErrorEventRow>(),
    db
      .prepare(
        `SELECT session_id, install_id, hwid, user_label, discord_user, client_country, client_city, client_timezone,
           platform, os_version, device_model, app_version, display_version, last_seen_at, is_active
         FROM app_sessions`
      )
      .all<EnrichSessionRow>(),
    // License tier is enrichment only — a database without the licenses table
    // (created by the licensing endpoints, not the telemetry schema) still serves errors.
    db
      .prepare(`SELECT hwid FROM licenses WHERE hwid IS NOT NULL AND status = 'active'`)
      .all<{ hwid: string }>()
      .catch(() => ({ results: [] as Array<{ hwid: string }> })),
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
    const kind = metricText(metrics, "error_kind");
    const isBackground = kind === BACKGROUND_KIND;

    const identity = resolveIdentity(hwid, installId, sessionId, installToIdentity, sessionToIdentity);

    let group = working.get(identity);
    if (!group) {
      group = {
        identity,
        metricHwid: null,
        metricInstallId: null,
        real: [],
        background: [],
        errorCount: 0,
        backgroundCount: 0,
        lastRealAt: null,
        firstRealAt: null,
        lastAnyAt: row.ts,
        firstAnyAt: row.ts,
      };
      working.set(identity, group);
    }

    group.metricHwid = group.metricHwid ?? hwid;
    group.metricInstallId = group.metricInstallId ?? installId;
    group.firstAnyAt = row.ts;

    if (isBackground) {
      group.backgroundCount += 1;
    } else {
      group.errorCount += 1;
      group.lastRealAt = group.lastRealAt ?? row.ts;
      group.firstRealAt = row.ts;
    }

    const bucket = isBackground ? group.background : group.real;
    const cap = isBackground ? MAX_BACKGROUND_EVENTS_PER_USER : MAX_REAL_EVENTS_PER_USER;
    if (bucket.length < cap) {
      bucket.push({
        id: row.event_id,
        timestamp: row.ts,
        receivedAt: row.received_at,
        message: row.message ?? null,
        type: metricText(metrics, "exception_type"),
        kind,
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
      const merged = [...group.real, ...group.background].sort(
        (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)
      );
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
        backgroundCount: group.backgroundCount,
        firstErrorAt: group.firstRealAt ?? group.firstAnyAt,
        lastErrorAt: group.lastRealAt ?? group.lastAnyAt,
        events: merged,
        truncated: group.errorCount > group.real.length || group.backgroundCount > group.background.length,
      };
    })
    .sort((left, right) => Date.parse(right.lastErrorAt) - Date.parse(left.lastErrorAt));

  const usersTruncated = allUsers.length > MAX_USER_GROUPS;
  const users = usersTruncated ? allUsers.slice(0, MAX_USER_GROUPS) : allUsers;

  // Totals cover the full scan, not just the groups that ship.
  let totalErrors = 0;
  let totalBackground = 0;
  let affectedUsers = 0;
  let lastErrorAt: string | null = null;
  for (const user of allUsers) {
    totalErrors += user.errorCount;
    totalBackground += user.backgroundCount;
    if (user.errorCount > 0) {
      affectedUsers += 1;
      if (lastErrorAt === null || Date.parse(user.lastErrorAt) > Date.parse(lastErrorAt)) {
        lastErrorAt = user.lastErrorAt;
      }
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
      backgroundErrors: totalBackground,
      affectedUsers,
      lastErrorAt,
    },
    users,
  };
}

function resolveIdentity(
  hwid: string | null,
  installId: string | null,
  sessionId: string | null,
  installToIdentity: Map<string, { identity: string; lastSeenTs: number }>,
  sessionToIdentity: Map<string, string>
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

function buildExtras(metrics: Record<string, unknown>, message: string | null): Record<string, string> {
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
    const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    extras[key] = trimmed.length > MAX_EXTRA_VALUE_LENGTH ? `${trimmed.slice(0, MAX_EXTRA_VALUE_LENGTH)}…` : trimmed;
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
