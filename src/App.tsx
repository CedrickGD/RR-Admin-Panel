import { AlertTriangle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { LoginForm } from "./components/LoginForm";
import { NetworkBackdrop } from "./components/NetworkBackdrop";
import { MobileNav, Sidebar } from "./components/Sidebar";
import { useDashboard } from "./hooks/useDashboard";
import { useTheme } from "./hooks/useTheme";
import { LogsPage } from "./pages/LogsPage";
import { LivePage } from "./pages/LivePage";
import { OverviewPage } from "./pages/OverviewPage";
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

  const [page, setPage] = useState<PageKey>("overview");

  /* ─── Loading ─── */
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-xl p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <RefreshCw className="h-6 w-6 animate-spin" />
          </div>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
            Loading
          </p>
          <h1 className="mt-3 text-2xl font-black tracking-[-0.06em]">Preparing dashboard</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[hsl(var(--muted-foreground))]">
            Loading auth state and session data.
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
        onSubmit={(email, password, confirm) =>
          void authenticate(email, password, confirm)
        }
      />
    );
  }

  /* ─── Dashboard ─── */
  return (
    <div className="app-shell">
      <NetworkBackdrop theme={theme} />

      <Sidebar
        page={page}
        onNavigate={setPage}
        user={user}
        authMode={authMode}
        summary={summary}
        health={health}
        theme={theme}
        onToggleTheme={toggleTheme}
        onRefresh={refresh}
        refreshing={refreshing}
        onLogout={() => void logout()}
      />

      <div className="main-area">
        {loadError ? (
          <div className="px-4 pt-4 md:px-8 md:pt-8">
            <div className="card border-rose-500/25 bg-rose-500/5 p-4 text-sm text-rose-500">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-500/80">Load error</p>
                    <p className="mt-1 font-semibold text-[hsl(var(--foreground))]">The dashboard could not refresh.</p>
                    <p className="mt-1 text-sm leading-6 text-rose-500">{loadError}</p>
                  </div>
                </div>

                <button type="button" className="btn-ghost self-start sm:self-center" onClick={refresh}>
                  Retry fetch
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {summary && health ? (
          <>
            {page === "overview" ? <OverviewPage summary={summary} theme={theme} /> : null}
            {page === "live" ? <LivePage summary={summary} /> : null}
            {page === "workers" ? <WorkersPage summary={summary} /> : null}
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
          <div className="flex min-h-[70vh] items-center justify-center px-4 md:px-8">
            <div className="card w-full max-w-lg p-8 text-center">
              <div className="spinner mx-auto" />
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                Loading
              </p>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.06em]">Loading dashboard data</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[hsl(var(--muted-foreground))]">
                Fetching session summary and recent errors.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <MobileNav page={page} onNavigate={setPage} />
    </div>
  );
}
