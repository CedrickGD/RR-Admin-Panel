import { afterEach, beforeEach, describe, expect, it } from "vitest";

import worker, { resetWorkerStateForTests } from "../backend-worker/index.js";
import { createApp, type RrApiApp } from "../deploy/nas/rr-api/src/app";
import { resetRateLimitsForTests } from "../functions/_lib/ratelimit";
import { loadUsersRollup } from "../functions/_lib/stats";
import { storeTelemetry } from "../functions/_lib/storage";
import { resetInstallsSchemaStateForTests } from "../shared/installs-store";
import type { UserRollupRecord } from "../src/types/telemetry";
import { needsAttention } from "../src/utils/userDirectory";
import { createTelemetryTestDb, type TelemetryTestDb } from "./helpers/telemetry-db";

const SHARED_KEY = "legacy-shared-key";
const INSTALL_BG = "0b5c7c1e-2f7a-4d8e-9a61-3c2d1e0f9a01";
const INSTALL_REAL = "5e8f2a4b-6c1d-4f3e-8b2a-9d7c6e5f4a02";
const HWID_BG = "B6B6B6B6B6B6B6B6B6B6B6B6B6B6B6B6";
const HWID_REAL = "C7C7C7C7C7C7C7C7C7C7C7C7C7C7C7C7";

const BACKGROUND = {
  error_kind: "background",
  error_code: "RR-E1003",
  exception_type: "System.AggregateException",
  base_exception_type: "System.NullReferenceException",
};
const UNHANDLED = {
  error_kind: "unhandled",
  error_code: "RR-E2001",
  exception_type: "System.InvalidOperationException",
};

let db: TelemetryTestDb;
let api: RrApiApp;

beforeEach(() => {
  resetWorkerStateForTests();
  resetInstallsSchemaStateForTests();
  resetRateLimitsForTests();
  db = createTelemetryTestDb({ APP_SHARED_KEY: SHARED_KEY, LEGACY_INGEST_KEY_ENABLED: "true" });
  api = createApp({ env: db.env, worker });
});

afterEach(async () => {
  await api.drain();
  db.close();
});

function payload(
  service: string,
  sessionId: string,
  installId: string,
  hwid: string,
  extra: Record<string, unknown> = {},
) {
  return {
    source: "razorreaper",
    service,
    timestamp: new Date().toISOString(),
    // Failures arrive as "down"; a background fault must not carry that into the session.
    status: service === "app_error" ? "down" : "ok",
    metrics: {
      session_id: sessionId,
      install_id: installId,
      hwid,
      app_version: "1.4.8.11",
      platform: "windows",
      ...extra,
    },
  };
}

/** The production ingest path: the standalone worker behind rr-api, legacy key. */
async function ingest(body: unknown): Promise<void> {
  const response = await api.fetch(
    new Request("http://rr-api.test/api/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-key": SHARED_KEY,
        "cf-connecting-ip": "203.0.113.7",
      },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(202);
}

async function ingestBackgroundAndRealCustomers(): Promise<void> {
  await ingest(payload("session_start", "s-bg", INSTALL_BG, HWID_BG));
  for (let index = 0; index < 3; index += 1) {
    await ingest(payload("app_error", "s-bg", INSTALL_BG, HWID_BG, BACKGROUND));
  }
  await ingest(payload("session_start", "s-real", INSTALL_REAL, HWID_REAL));
  await ingest(payload("app_error", "s-real", INSTALL_REAL, HWID_REAL, BACKGROUND));
  await ingest(payload("app_error", "s-real", INSTALL_REAL, HWID_REAL, UNHANDLED));
}

function sessionRow(sessionId: string) {
  return db.handle
    .prepare(`SELECT error_count, last_status, last_event FROM app_sessions WHERE session_id = ?`)
    .get(sessionId);
}

describe("session error_count ignores background faults", () => {
  it("worker ingest counts real errors only and keeps the session's last status", async () => {
    await ingestBackgroundAndRealCustomers();

    expect(sessionRow("s-bg")).toEqual({
      error_count: 0,
      last_status: "ok",
      last_event: "session_start",
    });
    expect(sessionRow("s-real")).toEqual({
      error_count: 1,
      last_status: "down",
      last_event: "app_error",
    });
    // The events themselves are kept: the Errors page aggregates them as background faults.
    expect(
      db.handle
        .prepare(`SELECT COUNT(*) AS n FROM telemetry_events WHERE service = 'app_error'`)
        .get(),
    ).toEqual({ n: 5 });
  });

  it("applies the same rule on the Pages Functions ingest path", async () => {
    const event = (id: string, service: string, extra: Record<string, unknown> = {}) => ({
      id,
      source: "razorreaper",
      service,
      timestamp: new Date().toISOString(),
      status: (service === "app_error" ? "down" : "ok") as "down" | "ok",
      metrics: { session_id: "s-fn", install_id: INSTALL_BG, hwid: HWID_BG, ...extra },
      message: null,
      receivedAt: new Date().toISOString(),
    });

    await storeTelemetry(db.env, event("e-1", "session_start"));
    await storeTelemetry(db.env, event("e-2", "app_error", BACKGROUND));
    expect(sessionRow("s-fn")).toEqual({
      error_count: 0,
      last_status: "ok",
      last_event: "session_start",
    });

    await storeTelemetry(db.env, event("e-3", "app_error", UNHANDLED));
    expect(sessionRow("s-fn")).toEqual({
      error_count: 1,
      last_status: "down",
      last_event: "app_error",
    });
  });

  it("does not flag a customer with only background faults as needing attention", async () => {
    await ingestBackgroundAndRealCustomers();

    const users = await loadUsersRollup(db.env, {
      rangeDays: null,
      version: null,
      platform: null,
      country: null,
    });
    const find = (hwid: string) =>
      users.find((user) => user.identity.toUpperCase() === hwid) as unknown as UserRollupRecord;

    const backgroundOnly = find(HWID_BG);
    expect(backgroundOnly.errors).toBe(0);
    expect(needsAttention(backgroundOnly)).toBe(false);

    const realError = find(HWID_REAL);
    expect(realError.errors).toBe(1);
    expect(needsAttention(realError)).toBe(true);
  });
});
