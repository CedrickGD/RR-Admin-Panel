import { nowIso } from "./http";
import { ensureTelemetrySchema, normalizeDisplayVersion } from "./storage";
import type { RuntimeEnv, StatsFilters, StatsPayload, UserErrorRecord, UserRollupRecord, TelemetryStatus } from "./types";

// Sessions longer than 2 days are artifacts (legacy install-scoped rows, crashed
// clients revived by heartbeats) and would wreck duration averages.
const MAX_PLAUSIBLE_DURATION_SECONDS = 172_800;

const IDENTITY_SQL = "COALESCE(hwid, install_id)";
const VERSION_SQL = "COALESCE(display_version, 'unknown')";

interface FilterClause {
  sql: string;
  bindings: unknown[];
}

export function parseStatsFilters(url: URL): StatsFilters {
  const rangeRaw = (url.searchParams.get("range") ?? "30d").trim().toLowerCase();
  const rangeDays =
    rangeRaw === "all"
      ? null
      : rangeRaw === "today"
        ? 1
        : Number.parseInt(rangeRaw.replace(/d$/, ""), 10);

  return {
    rangeDays: rangeDays !== null && Number.isFinite(rangeDays) && rangeDays > 0 ? Math.min(rangeDays, 3650) : rangeDays === null ? null : 30,
    version: readFilterParam(url, "version"),
    platform: readFilterParam(url, "platform"),
    country: readFilterParam(url, "country"),
  };
}

function readFilterParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)?.trim() ?? "";
  return value.length > 0 && value.length <= 64 ? value : null;
}

// Dimension filters (version/platform/country) apply to every query; the time
// range is applied per-metric because "users in range" keys off last_seen_at
// while "sessions in range" keys off started_at.
function buildDimensionClause(filters: StatsFilters): FilterClause {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filters.version) {
    conditions.push(`${VERSION_SQL} = ?`);
    bindings.push(filters.version);
  }
  if (filters.platform) {
    conditions.push(`platform = ?`);
    bindings.push(filters.platform);
  }
  if (filters.country) {
    conditions.push(`client_country = ?`);
    bindings.push(filters.country);
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    bindings,
  };
}

