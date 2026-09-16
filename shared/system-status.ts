/**
 * Payload of GET /api/admin/system (System health page). Every section a data source feeds is
 * `null` when that source is not available on this runtime (Cloudflare Pages has no file system,
 * no bot and no Docker) or failed for this request, so the page can say which part is missing
 * instead of guessing.
 */

/**
 * How often the System health page asks rr-api for this payload. The container cache in
 * functions/_lib/container-health.ts is sized from it, so several open tabs cost one Docker
 * round per interval; tests/api/admin-system.test.ts pins that relation.
 */
export const SYSTEM_STATUS_POLL_MS = 30_000;

export type SystemOverall = "ok" | "degraded" | "critical";

export interface SystemEventBucket {
  /** ISO start of the five-minute bucket. */
  start: string;
  count: number;
}

export interface SystemEventRates {
  last5Minutes: number;
  last60Minutes: number;
  byService: Array<{ service: string; last5Minutes: number; last60Minutes: number }>;
  /** Twelve five-minute buckets, oldest first; the last one is the current, partial bucket. */
  buckets: SystemEventBucket[];
  /** Newest telemetry event or session heartbeat, whichever is later. */
  lastIngestAt: string | null;
}

export interface SystemStorage {
  databaseBytes: number | null;
  walBytes: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
}

export interface SystemBackup {
  newestFile: string | null;
  newestAt: string | null;
  ageSeconds: number | null;
  /**
   * True when the three figures come from the success marker backup.sh writes only after the
   * copy passed its integrity checks (deploy/nas/backup/backup.sh), so the age is the time since
   * the last verified backup. False when there is no marker and they come from the newest file
   * name and its mtime, which proves a file was written and nothing more. Optional: an older
   * rr-api build does not send it.
   */
  verified?: boolean;
}

export interface SystemBot {
  reachable: boolean;
  latencyMs: number | null;
  uptimeSeconds: number | null;
  clients: number | null;
  watching: number | null;
}

export type ContainerHealth = "healthy" | "unhealthy" | "starting" | "none";

export interface SystemContainer {
  /** Compose service name, e.g. "rr-api". */
  service: string;
  /** Docker container name without the leading slash, e.g. "razorreaper-rr-api-1". */
  name: string;
  /** Docker state: running, restarting, exited, paused, created, dead. */
  state: string;
  health: ContainerHealth;
  /**
   * Length of the current run as Docker words it in its own `Status` line: "3 minutes",
   * "12 days", "About an hour". It is rounded the way Docker rounds it, and it travels as that
   * phrase so the page can print it unchanged instead of turning a rounded figure into "1 h
   * 0 min". Null when the container is not running, or when the status line carries no duration.
   * There is no exact start time: that lives in inspect, which the NAS gateway refuses
   * (deploy/nas/docker-gateway/Caddyfile). Restart counts come from inspect too and are
   * therefore not part of this payload at all — the page shows "—" for them.
   */
  uptime: string | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
}

/**
 * Whether a source could be read on this request. `null` alone cannot say why a section is
 * missing, so a section that can both be absent and fail carries its state here:
 * - "ok": the source answered.
 * - "unavailable": the source is configured for this runtime and the call to it failed (the
 *   container list is fetched from docker-gateway, so a failure there could be the gateway,
 *   docker-proxy behind it, the socket or the network — the caller cannot tell, and says so).
 *   A missing section must not read as "nothing is wrong".
 * - "not-configured": this runtime has no such source at all (Cloudflare Pages has no Docker).
 */
export type SystemSourceState = "ok" | "unavailable" | "not-configured";

export interface SystemSources {
  containers: SystemSourceState;
}

export type IncidentSeverity = "warning" | "critical";

export interface SystemIncident {
  id: string;
  severity: IncidentSeverity;
  /** Service the incident belongs to, matching a row on the page. */
  service: string;
  title: string;
  detail: string;
}

export interface SystemStatusPayload {
  ok: true;
  generatedAt: string;
  overall: SystemOverall;
  build: { commit: string; environment: string };
  runtime: { node: string | null; uptimeSeconds: number | null };
  database: { reachable: boolean; latencyMs: number | null };
  events: SystemEventRates | null;
  storage: SystemStorage | null;
  backup: SystemBackup | null;
  /** 5xx responses served by this rr-api process; resets when the process restarts. */
  serverErrors: { last5Minutes: number; last60Minutes: number } | null;
  bot: SystemBot | null;
  containers: SystemContainer[] | null;
  /** Why a nullable section is missing. Optional: an older rr-api build does not send it. */
  sources?: SystemSources;
  incidents: SystemIncident[];
}
