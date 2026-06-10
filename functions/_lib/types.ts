export type TelemetryStatus = "ok" | "degraded" | "down";
export type StorageBackend = "d1" | "kv";
export type AppUserRole = "admin" | "viewer";

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
  INGEST_TOKEN?: string;
  TELEMETRY_APP_KEY?: string;
  JWT_SECRET?: string;
  AUTH_SESSION_COOKIE?: string;
  AUTH_MODE?: string;
  STORAGE_BACKEND?: string;
  ACCESS_ENFORCEMENT?: string;
  ACCESS_ALLOWED_EMAIL?: string;
  ACCESS_ADMIN_EMAIL?: string;
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

export interface AppSessionRecord {
  id: string;
  installId: string;
  hwid: string | null;
  source: string;
  userLabel: string | null;
  clientIp: string | null;
  clientCountry: string | null;
  clientCity: string | null;
  clientRegion: string | null;
  clientLatitude: number | null;
  clientLongitude: number | null;
  clientTimezone: string | null;
  clientGeoSource: string | null;
  clientGeoSignalSource: string | null;
  clientAccuracyMeters: number | null;
  clientGeoCapturedAt: string | null;
  appVersion: string | null;
  displayVersion: string | null;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  rpcEnabled: boolean | null;
  featuresJson: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  isActive: boolean;
  lastEvent: string | null;
  lastStatus: TelemetryStatus;
  errorCount: number;
}

export interface StatsFilters {
  rangeDays: number | null;
  version: string | null;
  platform: string | null;
  country: string | null;
}

export interface DayPoint {
  day: string;
  sessions: number;
  users: number;
}

export interface VersionAdoptionPoint {
  version: string;
  users: number;
  sessions: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface VersionCurrentPoint {
  version: string;
  users: number;
  activeUsers: number;
}

export interface BreakdownPoint {
  key: string;
  users: number;
  sessions: number;
}

export interface StatsPayload {
  generatedAt: string;
  filters: StatsFilters;
  totals: {
    lifetimeUsers: number;
    lifetimeSessions: number;
    lifetimeEvents: number;
    usersInRange: number;
    sessionsInRange: number;
    newUsersInRange: number;
    activeNow: number;
    rpcLiveNow: number;
    rpcEnabledUsers: number;
    rpcKnownUsers: number;
    averageSessionDurationSeconds: number;
    errorsInRange: number;
  };
  series: {
    sessionsPerDay: DayPoint[];
    newUsersPerDay: Array<{ day: string; users: number }>;
    errorsPerDay: Array<{ day: string; errors: number }>;
  };
  breakdowns: {
    versionsAllTime: VersionAdoptionPoint[];
    versionsCurrent: VersionCurrentPoint[];
    platforms: BreakdownPoint[];
    countries: BreakdownPoint[];
    features: Array<{ feature: string; count: number; users: number }>;
    eventsLifetime: Array<{ service: string; count: number }>;
  };
  /** Unfiltered filter-dropdown options (breakdowns above respect the active filters). */
  options: {
    versions: string[];
    platforms: string[];
    countries: string[];
  };
}

export interface UserRollupRecord {
  identity: string;
  userLabel: string | null;
  firstSeen: string;
  lastSeen: string;
  sessions: number;
  totalDurationSeconds: number;
  errors: number;
  isActive: boolean;
  appVersion: string | null;
  displayVersion: string | null;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  country: string | null;
  city: string | null;
  timezone: string | null;
  rpcEnabled: boolean | null;
  lastStatus: TelemetryStatus | null;
  lastEvent: string | null;
  features: Record<string, number>;
}

export interface SummaryPayload {
  generatedAt: string;
  storage: StorageBackend;
  activeSessions: AppSessionRecord[];
  recentSessions: AppSessionRecord[];
  recentErrors: TelemetryEvent[];
  recentEvents: TelemetryEvent[];
  stats: {
    totalEvents: number;
    lifetimeEvents: number;
    totalSessions: number;
    activeUsers: number;
    lifetimeUsers: number;
    sessionsStartedToday: number;
    sessionsEndedToday: number;
    averageSessionDurationSeconds: number;
    errorsLast24Hours: number;
    lastIngestAt: string | null;
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

export interface AppSessionClaims {
  sub: "rr-user";
  scope: "dashboard";
  iat: number;
  exp: number;
  email: string;
  role: AppUserRole;
}

export interface AuthUser {
  id: number;
  email: string;
  role: AppUserRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
