import { AlertTriangle, RefreshCw } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import {
  clearWorkspaceSearchesExcept,
  setWorkspaceSearch,
} from "./hooks/useWorkspaceSearch";
import type { MapFocusTarget } from "./pages/HeatmapPage";
import type { PageKey } from "./types/telemetry";
import { PAGE_META } from "./pageMeta";
import {
  hashPageToken,
  isPageKey,
  LAST_PAGE_STORAGE_KEY,
  PAGE_KEYS,
  resolvePageKey,
  takeAccessSearch,
} from "./utils/pageRouting";

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

const STATS_PAGES = new Set<PageKey>(["overview", "traffic", "versions", "workers"]);
const USER_PAGES = new Set<PageKey>(["workers", "customers", "heatmap"]);

/** The page this hash asks for — a live key, or one a retired key aliases to. */
function pageFromHash(): PageKey | null {
  return resolvePageKey(hashPageToken(window.location.hash));
}

/**
 * True while the hash already names the page it shows. A hash that only
 * resolves — a retired alias such as "#/access" — is rewritten in place, so
 * Back never steps onto a URL that would just redirect again.
 */
function hashNamesItsPage(): boolean {
  return isPageKey(hashPageToken(window.location.hash));
}

function readInitialPage(): PageKey {
  const fromHash = pageFromHash();
  if (fromHash) return fromHash;
  try {
    const stored = resolvePageKey(localStorage.getItem(LAST_PAGE_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return "overview";
}

export default function App() {
  const { appearance } = useAppearance();
  const accentHue = appearance.hue;
  const [page, setPage] = useState<PageKey>(readInitialPage);
  /* The retired App access page could be opened on a search term, written to
     sessionStorage as "rr:access-search" just before the jump. Those jumps land
     on the directory now (src/utils/pageRouting.ts), which is the app-access
     surface, so the term is handed to its search field and consumed once. */
  useEffect(() => {
    if (page !== "customers") return;
    let search: string | null = null;
    try {
      search = takeAccessSearch(window.sessionStorage);
    } catch {
      /* Storage blocked — there is nothing to carry over. */
    }
    if (search) setWorkspaceSearch("customers", search);
  }, [page]);
  /* Each list page keeps its toolbar search in sessionStorage, but a query
     filters that one list only: opening another page drops it. (The navbar
     search field used to do this; it is gone, the searches live in the
     pages' toolbars.) A search handed over on arrival — the access redirect
     above — targets the page being opened, so it is kept. */
  useEffect(() => {
    clearWorkspaceSearchesExcept(page);
  }, [page]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [page]);

  // Keep URL hash + storage in sync with the active page. A hash that does not
  // name this page itself — none yet, or a retired alias — is replaced instead
  // of pushed, so the back button never steps to a duplicate or a redirect.
  useEffect(() => {
    const desired = `#/${page}`;
    if (window.location.hash !== desired) {
      if (hashNamesItsPage()) {
        window.location.hash = desired;
      } else {
        // Only the address is tidied: the entry keeps its state (a history
        // layer's record, which a reload adopts).
        window.history.replaceState(window.history.state, "", desired);
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
      const token = hashPageToken(window.location.hash);
      const key = resolvePageKey(token);
      if (!key) return;
      setPage(key);
      // An alias never stays in the address bar, even when it resolves to the
      // page already on screen — the sync effect above only runs on a change.
      // The entry keeps its state (a history layer's record).
      if (!isPageKey(token)) window.history.replaceState(window.history.state, "", `#/${key}`);
    };
    // Back/Forward between entries whose query differs too (Customer 360 and
    // the Licenses hand-off carry ?customer=… / ?customerReturn=…) fires only
    // popstate, never hashchange, which used to leave the old page on screen
    // under the new address. A step that changes the hash fires both events, so
    // this runs twice for it on purpose — keep the handler idempotent.
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
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
  // Tab title per page so open tabs and bookmarks can be told apart; the
  // login screen keeps the product title from index.html.
  const signedIn = Boolean(user);
  useEffect(() => {
    document.title = signedIn
      ? `${PAGE_META[page].label} · RazorReaper`
      : "RazorReaper — Operations Console";
  }, [page, signedIn]);
  const { stats, users } = useAdminStats(
    {
      stats: Boolean(user && canVisit(page, user)) && STATS_PAGES.has(page),
      users: Boolean(user && canVisit(page, user)) && USER_PAGES.has(page),
      userScope: "all",
    },
    page === "overview" ? { ...DEFAULT_STATS_FILTERS, range: "today" } : DEFAULT_STATS_FILTERS,
    JSON.stringify([user?.email, user?.role, user?.panelRole, user?.permissions]),
  );

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
          <h1 style={{ fontSize: "var(--fs-page)", marginBottom: 8 }}>Preparing Console</h1>
          <p style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.7 }}>
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
          <h1 style={{ fontSize: "var(--fs-page)", marginBottom: 8 }}>Still checking your sign-in</h1>
          <p style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.7 }}>
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
                        fontSize: "var(--fs-tiny)",
                        fontWeight: 600,
                        color: "var(--danger)",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        marginBottom: 2,
                      }}
                    >
                      Load error
                    </p>
                    <p style={{ fontSize: "var(--fs-small)", color: "var(--text-1)", marginBottom: 4 }}>
                      The dashboard could not refresh.
                    </p>
                    <p style={{ fontSize: "var(--fs-small)", color: "hsl(4 86% 68%)" }}>{loadError}</p>
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
                    />
                  ) : null}
                  {page === "versions" ? (
                    <VersionsPage
                      summary={summary}
                      stats={stats}
                      theme={appearance.theme}
                      accentHue={accentHue}
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
                    />
                  ) : null}
                  {page === "live" ? (
                    <LivePage
                      summary={summary}
                      focusedSessionId={focusedLiveSession?.id ?? null}
                      focusedSessionToken={focusedLiveSession?.token ?? 0}
                      onFocusConsumed={handleLiveFocusConsumed}
                      onOpenMapSession={handleOpenHeatmapSession}
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
                    />
                  ) : null}
                  {page === "customers" ? (
                    <CustomersPage users={users} />
                  ) : null}
                  {page === "errors" ? <ErrorsPage /> : null}
                  {page === "licenses" ? (
                    <LicensesPage
                      summary={summary}
                      onOpenSession={handleOpenLiveSession}
                      onOpenWorker={handleOpenWorker}
                    />
                  ) : null}
                  {page === "announcements" ? (
                    <AnnouncementsPage />
                  ) : null}
                  {page === "feedback" ? (
                    <FeedbackPage summary={summary} />
                  ) : null}
                  {page === "settings" ? (
                    <SettingsPage
                      user={user}
                      authMode={authMode}
                      onLogout={() => void logout()}
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
                  <h2 style={{ fontSize: "var(--fs-figure)", marginBottom: 8 }}>Fetching dashboard data</h2>
                  <p style={{ fontSize: "var(--fs-small)", color: "var(--text-2)", lineHeight: 1.7 }}>
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
