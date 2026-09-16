// In-memory SQLite bootstrapped from schema.sql, wrapped as the D1 binding the Pages Functions
// use — the same stack rr-api runs in production. For tests that need the real SQL (json_extract,
// window functions, LIMIT semantics) instead of the recorded-SQL mock in mock-d1.ts.
import { readFileSync } from "node:fs";

import { applySchema, locateSchemaFile } from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { buildRuntimeEnv, type RrApiEnv } from "../../deploy/nas/rr-api/src/env";
import { resetTelemetrySchemaStateForTests } from "../../functions/_lib/storage";

export interface TestEvent {
  id?: string;
  service?: string;
  ts: string;
  status?: "ok" | "degraded" | "down";
  metrics?: Record<string, unknown>;
  message?: string | null;
}

export interface TelemetryTestDb {
  handle: SqliteDatabaseHandle;
  env: RrApiEnv;
  /** Inserts rows straight into telemetry_events in one transaction. */
  insertEvents(events: readonly TestEvent[]): void;
  close(): void;
}

let sequence = 0;

/** `vars` are rr-api environment variables, e.g. the legacy ingest key for worker tests. */
export function createTelemetryTestDb(vars: Record<string, string> = {}): TelemetryTestDb {
  resetTelemetrySchemaStateForTests();
  const handle = createInMemoryDatabase();
  const schemaPath = locateSchemaFile();
  if (!schemaPath) throw new Error("schema.sql not found");
  applySchema(handle, readFileSync(schemaPath, "utf8"));
  const env = buildRuntimeEnv(vars, createD1Database(handle));

  const insert = handle.prepare(
    `INSERT INTO telemetry_events (event_id, source, service, ts, status, metrics_json, message, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMany = handle.transaction((events: readonly TestEvent[]) => {
    for (const event of events) {
      sequence += 1;
      insert.run(
        event.id ?? `evt-${sequence}`,
        "desktop-app",
        event.service ?? "app_error",
        event.ts,
        event.status ?? "down",
        JSON.stringify(event.metrics ?? {}),
        event.message ?? null,
        event.ts,
      );
    }
  });

  return {
    handle,
    env,
    insertEvents: (events) => insertMany(events),
    close: () => handle.close(),
  };
}

/** The production background fault: RR-E1003, an AggregateException around `baseType`. */
export function backgroundFault(
  ts: string,
  metrics: Record<string, unknown> & { base_exception_type?: string | null },
): TestEvent {
  return {
    ts,
    message:
      "A Task's exception(s) were not observed either by Waiting on the Task or accessing its Exception property.",
    metrics: {
      error_kind: "background",
      error_code: "RR-E1003",
      exception_type: "System.AggregateException",
      ...metrics,
    },
  };
}

export function realError(ts: string, metrics: Record<string, unknown>): TestEvent {
  return {
    ts,
    message: "Object reference not set to an instance of an object.",
    metrics: {
      error_kind: "unhandled",
      error_code: "RR-E2001",
      exception_type: "System.NullReferenceException",
      ...metrics,
    },
  };
}

/**
 * A background fault row as the desktop client reports it from 1.5.3 (the contract in
 * shared/telemetry-contract.ts): one row per distinct fault and session (`first`), 5-minute
 * rollups of the repeats (`rollup`), and the aborted Discord-pipe I/O it dropped on a row of its
 * own (`suppressed`, whose top_frame/top_frames arrive as JSON null and whose message the client
 * drops). `metrics` overrides or extends the contract keys — identity keys go in the same way.
 */
export function backgroundReport(
  ts: string,
  kind: "first" | "rollup" | "suppressed",
  metrics: Record<string, unknown> = {},
): TestEvent {
  const suppressed = kind === "suppressed";
  const row = backgroundFault(ts, {
    base_exception_type: suppressed ? null : "System.NullReferenceException",
    top_frame: suppressed
      ? null
      : "RazorReaper.Components.Pages.Home.UpdateResources (Home.razor:1394)",
    top_frames: suppressed
      ? null
      : "Home.UpdateResources (Home.razor:1394) > Home.OnInitializedAsync (Home.razor:889)",
    leaf_exception_count: suppressed ? 0 : 1,
    occurrences: 1,
    report_kind: kind,
    suppressed_aborted_io: 0,
    fault_source: "unobserved_task",
    app_version: "1.5.3",
    ...metrics,
  });
  return suppressed ? { ...row, message: null } : row;
}
