import {
  Activity,
  ArrowLeft,
  BarChart3,
  Ban,
  Bug,
  Globe2,
  History,
  Inbox,
  Megaphone,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Radio,
  Settings2,
  Server,
  ShieldCheck,
  Sun,
  UsersRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthMode,
  AuthUser,
  HealthPayload,
  PageKey,
  SummaryPayload,
} from "../types/telemetry";
import { canVisit } from "../../shared/panel-policy";
import { PAGE_META, type PageGroup } from "../pageMeta";
import { useAppearance } from "../hooks/useAppearance";
import { useChartColors } from "../hooks/useChartColors";
import { useSignOut } from "../hooks/useSignOut";
import { useTopHistoryLayer } from "../hooks/useHistoryLayer";
import { IconButton } from "./ds/Button";
const logo = new URL("../img/logo.ico", import.meta.url).href;
/* Sidebar structure (group order, item order, icons) only. Every visible
   name comes from PAGE_META, so the rail, the breadcrumb, the page H1 and the
   tab title can never disagree. */
const GROUPS: Array<{
  label: PageGroup;
  icon: ReactNode;
  items: Array<[PageKey, ReactNode]>;
}> = [
  {
    label: "Customers",
    icon: <UsersRound />,
    items: [
      ["customers", <UsersRound />],
      ["licenses", <KeyRound />],
    ],
  },
  {
    label: "Monitoring",
    icon: <Activity />,
    items: [
      ["overview", <LayoutDashboard />],
      ["live", <Radio />],
      ["workers", <History />],
      ["traffic", <BarChart3 />],
      ["versions", <PackageCheck />],
      ["heatmap", <Globe2 />],
    ],
  },
  {
    label: "Communication",
    icon: <MessageSquare />,
    items: [
      ["announcements", <Megaphone />],
      ["feedback", <Inbox />],
    ],
  },
  {
    label: "Diagnostics",
    icon: <CircleHelp />,
    items: [["errors", <Bug />]],
  },
  {
    label: "Administration",
    icon: <ShieldCheck />,
    items: [
      ["team", <ShieldCheck />],
      ["system", <Server />],
      ["settings", <Settings2 />],
    ],
  },
];
/** First page of `group` the current user is allowed to see — where the
    breadcrumb's group segment goes back to. Null only if the group has no
    visible items at all, which shouldn't happen while the user is on a page
    inside it. */
function firstVisiblePageInGroup(group: PageGroup, user: AuthUser): PageKey | null {
  const found = GROUPS.find((g) => g.label === group)?.items.find(([key]) => canVisit(key, user));
  return found ? found[0] : null;
}
/* Icon rail. Between 901px and 1200px the full 244px sidebar leaves ~850px for
   tables that want 1180px, so the rail is the default there — until the admin
   states a preference, which then holds at every width. */
const RAIL_KEY = "rr:sidebar-rail";
const RAIL_AUTO_QUERY = "(min-width: 901px) and (max-width: 1200px)";
/* The width the rail CSS itself is scoped to (app-glue.css). Below it the mobile
   drawer shows full labels whatever the stored preference says. */
const RAIL_WIDTH_QUERY = "(min-width: 901px)";
type RailPreference = "expanded" | "collapsed" | null;

function readRailPreference(): RailPreference {
  try {
    const stored = localStorage.getItem(RAIL_KEY);
    return stored === "expanded" || stored === "collapsed" ? stored : null;
  } catch {
    return null;
  }
}

