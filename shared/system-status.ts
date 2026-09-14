/**
 * Payload of GET /api/admin/system (System health page). Every section a data source feeds is
 * `null` when that source is not available on this runtime (Cloudflare Pages has no file system,
 * no bot and no Docker) or failed for this request, so the page can say which part is missing
 * instead of guessing.
 */

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
  /** Null when Docker inspect is not readable for this container (docker-gateway allowlist). */
  startedAt: string | null;
  /** Null for the same reason — "not reported", never a stand-in 0. */
  restartCount: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
}

/**
 * Whether a source could be read on this request. `null` alone cannot say why a section is
 * missing, so a section that can both be absent and fail carries its state here:
 * - "ok": the source answered.
 * - "unavailable": the source is configured for this runtime but failed (docker-proxy stopped,
 *   internal network broken), so a missing section must not read as "nothing is wrong".
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
