import type {
  SystemBackup,
  SystemBot,
  SystemContainer,
  SystemEventRates,
  SystemIncident,
  SystemOverall,
  SystemSourceState,
  SystemSources,
  SystemStatusPayload,
} from "../../shared/system-status";
import { loadBotHealth, type FetchLike } from "./bot-health";
import { loadContainers } from "./container-health";
import { serverErrorCounts } from "./http-error-ring";
import { nodeVersion, processUptimeSeconds } from "./runtime";
import { loadBackup, loadStorage, nodeSystemFs, type SystemFs } from "./system-adapter";
import type { D1Database, RuntimeEnv } from "./types";

const MINUTE_MS = 60 * 1000;
const BUCKET_MS = 5 * MINUTE_MS;
const BUCKET_COUNT = 12;

/** Incident thresholds (handoff 2026-09-12 §2.11). */
export const BACKUP_MAX_AGE_SECONDS = 26 * 60 * 60;
export const INGEST_STALL_MS = 15 * MINUTE_MS;

export interface SystemStatusDeps {
  now?: () => number;
  fetch?: FetchLike;
  fs?: SystemFs | null;
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

/**
 * Event rates for the last 5 and 60 minutes plus twelve five-minute buckets. Every cutoff is
 * computed here and bound as a parameter (never datetime('now')), so the query uses the ts index
 * and a test clock controls the window.
 */
export async function loadEventRates(db: D1Database, now: number): Promise<SystemEventRates> {
  const cutoff5 = new Date(now - 5 * MINUTE_MS).toISOString();
  const cutoff60 = new Date(now - 60 * MINUTE_MS).toISOString();
  // Buckets align to wall-clock five-minute marks; the newest one is still filling.
  const windowStartMs = Math.floor(now / BUCKET_MS) * BUCKET_MS - (BUCKET_COUNT - 1) * BUCKET_MS;
  const windowStart = new Date(windowStartMs).toISOString();

  const [services, buckets, lastEvent, lastSession] = await Promise.all([
    db
      .prepare(
        `SELECT service,
                SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS last5,
                COUNT(*) AS last60
           FROM telemetry_events
          WHERE ts >= ?
          GROUP BY service
          ORDER BY last60 DESC, service ASC`,
      )
      .bind(cutoff5, cutoff60)
      .all<{ service: string; last5: number | string; last60: number | string }>(),
    db
      .prepare(
        // Whole seconds, integer division: exact at bucket edges (julianday floats are not).
        `SELECT (CAST(strftime('%s', ts) AS INTEGER) - CAST(strftime('%s', ?) AS INTEGER)) / 300 AS bucket,
                COUNT(*) AS count
           FROM telemetry_events
          WHERE ts >= ?
          GROUP BY bucket`,
      )
      .bind(windowStart, windowStart)
      .all<{ bucket: number | string; count: number | string }>(),
    db
      .prepare("SELECT MAX(ts) AS lastIngestAt FROM telemetry_events")
      .first<{ lastIngestAt: string | null }>(),
    db
      .prepare("SELECT MAX(last_seen_at) AS lastSeenAt FROM app_sessions")
      .first<{ lastSeenAt: string | null }>()
      .catch(() => null),
  ]);

  const byService = (services.results ?? []).map((row) => ({
    service: row.service,
    last5Minutes: toCount(row.last5),
    last60Minutes: toCount(row.last60),
  }));
  const counts = new Array<number>(BUCKET_COUNT).fill(0);
  for (const row of buckets.results ?? []) {
    const index = toCount(row.bucket);
    // Client clocks can stamp events in the future; those fall outside the window.
    if (index >= 0 && index < BUCKET_COUNT) counts[index] += toCount(row.count);
  }
  return {
    last5Minutes: byService.reduce((sum, row) => sum + row.last5Minutes, 0),
    last60Minutes: byService.reduce((sum, row) => sum + row.last60Minutes, 0),
    byService,
    buckets: counts.map((count, index) => ({
      start: new Date(windowStartMs + index * BUCKET_MS).toISOString(),
      count,
    })),
    lastIngestAt: latestIso(lastEvent?.lastIngestAt ?? null, lastSession?.lastSeenAt ?? null),
  };
}

async function probeDatabase(
  db: D1Database | undefined,
  clock: () => number,
): Promise<{ reachable: boolean; latencyMs: number | null }> {
  if (!db) return { reachable: false, latencyMs: null };
  const started = clock();
  try {
    await db.prepare("SELECT 1 AS ok").first();
    return { reachable: true, latencyMs: Math.max(0, Math.round(clock() - started)) };
  } catch {
    return { reachable: false, latencyMs: null };
  }
}

function hoursLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  return hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h`;
}

export interface IncidentInput {
  database: { reachable: boolean };
  events: SystemEventRates | null;
  backup: SystemBackup | null;
  bot: SystemBot | null;
  containers: SystemContainer[] | null;
  /** Why a null section is null. Omitted by callers that cannot tell the two apart. */
  sources?: SystemSources;
}

/**
 * Server-side incident rules. A source that is simply not part of this runtime raises nothing
 * (the page says so), but a source that IS configured and then failed raises a warning: an
 * unreadable container list must never be summarised as "every check passed".
 */
export function computeIncidents(input: IncidentInput, now: number): SystemIncident[] {
  const incidents: SystemIncident[] = [];
  if (!input.database.reachable)
    incidents.push({
      id: "database-unreachable",
      severity: "critical",
      service: "database",
      title: "Database unreachable",
      detail: "A test read against the database failed.",
    });

  // Name the hop rr-api actually called, and nothing beyond it. The container list is fetched
  // from docker-gateway (compose: DOCKER_PROXY_URL=http://docker-gateway:2375); whether the
  // gateway, docker-proxy behind it or the socket itself failed is not something a failed call
  // can tell apart, so the incident reports the call and leaves the cause to the operator.
  if (input.sources?.containers === "unavailable")
    incidents.push({
      id: "containers-unavailable",
      severity: "warning",
      service: "docker-gateway",
      title: "Container data unavailable",
      detail:
        "The call to docker-gateway did not answer, so no container could be checked on this refresh.",
    });

  for (const container of input.containers ?? []) {
    if (container.state !== "running") {
      incidents.push({
        id: `container-down-${container.service}`,
        severity: "critical",
        service: container.service,
        title: `${container.service} is not running`,
        detail: `Docker reports the container as ${container.state}.`,
      });
      continue;
    }
    if (container.health === "unhealthy")
      incidents.push({
        id: `container-unhealthy-${container.service}`,
        severity: "critical",
        service: container.service,
        title: `${container.service} is unhealthy`,
        detail: "The container healthcheck is failing.",
      });
    // There used to be a "restarted recently" warning here. It needed RestartCount and
    // State.StartedAt, both of which only Docker inspect reports, and the gateway refuses inspect
    // for every container (deploy/nas/docker-gateway/Caddyfile). A short uptime on its own does
    // not mean a restart — a deploy looks identical — so nothing is raised in its place rather
    // than raising a guess. A container that is down or unhealthy right now still raises above.
  }

  if (input.bot && !input.bot.reachable)
    incidents.push({
      id: "bot-unreachable",
      severity: "critical",
      service: "bot",
      title: "Discord bot unreachable",
      detail: "The bot did not answer its health check within 1.5 s.",
    });

  if (input.backup) {
    if (input.backup.newestFile === null)
      incidents.push({
        id: "backup-missing",
        severity: "critical",
        service: "backup",
        title: "No backup found",
        detail: "The backup folder holds no nightly database backup.",
      });
    else if (input.backup.ageSeconds !== null && input.backup.ageSeconds > BACKUP_MAX_AGE_SECONDS)
      incidents.push({
        id: "backup-stale",
        severity: "warning",
        service: "backup",
        title: "Backup is overdue",
        detail: `The newest backup is ${hoursLabel(input.backup.ageSeconds)} old; one runs every night.`,
      });
  }

  if (input.events) {
    const last = Date.parse(input.events.lastIngestAt ?? "");
    if (!Number.isFinite(last) || now - last > INGEST_STALL_MS)
      incidents.push({
        id: "ingest-stalled",
        severity: "warning",
        service: "rr-api",
        title: "No incoming telemetry",
        detail: Number.isFinite(last)
          ? `No event or heartbeat for ${Math.round((now - last) / MINUTE_MS)} min. Quiet hours can cause this too.`
          : "No event or heartbeat has been stored yet.",
      });
  }
  return incidents;
}

export function overallFrom(incidents: readonly SystemIncident[]): SystemOverall {
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  return incidents.length > 0 ? "degraded" : "ok";
}

function settled<T>(result: PromiseSettledResult<T | null>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

/** Rejected = configured but broken; null = this runtime has no such source at all. */
function sourceState<T>(result: PromiseSettledResult<T | null>): SystemSourceState {
  if (result.status === "rejected") return "unavailable";
  return result.value === null ? "not-configured" : "ok";
}

/** Builds the whole payload; every source is independent, so one failing never blanks the rest. */
export async function buildSystemStatus(
  env: RuntimeEnv,
  deps: SystemStatusDeps = {},
): Promise<SystemStatusPayload> {
  const clock = deps.now ?? Date.now;
  const fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const fs = deps.fs === undefined ? nodeSystemFs() : deps.fs;
  const now = clock();

  const [database, events, storage, backup, bot, containers] = await Promise.allSettled([
    probeDatabase(env.DB, clock),
    env.DB ? loadEventRates(env.DB, now) : Promise.resolve(null),
    loadStorage(env, fs),
    loadBackup(env, fs, now),
    loadBotHealth(env, fetchFn, clock),
    loadContainers(env, fetchFn, clock),
  ]);

  const sources: SystemSources = { containers: sourceState(containers) };
  const parts: IncidentInput = {
    database: settled(database) ?? { reachable: false },
    events: settled(events),
    backup: settled(backup),
    bot: settled(bot),
    containers: settled(containers),
    sources,
  };
  const incidents = computeIncidents(parts, now);
  return {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    overall: overallFrom(incidents),
    build: {
      commit: env.BUILD_SHA?.trim() || env.CF_PAGES_COMMIT_SHA || "unknown",
      environment: env.CF_PAGES ? "pages" : nodeVersion() ? "nas" : "local",
    },
    runtime: { node: nodeVersion(), uptimeSeconds: processUptimeSeconds() },
    database: settled(database) ?? { reachable: false, latencyMs: null },
    events: parts.events,
    storage: settled(storage),
    backup: parts.backup,
    serverErrors: serverErrorCounts(now),
    bot: parts.bot,
    containers: parts.containers,
    sources,
    incidents,
  };
}
