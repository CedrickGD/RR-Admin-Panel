import {
  AlertTriangle,
  BarChart3,
  Clock3,
  History,
  Layers,
  LogOut,
  Map,
  Radio,
  RefreshCw,
  Settings2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AuthMode, AuthUser, HealthPayload, PageKey, SummaryPayload } from "../types/telemetry";
import { timeAgo } from "../utils/format";

const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

/** Canonical DS nav mapping — flat, no groups (design-system readme: ICONOGRAPHY). */
const NAV_ITEMS: NavEntry[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 size={16} /> },
  { key: "traffic",  label: "Traffic",  icon: <Clock3 size={16} /> },
  { key: "versions", label: "Versions", icon: <Layers size={16} /> },
  { key: "heatmap",  label: "Heatmap",  icon: <Map size={16} /> },
  { key: "live",     label: "Live",     icon: <Radio size={16} /> },
  { key: "workers",  label: "Sessions", icon: <History size={16} /> },
  { key: "logs",     label: "Errors",   icon: <AlertTriangle size={16} /> },
  { key: "settings", label: "Settings", icon: <Settings2 size={16} /> },
];

export interface NavbarProps {
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

/**
 * DS TopNav shell: sticky frosted top navbar — brand lockup left, flat
 * horizontal nav with a glowing accent tick on the navbar's bottom edge,
 * live ingest status + mono meta + icon actions right. Below 900px the
 * nav drops to a second horizontally scrollable row (see css/shell.css).
 */
export function Navbar({
  page,
  onNavigate,
  user,
  authMode,
  summary,
  health,
  onRefresh,
  refreshing = false,
  onLogout,
}: NavbarProps) {
  const apiOk = health?.api === "alive";
  const ingestLabel = timeAgo(summary?.stats.lastIngestAt ?? health?.lastIngestAt ?? null);

  return (
    <header className="topnav">
      <div className="tn-brand">
        <img src={brandLogo} alt="RazorReaper logo" className="tn-brand-img" />
        <div>
          <span className="tn-brand-name">RazorReaper</span>
          <span className="tn-brand-sub">Operations Console</span>
        </div>
      </div>

      <nav className="tn-nav" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`tn-item${page === item.key ? " active" : ""}`}
            onClick={() => onNavigate(item.key)}
            aria-current={page === item.key ? "page" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="tn-right">
        <div className={`tn-live${apiOk ? "" : " offline"}`} title={`API ${apiOk ? "online" : "offline"}`}>
          <span className="tn-live-dot" />
          {apiOk ? "Ingest online" : "Ingest offline"}
        </div>
        <div className="tn-meta" title="Last ingest">ingest · {ingestLabel}</div>
        <div className="tn-actions">
          <button
            type="button"
            className="btn-icon"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh data"
            title={refreshing ? "Syncing" : "Refresh data"}
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : undefined} />
          </button>
          {authMode === "app" ? (
            <button
              type="button"
              className="btn-icon"
              onClick={onLogout}
              aria-label="Sign out"
              title={`Signed in as ${user.email}`}
            >
              <LogOut size={16} />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
