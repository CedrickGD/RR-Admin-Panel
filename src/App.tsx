import { AlertTriangle, RefreshCw } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { LoginForm } from "./components/LoginForm";
import { Navbar } from "./components/Navbar";
import { useAdminStats, DEFAULT_STATS_FILTERS } from "./hooks/useAdminStats";
import { useDashboard } from "./hooks/useDashboard";
import { useAccent } from "./hooks/useAccent";
import type { MapFocusTarget } from "./pages/HeatmapPage";
import type { PageKey, StatsFilters } from "./types/telemetry";

const AccessPage = lazy(() =>
  import("./pages/AccessPage").then((module) => ({ default: module.AccessPage })),
);
const AnnouncementsPage = lazy(() =>
  import("./pages/AnnouncementsPage").then((module) => ({ default: module.AnnouncementsPage })),
);
const ErrorsPage = lazy(() =>
  import("./pages/ErrorsPage").then((module) => ({ default: module.ErrorsPage })),
);
const FeedbackPage = lazy(() =>
  import("./pages/FeedbackPage").then((module) => ({ default: module.FeedbackPage })),
);
const HeatmapPage = lazy(() =>
  import("./pages/HeatmapPage").then((module) => ({ default: module.HeatmapPage })),
);
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
  "overview",
  "live",
  "workers",
  "traffic",
  "versions",
  "heatmap",
  "errors",
  "licenses",
  "access",
  "feedback",
  "announcements",
  "settings",
];
const LAST_PAGE_STORAGE_KEY = "rr:last-page";
const STATS_PAGES = new Set<PageKey>(["overview", "traffic", "versions", "workers"]);
const USER_PAGES = new Set<PageKey>(["workers", "heatmap", "access"]);

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
  const { hue: accentHue } = useAccent();
  const [page, setPage] = useState<PageKey>(readInitialPage);

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
  const [filters, setFilters] = useState<StatsFilters>(DEFAULT_STATS_FILTERS);
  const {
    authMode,
    ready,
    user,
    requiresBootstrap,
    authBusy,
    authError,
    summary,
    health,
    loadError,
    refreshing,
    authenticate,
    logout,
    refresh,
  } = useDashboard(page);
  const { stats, users } = useAdminStats(
    {
      stats: Boolean(user) && STATS_PAGES.has(page),
      users: Boolean(user) && USER_PAGES.has(page),
      userScope: page === "workers" ? "filtered" : "all",
    },
    filters,
  );

  // Rendered by each data page inside its own header so the filters sit with the
  // content they affect instead of in a detached strip. Refresh lives here too —
  // top-right of the page, where a dashboard reload belongs.
  const refreshButton = (
    <button
      type="button"
      className="btn-icon"
      onClick={refresh}
      disabled={refreshing}
      aria-label="Refresh data"
      title={refreshing ? "Syncing" : "Refresh data"}
    >
      <RefreshCw size={15} className={refreshing ? "animate-spin" : undefined} />
    </button>
  );

  const filterBar = (
    <div className="header-tools">
      <FilterBar filters={filters} stats={stats} onChange={setFilters} />
      {refreshButton}
    </div>
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
          <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Preparing Console</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-2)", lineHeight: 1.7 }}>
            Loading auth state and session data…
          </p>
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
    <div className="app-shell v2-shell">
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

        {summary && health ? (
          <div key={page} className="page-enter">
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
                  theme="dark"
                  accentHue={accentHue}
                  filterBar={filterBar}
                />
              ) : null}
              {page === "traffic" ? (
                <TrafficPage
                  summary={summary}
                  stats={stats}
                  theme="dark"
                  accentHue={accentHue}
                  filterBar={filterBar}
                />
              ) : null}
              {page === "versions" ? (
                <VersionsPage
                  summary={summary}
                  stats={stats}
                  theme="dark"
                  accentHue={accentHue}
                  filterBar={filterBar}
                />
              ) : null}
              {page === "heatmap" ? (
                <HeatmapPage
                  summary={summary}
                  users={users}
                  theme="dark"
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
                  filterBar={filterBar}
                />
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
              {page === "announcements" ? <AnnouncementsPage filterBar={refreshButton} /> : null}
              {page === "feedback" ? (
                <FeedbackPage
                  summary={summary}
                  onOpenSession={handleOpenLiveSession}
                  onOpenWorker={handleOpenWorker}
                  filterBar={refreshButton}
                />
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
    </div>
  );
}
