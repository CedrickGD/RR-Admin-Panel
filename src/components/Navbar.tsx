import {
  AlertTriangle,
  BarChart3,
  Clock3,
  History,
  Layers,
  LogOut,
  Map,
  Menu,
  Radio,
  RefreshCw,
  Settings2,
  X,
  Key,
  Megaphone,
  MessageSquare,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AuthMode, AuthUser, HealthPayload, PageKey, SummaryPayload } from "../types/telemetry";
import { timeAgo } from "../utils/format";

const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

/**
 * Canonical DS nav mapping — flat, no group headers (design-system readme: ICONOGRAPHY),
 * but sequenced by mental model so related pages sit together:
 *   Analytics (aggregate history) → Live Ops (realtime) →
 *   Users & Support (per-user surfaces) → System (broadcast + config, last).
 */
const NAV_ITEMS: NavEntry[] = [
  // Analytics — aggregate, historical views
  { key: "overview", label: "Overview", icon: <BarChart3 size={16} /> },
  { key: "traffic",  label: "Traffic",  icon: <Clock3 size={16} /> },
  { key: "versions", label: "Versions", icon: <Layers size={16} /> },
  { key: "heatmap",  label: "Heatmap",  icon: <Map size={16} /> },
  // Live Ops — realtime / recent
  { key: "live",     label: "Live",     icon: <Radio size={16} /> },
  { key: "workers",  label: "Sessions", icon: <History size={16} /> },
  // Users & Support — per-user surfaces
  { key: "licenses", label: "Licenses", icon: <Key size={16} /> },
  { key: "feedback", label: "Feedback", icon: <MessageSquare size={16} /> },
  { key: "errors",   label: "Errors",   icon: <AlertTriangle size={16} /> },
  // System — broadcast + configuration
  { key: "announcements", label: "Announcements", icon: <Megaphone size={16} /> },
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
 * Frosted left sidebar shell: generous brand lockup on top, vertical nav
 * with white-pill active state, live-ingest status + actions pinned to the
 * bottom. Below 900px it becomes an off-canvas drawer behind a slim
 * frosted mobile bar (hamburger).
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const apiOk = health?.api === "alive";
  const ingestLabel = timeAgo(summary?.stats.lastIngestAt ?? health?.lastIngestAt ?? null);

  // Restore the persisted sidebar width once on mount.
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem("rr-sb-w"));
      if (Number.isFinite(stored) && stored >= 188 && stored <= 330) {
        document.documentElement.style.setProperty("--sb-w", `${stored}px`);
      }
    } catch { /* ignore */ }
  }, []);

  function navigate(key: PageKey) {
    onNavigate(key);
    setDrawerOpen(false);
  }

  /* Drag the sidebar's right edge to resize (persisted); double-click resets. */
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const root = document.documentElement;
    const startX = event.clientX;
    const startWidth = parseInt(getComputedStyle(root).getPropertyValue("--sb-w"), 10) || 236;

    function onMove(move: PointerEvent) {
      const width = Math.max(188, Math.min(330, startWidth + (move.clientX - startX)));
      root.style.setProperty("--sb-w", `${width}px`);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const final = parseInt(getComputedStyle(root).getPropertyValue("--sb-w"), 10);
      if (Number.isFinite(final)) {
        try { localStorage.setItem("rr-sb-w", String(final)); } catch { /* ignore */ }
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resetResize() {
    document.documentElement.style.setProperty("--sb-w", "236px");
    try { localStorage.removeItem("rr-sb-w"); } catch { /* ignore */ }
  }

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

  return (
    <>
      {/* Slim frosted bar — mobile only (≤900px) */}
      <header className="mobilebar">
        <button
          type="button"
          className="btn-icon"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
        >
          <Menu size={17} />
        </button>
        <div className="mobilebar-brand">
          <img src={brandLogo} alt="" className="mobilebar-logo" />
          <span>RazorReaper</span>
        </div>
        {refreshButton}
      </header>

      {drawerOpen ? <div className="sb-scrim" onClick={() => setDrawerOpen(false)} aria-hidden /> : null}

      <aside className={`sidebar${drawerOpen ? " open" : ""}`} aria-label="Primary">
        <div className="sb-brand">
          <img src={brandLogo} alt="RazorReaper logo" className="sb-brand-img" />
          <div className="sb-brand-text">
            <span className="sb-brand-name">RazorReaper</span>
            <span className="sb-brand-sub">Operations Console</span>
          </div>
          <button
            type="button"
            className="btn-icon sb-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="sb-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`sb-item${page === item.key ? " active" : ""}`}
              onClick={() => navigate(item.key)}
              aria-current={page === item.key ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sb-foot">
          <div className={`tn-live${apiOk ? "" : " offline"}`} title={`API ${apiOk ? "online" : "offline"}`}>
            <span className="tn-live-dot" />
            {apiOk ? "Ingest online" : "Ingest offline"}
          </div>
          <div className="sb-meta" title="Last ingest">ingest · {ingestLabel}</div>
          <div className="sb-actions">
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

        <div
          className="sb-resize"
          onPointerDown={startResize}
          onDoubleClick={resetResize}
          title="Drag to resize · double-click to reset"
          aria-hidden
        />
      </aside>
    </>
  );
}
