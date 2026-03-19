import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Globe2,
  History,
  LogOut,
  Map,
  Menu,
  Radio,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { AuthMode, AuthUser, HealthPayload, PageKey, SummaryPayload } from "../types/telemetry";
import { formatNumber, timeAgo } from "../utils/format";

const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavEntry[] = [
  { key: "overview",  label: "Overview",  icon: <BarChart3 className="h-[15px] w-[15px]" /> },
  { key: "traffic",   label: "Traffic",   icon: <Clock3    className="h-[15px] w-[15px]" /> },
  { key: "signals",   label: "Signals",   icon: <Globe2    className="h-[15px] w-[15px]" /> },
  { key: "heatmap",   label: "Heatmap",   icon: <Map       className="h-[15px] w-[15px]" /> },
  { key: "live",      label: "Live",      icon: <Radio     className="h-[15px] w-[15px]" /> },
  { key: "workers",   label: "Sessions",  icon: <History   className="h-[15px] w-[15px]" /> },
  { key: "logs",      label: "Errors",    icon: <AlertTriangle className="h-[15px] w-[15px]" /> },
  { key: "settings",  label: "Settings",  icon: <Settings2 className="h-[15px] w-[15px]" /> },
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
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  /* ─── Scroll-based transparency ─── */
  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 12);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /* ─── Close mobile menu on page change ─── */
  useEffect(() => { setMobileOpen(false); }, [page]);

  /* ─── Close mobile menu on outside click ─── */
  useEffect(() => {
    if (!mobileOpen) return;
    function handler(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileOpen]);

  /* ─── Status chip data ─── */
  const activeUsers = summary?.stats.activeUsers ?? 0;
  const errorsLast24h = summary?.stats.errorsLast24Hours ?? 0;
  const apiOk = health?.api === "alive";
  const ingestLabel = timeAgo(summary?.stats.lastIngestAt ?? health?.lastIngestAt ?? null);
  const statusDotClass = !apiOk ? "err" : errorsLast24h > 0 ? "warn" : "pulse";

  return (
    <>
      <nav ref={navRef} className={`navbar${scrolled ? " is-scrolled" : ""}`} aria-label="Main navigation">
        <div className="navbar-inner">
          {/* Brand */}
          <button
            type="button"
            className="navbar-brand"
            onClick={() => onNavigate("overview")}
            aria-label="Go to overview"
          >
            <img src={brandLogo} alt="RazorReaper" className="navbar-brand-img" />
            <span>
              <span className="navbar-brand-name">RazorReaper</span>
              <span className="navbar-brand-sub"> Console</span>
            </span>
          </button>

          <div className="navbar-divider" aria-hidden />

          {/* Desktop nav */}
          <nav className="navbar-nav" aria-label="Page navigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`navbar-link${page === item.key ? " active" : ""}`}
                onClick={() => onNavigate(item.key)}
                aria-current={page === item.key ? "page" : undefined}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right actions */}
          <div className="navbar-actions">
            {/* Status chip */}
            <div className="status-chip" title={`API ${apiOk ? "online" : "offline"} · Last ingest ${ingestLabel}`}>
              <span className={`status-dot ${statusDotClass}`} />
              <span>{formatNumber(activeUsers)} active</span>
            </div>

            {/* Refresh */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh data"
            >
              <RefreshCw className={`h-3.5 w-3.5${refreshing ? " animate-spin" : ""}`} />
              <span className="hidden sm:inline">{refreshing ? "Syncing" : "Refresh"}</span>
            </button>

            {/* Sign out */}
            {authMode === "app" ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onLogout}
                aria-label="Sign out"
                title={`Signed in as ${user.email}`}
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Sign out</span>
              </button>
            ) : null}

            {/* Mobile hamburger */}
            <button
              type="button"
              className="navbar-hamburger btn-icon"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      <div className={`navbar-mobile-drawer${mobileOpen ? " open" : ""}`} aria-hidden={!mobileOpen}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`navbar-mobile-link${page === item.key ? " active" : ""}`}
            onClick={() => onNavigate(item.key)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        <div className="divider" style={{ margin: "10px 0" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingTop: "4px" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-3)", padding: "0 12px" }}>
            Signed in as <strong style={{ color: "var(--text-2)" }}>{user.email}</strong>
          </div>
          {authMode === "app" ? (
            <button
              type="button"
              className="navbar-mobile-link"
              onClick={onLogout}
              style={{ color: "hsl(4 86% 68%)" }}
            >
              <LogOut className="h-[15px] w-[15px]" />
              Sign out
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
