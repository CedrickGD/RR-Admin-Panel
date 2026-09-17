import type { FeedbackKind, FeedbackUnread } from "../../shared/feedback-contract";
import type { BackgroundFaultReport } from "../../shared/telemetry-contract";

export type { FeedbackKind, FeedbackUnread };

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
  | "announcements"
  | "releases"
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
  /** Panel account that lifted it. Optional: older API builds do not send the column. */
  lifted_by?: string | null;
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
  /** client_ip of the newest session. Optional like the other later rollup fields. */
  lastIp?: string | null;
  /** Distinct client_ip values across every session of the identity. */
  ipCount?: number;
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
  /**
   * What a listed background fault row stands for (one fault, a first sighting, a 5-minute
   * rollup, or suppressed I/O — shared/telemetry-contract.ts). null on a real error.
   */
  report?: BackgroundFaultReport | null;
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
  firstErrorAt: string;
  lastErrorAt: string;
  /** Newest first; capped per user. Real errors only — background faults ship aggregated. */
  events: ErrorEventDetail[];
  truncated: boolean;
}

/**
 * One background fault: error_kind = 'background' events grouped by error code and base
 * exception type. A desktop-client bug (an unobserved task exception thrown in a loop), not a
 * crash — never counted as an error in any KPI or per-customer count.
 */
export interface BackgroundFaultGroup {
  /** metrics.error_code, e.g. "RR-E1003". */
  code: string | null;
  /** metrics.base_exception_type (the wrapped exception), else metrics.exception_type. */
  exceptionType: string | null;
  /** metrics.fault_source: "unobserved_task" (also every pre-1.5.3 row) or "render_dispatch". */
  faultSource: string;
  /** metrics.top_frame — the top RazorReaper frame; null for rows from clients before 1.5.3. */
  topFrame: string | null;
  /** metrics.top_frames of the group's newest row: up to three frames joined with " > ". */
  topFrames: string | null;
  /**
   * Faults in the group: SUM(occurrences) over its rows, one per row from a client before
   * 1.5.3. Suppressed-I/O rows (report_kind "suppressed") are not in it — they are not faults.
   * Kept under its historic wire name.
   */
  events: number;
  /** Rows (client reports) behind `events`. Equal to it until a client rolls repeats up. */
  reports: number;
  /** Distinct hwid, else install_id — the identity the customer rollup uses. */
  installs: number;
  sessions: number;
  /** Sessions in which the component stopped rendering (render_stopped); 0 for task faults. */
  stoppedSessions: number;
  /** Distinct app versions, newest first (capped). */
  versions: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface ErrorsPayload {
  generatedAt: string;
  range: string;
  cutoff: string | null;
  /**
   * True when the range held more real error events than one scan reads — the oldest are
   * missing from `users` and `totals.errors`. Background faults never count toward it.
   */
  scanTruncated: boolean;
  /** True when more users had errors than one response ships (totals still cover everyone). */
  usersTruncated: boolean;
  totals: {
    errors: number;
    /** Background faults in range (SUM of occurrences), over every group, suppressed I/O excluded. */
    backgroundErrors: number;
    /**
     * Aborted Discord-pipe I/O faults the client dropped before reporting, in range. Not app
     * faults: never listed, never counted. Optional: older rr-api builds do not send it.
     */
    backgroundSuppressed?: number;
    affectedUsers: number;
    lastErrorAt: string | null;
  };
  users: ErrorUserGroup[];
  /** Most frequent first. Optional: rr-api builds before WP 2.9 do not send it. */
  backgroundFaults?: BackgroundFaultGroup[];
  /** True when more fault groups exist than one response ships. */
  backgroundFaultsTruncated?: boolean;
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
  /** Unread feedback per inbox for the rail badge; absent without support.read or on a DB failure. */
  feedbackUnread?: FeedbackUnread;
}

export type FeedbackStatus = "new" | "read" | "archived";

/**
 * One row of GET /api/admin/feedback (functions/_lib/content.ts FeedbackRow plus the report id
 * the admin route merges in). `kind` says which inbox it belongs to (shared/feedback-contract.ts).
 */
export interface FeedbackRecord {
  id: number;
  message: string;
  contact: string | null;
  hwid: string | null;
  install_id: string | null;
  license_key: string | null;
  machine_name: string | null;
  app_version: string | null;
  platform: string | null;
  status: FeedbackStatus;
  kind: FeedbackKind;
  created_at: string;
  report_id?: string;
}

/** Mirror of functions/_lib/types.ts HealthPayload. The dashboard only checks that it arrived. */
export interface HealthPayload {
  ok: boolean;
  storage: { available: boolean };
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
