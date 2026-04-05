export type TelemetryStatus = "ok" | "degraded" | "down";
export type AuthMode = "app" | "access";
export type ThemeMode = "dark" | "light";
export type PageKey =
  | "overview"
  | "traffic"
  | "signals"
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
  platform: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  isActive: boolean;
  lastEvent: string | null;
  lastStatus: TelemetryStatus;
  errorCount: number;
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
