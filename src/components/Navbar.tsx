import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Layers,
  History,
  LogOut,
  Map,
  Menu,
  Radio,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { AuthMode, AuthUser, HealthPayload, PageKey, SummaryPayload } from "../types/telemetry";
import { formatNumber, timeAgo } from "../utils/format";

const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const NAV_GROUPS: Array<{ label: string; items: NavEntry[] }> = [
  {
    label: "Monitor",
    items: [
      { key: "overview", label: "Overview", icon: <BarChart3 className="h-[15px] w-[15px]" /> },
      { key: "traffic",  label: "Traffic",  icon: <Clock3    className="h-[15px] w-[15px]" /> },
      { key: "live",     label: "Live",     icon: <Radio     className="h-[15px] w-[15px]" /> },
      { key: "heatmap",  label: "Heatmap",  icon: <Map       className="h-[15px] w-[15px]" /> },
    ],
  },
  {
    label: "Analyze",
    items: [
      { key: "workers",  label: "Users & Sessions", icon: <History className="h-[15px] w-[15px]" /> },
      { key: "versions", label: "Versions",         icon: <Layers  className="h-[15px] w-[15px]" /> },
      { key: "logs",     label: "Errors",           icon: <AlertTriangle className="h-[15px] w-[15px]" /> },
    ],
  },
  {
    label: "System",
    items: [{ key: "settings", label: "Settings", icon: <Settings2 className="h-[15px] w-[15px]" /> }],
  },
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
 * v2 shell navigation: fixed left sidebar (command-center style). On mobile it
 * collapses into an overlay drawer behind a slim top bar.
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
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [page]);

  const activeUsers = summary?.stats.activeUsers ?? 0;
  const apiOk = health?.api === "alive";
  const ingestLabel = timeAgo(summary?.stats.lastIngestAt ?? health?.lastIngestAt ?? null);

  return (
    <>
      {/* Mobile top bar */}
      <div className="v2-mobilebar">
        <button type="button" className="btn-icon" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <img src={brandLogo} alt="" className="sb-brand-img" style={{ width: 26, height: 26 }} />
        <span className="sb-brand-name">RazorReaper</span>
        <div style={{ marginLeft: "auto" }} className={`sb-live${apiOk ? "" : " offline"}`}>
          <span className="sb-live-dot" />
          {formatNumber(activeUsers)} active
        </div>
      </div>
      {mobileOpen ? <div className="v2-scrim" onClick={() => setMobileOpen(false)} /> : null}

      {/* Sidebar */}
      <aside className={`sb${mobileOpen ? " open" : ""}`} aria-label="Main navigation">
        <button type="button" className="sb-brand" onClick={() => onNavigate("overview")} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
          <img src={brandLogo} alt="RazorReaper" className="sb-brand-img" />
          <span>
            <span className="sb-brand-name">RazorReaper</span>
            <span className="sb-brand-sub">Ops Console</span>
          </span>
        </button>

        {NAV_GROUPS.map((group) => (
          <div className="sb-group" key={group.label}>
            <p className="sb-group-label">{group.label}</p>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`sb-item${page === item.key ? " active" : ""}`}
                onClick={() => onNavigate(item.key)}
                aria-current={page === item.key ? "page" : undefined}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <div className="sb-foot">
          <div className={`sb-live${apiOk ? "" : " offline"}`} title={`API ${apiOk ? "online" : "offline"}`}>
            <span className="sb-live-dot" />
            {apiOk ? `${formatNumber(activeUsers)} active now` : "API offline"}
          </div>
          <span className="sb-foot-meta" title="Last ingest">ingest · {ingestLabel}</span>
          <div className="sb-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh data"
              style={{ flex: 1, justifyContent: "center" }}
            >
              <RefreshCw className={`h-3.5 w-3.5${refreshing ? " animate-spin" : ""}`} />
              {refreshing ? "Syncing" : "Refresh"}
            </button>
            {authMode === "app" ? (
              <button
                type="button"
                className="btn-icon"
                onClick={onLogout}
                aria-label="Sign out"
                title={`Signed in as ${user.email}`}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
