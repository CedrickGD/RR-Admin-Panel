import {
  Database,
  GitBranch,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  LogOut,
  Shield,
  User,
} from "lucide-react";
import type { AuthMode, AuthUser, HealthPayload, SummaryPayload } from "../types/telemetry";
import { formatDate, formatDuration } from "../utils/format";

interface SettingsPageProps {
  user: AuthUser;
  authMode: AuthMode;
  summary: SummaryPayload;
  health: HealthPayload;
  onLogout: () => void;
}

function SettingRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-[hsl(var(--border)/0.4)] last:border-0">
      <div className="p-2 rounded-lg bg-[hsl(var(--muted)/0.4)] text-[hsl(var(--muted-foreground))]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

export function SettingsPage({
  user,
  authMode,
  summary,
  health,
  onLogout,
}: SettingsPageProps) {
  return (
    <div className="page-content">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Account information & system details
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Account */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-[hsl(var(--primary))]" />
            Account
          </h3>
          <SettingRow
            icon={<Globe className="w-4 h-4" />}
            label="Email"
            value={user.email}
          />
          <SettingRow
            icon={<Shield className="w-4 h-4" />}
            label="Role"
            value={user.role.charAt(0).toUpperCase() + user.role.slice(1)}
          />
          <SettingRow
            icon={<KeyRound className="w-4 h-4" />}
            label="Auth Mode"
            value={
              authMode === "access"
                ? "Cloudflare Access"
                : "Email & Password"
            }
          />
          {authMode === "app" ? (
            <div className="mt-4">
              <button
                type="button"
                className="btn-danger flex items-center gap-2 text-sm"
                onClick={onLogout}
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          ) : null}
        </div>

        {/* System */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[hsl(var(--primary))]" />
            System
          </h3>
          <SettingRow
            icon={<Database className="w-4 h-4" />}
            label="Storage Backend"
            value={summary.storage.toUpperCase()}
          />
          <SettingRow
            icon={<Info className="w-4 h-4" />}
            label="API Status"
            value={health.api === "alive" ? "Online" : "Offline"}
          />
          <SettingRow
            icon={<GitBranch className="w-4 h-4" />}
            label="Build Commit"
            value={health.build?.commit ?? "unknown"}
          />
          {health.build?.branch ? (
            <SettingRow
              icon={<GitBranch className="w-4 h-4" />}
              label="Branch"
              value={health.build.branch}
            />
          ) : null}
          {health.build?.environment ? (
            <SettingRow
              icon={<Globe className="w-4 h-4" />}
              label="Environment"
              value={health.build.environment}
            />
          ) : null}
        </div>

        {/* Data summary */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-[hsl(var(--primary))]" />
            Data Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-xl bg-[hsl(var(--muted)/0.3)]">
              <p className="text-2xl font-bold font-[JetBrains_Mono,monospace] text-[hsl(var(--primary))]">
                {summary.stats.totalEvents.toLocaleString()}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Total Events
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-[hsl(var(--muted)/0.3)]">
              <p className="text-2xl font-bold font-[JetBrains_Mono,monospace] text-[hsl(var(--accent))]">
                {summary.stats.totalSessions}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Sessions
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-[hsl(var(--muted)/0.3)]">
              <p className="text-2xl font-bold font-[JetBrains_Mono,monospace] text-amber-400">
                {summary.stats.activeUsers}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Active Users
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-[hsl(var(--muted)/0.3)]">
              <p className="text-sm font-bold font-[JetBrains_Mono,monospace] text-rose-400">
                {formatDuration(summary.stats.averageSessionDurationSeconds)}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Avg Session
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
            <div className="rounded-xl bg-[hsl(var(--muted)/0.3)] p-4 text-center">
              <p className="text-lg font-bold font-[JetBrains_Mono,monospace]">
                {summary.stats.sessionsStartedToday}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Started Today</p>
            </div>
            <div className="rounded-xl bg-[hsl(var(--muted)/0.3)] p-4 text-center">
              <p className="text-lg font-bold font-[JetBrains_Mono,monospace]">
                {summary.stats.sessionsEndedToday}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Ended Today</p>
            </div>
            <div className="rounded-xl bg-[hsl(var(--muted)/0.3)] p-4 text-center col-span-2 sm:col-span-1">
              <p className="text-sm font-bold font-[JetBrains_Mono,monospace]">
                {formatDate(summary.stats.lastIngestAt)}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Last Ingest</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
