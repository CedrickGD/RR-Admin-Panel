import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Globe2,
  History,
  LogOut,
  Map,
  Radio,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  AuthMode,
  AuthUser,
  HealthPayload,
  PageKey,
  SummaryPayload,
} from "../types/telemetry";
import { formatNumber, timeAgo } from "../utils/format";

const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavEntry[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="h-[17px] w-[17px]" /> },
  { key: "traffic", label: "Traffic", icon: <Clock3 className="h-[17px] w-[17px]" /> },
  { key: "signals", label: "Signals", icon: <Globe2 className="h-[17px] w-[17px]" /> },
  { key: "heatmap", label: "Heatmap", icon: <Map className="h-[17px] w-[17px]" /> },
  { key: "live", label: "Live", icon: <Radio className="h-[17px] w-[17px]" /> },
  { key: "workers", label: "Sessions", icon: <History className="h-[17px] w-[17px]" /> },
  { key: "logs", label: "Errors", icon: <AlertTriangle className="h-[17px] w-[17px]" /> },
  { key: "settings", label: "Settings", icon: <Settings2 className="h-[17px] w-[17px]" /> },
];

interface TopNavProps {
  page: PageKey;
  onNavigate: (key: PageKey) => void;
  user: AuthUser;
  authMode: AuthMode;
  summary?: SummaryPayload | null;
  health?: HealthPayload | null;
  onRefresh: () => void;
  refreshing?: boolean;
  onLogout: () => void;
}

export function TopNav({
  page,
  onNavigate,
  user,
  authMode,
  summary,
  health,
  onRefresh,
  refreshing = false,
  onLogout,
}: TopNavProps) {
  const activeUsers = summary?.stats.activeUsers ?? 0;
  const totalSessions = summary?.stats.totalSessions ?? 0;
  const errorsLast24Hours = summary?.stats.errorsLast24Hours ?? 0;
  const ingestLabel = timeAgo(summary?.stats.lastIngestAt ?? health?.lastIngestAt ?? null);
  const storageLabel = summary?.storage?.toUpperCase() ?? health?.storage.backend?.toUpperCase() ?? "N/A";
  const apiLabel = health?.api === "alive" ? "API online" : "API offline";

  return (
    <header className="topbar">
      <div className="topbar-shell">
        <div className="topbar-main">
          <button type="button" className="topbar-brand" onClick={() => onNavigate("overview")}>
            <span className="topbar-brand-mark">
              <img src={brandLogo} alt="RazorReaper logo" className="topbar-brand-image" />
            </span>
            <span className="topbar-brand-copy">
              <strong>RazorReaper</strong>
              <span>Operations Console</span>
            </span>
          </button>

          <nav className="topbar-nav" aria-label="Dashboard sections">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`topbar-nav-item ${page === item.key ? "topbar-nav-item-active" : ""}`}
                onClick={() => onNavigate(item.key)}
              >
                <span className="topbar-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="topbar-actions">
            <button type="button" className="btn-ghost topbar-action-button" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
            {authMode === "app" ? (
              <button type="button" className="btn-danger topbar-action-button" onClick={onLogout}>
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            ) : null}
          </div>
        </div>

        <div className="topbar-statusbar">
          <div className="topbar-statusbar-item">
            <span>Operator</span>
            <strong>{user.email}</strong>
          </div>
          <div className="topbar-statusbar-item">
            <span>Mode</span>
            <strong>{authMode === "access" ? "Cloudflare Access" : "App auth"}</strong>
          </div>
          <div className="topbar-statusbar-item">
            <span>System</span>
            <strong>{apiLabel}</strong>
          </div>
          <div className="topbar-statusbar-item">
            <span>Active</span>
            <strong>{formatNumber(activeUsers)}</strong>
          </div>
          <div className="topbar-statusbar-item">
            <span>Sessions</span>
            <strong>{formatNumber(totalSessions)}</strong>
          </div>
          <div className="topbar-statusbar-item">
            <span>Errors</span>
            <strong>{formatNumber(errorsLast24Hours)}</strong>
          </div>
          <div className="topbar-statusbar-item">
            <span>Storage</span>
            <strong>{storageLabel}</strong>
          </div>
          <div className="topbar-statusbar-item">
            <span>Last ingest</span>
            <strong>{ingestLabel}</strong>
          </div>
        </div>
      </div>
    </header>
  );
}
