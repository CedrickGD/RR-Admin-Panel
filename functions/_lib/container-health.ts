import {
  SYSTEM_STATUS_POLL_MS,
  type ContainerHealth,
  type SystemContainer,
} from "../../shared/system-status";
import type { FetchLike } from "./bot-health";
import { isNodeRuntime } from "./runtime";
import type { RuntimeEnv } from "./types";

/**
 * Container state through the docker-gateway sidecar (compose service `docker-gateway`, a Caddy
 * path allowlist in front of docker-socket-proxy). The gateway allows two GET shapes and nothing
 * else: the project container list, and one-shot stats. Inspect is refused for every container,
 * because `GET /containers/<name>/json` returns Config.Env — and admin.env holds ORIGIN_KEY,
 * rr-api.env holds the ingest tokens and JWT_SECRET, bot.env holds the Discord token — plus
 * HostConfig and Mounts. So this module never asks for it: state, the healthcheck verdict and an
 * approximate uptime all come out of the list entry, and RestartCount is not collected at all.
 * Containers are addressed by name, not id, because the allowlist matches on the name.
 * Results are cached per module for CACHE_TTL_MS, one poll interval of the System health page:
 * every tab that polls inside the same interval is served the same sample, so several open tabs
 * cost one Docker round per interval instead of one each, and a sample is never served older
 * than the interval the page promises. The TTL must not drop below the poll interval again — at
 * 15 s no 30 s poll ever hit the cache, and every poll paid a full `stats?stream=false` round,
 * about a second per container on the NAS. A test pins the relation.
 */
export const DEFAULT_DOCKER_PROXY_URL = "http://docker-gateway:2375";
export const CACHE_TTL_MS = SYSTEM_STATUS_POLL_MS;
const REQUEST_TIMEOUT_MS = 4_000;
/** Compose project name from deploy/nas/compose.yml (`name: razorreaper`). */
const PROJECT_PREFIX = "razorreaper-";

let cache: { key: string; at: number; value: SystemContainer[] } | null = null;

/** Test seam. */
export function resetContainerCache(): void {
  cache = null;
}

/** Only this project's containers; the NAS also runs unrelated ones (e.g. homeassistant-app). */
export function isProjectContainer(name: string): boolean {
  return name.replace(/^\//, "").startsWith(PROJECT_PREFIX);
}

/** "razorreaper-rr-api-1" -> "rr-api" when the compose label is missing. */
export function serviceFromName(name: string): string {
  return name.replace(/^\//, "").slice(PROJECT_PREFIX.length).replace(/-\d+$/, "");
}

interface DockerListItem {
  Id: string;
  Names?: string[];
  State?: string;
  /** Human summary, e.g. "Up 3 minutes (healthy)" — the only health source without inspect. */
  Status?: string;
  Labels?: Record<string, string>;
}

interface DockerStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: { inactive_file?: number; cache?: number };
  };
}

