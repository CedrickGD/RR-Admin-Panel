import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapSchemaIfEmpty, locateSchemaFile } from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { requireDashboardAccess } from "../../functions/_lib/admin";
import { createAppSessionToken, hashPassword } from "../../functions/_lib/auth";
import { loadBotHealth } from "../../functions/_lib/bot-health";
import {
  CACHE_TTL_MS,
  healthFromStatus,
  isProjectContainer,
  loadContainers,
  resetContainerCache,
  uptimeFromStatus,
} from "../../functions/_lib/container-health";
import {
  enableServerErrorRing,
  recordServerError,
  resetServerErrorRing,
  serverErrorCounts,
} from "../../functions/_lib/http-error-ring";
import {
  BACKUP_MARKER,
  loadBackup,
  loadStorage,
  parseBackupMarker,
  type SystemFs,
} from "../../functions/_lib/system-adapter";
import { SYSTEM_STATUS_POLL_MS } from "../../shared/system-status";
import {
  buildSystemStatus,
  computeIncidents,
  loadEventRates,
  overallFrom,
  type IncidentInput,
} from "../../functions/_lib/system-status";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import { onRequest as system } from "../../functions/api/admin/system";
import { onRequest as team } from "../../functions/api/admin/team";
import { createMockD1 } from "../helpers/mock-d1";

const NOW = Date.parse("2026-09-13T12:02:30.000Z");
const MB = 1024 * 1024;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const MINUTE = 60_000;

