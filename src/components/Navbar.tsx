import {
  AlertTriangle,
  BarChart3,
  Clock3,
  History,
  Key,
  Layers,
  LogOut,
  Map,
  Menu,
  Radio,
  RefreshCw,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import type { AuthMode, AuthUser, HealthPayload, PageKey, SummaryPayload } from "../types/telemetry";
import { timeAgo } from "../utils/format";

const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface NavEntry {
  key: PageKey;
  label: string;
  Icon: LucideIcon;
}

/** Canonical DS nav mapping — flat, no groups (design-system readme: ICONOGRAPHY). */
const NAV_ITEMS: NavEntry[] = [
  { key: "overview", label: "Overview", Icon: BarChart3 },
  { key: "traffic",  label: "Traffic",  Icon: Clock3 },
  { key: "versions", label: "Versions", Icon: Layers },
  { key: "heatmap",  label: "Heatmap",  Icon: Map },
  { key: "live",     label: "Live",     Icon: Radio },
  { key: "workers",  label: "Sessions", Icon: History },
  { key: "logs",     label: "Errors",   Icon: AlertTriangle },
  { key: "licenses", label: "Licenses", Icon: Key },
  { key: "settings", label: "Settings", Icon: Settings2 },
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
 * Sticky horizontal top navbar: brand left · icon+label tabs · live status +
 * actions right. Slightly translucent so the aurora bleeds through (no blur —
 * that's disabled globally for perf). It sizes to the viewport: full labels on
 * wide screens, active-only labels when it gets tight, and on a detected phone
 * the tabs collapse behind a burger that opens a full nav drawer.
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
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const apiOk = health?.api === "alive";
  const ingestLabel = timeAgo(summary?.stats.lastIngestAt ?? health?.lastIngestAt ?? null);
  const showLogout = authMode === "app";

  function navigate(key: PageKey) {
    onNavigate(key);
    setDrawerOpen(false);
  }

  // Leaving mobile (rotate to landscape, resize) must not strand an open drawer.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // While the drawer is open: lock body scroll, close on Escape, and keep
  // Tab cycling inside the sheet (the scrim'd content behind is inert).
  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusables = Array.from(sheet.querySelectorAll<HTMLElement>("button"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !sheet.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !sheet.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  // Focus follows the drawer: into the sheet when it opens, back to the
  // burger when it closes — otherwise closing strands focus on <body>.
  useEffect(() => {
    if (drawerOpen) {
      wasOpen.current = true;
      sheetRef.current?.querySelector<HTMLElement>(".tn-sheet-item")?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      burgerRef.current?.focus();
    }
  }, [drawerOpen]);

  const refreshButton = (
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
  );

  const liveStatus = (
    <div className={`tn-live${apiOk ? "" : " offline"}`} title={`API ${apiOk ? "online" : "offline"}`}>
      <span className="tn-live-dot" />
      {apiOk ? "Ingest online" : "Ingest offline"}
    </div>
  );

  return (
    <>
      <header className={`topnav${isMobile ? " topnav--mobile" : ""}`}>
        {isMobile ? (
          <button
            ref={burgerRef}
            type="button"
            className="btn-icon tn-burger"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={drawerOpen}
            // Only reference the sheet while it exists — a dangling IDREF
            // when closed is an ARIA violation (the sheet mounts on open).
            aria-controls={drawerOpen ? "tn-mobile-sheet" : undefined}
          >
            {drawerOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        ) : null}

        <button type="button" className="tn-brand" onClick={() => navigate("overview")} title="RazorReaper — Overview">
          <img src={brandLogo} alt="" className="tn-brand-img" />
          <span className="tn-brand-text">
            <span className="tn-brand-name">RazorReaper</span>
            <span className="tn-brand-sub">Operations Console</span>
          </span>
        </button>

        {!isMobile ? (
          <nav className="tn-nav" aria-label="Primary">
            {NAV_ITEMS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className={`tn-item${page === key ? " active" : ""}`}
                onClick={() => navigate(key)}
                aria-current={page === key ? "page" : undefined}
                title={label}
              >
                <Icon size={17} />
                <span className="tn-label">{label}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <div className="tn-right">
          {!isMobile ? liveStatus : null}
          {!isMobile ? <div className="tn-meta" title="Last ingest">ingest · {ingestLabel}</div> : null}
          <div className="tn-actions">
            {refreshButton}
            {!isMobile && showLogout ? (
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

      {isMobile && drawerOpen ? (
        <>
          <div className="tn-scrim" onClick={() => setDrawerOpen(false)} aria-hidden />
          <nav id="tn-mobile-sheet" ref={sheetRef} className="tn-sheet" aria-label="Primary">
            <div className="tn-sheet-list">
              {NAV_ITEMS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`tn-sheet-item${page === key ? " active" : ""}`}
                  onClick={() => navigate(key)}
                  aria-current={page === key ? "page" : undefined}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="tn-sheet-foot">
              {liveStatus}
              <div className="tn-meta" title="Last ingest">ingest · {ingestLabel}</div>
              {showLogout ? (
                <button type="button" className="btn btn-ghost tn-sheet-logout" onClick={onLogout}>
                  <LogOut size={16} />
                  <span>Sign out · {user.email}</span>
                </button>
              ) : null}
            </div>
          </nav>
        </>
      ) : null}
    </>
  );
}
