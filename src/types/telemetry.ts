export type TelemetryStatus = "ok" | "degraded" | "down";
export type AuthMode = "app" | "access";
export type ThemeMode = "dark" | "light";
export type PageKey =
  | "overview"
  | "traffic"
  | "versions"
  | "heatmap"
  | "live"
  | "workers"
  | "logs"
  | "settings";

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
  hwid?: string | null;
  source: string;
  userLabel: string | null;
  clientIp: string | null;
  clientCountry: string | null;
  clientCity?: string | null;
  clientRegion?: string | null;
  clientLatitude?: number | null;
  clientLongitude?: number | null;
  clientTimezone?: string | null;
  clientGeoSource?: string | null;
  clientGeoSignalSource?: string | null;
  clientAccuracyMeters?: number | null;
  clientGeoCapturedAt?: string | null;
  appVersion: string | null;
  displayVersion?: string | null;
  platform: string | null;
  osVersion?: string | null;
  deviceModel?: string | null;
  rpcEnabled?: boolean | null;
  discordUser?: string | null;
  featuresJson?: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  isActive: boolean;
  lastEvent: string | null;
  lastStatus: TelemetryStatus;
  errorCount: number;
}

export type StatsRange = "today" | "7d" | "30d" | "90d" | "all";

export interface StatsFilters {
  range: StatsRange;
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
  filters: { rangeDays: number | null; version: string | null; platform: string | null; country: string | null };
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
  options?: {
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
  discordUser: string | null;
  latitude: number | null;
  longitude: number | null;
  lastStatus: TelemetryStatus | null;
  lastEvent: string | null;
  features: Record<string, number>;
  recentErrors: UserErrorRecord[];
}

export interface UserErrorRecord {
  timestamp: string;
  message: string | null;
  type: string | null;
}

export interface SummaryPayload {
  generatedAt: string;
  storage: "d1" | "kv";
  activeSessions: AppSessionRecord[];
  recentSessions: AppSessionRecord[];
  recentErrors: TelemetryEvent[];
  recentEvents: TelemetryEvent[];
  stats: {
    totalEvents: number;
    lifetimeEvents?: number;
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
  storage: { backend: "d1" | "kv"; available?: boolean };
  lastIngestAt: string | null;
  count: number;
  build: {
    commit: string;
    branch?: string;
    environment?: string;
    generatedAt?: string;
  };
}

export interface AuthUser {
  email: string;
  role: "admin" | "viewer";
}

export interface SessionPayload {
  authenticated: boolean;
  hasUsers: boolean;
  authMode?: AuthMode;
  user?: AuthUser;
}

export interface AuthActionPayload {
  user?: AuthUser;
  error?: string;
}

export interface AdminDataPayload {
  summary: SummaryPayload;
  health: HealthPayload;
  user: AuthUser;
  authMode?: AuthMode;
  error?: string;
}
