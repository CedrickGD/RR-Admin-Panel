import { AlertTriangle, RefreshCw } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { LoginForm } from "./components/LoginForm";
import { Navbar } from "./components/Navbar";
import { useAdminStats, DEFAULT_STATS_FILTERS } from "./hooks/useAdminStats";
import { useDashboard } from "./hooks/useDashboard";
import { useAppearance, setAppearanceAccount } from "./hooks/useAppearance";
import { PanelBackground } from "./components/PanelBackground";
import { CustomerWorkspaceRouter } from "./components/CustomerWorkspaceRouter";
import { canVisit } from "../shared/panel-policy";
import { PanelIdentity } from "./hooks/usePanelPermission";
import { CustomerProfilesProvider } from "./components/CustomerProfiles";
import { setWorkspaceSearch } from "./hooks/useWorkspaceSearch";
import type { MapFocusTarget } from "./pages/HeatmapPage";
import type { PageKey } from "./types/telemetry";

const AccessPage = lazy(() =>
  import("./pages/AccessPage").then((module) => ({ default: module.AccessPage })),
);
const TeamPage = lazy(() =>
  import("./pages/TeamPage").then((module) => ({ default: module.TeamPage })),
);
const SystemStatusPage = lazy(() =>
  import("./pages/SystemStatusPage").then((module) => ({ default: module.SystemStatusPage })),
);
const AnnouncementsPage = lazy(() =>
  import("./pages/AnnouncementsPage").then((module) => ({ default: module.AnnouncementsPage })),
);
const CustomersPage = lazy(() =>
  import("./pages/CustomersPage").then((module) => ({ default: module.CustomersPage })),
);
const ErrorsPage = lazy(() =>
  import("./pages/ErrorsPage").then((module) => ({ default: module.ErrorsPage })),
);
const FeedbackPage = lazy(() =>
  import("./pages/FeedbackPage").then((module) => ({ default: module.FeedbackPage })),
);
const HEATMAP_RELOAD_KEY = "rr:heatmap-chunk-reload";

