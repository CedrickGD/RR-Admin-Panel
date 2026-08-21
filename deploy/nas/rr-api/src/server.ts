// rr-api entry point: SQLite at DB_PATH, the unchanged worker + Pages Functions behind Hono on
// PORT, the worker's nightly license cleanup on a node-cron schedule, graceful SIGTERM/SIGINT.
import { serve } from "@hono/node-server";
import cron from "node-cron";

import worker from "../../../../backend-worker/index.js";
import { createApp } from "./app";
import { bootstrapSchemaIfEmpty, locateSchemaFile } from "./bootstrap";
import { createD1Database, openDatabase } from "./d1-adapter";
import { buildRuntimeEnv } from "./env";

const DEFAULT_DB_PATH = "/data/db/rr.sqlite";
const DEFAULT_PORT = 8787;
const DEFAULT_CRON = "30 3 * * *";

function readPort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT;
}

function isTrue(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

function log(message: string, details?: Record<string, unknown>): void {
  const line = details ? `${message} ${JSON.stringify(details)}` : message;
  console.log(`[rr-api] ${line}`);
}

function main(): void {
  const dbPath = process.env.DB_PATH?.trim() || DEFAULT_DB_PATH;
  const port = readPort(process.env.PORT);
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const cronExpression = process.env.CRON_LICENSE_CLEANUP?.trim() || DEFAULT_CRON;

  const handle = openDatabase(dbPath);
  log("database opened", {
    path: dbPath,
    journal: handle.pragma("journal_mode", { simple: true }),
  });

  if (isTrue(process.env.DB_BOOTSTRAP_SCHEMA)) {
    const result = bootstrapSchemaIfEmpty(
      handle,
      locateSchemaFile(process.env.SCHEMA_PATH?.trim() || undefined),
    );
    if (result.applied) {
      log("schema bootstrapped", { statements: result.statements, schema: result.schemaPath });
    } else {
      log("schema bootstrap skipped (database already has tables)");
    }
  }

  const env = buildRuntimeEnv(process.env, createD1Database(handle));
  const api = createApp({ env, worker });

  if (!cron.validate(cronExpression)) {
    throw new Error(`CRON_LICENSE_CLEANUP is not a valid cron expression: ${cronExpression}`);
  }
  const cleanupTask = cron.schedule(cronExpression, async () => {
    const scheduledTime = Date.now();
    log("license cleanup: start", { cron: cronExpression });
    try {
      await worker.scheduled({ cron: cronExpression, scheduledTime }, env, {
        waitUntil: () => {},
      });
    } catch (error) {
      console.error("[rr-api] license cleanup failed", error);
    }
  });

  const server = serve({ fetch: api.fetch, port, hostname: host }, (info) => {
    log("listening", {
      address: info.address,
      port: info.port,
      pagesRoutes: api.routeCount,
      cron: cronExpression,
      trustedForwarding: Boolean(process.env.ORIGIN_KEY?.trim()),
      originHost: process.env.ORIGIN_HOST?.trim() || null,
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutdown", { signal });
    void cleanupTask.stop();
    server.close(() => {
      void api.drain().finally(() => {
        try {
          handle.close();
        } finally {
          process.exit(0);
        }
      });
    });
    // Safety net for lingering keep-alive connections.
    setTimeout(() => {
      try {
        handle.close();
      } finally {
        process.exit(0);
      }
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
