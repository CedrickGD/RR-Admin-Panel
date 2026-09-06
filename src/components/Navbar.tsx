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
  Server,
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
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { Modal } from "./ds/Modal";
import { Button } from "./ds/Button";
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
    ],
  },
  {
    label: "Monitoring",
    icon: <Activity />,
    items: [
      ["overview", "Overview", <LayoutDashboard />],
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
      ["system", "Backend status", <Server />],
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
export function Navbar({ page, onNavigate, user, onLogout }: NavbarProps) {
  useChartColors();
  const [mobile, setMobile] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
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
  const searchScope =
    page === "licenses" || page === "workers" || page === "live" ? page : "customers";
  const searchLabel = {
    customers: "Search customers",
    licenses: "Search licenses",
    workers: "Search session history",
    live: "Search live sessions",
  }[searchScope];
  const [search, setSearch] = useWorkspaceSearch(searchScope);
  const { appearance, updateAppearance } = useAppearance();
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
      <aside className={`sidebar ${mobile ? "open" : ""}`} aria-label="Primary navigation">
        <div className="sb-brand-row">
          <button
            type="button"
            className="sb-brand"
            onClick={() => navigate(canVisit("overview", user) ? "overview" : "settings")}
          >
            <img className="sb-brand-img" src={logo} alt="" />
            <span className="sb-brand-text">
              <strong>RazorReaper</strong>
              <small>Admin workspace</small>
            </span>
          </button>
          <button
            type="button"
            className="btn-icon sb-close"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="sb-nav" aria-label="Main">
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
                    {items.map(([key, label, icon]) => (
                      <button
                        type="button"
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
          <div className="account-row">
            <span className="account-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
            <span className="account-text">
              <strong>{user.email.split("@")[0]}</strong>
              <small>{user.panelRole ?? user.role}</small>
            </span>
            <button
              className="btn-icon"
              onClick={() => setConfirmLogout(true)}
              title="Sign out"
              aria-label="Sign out"
            >
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
        {canVisit(searchScope, user) && (
          <form
            className="workspace-search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(search);
              if (page !== searchScope) navigate(searchScope);
            }}
          >
            <Search size={16} />
            <input
              aria-label={searchLabel}
              placeholder={
                searchScope === "licenses"
                  ? "Search licenses, customers, orders…"
                  : "Search customer, PC, Discord or HWID…"
              }
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {page !== searchScope && <kbd>↵</kbd>}
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
      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Sign out?"
        sub="You will need to sign in again to access the panel."
      >
        <div className="row-actions">
          <Button onClick={() => setConfirmLogout(false)}>Stay signed in</Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmLogout(false);
              onLogout();
            }}
          >
            Sign out
          </Button>
        </div>
      </Modal>
    </>
  );
}