function fakeFs(options: {
  files?: Record<string, { size: number; mtimeMs: number }>;
  dirs?: Record<string, string[]>;
  /** Text files readable with readFile, e.g. the backup success marker. */
  texts?: Record<string, string>;
  disk?: { bsize: number; blocks: number; bavail: number } | null;
}): SystemFs {
  return {
    async stat(path) {
      const file = options.files?.[path];
      if (!file) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      return file;
    },
    async statfs() {
      if (!options.disk) throw new Error("statfs unsupported");
      return options.disk;
    },
    async readdir(path) {
      const entries = options.dirs?.[path];
      if (!entries) throw new Error(`ENOENT ${path}`);
      return entries;
    },
    async readFile(path) {
      const text = options.texts?.[path];
      if (text === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      return text;
    },
  };
}

type Routes = Record<string, unknown | (() => never)>;

/** Fake fetch keyed by exact URL; a function value throws (refused / timed out). */
function fakeFetch(routes: Routes) {
  return vi.fn(async (input: string, _init?: RequestInit) => {
    if (!(input in routes)) return Response.json({ message: "not found" }, { status: 404 });
    const value = routes[input];
    if (typeof value === "function") return (value as () => never)();
    return Response.json(value);
  });
}

function sqliteEnv(): { handle: SqliteDatabaseHandle; env: RuntimeEnv } {
  const handle = createInMemoryDatabase();
  bootstrapSchemaIfEmpty(
    handle,
    locateSchemaFile(fileURLToPath(new URL("../../schema.sql", import.meta.url))),
  );
  return { handle, env: { DB: createD1Database(handle) } };
}

async function insertEvent(env: RuntimeEnv, service: string, ts: string, n: number) {
  await env
    .DB!.prepare(
      `INSERT INTO telemetry_events (event_id, source, service, ts, status, received_at)
       VALUES (?, 'app', ?, ?, 'ok', ?)`,
    )
    .bind(`evt-${service}-${ts}-${n}`, service, ts, ts)
    .run();
}

describe("system adapter (file system)", () => {
  const fs = fakeFs({
    files: {
      "/data/db/rr.sqlite": { size: 333 * MB, mtimeMs: NOW },
      "/data/db/rr.sqlite-wal": { size: 4 * MB, mtimeMs: NOW },
      "/backups/rr-20260913-0315.sqlite.gz": { size: 35 * MB, mtimeMs: NOW - 2 * 3600_000 },
    },
    dirs: {
      "/backups": ["rr-20260911-0315.sqlite.gz", "rr-20260913-0315.sqlite.gz", "notes.txt"],
    },
    disk: { bsize: 4096, blocks: 1000, bavail: 250 },
  });

  it("reports DB, WAL and free disk, and null without a file system", async () => {
    expect(await loadStorage({}, fs)).toEqual({
      databaseBytes: 333 * MB,
      walBytes: 4 * MB,
      diskFreeBytes: 250 * 4096,
      diskTotalBytes: 1000 * 4096,
    });
    expect(await loadStorage({}, null)).toBeNull();
    expect(await loadStorage({ DB_PATH: "/missing/rr.sqlite" }, fakeFs({ disk: null }))).toBeNull();
  });

  it("picks the newest nightly backup by its stamp and ages it when there is no marker", async () => {
    // No .last-success in the folder: the newest file is all there is, and it is unverified.
    expect(await loadBackup({ BACKUP_DIR: "/backups" }, fs, NOW)).toEqual({
      newestFile: "rr-20260913-0315.sqlite.gz",
      newestAt: iso(-2 * 3600_000),
      ageSeconds: 7200,
      verified: false,
    });
    expect(await loadBackup({}, fs, NOW)).toBeNull();
    expect(await loadBackup({ BACKUP_DIR: "/unreadable" }, fs, NOW)).toBeNull();
    expect(
      await loadBackup({ BACKUP_DIR: "/empty" }, fakeFs({ dirs: { "/empty": [] } }), NOW),
    ).toEqual({ newestFile: null, newestAt: null, ageSeconds: null, verified: false });
  });

  it("reads the age from the success marker, not from the newest file", async () => {
    // Last night's file exists but the marker still names the night before: that run wrote a
    // file and never verified it (or died before the marker), so the verified age is 26 h.
    const withMarker = fakeFs({
      files: { "/backups/rr-20260913-0315.sqlite.gz": { size: 35 * MB, mtimeMs: NOW - 3600_000 } },
      dirs: { "/backups": ["rr-20260912-0315.sqlite.gz", "rr-20260913-0315.sqlite.gz"] },
      texts: {
        [`/backups/${BACKUP_MARKER}`]: `${iso(-26 * 3600_000)} rr-20260912-0315.sqlite.gz\n`,
      },
    });
    expect(await loadBackup({ BACKUP_DIR: "/backups" }, withMarker, NOW)).toEqual({
      newestFile: "rr-20260912-0315.sqlite.gz",
      newestAt: iso(-26 * 3600_000),
      ageSeconds: 26 * 3600,
      verified: true,
    });
    // The marker is enough on its own: no listing is needed, and a trailing slash is tolerated.
    expect(
      await loadBackup(
        { BACKUP_DIR: "/backups/" },
        fakeFs({
          texts: { "/backups/.last-success": "2026-09-13T03:15:42Z rr-20260913-0315.sqlite.gz" },
        }),
        NOW,
      ),
    ).toMatchObject({ newestFile: "rr-20260913-0315.sqlite.gz", verified: true });
  });

  it("ignores a marker it cannot read and falls back to the newest file, unverified", async () => {
    for (const text of [
      "",
      "seeded from rr-20260913-0315.sqlite.gz",
      "yesterday rr-20260913-0315.sqlite.gz",
      "2026-09-13T03:15:42Z notes.txt",
      "2026-09-13T03:15:42Z rr-20260913-0315.sqlite.gz extra",
    ]) {
      const broken = fakeFs({
        files: {
          "/backups/rr-20260913-0315.sqlite.gz": { size: 35 * MB, mtimeMs: NOW - 2 * 3600_000 },
        },
        dirs: { "/backups": ["rr-20260913-0315.sqlite.gz"] },
        texts: { "/backups/.last-success": text },
      });
      expect([text, await loadBackup({ BACKUP_DIR: "/backups" }, broken, NOW)]).toEqual([
        text,
        {
          newestFile: "rr-20260913-0315.sqlite.gz",
          newestAt: iso(-2 * 3600_000),
          ageSeconds: 7200,
          verified: false,
        },
      ]);
    }
  });

  it("parses exactly the line backup.sh writes: an ISO timestamp and a backup file name", () => {
    expect(parseBackupMarker("2026-09-13T03:15:42Z rr-20260913-0315.sqlite.gz\n")).toEqual({
      at: "2026-09-13T03:15:42.000Z",
      file: "rr-20260913-0315.sqlite.gz",
    });
    // Whitespace around and between the two tokens is tolerated; an uncompressed name too.
    expect(parseBackupMarker("  2026-09-13T03:15:42Z   rr-20260913-0315.sqlite\r\n")).toEqual({
      at: "2026-09-13T03:15:42.000Z",
      file: "rr-20260913-0315.sqlite",
    });
    for (const bad of [
      "",
      "rr-20260913-0315.sqlite.gz",
      "2026-09-13T03:15:42Z",
      "not-a-date rr-20260913-0315.sqlite.gz",
      // An ad-hoc copy in the same folder is not a nightly backup.
      "2026-09-13T03:15:42Z rr-pre-errors-20260913.sqlite",
      "2026-09-13T03:15:42Z rr-20260913-0315.sqlite.gz extra",
    ])
      expect([bad, parseBackupMarker(bad)]).toEqual([bad, null]);
  });
});

describe("event rates", () => {
  let handle: SqliteDatabaseHandle;
  afterEach(() => handle?.close());

  it("counts 5 and 60 minute windows per service and fills twelve five-minute buckets", async () => {
    const setup = sqliteEnv();
    handle = setup.handle;
    // Window: buckets start at 11:05:00, cutoff5 = 11:57:30, cutoff60 = 11:02:30.
    await insertEvent(setup.env, "update_check", "2026-09-13T12:01:00.000Z", 1);
    await insertEvent(setup.env, "update_check", "2026-09-13T11:30:00.000Z", 2);
    await insertEvent(setup.env, "app_error", "2026-09-13T11:58:00.000Z", 3);
    await insertEvent(setup.env, "app_error", "2026-09-13T11:58:10.000Z", 4);
    await insertEvent(setup.env, "session_start", "2026-09-13T11:03:00.000Z", 5);
    await insertEvent(setup.env, "session_start", "2026-09-13T10:00:00.000Z", 6);

    const rates = await loadEventRates(setup.env.DB!, NOW);
    expect(rates.last5Minutes).toBe(3);
    expect(rates.last60Minutes).toBe(5);
    expect(rates.byService).toEqual([
      { service: "app_error", last5Minutes: 2, last60Minutes: 2 },
      { service: "update_check", last5Minutes: 1, last60Minutes: 2 },
      { service: "session_start", last5Minutes: 0, last60Minutes: 1 },
    ]);
    expect(rates.buckets).toHaveLength(12);
    expect(rates.buckets[0].start).toBe("2026-09-13T11:05:00.000Z");
    expect(rates.buckets.map((bucket) => bucket.count)).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 1,
    ]);
    expect(rates.lastIngestAt).toBe("2026-09-13T12:01:00.000Z");
  });

  it("binds JS-computed cutoffs instead of datetime('now')", async () => {
    const mock = createMockD1();
    await loadEventRates(mock.db, NOW);
    expect(mock.operations.some((op) => /'now'/i.test(op.sql))).toBe(false);
    const windowed = mock.operations.filter((op) => op.values.length > 0);
    expect(windowed.flatMap((op) => op.values)).toEqual([
      iso(-5 * MINUTE),
      iso(-60 * MINUTE),
      "2026-09-13T11:05:00.000Z",
      "2026-09-13T11:05:00.000Z",
    ]);
  });
});

