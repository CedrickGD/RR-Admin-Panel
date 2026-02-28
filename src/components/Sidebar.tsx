import {
  Activity,
  BarChart3,
  Globe,
  LogOut,
  Moon,
  Network,
  RefreshCw,
  ScrollText,
  Settings2,
  Sun,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AuthMode, AuthUser, PageKey, ThemeMode } from "../types/telemetry";

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavEntry[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 className="w-[18px] h-[18px]" /> },
  { key: "workers", label: "Workers", icon: <Users className="w-[18px] h-[18px]" /> },
  { key: "network", label: "Network", icon: <Network className="w-[18px] h-[18px]" /> },
  { key: "logs", label: "Logs", icon: <ScrollText className="w-[18px] h-[18px]" /> },
  { key: "settings", label: "Settings", icon: <Settings2 className="w-[18px] h-[18px]" /> },
];

interface SidebarProps {
  page: PageKey;
  onNavigate: (key: PageKey) => void;
  user: AuthUser;
  authMode: AuthMode;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}

export function Sidebar({
  page,
  onNavigate,
  user,
  authMode,
  theme,
  onToggleTheme,
  onRefresh,
  onLogout,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-white">
            <Activity className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="font-bold text-sm tracking-tight">RazorReaper</p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              Telemetry Dashboard
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 mb-2 border-b border-[hsl(var(--border))]" />

      {/* Navigation */}
      <nav className="flex-1 py-1">
        <p className="px-6 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
          Dashboard
        </p>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${page === item.key ? "nav-item-active" : ""}`}
            onClick={() => onNavigate(item.key)}
            type="button"
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="p-4 space-y-3 border-t border-[hsl(var(--border))]">
        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <button className="btn-icon" onClick={onRefresh} title="Refresh data" type="button">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="btn-icon" onClick={onToggleTheme} title="Toggle theme" type="button">
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
          {authMode === "app" ? (
            <button
              className="btn-icon"
              onClick={onLogout}
              title="Sign out"
              type="button"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        {/* User info */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <Globe className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{user.email}</p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase">
              {user.role}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* Mobile bottom nav */
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
