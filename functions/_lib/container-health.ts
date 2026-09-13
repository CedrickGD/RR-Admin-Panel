import type { ContainerHealth, SystemContainer } from "../../shared/system-status";
import type { FetchLike } from "./bot-health";
import { isNodeRuntime } from "./runtime";
import type { RuntimeEnv } from "./types";

/**
 * Container state through the read-only docker-socket-proxy sidecar (compose service
 * `docker-proxy`, CONTAINERS=1 and POST=0): list, inspect and one-shot stats, never a write.
 * Results are cached per module for CACHE_TTL_MS so a page polling every 30 s from several tabs
 * costs one Docker round per window; `stats?stream=false` alone takes about a second.
 */
export const DEFAULT_DOCKER_PROXY_URL = "http://docker-proxy:2375";
export const CACHE_TTL_MS = 15_000;
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
  Labels?: Record<string, string>;
}

interface DockerInspect {
  RestartCount?: number;
  State?: { Status?: string; StartedAt?: string; Health?: { Status?: string } };
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

function toHealth(value: string | undefined): ContainerHealth {
  return value === "healthy" || value === "unhealthy" || value === "starting" ? value : "none";
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
  const [inspect, stats] = await Promise.all([
    getJson<DockerInspect>(fetchFn, `${base}/containers/${item.Id}/json`).catch(() => null),
    running
      ? getJson<DockerStats>(fetchFn, `${base}/containers/${item.Id}/stats?stream=false`).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);
  const startedAt = inspect?.State?.StartedAt;
  return {
    service: item.Labels?.["com.docker.compose.service"] ?? serviceFromName(name),
    name,
    state: inspect?.State?.Status ?? item.State ?? "unknown",
    health: toHealth(inspect?.State?.Health?.Status),
    // Docker reports "0001-01-01T00:00:00Z" for a container that never started.
    startedAt: startedAt && !startedAt.startsWith("0001-") ? startedAt : null,
    restartCount: inspect?.RestartCount ?? 0,
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
