import {
  Activity,
  BarChart3,
  Ban,
  Bug,
  Globe2,
  History,
  Inbox,
  Megaphone,
  PackageCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  AuthMode,
  AuthUser,
  HealthPayload,
  PageKey,
  SummaryPayload,
} from "../types/telemetry";
import { canVisit } from "../../shared/panel-policy";
import { useAppearance } from "../hooks/useAppearance";
import { useChartColors } from "../hooks/useChartColors";
const logo = new URL("../img/logo.ico", import.meta.url).href;
const GROUPS: Array<{
  label: string;
  icon: ReactNode;
  items: Array<[PageKey, string, ReactNode]>;
}> = [
  {
    label: "Customers",
    icon: <UsersRound />,
    items: [
      ["customers", "Customer directory", <UsersRound />],
      ["licenses", "Licenses & orders", <KeyRound />],
      ["access", "App suspensions", <Ban />],
    ],
  },
  {
    label: "Monitoring",
    icon: <Activity />,
    items: [
      ["live", "Live sessions", <Radio />],
      ["workers", "Session history", <History />],
      ["traffic", "Traffic", <BarChart3 />],
      ["versions", "Versions", <PackageCheck />],
      ["heatmap", "World map", <Globe2 />],
    ],
  },
  {
    label: "Communication",
    icon: <MessageSquare />,
    items: [
      ["announcements", "Announcements", <Megaphone />],
      ["feedback", "Feedback inbox", <Inbox />],
    ],
  },
  {
    label: "Diagnostics",
    icon: <CircleHelp />,
    items: [["errors", "Application errors", <Bug />]],
  },
  {
    label: "Administration",
    icon: <ShieldCheck />,
    items: [
      ["team", "Panel access", <ShieldCheck />],
      ["settings", "Settings", <Settings2 />],
    ],
  },
];
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
export function Navbar({ page, onNavigate, user, health, onLogout }: NavbarProps) {
  useChartColors();
  const [mobile, setMobile] = useState(false);
  const [expanded, setExpanded] = useState(
    () => GROUPS.find((g) => g.items.some(([key]) => key === page))?.label ?? "Customers",
  );
  const [search, setSearch] = useState("");
  const { appearance, updateAppearance } = useAppearance();
  useEffect(() => {
    const group = GROUPS.find((g) => g.items.some(([key]) => key === page));
    if (group) setExpanded(group.label);
  }, [page]);
  function navigate(key: PageKey) {
    window.dispatchEvent(new Event("rr:close-customer"));
    onNavigate(key);
    setMobile(false);
  }
  const activeGroup = GROUPS.find((g) => g.items.some(([key]) => key === page));
  const title =
    page === "overview"
      ? "Overview"
      : (activeGroup?.items.find(([key]) => key === page)?.[1] ?? "Workspace");
  return (
    <>
      <button
        className={`sb-scrim ${mobile ? "sb-scrim-open" : ""}`}
        aria-label="Close navigation"
        aria-hidden={!mobile}
        tabIndex={mobile ? 0 : -1}
        onClick={() => setMobile(false)}
      />
      <aside className={`sidebar ${mobile ? "open" : ""}`} aria-label="Primary navigation">
        <button
          className="sb-brand"
          onClick={() => navigate(canVisit("overview", user) ? "overview" : "settings")}
        >
          <img className="sb-brand-img" src={logo} alt="" />
          <span className="sb-brand-text">
            <strong>RazorReaper</strong>
            <small>Admin workspace</small>
          </span>
        </button>
        <nav className="sb-nav" aria-label="Main">
          {canVisit("overview", user) && (
            <button
              className={`sb-item ${page === "overview" ? "active" : ""}`}
              onClick={() => navigate("overview")}
              aria-current={page === "overview" ? "page" : undefined}
            >
              <LayoutDashboard />
              <span>Overview</span>
            </button>
          )}
          <div className="nav-divider" />
          {GROUPS.map((group) => {
            const items = group.items.filter(([key]) => canVisit(key, user));
            if (!items.length) return null;
            const open = expanded === group.label;
            const active = items.some(([key]) => key === page);
            return (
              <div className="nav-section" key={group.label}>
                <button
                  className={`sb-item nav-parent ${active ? "has-active" : ""}`}
                  onClick={() => setExpanded(open ? "" : group.label)}
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
                    {items.map(([key, label, icon]) => (
                      <button
                        key={key}
                        className={`sb-item ${page === key ? "active" : ""}`}
                        onClick={() => navigate(key)}
                        aria-current={page === key ? "page" : undefined}
                      >
                        {icon}
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sb-foot">
          <span className="workspace-status">
            <i className={health?.api === "alive" ? "online" : ""} />
            {health?.api === "alive" ? "All systems connected" : "Connecting…"}
          </span>
          <div className="account-row">
            <span className="account-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
            <span className="account-text">
              <strong>{user.email.split("@")[0]}</strong>
              <small>{user.panelRole ?? user.role}</small>
            </span>
            <button className="btn-icon" onClick={onLogout} title="Sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <header className="workspace-bar">
        <button
          className="btn-icon mobile-menu"
          aria-label="Open navigation"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </button>
        <div className="workspace-breadcrumb">
          <span>{activeGroup?.label ?? "Workspace"}</span>
          <ChevronRight size={13} />
          <strong>{title}</strong>
        </div>
        {canVisit("customers", user) && (
          <form
            className="workspace-search"
            onSubmit={(e) => {
              e.preventDefault();
              sessionStorage.setItem("rr:customer-search", search);
              navigate("customers");
              window.dispatchEvent(new CustomEvent("rr:customer-search", { detail: search }));
            }}
          >
            <Search size={16} />
            <input
              aria-label="Search customers"
              placeholder="Search customers, Discord, devices…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
        )}
        <button
          className="btn-icon theme-toggle"
          onClick={() =>
            updateAppearance({ theme: appearance.theme === "dark" ? "light" : "dark" })
          }
          title={appearance.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={appearance.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {appearance.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>
    </>
  );
}
