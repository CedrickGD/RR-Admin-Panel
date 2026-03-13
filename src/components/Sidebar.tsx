import {
  Activity,
  AlertTriangle,
  BarChart3,
  History,
  LogOut,
  Moon,
  Radio,
  RefreshCw,
  Settings2,
  Sun,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type {
  AuthMode,
  AuthUser,
  HealthPayload,
  PageKey,
  SummaryPayload,
  ThemeMode,
} from "../types/telemetry";
import { formatNumber, timeAgo } from "../utils/format";

export const DEFAULT_SIDEBAR_WIDTH = 296;
export const SIDEBAR_MIN_WIDTH = 248;
export const SIDEBAR_MAX_WIDTH = 420;

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavEntry[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="h-[17px] w-[17px]" /> },
  { key: "live", label: "Live", icon: <Radio className="h-[17px] w-[17px]" /> },
  { key: "workers", label: "Sessions", icon: <History className="h-[17px] w-[17px]" /> },
  { key: "logs", label: "Errors", icon: <AlertTriangle className="h-[17px] w-[17px]" /> },
  { key: "settings", label: "Settings", icon: <Settings2 className="h-[17px] w-[17px]" /> },
];

interface SidebarProps {
  page: PageKey;
  onNavigate: (key: PageKey) => void;
  user: AuthUser;
  authMode: AuthMode;
  summary?: SummaryPayload | null;
  health?: HealthPayload | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  onLogout: () => void;
  sidebarWidth: number;
  onResizeWidth: (width: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
}

export function Sidebar({
  page,
  onNavigate,
  user,
  authMode,
  summary,
  health,
  theme,
  onToggleTheme,
  onRefresh,
  refreshing = false,
  onLogout,
  sidebarWidth,
  onResizeWidth,
  onResizeStart,
  onResizeEnd,
}: SidebarProps) {
  const activeUsers = summary?.stats.activeUsers ?? 0;
  const totalSessions = summary?.stats.totalSessions ?? 0;
  const errorsLast24Hours = summary?.stats.errorsLast24Hours ?? 0;
  const ingestLabel = timeAgo(summary?.stats.lastIngestAt ?? health?.lastIngestAt ?? null);
  const storageLabel = summary?.storage?.toUpperCase() ?? health?.storage.backend?.toUpperCase() ?? "N/A";
  const systemLabel = health?.api === "alive" ? "API online" : "API offline";
  const pulseLabel = errorsLast24Hours > 0 ? "Monitoring incidents" : "Quiet telemetry window";
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(sidebarWidth);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const delta = event.clientX - resizeStartXRef.current;
      onResizeWidth(clampSidebarWidth(resizeStartWidthRef.current + delta));
    };

    const stopResizing = () => {
      setIsResizing(false);
      onResizeEnd();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizing, onResizeEnd, onResizeWidth]);

  function handleResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.innerWidth <= 1024 || event.pointerType === "touch") {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = sidebarWidth;
    setIsResizing(true);
    onResizeStart();
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand-mark">
          <Activity className="h-5 w-5" />
        </div>
        <div className="sidebar-brand-copy">
          <p className="sidebar-brand-title">RazorReaper Admin</p>
          <p className="sidebar-brand-subtitle">Operations Console</p>
        </div>
      </div>

      <section className="sidebar-block sidebar-command-block">
        <div className="sidebar-command-head">
          <div>
            <p className="sidebar-block-label">Command Deck</p>
            <p className="sidebar-command-title">{pulseLabel}</p>
          </div>
          <span className={`sidebar-pill ${errorsLast24Hours > 0 ? "sidebar-pill-warning" : "sidebar-pill-success"}`}>
            {systemLabel}
          </span>
        </div>

        <div className="sidebar-hero-metrics">
          <div>
            <span>Active</span>
            <strong>{formatNumber(activeUsers)}</strong>
          </div>
          <div>
            <span>Sessions</span>
            <strong>{formatNumber(totalSessions)}</strong>
          </div>
          <div>
            <span>Errors</span>
            <strong>{formatNumber(errorsLast24Hours)}</strong>
          </div>
          <div>
            <span>Storage</span>
            <strong>{storageLabel}</strong>
          </div>
        </div>

        <div className="sidebar-command-foot">
          <span>Last ingest</span>
          <strong>{ingestLabel}</strong>
        </div>
      </section>

      <section className="sidebar-block sidebar-nav-block">
        <p className="sidebar-block-label">Navigation</p>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${page === item.key ? "nav-item-active" : ""}`}
              onClick={() => onNavigate(item.key)}
              type="button"
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span className="nav-item-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </section>

      <div className="sidebar-spacer" />

      <section className="sidebar-block sidebar-controls-block">
        <p className="sidebar-block-label">Controls</p>
        <div className="sidebar-control-row">
          <button
            className="btn-icon"
            onClick={(event) => {
              event.preventDefault();
              onRefresh();
            }}
            title="Refresh data"
            type="button"
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button className="btn-icon" onClick={onToggleTheme} title="Toggle theme" type="button">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {authMode === "app" ? (
            <button className="btn-icon" onClick={onLogout} title="Sign out" type="button">
              <LogOut className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </section>

      <section className="sidebar-user">
        <p className="sidebar-user-email">{user.email}</p>
        <p className="sidebar-user-meta">
          {user.role} · {authMode === "access" ? "Zero Trust" : "App auth"}
        </p>
      </section>

      <button
        type="button"
        className="sidebar-resize-handle"
        onPointerDown={handleResizePointerDown}
        onDoubleClick={() => onResizeWidth(DEFAULT_SIDEBAR_WIDTH)}
        aria-label="Resize sidebar"
        title="Drag to resize sidebar"
      />
    </aside>
  );
}

export function MobileNav({
  page,
  onNavigate,
}: {
  page: PageKey;
  onNavigate: (key: PageKey) => void;
}) {
  return (
    <nav className="mobile-nav">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          className={`mobile-nav-btn ${page === item.key ? "mobile-nav-btn-active" : ""}`}
          onClick={() => onNavigate(item.key)}
          type="button"
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
