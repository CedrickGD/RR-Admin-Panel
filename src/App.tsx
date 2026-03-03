import { useEffect, useState } from "react";
import { LoginForm } from "./components/LoginForm";
import { MobileNav, Sidebar } from "./components/Sidebar";
import { useDashboard } from "./hooks/useDashboard";
import { useTheme } from "./hooks/useTheme";
import { LogsPage } from "./pages/LogsPage";
import { LivePage } from "./pages/LivePage";
import { NetworkPage } from "./pages/NetworkPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ActionsPage } from "./pages/ActionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkersPage } from "./pages/WorkersPage";
import type { PageKey } from "./types/telemetry";

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
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
  } = useDashboard();

  const [page, setPage] = useState<PageKey>("live");

  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.style.setProperty("--status-dot-progress", "0");
      return;
    }

    let raf = 0;
    const durationMs = 2000;

    const tick = (now: number) => {
      const phase = (now % durationMs) / durationMs;
      const progress = phase <= 0.7 ? phase / 0.7 : 1;
      root.style.setProperty("--status-dot-progress", progress.toFixed(4));
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      root.style.removeProperty("--status-dot-progress");
    };
  }, []);

  /* ─── Loading ─── */
  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[hsl(var(--background))]">
        <div className="spinner" />
        <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
          Loading session...
        </p>
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
        onSubmit={(email, password, confirm) =>
          void authenticate(email, password, confirm)
        }
      />
    );
  }

  /* ─── Dashboard ─── */
  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        onNavigate={setPage}
        user={user}
        authMode={authMode}
        theme={theme}
        onToggleTheme={toggleTheme}
        onRefresh={refresh}
        refreshing={refreshing}
        onLogout={() => void logout()}
      />

      <div className="main-area">
        {loadError ? (
          <div className="mx-8 mt-6 p-4 rounded-xl border border-rose-500/30 bg-rose-500/8 text-rose-400 text-sm">
            {loadError}
          </div>
        ) : null}

        {summary && health ? (
          <>
            {page === "overview" ? <OverviewPage summary={summary} /> : null}
            {page === "live" ? <LivePage summary={summary} /> : null}
            {page === "workers" ? <WorkersPage summary={summary} /> : null}
            {page === "network" ? <NetworkPage summary={summary} /> : null}
            {page === "actions" ? <ActionsPage summary={summary} /> : null}
            {page === "logs" ? <LogsPage summary={summary} /> : null}
            {page === "settings" ? (
              <SettingsPage
                user={user}
                authMode={authMode}
                summary={summary}
                health={health}
                onLogout={() => void logout()}
              />
            ) : null}
          </>
        ) : !loadError ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
            <div className="spinner" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Loading dashboard data...
            </p>
          </div>
        ) : null}
      </div>

      <MobileNav page={page} onNavigate={setPage} />
    </div>
  );
}