function rangeCutoffIso(filters: StatsFilters): string {
  const days = filters.rangeDays ?? 3650;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function loadStats(env: RuntimeEnv, filters: StatsFilters): Promise<StatsPayload> {
  const db = env.DB;
  if (!db) {
    throw new Error("Stats require the D1 storage backend.");
  }

  await ensureTelemetrySchema(db);

  const dim = buildDimensionClause(filters);
  const cutoff = rangeCutoffIso(filters);
  const and = dim.sql ? " AND " : " WHERE ";

  const [totals, rangeTotals, errorTotals, rpc, sessionsPerDay, newUsersPerDay, errorsPerDay, versionsAllTime, versionsCurrent, platforms, countries, featureRows, counters, versionOptions, platformOptions, countryOptions] =
    await Promise.all([
      db
        .prepare(
          `SELECT
             COUNT(*) AS lifetimeSessions,
             COUNT(DISTINCT ${IDENTITY_SQL}) AS lifetimeUsers,
             SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS activeNow,
             SUM(CASE WHEN is_active = 1 AND rpc_enabled = 1 THEN 1 ELSE 0 END) AS rpcLiveNow
           FROM app_sessions ${dim.sql}`
        )
        .bind(...dim.bindings)
        .first<Record<string, number | string | null>>(),
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS sessionsInRange,
             COUNT(DISTINCT CASE WHEN last_seen_at >= ? THEN ${IDENTITY_SQL} END) AS usersInRange,
             AVG(CASE WHEN started_at >= ? AND duration_seconds BETWEEN 1 AND ${MAX_PLAUSIBLE_DURATION_SECONDS}
                      AND session_id NOT LIKE 'install:%' THEN duration_seconds END) AS averageSessionDurationSeconds
           FROM app_sessions ${dim.sql}`
        )
        // The three cutoff placeholders live in the SELECT clause, BEFORE the dimension
        // filters in WHERE — bind order must match the SQL text order.
        .bind(cutoff, cutoff, cutoff, ...dim.bindings)
        .first<Record<string, number | string | null>>(),
      // Errors come from the events table (90-day retention), not from summing session
      // error_count — that would re-count a long-lived session's lifetime errors in
      // every range it is merely seen in. Background errors are excluded like elsewhere.
      db
        .prepare(
          `SELECT COUNT(*) AS errorsInRange
           FROM telemetry_events
           WHERE service = 'app_error' AND ts >= ?
             AND COALESCE(json_extract(metrics_json, '$.error_kind'), '') != 'background'`
        )
        .bind(cutoff)
        .first<{ errorsInRange: number | string | null }>(),
      db
        .prepare(
          `WITH ranked AS (
             SELECT ${IDENTITY_SQL} AS identity, rpc_enabled,
               ROW_NUMBER() OVER (PARTITION BY ${IDENTITY_SQL} ORDER BY last_seen_at DESC) AS rn
             FROM app_sessions ${dim.sql}
           )
           SELECT
             SUM(CASE WHEN rpc_enabled = 1 THEN 1 ELSE 0 END) AS rpcEnabledUsers,
             SUM(CASE WHEN rpc_enabled IS NOT NULL THEN 1 ELSE 0 END) AS rpcKnownUsers
           FROM ranked WHERE rn = 1`
        )
        .bind(...dim.bindings)
        .first<Record<string, number | string | null>>(),
      db
        .prepare(
          `SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS sessions, COUNT(DISTINCT ${IDENTITY_SQL}) AS users
           FROM app_sessions ${dim.sql}${and}started_at >= ?
           GROUP BY day ORDER BY day`
        )
        .bind(...dim.bindings, cutoff)
        .all<{ day: string; sessions: number; users: number }>(),
      db
        .prepare(
          `SELECT day, COUNT(*) AS users FROM (
             SELECT ${IDENTITY_SQL} AS identity, substr(MIN(started_at), 1, 10) AS day
             FROM app_sessions ${dim.sql}
             GROUP BY identity
           ) WHERE day >= substr(?, 1, 10)
           GROUP BY day ORDER BY day`
        )
        .bind(...dim.bindings, cutoff)
        .all<{ day: string; users: number }>(),
      db
        .prepare(
          `SELECT substr(ts, 1, 10) AS day, COUNT(*) AS errors
           FROM telemetry_events
           WHERE service = 'app_error' AND ts >= ?
             AND COALESCE(json_extract(metrics_json, '$.error_kind'), '') != 'background'
           GROUP BY day ORDER BY day`
        )
        .bind(cutoff)
        .all<{ day: string; errors: number }>(),
      db
        .prepare(
          `SELECT ${VERSION_SQL} AS version,
             COUNT(DISTINCT ${IDENTITY_SQL}) AS users,
             COUNT(*) AS sessions,
             substr(MIN(started_at), 1, 10) AS firstSeen,
             substr(MAX(last_seen_at), 1, 10) AS lastSeen
           FROM app_sessions ${dim.sql}
           GROUP BY version ORDER BY firstSeen`
        )
        .bind(...dim.bindings)
        .all<{ version: string; users: number; sessions: number; firstSeen: string | null; lastSeen: string | null }>(),
      db
        .prepare(
          `WITH ranked AS (
             SELECT ${IDENTITY_SQL} AS identity, ${VERSION_SQL} AS version, is_active,
               ROW_NUMBER() OVER (PARTITION BY ${IDENTITY_SQL} ORDER BY last_seen_at DESC) AS rn
             FROM app_sessions ${dim.sql}
           )
           SELECT version, COUNT(*) AS users, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS activeUsers
           FROM ranked WHERE rn = 1
           GROUP BY version ORDER BY users DESC`
        )
        .bind(...dim.bindings)
        .all<{ version: string; users: number; activeUsers: number }>(),
      db
        .prepare(
          `SELECT COALESCE(platform, 'unknown') AS key, COUNT(DISTINCT ${IDENTITY_SQL}) AS users, COUNT(*) AS sessions
           FROM app_sessions ${dim.sql}
           GROUP BY key ORDER BY users DESC`
        )
        .bind(...dim.bindings)
        .all<{ key: string; users: number; sessions: number }>(),
      db
        .prepare(
          `SELECT COALESCE(client_country, 'unknown') AS key, COUNT(DISTINCT ${IDENTITY_SQL}) AS users, COUNT(*) AS sessions
           FROM app_sessions ${dim.sql}
           GROUP BY key ORDER BY users DESC`
        )
        .bind(...dim.bindings)
        .all<{ key: string; users: number; sessions: number }>(),
      db
        .prepare(
          `SELECT ${IDENTITY_SQL} AS identity, features_json
           FROM app_sessions
           ${dim.sql}${and}features_json IS NOT NULL`
        )
        .bind(...dim.bindings)
        .all<{ identity: string; features_json: string }>(),
      db
        .prepare(`SELECT counter_key, counter_value FROM telemetry_counters ORDER BY counter_value DESC`)
        .all<{ counter_key: string; counter_value: number | string }>(),
      // Filter-dropdown options are deliberately UNFILTERED so picking one value never
      // hides its alternatives.
      db
        .prepare(`SELECT DISTINCT ${VERSION_SQL} AS value FROM app_sessions ORDER BY value`)
        .all<{ value: string }>(),
      db
        .prepare(`SELECT DISTINCT platform AS value FROM app_sessions WHERE platform IS NOT NULL ORDER BY value`)
        .all<{ value: string }>(),
      db
        .prepare(`SELECT DISTINCT client_country AS value FROM app_sessions WHERE client_country IS NOT NULL ORDER BY value`)
        .all<{ value: string }>(),
    ]);

  const eventsLifetime = counters.results
    .filter((row) => row.counter_key.startsWith("events:"))
    .map((row) => ({ service: row.counter_key.slice("events:".length), count: toNumber(row.counter_value) }));
  const lifetimeEvents = toNumber(counters.results.find((row) => row.counter_key === "events_total")?.counter_value);

  return {
    generatedAt: nowIso(),
    filters,
    totals: {
      lifetimeUsers: toNumber(totals?.lifetimeUsers),
      lifetimeSessions: toNumber(totals?.lifetimeSessions),
      lifetimeEvents,
      usersInRange: toNumber(rangeTotals?.usersInRange),
      sessionsInRange: toNumber(rangeTotals?.sessionsInRange),
      newUsersInRange: newUsersPerDay.results.reduce((sum, row) => sum + toNumber(row.users), 0),
      activeNow: toNumber(totals?.activeNow),
      rpcLiveNow: toNumber(totals?.rpcLiveNow),
      rpcEnabledUsers: toNumber(rpc?.rpcEnabledUsers),
      rpcKnownUsers: toNumber(rpc?.rpcKnownUsers),
      averageSessionDurationSeconds: Math.round(toNumber(rangeTotals?.averageSessionDurationSeconds)),
      errorsInRange: toNumber(errorTotals?.errorsInRange),
    },
    series: {
      sessionsPerDay: zeroFillDays(
        sessionsPerDay.results.map((row) => ({ day: row.day, sessions: toNumber(row.sessions), users: toNumber(row.users) })),
        cutoff,
        { sessions: 0, users: 0 }
      ),
      newUsersPerDay: zeroFillDays(
        newUsersPerDay.results.map((row) => ({ day: row.day, users: toNumber(row.users) })),
        cutoff,
        { users: 0 }
      ),
      errorsPerDay: zeroFillDays(
        errorsPerDay.results.map((row) => ({ day: row.day, errors: toNumber(row.errors) })),
        cutoff,
        { errors: 0 }
      ),
    },
    breakdowns: {
      versionsAllTime: versionsAllTime.results.map((row) => ({
        version: row.version,
        users: toNumber(row.users),
        sessions: toNumber(row.sessions),
        firstSeen: row.firstSeen,
        lastSeen: row.lastSeen,
      })),
      versionsCurrent: versionsCurrent.results.map((row) => ({
        version: row.version,
        users: toNumber(row.users),
        activeUsers: toNumber(row.activeUsers),
      })),
      platforms: platforms.results.map((row) => ({ key: row.key, users: toNumber(row.users), sessions: toNumber(row.sessions) })),
      countries: countries.results.map((row) => ({ key: row.key, users: toNumber(row.users), sessions: toNumber(row.sessions) })),
      features: aggregateFeatures(featureRows.results),
      eventsLifetime,
    },
    options: {
      versions: versionOptions.results.map((row) => row.value),
      platforms: platformOptions.results.map((row) => row.value),
      countries: countryOptions.results.map((row) => row.value),
    },
  };
}

/**
 * Fill calendar gaps with zero rows so charts keep a uniform time axis. Starts at the
 * later of the range cutoff and the first data day (so "all" doesn't render months of
 * empty lead-in), and always extends to today (UTC).
 */
function zeroFillDays<T extends { day: string }>(rows: T[], cutoffIso: string, zero: Omit<T, "day">): T[] {
  if (rows.length === 0) {
    return rows;
  }

  const today = new Date().toISOString().slice(0, 10);
  const cutoffDay = cutoffIso.slice(0, 10);
  const start = rows[0].day > cutoffDay ? rows[0].day : cutoffDay;
  if (start > today) {
    return rows;
  }

  const byDay = new Map(rows.map((row) => [row.day, row]));
  const filled: T[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  // Hard bound (~10 years) against malformed day strings producing endless loops.
  for (let i = 0; cursor <= end && i < 3700; i += 1, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    filled.push(byDay.get(day) ?? ({ day, ...zero } as T));
  }

  return filled;
}

function aggregateFeatures(rows: Array<{ identity: string; features_json: string }>): Array<{ feature: string; count: number; users: number }> {
  const counts = new Map<string, { count: number; users: Set<string> }>();

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.features_json);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }

    for (const [feature, value] of Object.entries(parsed as Record<string, unknown>)) {
      const count = toNumber(value);
      if (count <= 0) {
        continue;
      }
      const entry = counts.get(feature) ?? { count: 0, users: new Set<string>() };
      entry.count += count;
      entry.users.add(row.identity);
      counts.set(feature, entry);
    }
  }

  return [...counts.entries()]
    .map(([feature, entry]) => ({ feature, count: entry.count, users: entry.users.size }))
    .sort((left, right) => right.count - left.count);
}

interface UserRollupRow {
  identity: string;
  first_seen: string;
  last_seen: string;
  sessions: number | string;
  total_duration_seconds: number | string | null;
  errors: number | string | null;
  is_active: number | string | null;
  user_label: string | null;
  app_version: string | null;
  display_version: string | null;
  platform: string | null;
  os_version: string | null;
  device_model: string | null;
  client_country: string | null;
  client_city: string | null;
  client_timezone: string | null;
  client_latitude: number | string | null;
  client_longitude: number | string | null;
  rpc_enabled: number | string | null;
  discord_user: string | null;
  last_status: TelemetryStatus | null;
  last_event: string | null;
  hwid: string | null;
}

export async function loadUsersRollup(env: RuntimeEnv, filters: StatsFilters): Promise<UserRollupRecord[]> {
  const db = env.DB;
  if (!db) {
    throw new Error("User rollups require the D1 storage backend.");
  }

  await ensureTelemetrySchema(db);

  const dim = buildDimensionClause(filters);

  const [rollups, featureRows, errorEvents, premiumHwidsRow] = await Promise.all([
    db
      .prepare(
        `WITH base AS (
           SELECT *, ${IDENTITY_SQL} AS identity FROM app_sessions ${dim.sql}
         ), ranked AS (
           SELECT identity, user_label, app_version, display_version, platform, os_version, device_model, hwid,
             client_country, client_city, client_timezone, client_latitude, client_longitude, rpc_enabled, discord_user, last_status, last_event,
             ROW_NUMBER() OVER (PARTITION BY identity ORDER BY last_seen_at DESC) AS rn
           FROM base
         ), agg AS (
           SELECT identity,
             MIN(started_at) AS first_seen,
             MAX(last_seen_at) AS last_seen,
             COUNT(*) AS sessions,
             SUM(CASE WHEN session_id NOT LIKE 'install:%' AND duration_seconds BETWEEN 1 AND ${MAX_PLAUSIBLE_DURATION_SECONDS}
                 THEN duration_seconds ELSE 0 END) AS total_duration_seconds,
             SUM(error_count) AS errors,
             MAX(is_active) AS is_active
           FROM base GROUP BY identity
         )
         SELECT agg.identity, agg.first_seen, agg.last_seen, agg.sessions, agg.total_duration_seconds, agg.errors, agg.is_active,
           r.user_label, r.app_version, r.display_version, r.platform, r.os_version, r.device_model, r.hwid,
           r.client_country, r.client_city, r.client_timezone, r.client_latitude, r.client_longitude, r.rpc_enabled, r.discord_user, r.last_status, r.last_event
         FROM agg JOIN ranked r ON r.identity = agg.identity AND r.rn = 1
         ORDER BY agg.last_seen DESC`
      )
      .bind(...dim.bindings)
      .all<UserRollupRow>(),
    db
      .prepare(
        `SELECT ${IDENTITY_SQL} AS identity, features_json
         FROM app_sessions
         ${dim.sql}${dim.sql ? " AND " : " WHERE "}features_json IS NOT NULL`
      )
      .bind(...dim.bindings)
      .all<{ identity: string; features_json: string }>(),
    // Recent error events for per-user troubleshooting (90-day retained window).
    db
      .prepare(
        `SELECT ts, message, metrics_json
         FROM telemetry_events
         WHERE service = 'app_error'
           AND COALESCE(json_extract(metrics_json, '$.error_kind'), '') != 'background'
         ORDER BY id DESC
         LIMIT 400`
      )
      .all<{ ts: string; message: string | null; metrics_json: string | null }>(),
    db
      .prepare(`SELECT hwid FROM licenses WHERE hwid IS NOT NULL AND status = 'active'`)
      .all<{ hwid: string }>(),
  ]);

  const premiumHwids = new Set(premiumHwidsRow.results.map((r) => r.hwid));

  const featuresByIdentity = new Map<string, Record<string, number>>();
  for (const row of featureRows.results) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.features_json);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }

    const merged = featuresByIdentity.get(row.identity) ?? {};
    for (const [feature, value] of Object.entries(parsed as Record<string, unknown>)) {
      const count = toNumber(value);
      if (count > 0) {
        merged[feature] = (merged[feature] ?? 0) + count;
      }
    }
    featuresByIdentity.set(row.identity, merged);
  }

  // Group recent errors under the same identity key the rollup uses
  // (hwid when the event carries one, else install_id).
  const errorsByIdentity = new Map<string, UserErrorRecord[]>();
  for (const event of errorEvents.results) {
    let metrics: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(event.metrics_json ?? "{}") as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        metrics = parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable metrics; attribute by nothing.
    }
    const hwid = typeof metrics.hwid === "string" ? metrics.hwid.trim() : "";
    const installId = typeof metrics.install_id === "string" ? metrics.install_id.trim() : "";
    const identity = hwid || installId;
    if (!identity) {
      continue;
    }
    const list = errorsByIdentity.get(identity) ?? [];
    if (list.length < 5) {
      list.push({
        timestamp: event.ts,
        message: event.message,
        type: typeof metrics.exception_type === "string" ? metrics.exception_type : null,
      });
    }
    errorsByIdentity.set(identity, list);
  }

  return rollups.results.map((row) => ({
    identity: row.identity,
    userLabel: row.user_label ?? null,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    sessions: toNumber(row.sessions),
    totalDurationSeconds: toNumber(row.total_duration_seconds),
    errors: toNumber(row.errors),
    isActive: toNumber(row.is_active) === 1,
    licenseTier: premiumHwids.has(row.identity) || (row.hwid && premiumHwids.has(row.hwid)) ? "premium" : "free",
    hwid: row.hwid ?? null,
    appVersion: row.app_version ?? null,
    displayVersion: row.display_version ?? normalizeDisplayVersion(row.app_version ?? null),
    platform: row.platform ?? null,
    osVersion: row.os_version ?? null,
    deviceModel: row.device_model ?? null,
    country: row.client_country ?? null,
    city: row.client_city ?? null,
    timezone: row.client_timezone ?? null,
    rpcEnabled: row.rpc_enabled === null || row.rpc_enabled === undefined ? null : toNumber(row.rpc_enabled) === 1,
    discordUser: row.discord_user ?? null,
    latitude: toNullableFloat(row.client_latitude),
    longitude: toNullableFloat(row.client_longitude),
    lastStatus: row.last_status ?? null,
    lastEvent: row.last_event ?? null,
    features: featuresByIdentity.get(row.identity) ?? {},
    recentErrors: errorsByIdentity.get(row.identity) ?? [],
  }));
}

function toNullableFloat(value: number | string | null): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}
