import { useCallback, useEffect, useState } from "react";
import type {
  AdminDataPayload,
  AuthMode,
  AuthUser,
  HealthPayload,
  PageKey,
  SummaryPayload,
} from "../types/telemetry";
import { fetchAdminData, fetchSession, postAuth, postLogout } from "../utils/api";

const DEFAULT_REFRESH_MS = 15_000;
const LIVE_REFRESH_MS = 5_000;

export function useDashboard(activePage: PageKey) {
  const [authMode, setAuthMode] = useState<AuthMode>("access");
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [requiresBootstrap, setRequiresBootstrap] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadDashboard = useCallback(
    async (silent: boolean) => {
      try {
        const { ok, data, status } = await fetchAdminData();

        if (status === 401) {
          setUser(null);
          setSummary(null);
          setHealth(null);
          const session = await fetchSession();
          setAuthMode(session.authMode ?? "access");
          setRequiresBootstrap(!session.hasUsers);
          setAuthError(
            session.authMode === "app"
              ? "Session expired. Please sign in again."
              : null
          );
          return;
        }

        if (!ok || !data?.summary || !data?.health || !data?.user) {
          throw new Error(data?.error ?? "Failed to load dashboard data.");
        }

        // The 5s live poll can race: a slow, older response may resolve after a
        // newer one, and an edge/replica could hand back an older snapshot. Each
        // response carries a server-stamped generatedAt, so never let an older
        // payload clobber a newer one already on screen. (Unparseable timestamps
        // fall through to accept, so a bad value can't wedge the view.)
        const incoming = data.summary;
        setSummary(prev =>
          prev && Date.parse(incoming.generatedAt) < Date.parse(prev.generatedAt)
            ? prev
            : incoming
        );
        setHealth(data.health);
        setUser(data.user);
        setAuthMode(prev => data.authMode ?? prev);
        setLoadError(null);
      } catch (err) {
        if (!silent) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load dashboard data."
          );
        }
      }
    },
    []
  );

  // Bootstrap auth session — runs once on mount
  useEffect(() => {
    void (async () => {
      const session = await fetchSession();
      setAuthMode(session.authMode ?? "access");
      if (session.authenticated && session.user) {
        setUser(session.user);
        setRequiresBootstrap(false);
        await loadDashboard(false);
      } else {
        setRequiresBootstrap(!session.hasUsers);
      }
      setReady(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;

    const refreshMs = activePage === "live" ? LIVE_REFRESH_MS : DEFAULT_REFRESH_MS;
    const id = window.setInterval(() => {
      void loadDashboard(true);
    }, refreshMs);

    return () => window.clearInterval(id);
  }, [activePage, loadDashboard, user]);

  useEffect(() => {
    if (!user || activePage !== "live") {
      return;
    }

    void loadDashboard(true);
  }, [activePage, loadDashboard, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const syncVisibleState = () => {
      if (document.visibilityState === "visible") {
        void loadDashboard(true);
      }
    };

    window.addEventListener("focus", syncVisibleState);
    document.addEventListener("visibilitychange", syncVisibleState);

    return () => {
      window.removeEventListener("focus", syncVisibleState);
      document.removeEventListener("visibilitychange", syncVisibleState);
    };
  }, [loadDashboard, user]);

  const authenticate = async (
    email: string,
    password: string,
    confirm: string
  ) => {
    if (authBusy) return;
    if (!email || !password) {
      setAuthError("Email and password are required.");
      return;
    }
    if (requiresBootstrap && password !== confirm) {
      setAuthError("Passwords do not match.");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);

    try {
      const endpoint = requiresBootstrap
        ? "/api/auth/bootstrap"
        : "/api/auth/login";
      const { ok, data } = await postAuth(endpoint, email, password);
      if (!ok || !data?.user) {
        setAuthError(data?.error ?? "Authentication failed.");
        return;
      }
      setUser(data.user);
      setRequiresBootstrap(false);
      await loadDashboard(false);
    } catch {
      setAuthError("Authentication request failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    await postLogout();
    setUser(null);
    setSummary(null);
    setHealth(null);
    setAuthError(null);
    const session = await fetchSession();
    setAuthMode(session.authMode ?? "access");
    setRequiresBootstrap(!session.hasUsers);
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const startedAt = Date.now();
    // Surface the full-page load error ONLY when there's nothing already on screen.
    // The click still gives feedback (spinner + a data update on success), but a
    // transient refresh blip must not throw a load-error banner over good data we're
    // already showing — the next background poll self-heals it anyway.
    await loadDashboard(summary !== null);
    const elapsed = Date.now() - startedAt;
    const minVisibleMs = 550;
    if (elapsed < minVisibleMs) {
      await new Promise((resolve) => window.setTimeout(resolve, minVisibleMs - elapsed));
    }
    setRefreshing(false);
  };

  return {
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
  } as const;
}