export interface NavbarProps {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
  user: AuthUser;
  authMode: AuthMode;
  summary?: SummaryPayload | null;
  health?: HealthPayload | null;
  onRefresh: () => void;
  refreshing?: boolean;
  onLogout: () => void;
}
export function Navbar({ page, onNavigate, user, onLogout }: NavbarProps) {
  useChartColors();
  const [mobile, setMobile] = useState(false);
  const signOut = useSignOut(onLogout);
  // The layer a Back press would close (Customer 360, a dialog, the fullscreen
  // map). While there is one, phones get a back arrow in the bar.
  const topLayer = useTopHistoryLayer();
  const expansionKey = `rr:navigation:${user.email}`;
  const [expanded, setExpanded] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(expansionKey) ?? "null");
      if (Array.isArray(saved))
        return saved.filter((label) => GROUPS.some((g) => g.label === label));
    } catch {
      /* Navigation still works when storage is unavailable. */
    }
    return GROUPS.map((g) => g.label);
  });
  const { appearance, updateAppearance } = useAppearance();

  /* ── Icon rail ─── */
  const [railPreference, setRailPreference] = useState<RailPreference>(readRailPreference);
  const [autoRail, setAutoRail] = useState(() => window.matchMedia(RAIL_AUTO_QUERY).matches);
  const [wideViewport, setWideViewport] = useState(
    () => window.matchMedia(RAIL_WIDTH_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(RAIL_AUTO_QUERY);
    const onChange = () => setAutoRail(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const query = window.matchMedia(RAIL_WIDTH_QUERY);
    const onChange = () => setWideViewport(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const railCollapsed = railPreference ? railPreference === "collapsed" : autoRail;
  /* The stored preference holds at every width, but only the desktop rail hides
     the labels — in the mobile drawer they are all visible, so a `title` there
     is a tooltip (and an accessible description) repeating what is on screen. */
  const railLabelsHidden = railCollapsed && wideViewport;
  useEffect(() => {
    // --sb-w and every offset that reads it (topbar, main, Customer 360) follow
    // this class; the rail rules themselves are scoped to (min-width: 901px),
    // so it is inert while the mobile drawer owns the sidebar.
    const root = document.documentElement;
    root.classList.toggle("sb-collapsed", railCollapsed);
    return () => root.classList.remove("sb-collapsed");
  }, [railCollapsed]);
  function toggleRail() {
    const next: RailPreference = railCollapsed ? "expanded" : "collapsed";
    setRailPreference(next);
    try {
      localStorage.setItem(RAIL_KEY, next);
    } catch {
      /* The rail still toggles when storage is unavailable. */
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(expansionKey, JSON.stringify(expanded));
    } catch {
      /* Optional cache. */
    }
  }, [expanded, expansionKey]);

  useEffect(() => {
    if (!mobile) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobile(false);
    };
    const onResize = () => {
      if (window.innerWidth > 900) setMobile(false);
    };
    const onPointerDown = (e: MouseEvent | TouchEvent | PointerEvent) => {
      const target = e.target as Node | null;
      const sidebarEl = document.querySelector(".sidebar");
      const menuBtn = document.querySelector(".mobile-menu");
      if (sidebarEl && !sidebarEl.contains(target) && menuBtn && !menuBtn.contains(target)) {
        setMobile(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [mobile]);

  useEffect(() => {
    setMobile(false);
  }, [page]);

  // Closing the drawer unmounts its close button (and hides the rail), which would drop
  // focus on <body>. Hand it back to the control that opened the drawer.
  const menuRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (mobile) {
      drawerWasOpen.current = true;
      return;
    }
    if (!drawerWasOpen.current) return;
    drawerWasOpen.current = false;
    if (menuRef.current?.offsetParent !== null) menuRef.current?.focus();
  }, [mobile]);

  // The rail scrolls on short viewports: keep the current page's item (or its
  // collapsed group) in view after every navigation — deep links and
  // the brand button can land on a page whose item sits below the fold.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const target =
      nav?.querySelector<HTMLElement>(".sb-item.active") ??
      nav?.querySelector<HTMLElement>(".nav-parent.has-active");
    target?.scrollIntoView({ block: "nearest" });
  }, [page]);

  function navigate(key: PageKey) {
    // Another page closes an open Customer 360 through its hash change, which
    // keeps the workspace entry under the new page (Back returns to it). The
    // page already on screen changes no hash, so it closes the workspace here.
    if (key === page) window.dispatchEvent(new Event("rr:close-customer"));
    onNavigate(key);
    setMobile(false);
  }

  const meta = PAGE_META[page];
  const breadcrumbGroupTarget =
    meta.group === meta.label ? null : firstVisiblePageInGroup(meta.group, user);
  return (
    <>
      <aside
        id="sidebar-nav"
        className={`sidebar ${mobile ? "open" : ""}`}
        aria-label="Primary navigation"
      >
        <div className="sb-brand-row">
          <button
            type="button"
            className="sb-brand"
            // The rail hides `.sb-brand-text` and the logo is decorative, which
            // left the button with no accessible name at all in that layout —
            // and the rail is the default between 901 and 1200px.
            aria-label="RazorReaper Operations Console — go to overview"
            title={railLabelsHidden ? "RazorReaper — Operations Console" : undefined}
            onClick={() => navigate(canVisit("overview", user) ? "overview" : "settings")}
          >
            <img className="sb-brand-img" src={logo} alt="" />
            <span className="sb-brand-text">
              <strong>RazorReaper</strong>
              <small>Operations Console</small>
            </span>
          </button>
          {mobile ? (
            <IconButton
              className="sb-close"
              icon={<X />}
              size={18}
              onClick={() => setMobile(false)}
              aria-label="Close navigation"
            />
          ) : (
            /* Desktop only (CSS hides it below 901px, where the X owns this slot). */
            <IconButton
              className="sb-rail-toggle"
              icon={railCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              size={16}
              onClick={toggleRail}
              title={railCollapsed ? "Expand navigation" : "Collapse navigation"}
              aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
            />
          )}
        </div>
        <nav className="sb-nav" aria-label="Main" ref={navRef}>
          {GROUPS.map((group) => {
            const items = group.items.filter(([key]) => canVisit(key, user));
            if (!items.length) return null;
            const open = expanded.includes(group.label);
            const active = items.some(([key]) => key === page);
            return (
              <div className="nav-section" key={group.label}>
                <button
                  type="button"
                  className={`sb-item nav-parent ${active ? "has-active" : ""}`}
                  // The rail hides every label, so the tooltip carries the name.
                  title={railLabelsHidden ? group.label : undefined}
                  onClick={() =>
                    setExpanded((current) =>
                      current.includes(group.label)
                        ? current.filter((label) => label !== group.label)
                        : [...current, group.label],
                    )
                  }
                  aria-expanded={open}
                >
                  {group.icon}
                  <span>{group.label}</span>
                  {open ? (
                    <ChevronDown className="nav-chevron" />
                  ) : (
                    <ChevronRight className="nav-chevron" />
                  )}
                </button>
                {open && (
                  <div className="nav-children">
                    {items.map(([key, icon]) => (
                      <button
                        type="button"
                        key={key}
                        className={`sb-item ${page === key ? "active" : ""}`}
                        title={railLabelsHidden ? PAGE_META[key].label : undefined}
                        onClick={() => navigate(key)}
                        aria-current={page === key ? "page" : undefined}
                      >
                        {icon}
                        <span>{PAGE_META[key].label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sb-foot">
          {/* The row shows the local part only; the title carries the address it
              stands for, which is otherwise buried in Settings › Account. */}
          <div className="account-row" title={`${user.email} · ${user.panelRole ?? user.role}`}>
            <span className="account-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
            <span className="account-text">
              <strong>{user.email.split("@")[0]}</strong>
              <small>{user.panelRole ?? user.role}</small>
            </span>
            <IconButton
              icon={<LogOut />}
              size={16}
              onClick={signOut.requestSignOut}
              title="Sign out"
              aria-label="Sign out"
            />
          </div>
        </div>
      </aside>
      <header className="workspace-bar">
        <IconButton
          ref={menuRef}
          className="mobile-menu"
          icon={mobile ? <X /> : <Menu />}
          size={18}
          aria-label={mobile ? "Close navigation" : "Open navigation"}
          aria-expanded={mobile}
          aria-controls="sidebar-nav"
          onClick={() => setMobile(!mobile)}
        />
        {/* Phones only (workspace.css): while a layer is open its Back takes the
            "‹ Group" link's place next to the menu button, at the same size. */}
        {topLayer ? (
          <IconButton
            className="workspace-layer-back"
            icon={<ArrowLeft />}
            size={18}
            title="Back"
            aria-label="Back"
            onClick={() => history.back()}
          />
        ) : null}
        <div className={`workspace-breadcrumb${topLayer ? " has-layer" : ""}`}>
          {/* A page named after its own group shows the name once, never twice. */}
          {breadcrumbGroupTarget === null ? (
            <strong aria-current="page">{meta.label}</strong>
          ) : (
            <>
              {/* Real link (not just a click handler) so it behaves like any other
                  link — middle-click, open in new tab, keyboard-focusable with a
                  visible ring. Desktop shows "Group › Page"; ≤600px collapses to
                  just this "‹ Group" link (see workspace.css). */}
              <a
                className="workspace-breadcrumb-group"
                href={`#/${breadcrumbGroupTarget}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(breadcrumbGroupTarget);
                }}
              >
                <ChevronLeft
                  size={14}
                  className="workspace-breadcrumb-back"
                  aria-hidden="true"
                />
                <span className="workspace-breadcrumb-group-label">{meta.group}</span>
              </a>
              <ChevronRight size={13} className="workspace-breadcrumb-sep" aria-hidden="true" />
              <strong className="workspace-breadcrumb-page" aria-current="page">
                {meta.label}
              </strong>
            </>
          )}
        </div>
        <IconButton
          className="theme-toggle"
          icon={appearance.theme === "dark" ? <Sun /> : <Moon />}
          size={18}
          onClick={() =>
            updateAppearance({ theme: appearance.theme === "dark" ? "light" : "dark" })
          }
          title={appearance.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={appearance.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        />
      </header>
      {signOut.dialog}
    </>
  );
}
