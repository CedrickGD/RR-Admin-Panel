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
  Ban,
  Megaphone,
  MessageSquare,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AuthMode, AuthUser, HealthPayload, PageKey, SummaryPayload } from "../types/telemetry";
import { timeAgo } from "../utils/format";

const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

/** Set the sidebar width var and flip the icon-only collapsed class in one place. */
function applySidebarWidth(width: number) {
  const root = document.documentElement;
  root.style.setProperty("--sb-w", `${width}px`);
  root.classList.toggle("sb-collapsed", width < 150);
}

interface NavEntry {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

interface NavGroup {
  /** Micro-caps label rendered above the group; null = no header (top group). */
  label: string | null;
  items: NavEntry[];
}

/**
 * Nav grouped by what the admin is doing, labeled so the structure is visible:
 * dashboard first, then realtime, then history, then per-user management, then
 * broadcast + configuration.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ key: "overview", label: "Overview", icon: <BarChart3 size={16} /> }],
  },
  {
    label: "Live",
    items: [
      { key: "live",    label: "Live",     icon: <Radio size={16} /> },
      { key: "workers", label: "Sessions", icon: <History size={16} /> },
    ],
  },
  {
    label: "Analytics",
    items: [
      { key: "traffic",  label: "Traffic",  icon: <Clock3 size={16} /> },
      { key: "versions", label: "Versions", icon: <Layers size={16} /> },
      { key: "heatmap",  label: "Heatmap",  icon: <Map size={16} /> },
      { key: "errors",   label: "Errors",   icon: <AlertTriangle size={16} /> },
    ],
  },
  {
    label: "Users",
    items: [
      { key: "licenses", label: "Licenses", icon: <Key size={16} /> },
      { key: "access",   label: "Access",   icon: <Ban size={16} /> },
      { key: "feedback", label: "Feedback", icon: <MessageSquare size={16} /> },
    ],
  },
  {
    label: "System",
    items: [
      { key: "announcements", label: "Announcements", icon: <Megaphone size={16} /> },
      { key: "settings",      label: "Settings",      icon: <Settings2 size={16} /> },
    ],
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

  // Restore the persisted sidebar width once on mount (64px = icon-only collapsed mode).
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem("rr-sb-w"));
      if (Number.isFinite(stored) && stored >= 64 && stored <= 330) {
        applySidebarWidth(stored);
      }
    } catch { /* ignore */ }
  }, []);

  function navigate(key: PageKey) {
    onNavigate(key);
    setDrawerOpen(false);
  }

  /* Drag the sidebar's right edge to resize (persisted); double-click resets.
     Below the snap threshold the sidebar collapses to an icon-only rail (logo +
     page icons). The content column follows --sb-w live, and a resize event is
     dispatched so charts/maps re-measure their containers mid-drag. */
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const root = document.documentElement;
    const startX = event.clientX;
    const startWidth = parseInt(getComputedStyle(root).getPropertyValue("--sb-w"), 10) || 236;
    let frame = 0;
    let nextWidth = startWidth;

    function flush() {
      frame = 0;
      applySidebarWidth(nextWidth);
      window.dispatchEvent(new Event("resize"));
    }
    function onMove(move: PointerEvent) {
      const raw = startWidth + (move.clientX - startX);
      // Snap: anything dragged below the readable minimum collapses to the icon rail.
      nextWidth = raw < 150 ? 64 : Math.min(330, Math.max(188, raw));
      if (!frame) frame = requestAnimationFrame(flush);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frame) cancelAnimationFrame(frame);
      applySidebarWidth(nextWidth);
      try { localStorage.setItem("rr-sb-w", String(nextWidth)); } catch { /* ignore */ }
      window.dispatchEvent(new Event("resize"));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function resetResize() {
    applySidebarWidth(236);
    try { localStorage.removeItem("rr-sb-w"); } catch { /* ignore */ }
    window.dispatchEvent(new Event("resize"));
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

      <div className={`sb-scrim${drawerOpen ? " sb-scrim-open" : ""}`} onClick={() => setDrawerOpen(false)} aria-hidden />

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
          {NAV_GROUPS.map((group, groupIndex) => (
            <div key={group.label ?? `group-${groupIndex}`} style={{ display: "contents" }}>
              {group.label ? <div className="sb-group-label">{group.label}</div> : null}
              {group.items.map((item) => (
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
            </div>
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
