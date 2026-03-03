export type TelemetryStatus = "ok" | "degraded" | "down";
export type AuthMode = "app" | "access";
export type ThemeMode = "dark" | "light";
export type Timeframe = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y";
export type PageKey = "overview" | "live" | "workers" | "network" | "actions" | "logs" | "settings";

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
  storage: "d1" | "kv";
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

export interface ChartPoint {
  label: string;
  value: number;
}

export interface PieSlice {
  name: string;
  value: number;
}

export interface WorkerRow {
  name: string;
  events: number;
  lastSeen: string;
  status: TelemetryStatus;
  platform: string;
  version: string;
  services: number;
}

export interface MetricKeyCount {
  key: string;
  count: number;
}
