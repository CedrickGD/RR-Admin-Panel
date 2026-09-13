import { describe, expect, it } from "vitest";
import type { SystemContainer, SystemStatusPayload } from "../shared/system-status";
import { routePermissions } from "../shared/panel-policy";
import { SERVICE_ORDER, formatBytes, formatUptime, serviceRows } from "../src/utils/systemStatus";

const generatedAt = "2026-09-13T12:00:00.000Z";

function container(service: string, patch: Partial<SystemContainer> = {}): SystemContainer {
  return {
    service,
    name: `razorreaper-${service}-1`,
    state: "running",
    health: "healthy",
    startedAt: "2026-09-12T12:00:00.000Z",
    restartCount: 0,
    cpuPercent: 1.5,
    memoryBytes: 64 * 1024 * 1024,
    memoryLimitBytes: null,
    ...patch,
  };
}

function payload(patch: Partial<SystemStatusPayload> = {}): SystemStatusPayload {
  return {
    ok: true,
    generatedAt,
    overall: "ok",
    build: { commit: "abc1234", environment: "nas" },
    runtime: { node: "22.12.0", uptimeSeconds: 3600 },
    database: { reachable: true, latencyMs: 1 },
    events: null,
    storage: {
      databaseBytes: 333 * 1024 * 1024,
      walBytes: 4 * 1024 * 1024,
      diskFreeBytes: 2.5 * 1024 ** 4,
      diskTotalBytes: 3.6 * 1024 ** 4,
    },
    backup: { newestFile: "rr-20260913-0315.sqlite.gz", newestAt: generatedAt, ageSeconds: 60 },
    serverErrors: { last5Minutes: 0, last60Minutes: 2 },
    bot: { reachable: true, latencyMs: 12, uptimeSeconds: 600, clients: 0, watching: 1 },
    containers: [
      container("rr-api"),
      container("admin"),
      container("bot"),
      container("caddy", { health: "none" }),
      container("cloudflared", { health: "none" }),
      container("backup", { state: "exited", health: "none" }),
      container("docker-proxy", { health: "unhealthy" }),
    ],
    incidents: [],
    ...patch,
  };
}

describe("system health page model", () => {
  it("requires monitoring access for the health endpoints", () => {
    expect(routePermissions("/api/admin/health", "GET")).toEqual(["monitoring.read"]);
    expect(routePermissions("/api/admin/system", "GET")).toEqual(["monitoring.read"]);
  });

  it("lists every NAS service once, in page order", () => {
    expect(serviceRows(payload()).map((row) => row.key)).toEqual([...SERVICE_ORDER]);
  });

  it("maps Docker state and healthchecks to a status tone", () => {
    const rows = Object.fromEntries(serviceRows(payload()).map((row) => [row.key, row]));
    expect(rows["rr-api"]).toMatchObject({ tone: "ok", health: "Healthy" });
    expect(rows.caddy).toMatchObject({ tone: "ok", health: "Running" });
    expect(rows.backup).toMatchObject({ tone: "danger", health: "Exited" });
    expect(rows["docker-proxy"]).toMatchObject({ tone: "danger", health: "Unhealthy" });
    expect(rows.database.detail).toBe("333 MB · WAL 4.0 MB · 2.5 TB free");
    expect(rows.bot.detail).toBe("12 ms · watching 1");
    expect(rows["rr-api"].detail).toBe("2 server errors in 60 min");
  });

  it("shows no uptime for a container that is not running", () => {
    const rows = Object.fromEntries(serviceRows(payload()).map((row) => [row.key, row]));
    // Docker keeps the last StartedAt on a stopped container; rendering it would show an
    // "uptime" climbing on every refresh for a service that is down.
    expect(rows.backup).toMatchObject({ tone: "danger", health: "Exited", startedAt: null });
    expect(rows["rr-api"].startedAt).toBe("2026-09-12T12:00:00.000Z");
  });

  it("drops verified-green rows to unknown while the data is stale", () => {
    const rows = Object.fromEntries(
      serviceRows(payload(), { stale: true }).map((row) => [row.key, row]),
    );
    // The last refresh failed: nothing green is current any more, but a known failure still is.
    expect(rows["rr-api"]).toMatchObject({ tone: "unknown", health: "Healthy" });
    expect(rows.database).toMatchObject({ tone: "unknown", health: "Connected" });
    expect(rows.backup).toMatchObject({ tone: "danger", health: "Exited" });
    expect(rows["docker-proxy"]).toMatchObject({ tone: "danger", health: "Unhealthy" });
    expect(serviceRows(payload()).every((row) => row.tone !== "ok")).toBe(false);
  });

  it("marks a healthy bot container as unreachable when its health check fails", () => {
    const rows = serviceRows(
      payload({
        bot: {
          reachable: false,
          latencyMs: null,
          uptimeSeconds: null,
          clients: null,
          watching: null,
        },
      }),
    );
    expect(rows.find((row) => row.key === "bot")).toMatchObject({
      tone: "danger",
      health: "Unreachable",
    });
  });

  it("degrades per row when container data is missing instead of guessing", () => {
    const rows = Object.fromEntries(
      serviceRows(payload({ containers: null, storage: null })).map((row) => [row.key, row]),
    );
    expect(rows["rr-api"]).toMatchObject({ tone: "ok", health: "Responding" });
    expect(rows["rr-api"].startedAt).toBe("2026-09-13T11:00:00.000Z");
    expect(rows.caddy).toMatchObject({ tone: "unknown", health: "Unknown" });
    expect(rows["docker-proxy"]).toMatchObject({ tone: "warning", health: "No response" });
    expect(rows.database.detail).toBe("File sizes not reported");
  });

  it("does not blame docker-proxy on a runtime that has no Docker at all", () => {
    const rows = Object.fromEntries(
      serviceRows(payload({ containers: null, sources: { containers: "not-configured" } })).map(
        (row) => [row.key, row],
      ),
    );
    expect(rows["docker-proxy"]).toMatchObject({ tone: "unknown", health: "Not on this runtime" });
  });

  it("formats byte counts compactly", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4.2 * 1024 * 1024)).toBe("4.2 MB");
    expect(formatBytes(105 * 1024 * 1024)).toBe("105 MB");
  });

  it("formats uptime in the largest units that still read at a glance", () => {
    expect(formatUptime(null)).toBe("—");
    expect(formatUptime(40 * 60)).toBe("40 min");
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe("5 h 12 min");
    expect(formatUptime(3 * 86400 + 4 * 3600)).toBe("3 d 4 h");
  });
});
