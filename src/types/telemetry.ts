export type TelemetryStatus = "ok" | "degraded" | "down";
export type AuthMode = "app" | "access";
export type ThemeMode = "dark" | "light";
export type PageKey =
  | "system"
  | "team"
  | "overview"
  | "traffic"
  | "versions"
  | "heatmap"
  | "live"
  | "workers"
  | "customers"
  | "errors"
  | "settings"
  | "licenses"
  | "access"
  | "announcements"
  | "feedback";

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
  licenses?: Array<{
    license_key: string;
    max_uses: number;
    custom_options: string;
    status: string;
    type: string;
    duration_days: number | null;
    usage_count: number;
    expires_at: string | null;
    created_at: string;
  }>;
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
  filters: {
    rangeDays: number | null;
    version: string | null;
    platform: string | null;
    country: string | null;
  };
  totals: {
    lifetimeUsers: number;
    lifetimeSessions: number;
    lifetimeEvents: number;
    freeDownloads: number;
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

export type SuspensionMode = "ban" | "suspend";

export interface UserSuspensionSummary {
  mode: SuspensionMode;
  reason: string | null;
  bannedUntil: string | null;
  hadPaidLicense: boolean;
  createdAt: string;
}

/** Full suspension record from /api/admin/access (the "Suspensions" table). */
export interface SuspensionRecord {
  id: number;
  identity: string;
  hwid: string | null;
  install_id: string | null;
  user_label: string | null;
  mode: SuspensionMode;
  reason: string | null;
  banned_until: string | null;
  is_active: number;
  had_paid_license: number;
  paid_license_keys: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lifted_at: string | null;
}

/** One registered install (rr.install.v1) of a device, from GET /api/admin/installs?hwid=. */
export interface InstallRecord {
  installId: string;
  hwid: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  licenseId: number | null;
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
  licenseTier?: "premium" | "free";
  paidLicenseKeys?: string[];
  suspension?: UserSuspensionSummary | null;
  hwid: string | null;
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

export interface UserActivityDay {
  /** Local calendar date (user's timezone), YYYY-MM-DD. */
  date: string;
  seconds: number;
  sessions: number;
}

export interface UserActivityInterval {
  startedAt: string;
  endedAt: string;
  /** End came from the most recent heartbeat rather than an explicit session_end. */
  approximateEnd: boolean;
}

/** Per-user behaviour analytics from GET /api/admin/user-activity. */
export interface UserActivityPayload {
  identity: string;
  timezone: string;
  rangeDays: number | null;
  totalSeconds: number;
  sessionCount: number;
  averageSessionSeconds: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Only legacy install-scoped sessions exist — no per-run history available. */
  legacyOnly: boolean;
  days: UserActivityDay[];
  intervals: UserActivityInterval[];
  intervalsComplete: boolean;
  /** Seconds online per weekday x hour (local time); [0][*] = Monday. */
  hourOfWeek: number[][];
  hourOfDay: number[];
  weekdayTotals: number[];
}

export type ErrorsRangeKey = "1h" | "6h" | "12h" | "24h" | "3d" | "7d" | "30d" | "all";

export interface ErrorEventDetail {
  id: string;
  timestamp: string;
  receivedAt: string;
  message: string | null;
  type: string | null;
  kind: string | null;
  code: string | null;
  sessionId: string | null;
  appVersion: string | null;
  source: string;
  /** Leftover metrics after the surfaced/identity/geo keys are stripped. */
  extras: Record<string, string>;
}

export interface ErrorUserGroup {
  identity: string;
  userLabel: string | null;
  discordUser: string | null;
  hwid: string | null;
  installId: string | null;
  licenseTier: "premium" | "free";
  country: string | null;
  city: string | null;
  timezone: string | null;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  appVersion: string | null;
  displayVersion: string | null;
  isActive: boolean;
  lastSeen: string | null;
  /** Real (non-background) errors in range — counted before the per-user event cap. */
  errorCount: number;
  backgroundCount: number;
  firstErrorAt: string;
  lastErrorAt: string;
  /** Newest first; capped per user, background events flagged via `kind`. */
  events: ErrorEventDetail[];
  truncated: boolean;
}

export interface ErrorsPayload {
  generatedAt: string;
  range: string;
  cutoff: string | null;
  /** True when the range held more error events than one scan reads (oldest are missing). */
  scanTruncated: boolean;
  /** True when more users had errors than one response ships (totals still cover everyone). */
  usersTruncated: boolean;
  totals: {
    errors: number;
    backgroundErrors: number;
    affectedUsers: number;
    lastErrorAt: string | null;
  };
  users: ErrorUserGroup[];
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
  panelRole?: import("../../shared/panel-policy").PanelRole;
  permissions?: import("../../shared/panel-policy").Permission[];
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
