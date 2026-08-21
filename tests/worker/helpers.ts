import worker, { resetWorkerStateForTests } from "../../backend-worker/index.js";
import type { PublicKeyJwk } from "../../shared/install-auth";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import { signedHeaders } from "../helpers/install-signer";
import { createMockD1, type MockD1, type MockD1Resolvers } from "../helpers/mock-d1";

export const WORKER_ORIGIN = "https://backend.test";
export const TEST_INGEST_KEY = "test-shared-ingest-key";
export const TEST_CLIENT_IP = "203.0.113.7";

export const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
export const OTHER_INSTALL_ID = "0b7e5a1c-3d2f-4e6a-9c8b-1a2b3c4d5e6f";
export const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";

export const INSTALL_LOOKUP = /SELECT .* FROM installs WHERE install_id = \?/;
export const SESSION_LOOKUP = /FROM app_sessions WHERE session_id = \?/;
export const EVENT_INSERT = /^INSERT INTO telemetry_events/;
export const SESSION_UPSERT = /^INSERT INTO app_sessions/;
export const INSTALL_INSERT = /^INSERT (OR IGNORE )?INTO installs/;
export const HWID_COUNT = /SELECT COUNT\(\*\) AS count FROM installs WHERE hwid = \?/;

export interface FakeRateLimiter {
  keys: string[];
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

export function fakeLimiter(success = true): FakeRateLimiter {
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success };
    },
  };
}

export interface WorkerEnv {
  DB?: MockD1["db"];
  APP_SHARED_KEY?: string;
  INGEST_TOKEN?: string;
  LEGACY_INGEST_KEY_ENABLED?: string;
  RL_INGEST?: FakeRateLimiter;
  RL_REGISTER?: FakeRateLimiter;
  [key: string]: unknown;
}

export interface WorkerHarness {
  env: WorkerEnv;
  mock: MockD1;
  ingestLimiter: FakeRateLimiter;
  registerLimiter: FakeRateLimiter;
}

/** Fresh worker state + mock D1 + permissive fake limiters + a configured legacy ingest key. */
export function createWorkerHarness(
  resolvers: MockD1Resolvers = {},
  envOverrides: Partial<WorkerEnv> = {},
): WorkerHarness {
  resetWorkerStateForTests();
  resetInstallsSchemaStateForTests();
  const mock = createMockD1(resolvers);
  const ingestLimiter = fakeLimiter();
  const registerLimiter = fakeLimiter();
  const env: WorkerEnv = {
    DB: mock.db,
    APP_SHARED_KEY: TEST_INGEST_KEY,
    RL_INGEST: ingestLimiter,
    RL_REGISTER: registerLimiter,
    ...envOverrides,
  };
  return { env, mock, ingestLimiter, registerLimiter };
}

export function executionContext(): { waitUntil: (promise: Promise<unknown>) => void } {
  return {
    waitUntil: () => {},
  };
}

export interface WorkerRequestOptions {
  method?: string;
  path: string;
  headers?: HeadersInit;
  json?: unknown;
  body?: string;
  clientIp?: string | null;
}

export function workerRequest(options: WorkerRequestOptions): Request {
  const headers = new Headers(options.headers);
  const clientIp = options.clientIp === undefined ? TEST_CLIENT_IP : options.clientIp;
  if (clientIp && !headers.has("cf-connecting-ip")) {
    headers.set("cf-connecting-ip", clientIp);
  }
  const body = options.body ?? (options.json !== undefined ? JSON.stringify(options.json) : null);
  if (body !== null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(new URL(options.path, WORKER_ORIGIN), {
    method: options.method ?? (body !== null ? "POST" : "GET"),
    headers,
    body: body ?? undefined,
  });
}

export interface SignedWorkerRequestOptions extends WorkerRequestOptions {
  privateKey: CryptoKey;
  installId?: string;
  timestamp?: string;
}

/** Builds a request carrying valid rr.install.v1 headers for its method/path/body. */
export async function signedWorkerRequest(options: SignedWorkerRequestOptions): Promise<Request> {
  const body = options.body ?? (options.json !== undefined ? JSON.stringify(options.json) : "");
  const method = options.method ?? (body ? "POST" : "GET");
  const headers = await signedHeaders(
    options.privateKey,
    {
      installId: options.installId ?? INSTALL_ID,
      method,
      pathname: new URL(options.path, WORKER_ORIGIN).pathname,
      timestamp: options.timestamp ?? String(Math.floor(Date.now() / 1000)),
      bodyText: body,
    },
    options.headers,
  );
  return workerRequest({ ...options, method, headers, body: body || undefined, json: undefined });
}

export function legacyKeyHeaders(key: string = TEST_INGEST_KEY): Record<string, string> {
  return { "x-app-key": key };
}

export function installRow(
  publicKeyJwk: PublicKeyJwk,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    install_id: INSTALL_ID,
    public_key_jwk: JSON.stringify(publicKeyJwk),
    hwid: HWID,
    app_version: "1.4.9",
    created_at: "2026-08-20T12:00:00.000Z",
    last_seen_at: null,
    revoked_at: null,
    license_id: null,
    ...overrides,
  };
}

export function sessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: "session-1",
    install_id: INSTALL_ID,
    hwid: HWID,
    source: "razorreaper",
    user_label: null,
    client_ip: null,
    client_country: null,
    client_city: null,
    client_region: null,
    client_latitude: null,
    client_longitude: null,
    client_timezone: null,
    client_geo_source: null,
    client_geo_signal_source: null,
    client_accuracy_meters: null,
    client_geo_captured_at: null,
    app_version: "1.4.9",
    display_version: "1.4.9",
    platform: "windows",
    os_version: null,
    device_model: null,
    rpc_enabled: null,
    discord_user: null,
    features_json: null,
    started_at: "2026-08-21T11:00:00.000Z",
    last_seen_at: "2026-08-21T11:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    is_active: 1,
    last_event: "session_start",
    last_status: "ok",
    error_count: 0,
    updated_at: "2026-08-21T11:00:00.000Z",
    ...overrides,
  };
}

export function canonicalEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "razorreaper",
    service: "session_start",
    timestamp: new Date().toISOString(),
    status: "ok",
    metrics: {
      session_id: "session-1",
      install_id: INSTALL_ID,
      app_version: "1.4.9",
      platform: "windows",
    },
    ...overrides,
  };
}

export async function dispatch(harness: WorkerHarness, request: Request): Promise<Response> {
  return worker.fetch(request, harness.env, executionContext());
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}
