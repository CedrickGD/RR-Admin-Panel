export type TelemetryStatus = "ok" | "degraded" | "down";
export type StorageBackend = "d1" | "kv";

export interface D1RunResult {
  success?: boolean;
  error?: string;
}

export interface D1AllResult<T> {
  results: T[];
  success?: boolean;
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = D1RunResult>(): Promise<T>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface KVListResult {
  keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
  list_complete: boolean;
  cursor?: string;
}

export interface KVNamespace {
  get(key: string, type: "text"): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult>;
}

export interface RuntimeEnv {
  ADMIN_KEY_HASH?: string;
  INGEST_TOKEN?: string;
  JWT_SECRET?: string;
  STORAGE_BACKEND?: string;
  ACCESS_ENFORCEMENT?: string;
  ACCESS_ALLOWED_EMAIL?: string;
  BUILD_SHA?: string;
  DB?: D1Database;
  KV?: KVNamespace;
  CF_PAGES?: string;
  CF_PAGES_BRANCH?: string;
  CF_PAGES_COMMIT_SHA?: string;
}

export interface TelemetryEvent {
  id: string;
  source: string;
  service: string;
  timestamp: string;
  status: TelemetryStatus;
  metrics: Record<string, unknown>;
  message: string | null;
  receivedAt: string;
}

export interface SummaryPayload {
  generatedAt: string;
  storage: StorageBackend;
  overallStatus: TelemetryStatus | "unknown";
  latest: TelemetryEvent[];
  recent: TelemetryEvent[];
  stats: {
    totalEvents: number;
    lastIngestAt: string | null;
    sources: number;
    services: number;
  };
}

export interface HealthPayload {
  ok: boolean;
  api: "alive";
  storage: {
    backend: StorageBackend;
    available: boolean;
  };
  lastIngestAt: string | null;
  count: number;
  build: {
    commit: string;
    branch: string;
    environment: string;
    generatedAt: string;
  };
}

export interface SessionClaims {
  sub: "admin";
  scope: "admin";
  iat: number;
  exp: number;
  email: string | null;
}
