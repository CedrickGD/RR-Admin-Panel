import type {
  SystemContainer,
  SystemOverall,
  SystemStatusPayload,
} from "../../shared/system-status";

export type ServiceTone = "ok" | "warning" | "danger" | "unknown";

export interface ServiceRow {
  key: string;
  tone: ServiceTone;
  health: string;
  /** One quiet line under the name: live figures where a source reports them, else the role. */
  detail: string;
  /**
   * Length of the CURRENT run, ready to print: Docker's own rounded phrase for a container row
   * ("12 days"), the measured process uptime for the rr-api row that has no container data.
   * Null while the container is not running, so uptime stays blank instead of counting up for a
   * service that is down. There is no Restarts figure on the row at all: see
   * RESTARTS_UNAVAILABLE in SystemStatusPage.
   */
  uptime: string | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
}

/** Every service the NAS runs, in the order the page lists them. */
export const SERVICE_ORDER = [
  "rr-api",
  "admin",
  "bot",
  "caddy",
  "cloudflared",
  "backup",
  "database",
  "docker-gateway",
  "docker-proxy",
] as const;

const SERVICE_ROLE: Record<string, string> = {
  "rr-api": "Backend API",
  admin: "Panel and API gateway",
  bot: "Discord bot",
  caddy: "Media and downloads",
  cloudflared: "Cloudflare tunnel",
  backup: "Nightly database backup",
  database: "SQLite database",
  "docker-gateway": "Docker allowlist for this page",
  "docker-proxy": "Read-only Docker access",
};

export const OVERALL_LABEL: Record<SystemOverall, string> = {
  ok: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
};

export const OVERALL_TONE: Record<SystemOverall, ServiceTone> = {
  ok: "ok",
  degraded: "warning",
  critical: "danger",
};

/** The shared status-dot classes (components.css): green, amber, red, grey. */
export function statusDotClass(tone: ServiceTone): string {
  if (tone === "warning") return "status-dot warn";
  if (tone === "danger") return "status-dot err";
  if (tone === "unknown") return "status-dot idle";
  return "status-dot";
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Process uptime, from a real second count: "40 min", "5 h 12 min", "3 d 4 h". Container rows do
 * not come through here — Docker reports those only as a rounded phrase, which the page prints as
 * it arrives (SystemContainer.uptime).
 */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return "—";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function containerState(container: SystemContainer): { tone: ServiceTone; health: string } {
  if (container.state !== "running") return { tone: "danger", health: capitalize(container.state) };
  if (container.health === "unhealthy") return { tone: "danger", health: "Unhealthy" };
  if (container.health === "starting") return { tone: "warning", health: "Starting" };
  // No healthcheck defined (caddy, cloudflared, backup): running is all Docker can say.
  return { tone: "ok", health: container.health === "healthy" ? "Healthy" : "Running" };
}

export interface ServiceRowOptions {
  /**
   * The payload on screen is the last one that loaded and the refresh after it failed. What was
   * green then is unverified now, so every "ok" row drops to the grey unknown dot and its health
   * word says "Last: …" instead; a row that was already warning or failing keeps both, because
   * that reading is still the latest news.
   */
  stale?: boolean;
}

/** One row per NAS service, merged from the container list, the bot probe and the database. */
export function serviceRows(
  payload: SystemStatusPayload,
  options: ServiceRowOptions = {},
): ServiceRow[] {
  const rows = SERVICE_ORDER.map((key): ServiceRow => {
    if (key === "database") {
      const storage = payload.storage;
      const sizes = storage
        ? [
            storage.databaseBytes !== null ? formatBytes(storage.databaseBytes) : null,
            storage.walBytes !== null ? `WAL ${formatBytes(storage.walBytes)}` : null,
            storage.diskFreeBytes !== null ? `${formatBytes(storage.diskFreeBytes)} free` : null,
          ].filter(Boolean)
        : [];
      return {
        key,
        tone: payload.database.reachable ? "ok" : "danger",
        health: payload.database.reachable ? "Connected" : "Unreachable",
        detail: sizes.length > 0 ? sizes.join(" · ") : "File sizes not reported",
        uptime: null,
        cpuPercent: null,
        memoryBytes: null,
      };
    }

    const container = payload.containers?.find((entry) => entry.service === key);
    const row: ServiceRow = {
      key,
      ...(container
        ? containerState(container)
        : {
            tone: "unknown" as const,
            health: payload.containers === null ? "Unknown" : "Not found",
          }),
      detail: SERVICE_ROLE[key],
      // Uptime belongs to a run that is happening: a container that is not running gets none,
      // however recently it was up. Docker's own phrase, printed as Docker rounded it.
      uptime: container?.state === "running" ? container.uptime : null,
      cpuPercent: container?.cpuPercent ?? null,
      memoryBytes: container?.memoryBytes ?? null,
    };

    if (key === "rr-api") {
      // This payload came from rr-api, so it is answering even without container data.
      if (!container) {
        row.tone = "ok";
        row.health = "Responding";
        // The process reports its own uptime, which is the closest thing to a container uptime
        // when the container list could not be read at all — and it is a measured second count,
        // so this is the one row whose uptime may carry a minutes figure.
        row.uptime =
          payload.runtime.uptimeSeconds === null
            ? null
            : formatUptime(payload.runtime.uptimeSeconds);
      }
      if (payload.serverErrors)
        row.detail = `${payload.serverErrors.last60Minutes} server errors in 60 min`;
    } else if (key === "bot") {
      if (payload.bot && !payload.bot.reachable) {
        row.tone = "danger";
        row.health = "Unreachable";
        row.detail = "No answer from its health check";
      } else if (payload.bot) {
        if (!container) {
          row.tone = "ok";
          row.health = "Responding";
        }
        row.detail = [
          payload.bot.latencyMs !== null ? `${payload.bot.latencyMs} ms` : null,
          payload.bot.watching !== null ? `watching ${payload.bot.watching}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
    } else if (key === "backup") {
      row.detail = payload.backup
        ? (payload.backup.newestFile ?? "No backup file yet")
        : "Backup folder not mounted";
    } else if (key === "docker-gateway" && payload.containers === null) {
      // The gateway is the hop rr-api calls, so its silence is the only thing rr-api observed.
      // docker-proxy sits behind it and keeps the grey "Unknown" every unreadable row gets: a
      // failed call cannot tell which of the two was at fault.
      const absent = payload.sources?.containers === "not-configured";
      row.tone = absent ? "unknown" : "warning";
      row.health = absent ? "Not on this runtime" : "No response";
      row.detail = "Container data unavailable";
    }
    return row;
  });

  if (!options.stale) return rows;
  // The dot and the word have to agree: a grey dot beside "Healthy" still reads as a verdict from
  // just now. "Last: Healthy" keeps the reading and drops the claim that it is current.
  return rows.map((row) =>
    row.tone === "ok" ? { ...row, tone: "unknown" as const, health: `Last: ${row.health}` } : row,
  );
}

/** "HH:MM" in the viewer's time zone for a bucket start. */
export function bucketLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : iso;
}
