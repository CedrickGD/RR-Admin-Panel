import { AlertTriangle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { LoginForm } from "./components/LoginForm";
import { Navbar } from "./components/Navbar";
import { useAdminStats, DEFAULT_STATS_FILTERS } from "./hooks/useAdminStats";
import { useDashboard } from "./hooks/useDashboard";
import { useAccent } from "./hooks/useAccent";
import { LogsPage } from "./pages/LogsPage";
import { HeatmapPage } from "./pages/HeatmapPage";
import { LivePage } from "./pages/LivePage";
import { OverviewPage } from "./pages/OverviewPage";
import { VersionsPage } from "./pages/VersionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrafficPage } from "./pages/TrafficPage";
import { WorkersPage } from "./pages/WorkersPage";
import type { PageKey, StatsFilters } from "./types/telemetry";

type FocusedSession = { id: string; token: number } | null;

const FILTERED_PAGES: ReadonlySet<PageKey> = new Set(["overview", "traffic", "versions", "workers"]);

export default function App() {
  const { hue: accentHue } = useAccent();
  const [page, setPage] = useState<PageKey>("overview");
  const [focusedLiveSession, setFocusedLiveSession] = useState<FocusedSession>(null);
  const [focusedHeatmapSession, setFocusedHeatmapSession] = useState<FocusedSession>(null);
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
  const { stats, users } = useAdminStats(Boolean(user), filters);

  function nextFocusedSession(current: FocusedSession, sessionId: string): FocusedSession {
    return { id: sessionId, token: current?.id === sessionId ? current.token + 1 : 1 };
  }
  function handleOpenLiveSession(sessionId: string) {
    setFocusedLiveSession((c) => nextFocusedSession(c, sessionId));
    setPage("live");
  }
  function handleOpenHeatmapSession(sessionId: string) {
    setFocusedHeatmapSession((c) => nextFocusedSession(c, sessionId));
    setPage("heatmap");
  }

  /* ─── Loading ─── */
  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: "var(--accent-subtle)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
            color: "var(--accent-text)",
          }}>
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
          <p className="kicker" style={{ marginBottom: 8 }}>Initializing</p>
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
    <div className="app-shell">
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

      <main className="main-area">
        {loadError ? (
          <div className="page-content" style={{ paddingBottom: 0, paddingTop: 20 }}>
            <div style={{
              background: "hsl(4 86% 58% / 0.07)",
              border: "1px solid hsl(4 86% 58% / 0.22)",
              borderRadius: 12,
              padding: "14px 18px",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}>
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--danger)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
                  Load error
                </p>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-1)", marginBottom: 4 }}>The dashboard could not refresh.</p>
                <p style={{ fontSize: "0.8125rem", color: "hsl(4 86% 68%)" }}>{loadError}</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>Retry</button>
            </div>
          </div>
        ) : null}

        {summary && health ? (
          <div key={page} className="page-enter">
            {FILTERED_PAGES.has(page) ? (
              <div className="page-content" style={{ paddingBottom: 0, paddingTop: 18 }}>
                <FilterBar filters={filters} stats={stats} onChange={setFilters} />
              </div>
            ) : null}
            {page === "overview"  ? <OverviewPage  summary={summary} stats={stats} theme="dark" accentHue={accentHue} /> : null}
            {page === "traffic"   ? <TrafficPage   summary={summary} stats={stats} theme="dark" accentHue={accentHue} /> : null}
            {page === "versions"  ? <VersionsPage  summary={summary} stats={stats} theme="dark" accentHue={accentHue} /> : null}
            {page === "heatmap"   ? (
              <HeatmapPage
                summary={summary}
                theme="dark"
                onOpenSession={handleOpenLiveSession}
                focusedSessionId={focusedHeatmapSession?.id ?? null}
                focusedSessionToken={focusedHeatmapSession?.token ?? 0}
              />
            ) : null}
            {page === "live" ? (
              <LivePage
                summary={summary}
                focusedSessionId={focusedLiveSession?.id ?? null}
                focusedSessionToken={focusedLiveSession?.token ?? 0}
                onOpenMapSession={handleOpenHeatmapSession}
              />
            ) : null}
            {page === "workers"   ? <WorkersPage   summary={summary} stats={stats} users={users} onOpenMapSession={handleOpenHeatmapSession} /> : null}
            {page === "logs"      ? <LogsPage      summary={summary} /> : null}
            {page === "settings"  ? (
              <SettingsPage
                user={user}
                authMode={authMode}
                summary={summary}
                health={health}
                onLogout={() => void logout()}
              />
            ) : null}
          </div>
        ) : !loadError ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: "24px" }}>
            <div className="login-card" style={{ textAlign: "center", maxWidth: 380 }}>
              <div className="spinner" style={{ margin: "0 auto 16px" }} />
              <p className="kicker" style={{ marginBottom: 8 }}>Loading</p>
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
