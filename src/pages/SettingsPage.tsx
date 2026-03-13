import { LogOut } from "lucide-react";
import type { AuthMode, AuthUser, HealthPayload, SummaryPayload } from "../types/telemetry";
import { formatDate, formatNumber } from "../utils/format";

interface SettingsPageProps {
  user: AuthUser;
  authMode: AuthMode;
  summary: SummaryPayload;
  health: HealthPayload;
  onLogout: () => void;
}

export function SettingsPage({
  user,
  authMode,
  summary,
  health,
  onLogout,
}: SettingsPageProps) {
  return (
    <div className="page-content page-content-wide page-stack">
      <section className="page-header">
        <div>
          <p className="page-kicker">Configuration</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Account and backend information.</p>
        </div>

        <div className="page-header-side">
          <div className="page-meta-stack">
            <div className="page-meta">
              <span>Auth mode</span>
              <strong>{authMode === "access" ? "Zero Trust" : "App auth"}</strong>
            </div>
            <div className="page-meta">
              <span>Storage</span>
              <strong>{summary.storage.toUpperCase()}</strong>
            </div>
            <div className="page-meta">
              <span>Last ingest</span>
              <strong>{summary.stats.lastIngestAt ? formatDate(summary.stats.lastIngestAt) : "Waiting"}</strong>
            </div>
          </div>
        </div>
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Account</h2>
              <p className="panel-subtitle">Current dashboard identity.</p>
            </div>
          </div>

          <div className="info-list">
            <InfoRow label="Email" value={user.email} />
            <InfoRow label="Role" value={user.role} />
            <InfoRow label="Auth mode" value={authMode === "access" ? "Cloudflare Access" : "Email & Password"} />
          </div>

          {authMode === "app" ? (
            <div className="section-actions">
              <button type="button" className="btn-danger" onClick={onLogout}>
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">System</h2>
              <p className="panel-subtitle">Build and backend status.</p>
            </div>
          </div>

          <div className="info-list">
            <InfoRow label="Storage" value={summary.storage.toUpperCase()} />
            <InfoRow label="API" value={health.api === "alive" ? "Online" : "Offline"} />
            <InfoRow label="Commit" value={health.build?.commit ?? "unknown"} />
            <InfoRow label="Branch" value={health.build?.branch ?? "unknown"} />
            <InfoRow label="Environment" value={health.build?.environment ?? "unknown"} />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Data Summary</h2>
            <p className="panel-subtitle">Current loaded totals without the low-signal session close metrics.</p>
          </div>
        </div>

        <div className="stats-grid">
          <Summary label="Total Events" value={formatNumber(summary.stats.totalEvents)} />
          <Summary label="Total Sessions" value={formatNumber(summary.stats.totalSessions)} />
          <Summary label="Active Users" value={formatNumber(summary.stats.activeUsers)} />
          <Summary label="Started Today" value={formatNumber(summary.stats.sessionsStartedToday)} />
          <Summary label="Errors 24h" value={formatNumber(summary.stats.errorsLast24Hours)} />
          <Summary label="Recent Errors Loaded" value={formatNumber(summary.recentErrors.length)} />
          <Summary label="Last Ingest" value={summary.stats.lastIngestAt ? formatDate(summary.stats.lastIngestAt) : "Waiting"} />
        </div>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="simple-stat">
      <p className="simple-stat-label">{label}</p>
      <p className="simple-stat-value">{value}</p>
    </div>
  );
}