async function getJson<T>(fetchFn: FetchLike, url: string): Promise<T> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`docker proxy ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Healthcheck verdict out of the list entry's `Status` string. The gateway refuses inspect for
 * every container, so the list is the only source, and Docker writes the verdict there in a
 * fixed form: "Up 3 minutes (healthy)" / "(unhealthy)" / "(health: starting)".
 */
export function healthFromStatus(status: string | undefined): ContainerHealth {
  if (!status) return "none";
  if (status.includes("(healthy)")) return "healthy";
  if (status.includes("(unhealthy)")) return "unhealthy";
  if (status.includes("(health: starting)")) return "starting";
  return "none";
}

/** The durations go-units writes into `Status`: "3 minutes", "12 days", "About an hour". */
const UPTIME_PHRASE = /^\d+ (second|minute|hour|day|week|month|year)s?$/;
const UPTIME_APPROXIMATE = ["Less than a second", "About a minute", "About an hour"];

/**
 * The length of the current run in Docker's own words, out of the same `Status` string — "Up 3
 * minutes (healthy)" gives "3 minutes". Without inspect there is no `State.StartedAt`, and this
 * rounded human duration (go-units) is what Docker offers instead: "About an hour" is anywhere
 * from 45 to 90 minutes. The phrase is passed on as written rather than converted to seconds,
 * because a seconds figure re-formatted for the column prints "1 h 0 min" and claims a precision
 * the source never had. Null for anything that is not "Up …" ("Exited (0) 5 minutes ago",
 * "Created", "Restarting (1) 2 seconds ago"): those have no current run to time. Null too for
 * wording this does not recognise, so an unexpected string shows as "—" and not as itself.
 */
export function uptimeFromStatus(status: string | undefined): string | null {
  // Drop the trailing "(healthy)" / "(health: starting)" / "(Paused)" note.
  const text = (status ?? "").trim().replace(/\s*\([^)]*\)\s*$/, "");
  if (!text.startsWith("Up ")) return null;
  const rest = text.slice(3).trim();
  if (UPTIME_APPROXIMATE.includes(rest)) return rest;
  return UPTIME_PHRASE.test(rest) ? rest : null;
}

/** `docker stats` CPU%: container CPU delta over host CPU delta, times online CPUs. */
export function cpuPercent(stats: DockerStats): number | null {
  const cpu = stats.cpu_stats;
  const pre = stats.precpu_stats;
  const cpuDelta = (cpu?.cpu_usage?.total_usage ?? 0) - (pre?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (cpu?.system_cpu_usage ?? 0) - (pre?.system_cpu_usage ?? 0);
  if (!cpu?.system_cpu_usage || !pre?.system_cpu_usage || systemDelta <= 0 || cpuDelta < 0)
    return null;
  const cpus = cpu.online_cpus ?? cpu.cpu_usage?.percpu_usage?.length ?? 1;
  return Math.round((cpuDelta / systemDelta) * cpus * 1000) / 10;
}

/** `docker stats` memory: usage minus page cache (cgroup v2 inactive_file, v1 cache). */
export function memoryBytes(stats: DockerStats): number | null {
  const memory = stats.memory_stats;
  if (typeof memory?.usage !== "number") return null;
  const cacheBytes = memory.stats?.inactive_file ?? memory.stats?.cache ?? 0;
  return Math.max(0, memory.usage - cacheBytes);
}

async function describeContainer(
  fetchFn: FetchLike,
  base: string,
  item: DockerListItem,
): Promise<SystemContainer> {
  const name = (item.Names?.[0] ?? item.Id).replace(/^\//, "");
  const running = item.State === "running";
  // Stats is the only per-container call the gateway still allows, and it is worth making only
  // for a running container: a stopped one has no CPU or memory to sample. A 403, a timeout or a
  // malformed body leaves the figures null, which the page prints as "—" rather than as zero.
  const stats = running
    ? await getJson<DockerStats>(fetchFn, `${base}/containers/${name}/stats?stream=false`).catch(
        () => null,
      )
    : null;
  return {
    service: item.Labels?.["com.docker.compose.service"] ?? serviceFromName(name),
    name,
    state: item.State ?? "unknown",
    health: healthFromStatus(item.Status),
    uptime: running ? uptimeFromStatus(item.Status) : null,
    cpuPercent: stats ? cpuPercent(stats) : null,
    memoryBytes: stats ? memoryBytes(stats) : null,
    memoryLimitBytes: stats?.memory_stats?.limit ?? null,
  };
}

/**
 * This project's containers, sorted by service name. Null when no proxy is configured for this
 * runtime; throws when the proxy is configured but the container list cannot be read.
 */
export async function loadContainers(
  env: RuntimeEnv,
  fetchFn: FetchLike,
  clock: () => number = Date.now,
): Promise<SystemContainer[] | null> {
  const configured =
    env.DOCKER_PROXY_URL?.trim() || (isNodeRuntime() ? DEFAULT_DOCKER_PROXY_URL : "");
  if (!configured) return null;
  const base = configured.replace(/\/$/, "");
  const now = clock();
  if (cache && cache.key === base && now - cache.at < CACHE_TTL_MS) return cache.value;

  const list = await getJson<DockerListItem[]>(fetchFn, `${base}/containers/json?all=1`);
  const project = list.filter((item) => (item.Names ?? []).some(isProjectContainer));
  const value = (
    await Promise.all(project.map((item) => describeContainer(fetchFn, base, item)))
  ).sort((a, b) => a.service.localeCompare(b.service));
  cache = { key: base, at: clock(), value };
  return value;
}