describe("bot health passthrough", () => {
  it("reads uptime, clients and latency from the bot's /health", async () => {
    const fetchFn = fakeFetch({
      "http://bot:8080/health": { ok: true, uptime: 613_595, clients: 0, watching: 1 },
    });
    let tick = 1_000;
    const clock = () => (tick += 21);
    expect(await loadBotHealth({}, fetchFn, clock)).toEqual({
      reachable: true,
      latencyMs: 21,
      uptimeSeconds: 614,
      clients: 0,
      watching: 1,
    });
    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("honours BOT_URL and reports refused or failing bots as unreachable", async () => {
    const refused = fakeFetch({
      "http://bot.test:9000/health": () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await loadBotHealth({ BOT_URL: "http://bot.test:9000/" }, refused)).toMatchObject({
      reachable: false,
      latencyMs: null,
    });
    const failing = vi.fn(async () => Response.json({ ok: false }, { status: 503 }));
    expect((await loadBotHealth({}, failing))?.reachable).toBe(false);
  });
});

describe("containers via docker-gateway", () => {
  const base = "http://docker-gateway:2375";
  const routes: Routes = {
    [`${base}/containers/json?all=1`]: [
      {
        Id: "a1",
        Names: ["/razorreaper-rr-api-1"],
        State: "running",
        Status: "Up 30 hours (healthy)",
        Labels: { "com.docker.compose.service": "rr-api" },
      },
      {
        Id: "b2",
        Names: ["/razorreaper-bot-1"],
        State: "running",
        Status: "Up 10 minutes (unhealthy)",
        Labels: {},
      },
      {
        Id: "c3",
        Names: ["/razorreaper-backup-1"],
        State: "exited",
        Status: "Exited (0) 2 minutes ago",
        Labels: { "com.docker.compose.service": "backup" },
      },
      {
        Id: "h4",
        Names: ["/homeassistant-app"],
        State: "running",
        Status: "Up 6 days",
        Labels: {},
      },
    ],
    // No inspect route for any container: the gateway answers 403 to every /json path, exactly
    // like the NAS does, so a request for one here would fail the test by 404-ing.
    [`${base}/containers/razorreaper-rr-api-1/stats?stream=false`]: {
      cpu_stats: {
        cpu_usage: { total_usage: 2_000_000 },
        system_cpu_usage: 100_000_000,
        online_cpus: 4,
      },
      precpu_stats: { cpu_usage: { total_usage: 1_000_000 }, system_cpu_usage: 50_000_000 },
      memory_stats: { usage: 120 * MB, limit: 1024 * MB, stats: { inactive_file: 15 * MB } },
    },
    [`${base}/containers/razorreaper-bot-1/stats?stream=false`]: {
      memory_stats: { usage: 56 * MB },
    },
  };

  beforeEach(() => resetContainerCache());
  afterEach(() => vi.useRealTimers());

  it("keeps only this project's containers", () => {
    expect(isProjectContainer("/razorreaper-rr-api-1")).toBe(true);
    expect(isProjectContainer("/homeassistant-app")).toBe(false);
  });

  it("reads the healthcheck verdict out of the list status line", () => {
    expect(healthFromStatus("Up 30 hours (healthy)")).toBe("healthy");
    expect(healthFromStatus("Up 10 minutes (unhealthy)")).toBe("unhealthy");
    expect(healthFromStatus("Up 3 seconds (health: starting)")).toBe("starting");
    expect(healthFromStatus("Up 2 days")).toBe("none");
    expect(healthFromStatus(undefined)).toBe("none");
  });

  it("reads the rounded uptime phrase out of the same status line, and nothing else", () => {
    // Docker's own rounding (go-units), health suffix dropped, wording kept: the page prints
    // this phrase as it stands, because turning "About an hour" into seconds and formatting it
    // back would print "1 h 0 min" for anything between 45 and 90 minutes.
    expect(uptimeFromStatus("Up 45 seconds")).toBe("45 seconds");
    expect(uptimeFromStatus("Up 10 minutes (unhealthy)")).toBe("10 minutes");
    expect(uptimeFromStatus("Up 30 hours (healthy)")).toBe("30 hours");
    expect(uptimeFromStatus("Up 6 days")).toBe("6 days");
    expect(uptimeFromStatus("Up 3 weeks")).toBe("3 weeks");
    // Shapes taken verbatim from `docker ps` on the NAS, 2026-09-14.
    expect(uptimeFromStatus("Up 12 days")).toBe("12 days");
    expect(uptimeFromStatus("Up Less than a second")).toBe("Less than a second");
    expect(uptimeFromStatus("Exited (0) 13 days ago")).toBeNull();
    expect(uptimeFromStatus("Up About a minute")).toBe("About a minute");
    expect(uptimeFromStatus("Up About an hour")).toBe("About an hour");
    // No current run, or nothing recognisable: null, never a made-up figure as a stand-in.
    expect(uptimeFromStatus("Exited (0) 2 minutes ago")).toBeNull();
    expect(uptimeFromStatus("Restarting (1) 3 seconds ago")).toBeNull();
    expect(uptimeFromStatus("Created")).toBeNull();
    expect(uptimeFromStatus("Up")).toBeNull();
    expect(uptimeFromStatus("Up a while")).toBeNull();
    expect(uptimeFromStatus(undefined)).toBeNull();
  });

  it("lists and samples project containers by name, and never asks for inspect", async () => {
    const fetchFn = fakeFetch(routes);
    const containers = await loadContainers({}, fetchFn, () => NOW);
    expect(containers).toEqual([
      {
        // Not running: no uptime, and no stats call worth making.
        service: "backup",
        name: "razorreaper-backup-1",
        state: "exited",
        health: "none",
        uptime: null,
        cpuPercent: null,
        memoryBytes: null,
        memoryLimitBytes: null,
      },
      {
        // State, health and uptime all come out of the list entry; no row carries a restart
        // count any more, because reading one would need inspect.
        service: "bot",
        name: "razorreaper-bot-1",
        state: "running",
        health: "unhealthy",
        uptime: "10 minutes",
        cpuPercent: null,
        memoryBytes: 56 * MB,
        memoryLimitBytes: null,
      },
      {
        service: "rr-api",
        name: "razorreaper-rr-api-1",
        state: "running",
        health: "healthy",
        uptime: "30 hours",
        cpuPercent: 8,
        memoryBytes: 105 * MB,
        memoryLimitBytes: 1024 * MB,
      },
    ]);
    const urls = fetchFn.mock.calls.map((call) => call[0]);
    // The escalation this whole change is about: no inspect request leaves rr-api, for any
    // container, its own included.
    expect(urls.filter((url) => /\/containers\/[^/]+\/json/.test(url))).toEqual([]);
    // Addressed by container name, never by id: the gateway allowlist matches on the name.
    expect(urls.some((url) => /\/containers\/(a1|b2|c3|h4)\//.test(url))).toBe(false);
    expect(urls.some((url) => url.includes("homeassistant"))).toBe(false);
    expect(urls).not.toContain(`${base}/containers/razorreaper-backup-1/stats?stream=false`);
  });

  it("keeps the cache TTL at or above the page's poll interval", () => {
    // At 15 s no 30 s poll ever hit the cache, so every poll from every open tab paid a full
    // stats round on the NAS. The TTL is defined from the poll interval; this pins the relation
    // so it cannot quietly drop below it again.
    expect(CACHE_TTL_MS).toBeGreaterThanOrEqual(SYSTEM_STATUS_POLL_MS);
  });

  it("serves every poll inside one interval from one Docker round, then samples again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fetchFn = fakeFetch(routes);
    const listCalls = () =>
      fetchFn.mock.calls.filter((call) => call[0].endsWith("/containers/json?all=1")).length;
    const statsCalls = () =>
      fetchFn.mock.calls.filter((call) => call[0].endsWith("/stats?stream=false")).length;
    // Three tabs, each polling every SYSTEM_STATUS_POLL_MS, land inside one interval.
    await loadContainers({}, fetchFn);
    vi.setSystemTime(NOW + 10_000);
    await loadContainers({}, fetchFn);
    vi.setSystemTime(NOW + SYSTEM_STATUS_POLL_MS - 1);
    await loadContainers({}, fetchFn);
    expect(listCalls()).toBe(1);
    expect(statsCalls()).toBe(2); // rr-api and bot are running; backup is not sampled
    // The first tab's next poll, one interval on, is the first that samples again.
    vi.setSystemTime(NOW + SYSTEM_STATUS_POLL_MS);
    await loadContainers({}, fetchFn);
    expect(listCalls()).toBe(2);
    expect(statsCalls()).toBe(4);
  });

  it("throws when the proxy does not answer, so the section turns null", async () => {
    const fetchFn = fakeFetch({});
    await expect(
      loadContainers({ DOCKER_PROXY_URL: "http://proxy.test" }, fetchFn),
    ).rejects.toThrow();
  });
});

describe("incident rules", () => {
  const healthy: IncidentInput = {
    database: { reachable: true },
    events: {
      last5Minutes: 3,
      last60Minutes: 40,
      byService: [],
      buckets: [],
      lastIngestAt: iso(-2 * MINUTE),
    },
    backup: {
      newestFile: "rr-20260913-0315.sqlite.gz",
      newestAt: iso(0),
      ageSeconds: 3600,
      verified: true,
    },
    bot: { reachable: true, latencyMs: 5, uptimeSeconds: 60, clients: 0, watching: 1 },
    containers: [
      {
        service: "rr-api",
        name: "razorreaper-rr-api-1",
        state: "running",
        health: "healthy",
        uptime: "24 hours",
        cpuPercent: 1,
        memoryBytes: 1,
        memoryLimitBytes: null,
      },
    ],
  };

  it("raises nothing when every check passes", () => {
    expect(computeIncidents(healthy, NOW)).toEqual([]);
    expect(overallFrom([])).toBe("ok");
  });

  it("says whether an overdue backup age is a verified one", () => {
    const stale = (verified: boolean) =>
      computeIncidents(
        { ...healthy, backup: { ...healthy.backup!, ageSeconds: 27 * 3600, verified } },
        NOW,
      );
    // With the marker, the age is the time since the last verified backup.
    expect(stale(true)).toEqual([
      expect.objectContaining({
        id: "backup-stale",
        severity: "warning",
        detail: "The last verified backup is 27 h old; one runs every night.",
      }),
    ]);
    // Without it, the newest file's mtime is all there is, and the wording says so.
    expect(stale(false)).toEqual([
      expect.objectContaining({
        id: "backup-stale",
        severity: "warning",
        detail:
          "The newest backup file is 27 h old and no verified backup is recorded; one runs every night.",
      }),
    ]);
  });

  it("flags a stale backup, stalled ingest and an unreachable bot", () => {
    const incidents = computeIncidents(
      {
        ...healthy,
        backup: { ...healthy.backup!, ageSeconds: 27 * 3600 },
        events: { ...healthy.events!, lastIngestAt: iso(-16 * MINUTE) },
        bot: { ...healthy.bot!, reachable: false },
      },
      NOW,
    );
    expect(incidents.map((incident) => [incident.id, incident.severity])).toEqual([
      ["bot-unreachable", "critical"],
      ["backup-stale", "warning"],
      ["ingest-stalled", "warning"],
    ]);
    expect(overallFrom(incidents)).toBe("critical");
    expect(
      computeIncidents({ ...healthy, backup: { ...healthy.backup!, ageSeconds: 25 * 3600 } }, NOW),
    ).toEqual([]);
  });

  it("flags unhealthy and stopped containers", () => {
    const base = healthy.containers![0];
    const incidents = computeIncidents(
      {
        ...healthy,
        containers: [
          { ...base, service: "bot", health: "unhealthy" },
          { ...base, service: "caddy", state: "exited" },
        ],
      },
      NOW,
    );
    expect(incidents.map((incident) => incident.id)).toEqual([
      "container-unhealthy-bot",
      "container-down-caddy",
    ]);
    expect(overallFrom(incidents)).toBe("critical");
  });

  it("raises nothing for a container that merely started recently", () => {
    // A restart warning would need RestartCount, which only inspect reports and the gateway
    // refuses. A short uptime alone is not a restart — a deploy looks exactly the same — so the
    // rule is gone rather than guessed at.
    const base = healthy.containers![0];
    expect(
      computeIncidents(
        { ...healthy, containers: [{ ...base, service: "admin", uptime: "5 minutes" }] },
        NOW,
      ),
    ).toEqual([]);
  });

  it("stays silent for sources this runtime simply does not have", () => {
    expect(
      computeIncidents(
        {
          ...healthy,
          events: null,
          backup: null,
          bot: null,
          containers: null,
          sources: { containers: "not-configured" },
        },
        NOW,
      ),
    ).toEqual([]);
  });

  it("warns when a configured source failed, so nothing reads as every check passed", () => {
    const incidents = computeIncidents(
      { ...healthy, containers: null, sources: { containers: "unavailable" } },
      NOW,
    );
    expect(incidents.map((incident) => [incident.id, incident.severity])).toEqual([
      ["containers-unavailable", "warning"],
    ]);
    expect(overallFrom(incidents)).toBe("degraded");
  });

  it("blames only the hop rr-api called for an unreadable container list", () => {
    // rr-api fetches the list from docker-gateway (DOCKER_PROXY_URL=http://docker-gateway:2375)
    // and sees one thing: that call did not answer. Whether the gateway, docker-proxy behind it
    // or the socket failed is not in evidence, so the incident says the call and stops there.
    const [incident] = computeIncidents(
      { ...healthy, containers: null, sources: { containers: "unavailable" } },
      NOW,
    );
    expect(incident.service).toBe("docker-gateway");
    expect(incident.detail).toBe(
      "The call to docker-gateway did not answer, so no container could be checked on this refresh.",
    );
    expect(`${incident.title} ${incident.detail}`).not.toContain("docker-proxy");
  });
});

describe("5xx ring buffer", () => {
  afterEach(() => resetServerErrorRing());

  it("is null until rr-api enables it, then counts by window", () => {
    expect(serverErrorCounts(NOW)).toBeNull();
    enableServerErrorRing();
    recordServerError(NOW - 2 * MINUTE);
    recordServerError(NOW - 30 * MINUTE);
    recordServerError(NOW - 90 * MINUTE);
    expect(serverErrorCounts(NOW)).toEqual({ last5Minutes: 1, last60Minutes: 2 });
  });
});

describe("buildSystemStatus", () => {
  let handle: SqliteDatabaseHandle;
  beforeEach(() => resetContainerCache());
  afterEach(() => handle?.close());

  it("assembles every source and warns about the one that failed", async () => {
    const setup = sqliteEnv();
    handle = setup.handle;
    await insertEvent(setup.env, "update_check", iso(-MINUTE), 1);
    const fetchFn = fakeFetch({
      "http://bot.test/health": { ok: true, uptime: 60_000, clients: 0, watching: 1 },
      "http://proxy.test/containers/json?all=1": () => {
        throw new TypeError("fetch failed");
      },
    });
    const status = await buildSystemStatus(
      {
        ...setup.env,
        BUILD_SHA: "abc1234",
        BACKUP_DIR: "/backups",
        BOT_URL: "http://bot.test",
        DOCKER_PROXY_URL: "http://proxy.test",
      },
      {
        now: () => NOW,
        fetch: fetchFn,
        fs: fakeFs({
          files: {
            "/data/db/rr.sqlite": { size: 333 * MB, mtimeMs: NOW },
            "/backups/rr-20260913-0315.sqlite.gz": { size: 1, mtimeMs: NOW - 3600_000 },
          },
          dirs: { "/backups": ["rr-20260913-0315.sqlite.gz"] },
          disk: { bsize: 4096, blocks: 10, bavail: 5 },
        }),
      },
    );
    expect(status).toMatchObject({
      ok: true,
      generatedAt: iso(0),
      overall: "degraded",
      build: { commit: "abc1234" },
      database: { reachable: true },
      events: { last5Minutes: 1, last60Minutes: 1 },
      storage: { databaseBytes: 333 * MB, walBytes: null },
      // No .last-success in this fake folder: the newest file's age, and said to be unverified.
      backup: { ageSeconds: 3600, verified: false },
      bot: { reachable: true, uptimeSeconds: 60 },
      containers: null,
      sources: { containers: "unavailable" },
      serverErrors: null,
    });
    // A dead docker-proxy is an incident, not silence: null alone would summarise as "ok".
    expect(status.incidents.map((incident) => incident.id)).toEqual(["containers-unavailable"]);
    expect(typeof status.runtime.node).toBe("string");
  });

  it("reports a missing database as critical and every file source as null", async () => {
    const status = await buildSystemStatus(
      // An unset build arg reaches the container as an empty BUILD_SHA; that is "unknown",
      // not a commit called "".
      { BUILD_SHA: "", BOT_URL: "http://bot.test", DOCKER_PROXY_URL: "http://proxy.test" },
      {
        now: () => NOW,
        fs: null,
        fetch: fakeFetch({
          "http://bot.test/health": { ok: true },
          "http://proxy.test/containers/json?all=1": [],
        }),
      },
    );
    expect(status).toMatchObject({
      overall: "critical",
      build: { commit: "unknown" },
      database: { reachable: false, latencyMs: null },
      events: null,
      storage: null,
      backup: null,
      containers: [],
      sources: { containers: "ok" },
    });
    expect(status.incidents.map((incident) => incident.id)).toEqual(["database-unreachable"]);
  });
});

describe("GET /api/admin/system permission gate", () => {
  const SECRET = "test-secret-used-only-in-local-tests";
  const OWNER = "owner@example.test";
  const MEMBER = "support@example.test";
  let handle: SqliteDatabaseHandle;
  let env: RuntimeEnv;
  let ownerToken: string;
  let memberToken: string;

  const request = (path: string, token: string, body?: unknown) =>
    new Request(`https://panel.test${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        cookie: `rr_session=${token}`,
        origin: "https://panel.test",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const saveSupport = (overrides: Record<string, unknown>) =>
    team({
      env,
      request: request("/api/admin/team", ownerToken, {
        action: "save",
        email: MEMBER,
        displayName: "Support",
        role: "support",
        enabled: true,
        expiresAt: null,
        overrides,
      }),
    });

  beforeEach(async () => {
    handle = createInMemoryDatabase();
    env = {
      AUTH_MODE: "app",
      JWT_SECRET: SECRET,
      DB: createD1Database(handle),
      ACCESS_ENFORCEMENT: "off",
    };
    await ensureAuthSchema(env);
    const hash = await hashPassword("Example-Password-123!");
    await createUser(env, OWNER, "admin", hash);
    await createUser(env, MEMBER, "viewer", hash);
    ownerToken = (await createAppSessionToken(SECRET, OWNER, "admin")).token;
    memberToken = (await createAppSessionToken(SECRET, MEMBER, "viewer")).token;
    expect((await team({ env, request: request("/api/admin/team", ownerToken) })).status).toBe(200);
  });
  afterEach(() => handle.close());

  it("lets a support member with monitoring.read through", async () => {
    expect((await saveSupport({})).status).toBe(200);
    const access = await requireDashboardAccess(request("/api/admin/system", memberToken), env);
    expect(access.ok).toBe(true);
  });

  it("returns 403 to a support member whose monitoring.read is denied", async () => {
    expect(
      (await saveSupport({ "monitoring.read": { effect: "deny", expiresAt: null } })).status,
    ).toBe(200);
    const response = await system({ env, request: request("/api/admin/system", memberToken) });
    expect(response.status).toBe(403);
  });

  it("rejects anything but GET", async () => {
    const response = await system({
      env,
      request: new Request("https://panel.test/api/admin/system", { method: "POST" }),
    });
    expect(response.status).toBe(405);
  });
});