const HeatmapPage = lazy(async () => {
  try {
    const module = await import("./pages/HeatmapPage");
    sessionStorage.removeItem(HEATMAP_RELOAD_KEY);
    return { default: module.HeatmapPage };
  } catch (error) {
    // An already-open admin tab can still reference the previous deployment's
    // hashed Heatmap chunk after the container is replaced. Reload once so the
    // tab picks up the current index and asset names instead of staying broken.
    if (sessionStorage.getItem(HEATMAP_RELOAD_KEY) !== "1") {
      sessionStorage.setItem(HEATMAP_RELOAD_KEY, "1");
      window.location.reload();
      return new Promise<never>(() => undefined);
    }
    sessionStorage.removeItem(HEATMAP_RELOAD_KEY);
    throw error;
  }
});
const LicensesPage = lazy(() =>
  import("./pages/LicensesPage").then((module) => ({ default: module.LicensesPage })),
);
const LivePage = lazy(() =>
  import("./pages/LivePage").then((module) => ({ default: module.LivePage })),
);
const OverviewPage = lazy(() =>
  import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const TrafficPage = lazy(() =>
  import("./pages/TrafficPage").then((module) => ({ default: module.TrafficPage })),
);
const VersionsPage = lazy(() =>
  import("./pages/VersionsPage").then((module) => ({ default: module.VersionsPage })),
);
const WorkersPage = lazy(() =>
  import("./pages/WorkersPage").then((module) => ({ default: module.WorkersPage })),
);

type FocusedSession = { id: string; token: number } | null;

/* ── Page persistence ────────────────────────────────────────────
   The page lives in the URL hash (#/live) and localStorage, so any full
   reload — F5, the guarded Cloudflare Access re-auth reload, a phone tab
   being restored — lands back on the page the admin was on, never on
   Overview. Hash also gives shareable deep links and back/forward nav. */
const PAGE_KEYS: readonly PageKey[] = [
  "team",
  "overview",
  "live",
  "workers",
  "customers",
  "traffic",
  "versions",
  "heatmap",
  "errors",
  "licenses",
  "access",
  "feedback",
  "announcements",
  "system",
  "settings",
];
const LAST_PAGE_STORAGE_KEY = "rr:last-page";
const STATS_PAGES = new Set<PageKey>(["overview", "traffic", "versions", "workers"]);
const USER_PAGES = new Set<PageKey>(["workers", "customers", "heatmap", "access"]);

function isPageKey(value: string | null | undefined): value is PageKey {
  return typeof value === "string" && (PAGE_KEYS as readonly string[]).includes(value);
}

function pageFromHash(): PageKey | null {
  const raw = window.location.hash.replace(/^#\/?/, "").trim();
  return isPageKey(raw) ? raw : null;
}

function readInitialPage(): PageKey {
  const fromHash = pageFromHash();
  if (fromHash) return fromHash;
  try {
    const stored = localStorage.getItem(LAST_PAGE_STORAGE_KEY);
    if (isPageKey(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "overview";
}

export default function App() {
  const { appearance } = useAppearance();
  const accentHue = appearance.hue;
  const [page, setPage] = useState<PageKey>(readInitialPage);
  useEffect(() => {
    if (page !== "access") return;
    const search = sessionStorage.getItem("rr:access-search");
    if (search) {
      setWorkspaceSearch("customers", search);
      sessionStorage.removeItem("rr:access-search");
    }
    setPage("customers");
  }, [page]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [page]);

  // Keep URL hash + storage in sync with the active page. The very first
  // normalization (no valid hash yet) replaces instead of pushing so the
  // back button never steps to a hashless duplicate of the same page.
  useEffect(() => {
    const desired = `#/${page}`;
    if (window.location.hash !== desired) {
      if (pageFromHash() === null) {
        window.history.replaceState(null, "", desired);
      } else {
        window.location.hash = desired;
      }
    }
    try {
      localStorage.setItem(LAST_PAGE_STORAGE_KEY, page);
    } catch {
      /* ignore */
    }
  }, [page]);

  // Browser back/forward (and hand-edited hashes) drive the page too.
  useEffect(() => {
    const onHashChange = () => {
      const key = pageFromHash();
      if (key) setPage(key);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const [focusedLiveSession, setFocusedLiveSession] = useState<FocusedSession>(null);
  // One-shot show-on-map command. The Heatmap page copies it into local state and
  // reports back via onFocusConsumed, so nothing here can lock the map onto a user.
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null);
  const [focusedWorkerId, setFocusedWorkerId] = useState<string | null>(null);

  const {
    authMode,
    ready,
    user,
    requiresBootstrap,
    authBusy,
    authError,
    sessionError,
    summary,
    health,
    loadError,
    refreshing,
    authenticate,
    logout,
    retrySession,
    refresh,
  } = useDashboard(page);
  useEffect(() => {
    setAppearanceAccount(user?.email ?? "guest");
    if (user && !canVisit(page, user))
      setPage(PAGE_KEYS.find((key) => canVisit(key, user)) ?? "settings");
  }, [user, page]);
  const { stats, users } = useAdminStats(
    {
      stats: Boolean(user && canVisit(page, user)) && STATS_PAGES.has(page),
      users: Boolean(user && canVisit(page, user)) && USER_PAGES.has(page),
      userScope: "all",
    },
    page === "overview" ? { ...DEFAULT_STATS_FILTERS, range: "today" } : DEFAULT_STATS_FILTERS,
    JSON.stringify([user?.email, user?.role, user?.panelRole, user?.permissions]),
  );

  // Data refreshes automatically; page-specific lists own their search filters.
  const refreshButton = null;

  const filterBar = null;

  function nextFocusedSession(current: FocusedSession, sessionId: string): FocusedSession {
    return { id: sessionId, token: current?.id === sessionId ? current.token + 1 : 1 };
  }
  function handleOpenLiveSession(sessionId: string) {
    setFocusedLiveSession((c) => nextFocusedSession(c, sessionId));
    setPage("live");
  }
  function handleOpenHeatmapSession(sessionId: string) {
    setMapFocusTarget((c) => ({ kind: "session", id: sessionId, token: (c?.token ?? 0) + 1 }));
    setPage("heatmap");
  }
  function handleOpenMapUser(identity: string) {
    setMapFocusTarget((c) => ({ kind: "user", id: identity, token: (c?.token ?? 0) + 1 }));
    setPage("heatmap");
  }
  function handleOpenWorker(userId: string) {
    setFocusedWorkerId(userId);
    setPage("workers");
  }
  const handleMapFocusConsumed = useCallback(() => setMapFocusTarget(null), []);
  const handleLiveFocusConsumed = useCallback(() => setFocusedLiveSession(null), []);

  /* ─── Loading ─── */
  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "var(--accent-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              color: "var(--accent-text)",
            }}
          >
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
          <p className="kicker" style={{ marginBottom: 8 }}>
            Initializing
          </p>
          <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Preparing Console</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-2)", lineHeight: 1.7 }}>
            Loading auth state and session data…
          </p>
        </div>
      </div>
    );
  }

  if (!user && sessionError) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: "center" }}>
          <AlertTriangle
            className="h-5 w-5"
            style={{ color: "var(--danger)", margin: "0 auto 16px" }}
          />
          <p className="kicker" style={{ marginBottom: 8 }}>
            Session check unavailable
          </p>
          <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Still checking your sign-in</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-2)", lineHeight: 1.7 }}>
            {sessionError}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 20 }}
            onClick={() => void retrySession()}
          >
            Retry session check
          </button>
        </div>
      </div>
    );
  }

  /* ─── Auth ─── */
  if (!user) {
    return (
      <LoginForm
        isBootstrap={requiresBootstrap}
        authMode={authMode}
        busy={authBusy}
        error={authError}
        onSubmit={(email, password, confirm) => void authenticate(email, password, confirm)}
      />
    );
  }

  /* ─── Dashboard ─── */
  return (
    <PanelIdentity.Provider value={user}>
      <CustomerProfilesProvider key={user.email}>
        <div className="app-shell v2-shell">
          <PanelBackground />
          <Navbar
            page={page}
            onNavigate={setPage}
            user={user}
            authMode={authMode}
            summary={summary}
            health={health}
            onRefresh={refresh}
            refreshing={refreshing}
            onLogout={() => void logout()}
          />

          <main className="main-area v2-main">
            {loadError ? (
              <div className="page-content" style={{ paddingBottom: 0, paddingTop: 20 }}>
                <div
                  style={{
                    background: "hsl(4 86% 58% / 0.07)",
                    border: "1px solid hsl(4 86% 58% / 0.22)",
                    borderRadius: 12,
                    padding: "14px 18px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <AlertTriangle
                    className="h-4 w-4 mt-0.5 shrink-0"
                    style={{ color: "var(--danger)" }}
                  />
                  <div style={{ flex: 1 }}>
                    <p
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "var(--danger)",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        marginBottom: 2,
                      }}
                    >
                      Load error
                    </p>
                    <p style={{ fontSize: "0.8125rem", color: "var(--text-1)", marginBottom: 4 }}>
                      The dashboard could not refresh.
                    </p>
                    <p style={{ fontSize: "0.8125rem", color: "hsl(4 86% 68%)" }}>{loadError}</p>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                    Retry
                  </button>
                </div>
              </div>
            ) : null}

            {page === "system" && canVisit(page, user) ? (
              <Suspense fallback={<div className="page-content">Loading backend status…</div>}>
                <SystemStatusPage />
              </Suspense>
            ) : summary && health && canVisit(page, user) ? (
              <div key={`${page}:${JSON.stringify(user.permissions)}`} className="page-enter">
                <Suspense
                  fallback={
                    <div
                      className="page-content"
                      style={{ minHeight: 320, display: "grid", placeItems: "center" }}
                    >
                      <div className="spinner spinner-md" aria-label="Loading page" />
                    </div>
                  }
                >
                  {page === "overview" ? (
                    <OverviewPage
                      summary={summary}
                      stats={stats}
                      theme={appearance.theme}
                      accentHue={accentHue}
                    />
                  ) : null}
                  {page === "traffic" ? (
                    <TrafficPage
                      summary={summary}
                      stats={stats}
                      theme={appearance.theme}
                      accentHue={accentHue}
                      filterBar={filterBar}
                    />
                  ) : null}
                  {page === "versions" ? (
                    <VersionsPage
                      summary={summary}
                      stats={stats}
                      theme={appearance.theme}
                      accentHue={accentHue}
                      filterBar={filterBar}
                    />
                  ) : null}
                  {page === "heatmap" ? (
                    <HeatmapPage
                      summary={summary}
                      users={users}
                      theme={appearance.theme}
                      onOpenSession={handleOpenLiveSession}
                      focusedTarget={mapFocusTarget}
                      onFocusConsumed={handleMapFocusConsumed}
                      filterBar={refreshButton}
                    />
                  ) : null}
                  {page === "live" ? (
                    <LivePage
                      summary={summary}
                      focusedSessionId={focusedLiveSession?.id ?? null}
                      focusedSessionToken={focusedLiveSession?.token ?? 0}
                      onFocusConsumed={handleLiveFocusConsumed}
                      onOpenMapSession={handleOpenHeatmapSession}
                      filterBar={refreshButton}
                    />
                  ) : null}
                  {page === "workers" ? (
                    <WorkersPage
                      summary={summary}
                      stats={stats}
                      users={users}
                      focusedWorkerId={focusedWorkerId}
                      onOpenMapSession={handleOpenHeatmapSession}
                      onOpenMapUser={handleOpenMapUser}
                      filterBar={refreshButton}
                    />
                  ) : null}
                  {page === "customers" ? (
                    <CustomersPage users={users} filterBar={refreshButton} />
                  ) : null}
                  {page === "errors" ? <ErrorsPage /> : null}
                  {page === "licenses" ? (
                    <LicensesPage
                      summary={summary}
                      onOpenSession={handleOpenLiveSession}
                      onOpenWorker={handleOpenWorker}
                      filterBar={refreshButton}
                    />
                  ) : null}
                  {page === "access" ? (
                    <AccessPage
                      users={users}
                      onOpenWorker={handleOpenWorker}
                      filterBar={refreshButton}
                    />
                  ) : null}
                  {page === "announcements" ? (
                    <AnnouncementsPage filterBar={refreshButton} />
                  ) : null}
                  {page === "feedback" ? (
                    <FeedbackPage summary={summary} filterBar={refreshButton} />
                  ) : null}
                  {page === "settings" ? (
                    <SettingsPage
                      user={user}
                      authMode={authMode}
                      summary={summary}
                      health={health}
                      onLogout={() => void logout()}
                      filterBar={refreshButton}
                    />
                  ) : null}
                  {page === "team" ? <TeamPage /> : null}
                </Suspense>
              </div>
            ) : !loadError ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "70vh",
                  padding: "24px",
                }}
              >
                <div className="login-card" style={{ textAlign: "center", maxWidth: 380 }}>
                  <div className="spinner" style={{ margin: "0 auto 16px" }} />
                  <p className="kicker" style={{ marginBottom: 8 }}>
                    Loading
                  </p>
                  <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Fetching dashboard data</h2>
                  <p style={{ fontSize: "0.8125rem", color: "var(--text-2)", lineHeight: 1.7 }}>
                    Loading session summary and telemetry…
                  </p>
                </div>
              </div>
            ) : null}
          </main>
          <CustomerWorkspaceRouter user={user} />
        </div>
      </CustomerProfilesProvider>
    </PanelIdentity.Provider>
  );
}
