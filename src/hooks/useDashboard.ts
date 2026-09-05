import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminDataPayload,
  AuthMode,
  AuthUser,
  HealthPayload,
  PageKey,
  SummaryPayload,
} from "../types/telemetry";
import { apiUrl, fetchAdminData, fetchSession, postAuth, postLogout } from "../utils/api";
import { emitRefresh } from "../utils/refreshBus";

const DEFAULT_REFRESH_MS = 15_000;
const LIVE_REFRESH_MS = 5_000;

export function useDashboard(activePage: PageKey) {
  const [authMode, setAuthMode] = useState<AuthMode>("access");
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [requiresBootstrap, setRequiresBootstrap] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const dashboardRequest = useRef<Promise<void> | null>(null);
  const accessRevision = useRef(0);
  const currentUser = useRef(user);
  useEffect(() => {
    currentUser.current = user;
  }, [user]);
  const loadDashboard = useCallback((silent: boolean): Promise<void> => {
    // Slow NAS reads and fetch retries can exceed the polling interval. Share
    // the in-flight request instead of stacking more DB work behind it.
    if (dashboardRequest.current) return dashboardRequest.current;

    const request = (async () => {
      const revision = accessRevision.current;
      try {
        const { ok, data, status } = await fetchAdminData();
        if (revision !== accessRevision.current) return;

        if (status === 401) {
          const session = await fetchSession();
          if (revision !== accessRevision.current) return;
          setAuthMode(session.authMode ?? "access");
          setRequiresBootstrap(!session.hasUsers);
          if (!session.authenticated) {
            // A dashboard 401 can be produced by an intermediary or a stale
            // response. Only the session endpoint's explicit, valid verdict is
            // allowed to replace the authenticated UI with the login gate.
            setUser(null);
            setSummary(null);
            setHealth(null);
            setAuthError(
              session.authMode === "app" ? "Session expired. Please sign in again." : null,
            );
            return;
          }

          setUser(session.user ?? null);
          setRequiresBootstrap(false);
          throw new Error("Dashboard authorization could not be confirmed.");
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
        setSummary((prev) =>
          prev && Date.parse(incoming.generatedAt) < Date.parse(prev.generatedAt) ? prev : incoming,
        );
        setHealth(data.health);
        setUser(data.user);
        setAuthMode((prev) => data.authMode ?? prev);
        setLoadError(null);
      } catch (err) {
        if (!silent) {
          setLoadError(err instanceof Error ? err.message : "Failed to load dashboard data.");
        }
      }
    })();

    dashboardRequest.current = request;
    void request.finally(() => {
      if (dashboardRequest.current === request) dashboardRequest.current = null;
    });
    return request;
  }, []);

  const verifySession = useCallback(async () => {
    setReady(false);
    setSessionError(null);

    try {
      const session = await fetchSession();
      setAuthMode(session.authMode ?? "access");
      if (session.authenticated && session.user) {
        setUser(session.user);
        setRequiresBootstrap(false);
        await loadDashboard(false);
      } else {
        setUser(null);
        setSummary(null);
        setHealth(null);
        setRequiresBootstrap(!session.hasUsers);
      }
    } catch {
      // An unavailable verifier says nothing about authentication. Keep this
      // state distinct from an explicit unauthenticated response so an outage
      // can never render the login/bootstrap form as a false logout.
      setSessionError(
        "Session verification is temporarily unavailable. Your sign-in state has not been changed.",
      );
    } finally {
      setReady(true);
    }
  }, [loadDashboard]);

  // Bootstrap auth session — runs once on mount
  useEffect(() => {
    void verifySession();
  }, [verifySession]);

  useEffect(() => {
    if (!user?.email) return;
    const stream = new EventSource(apiUrl("/api/auth/watch"), { withCredentials: true });
    const changed = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { authenticated: boolean; user?: AuthUser };
        if (
          payload.authenticated &&
          JSON.stringify(payload.user) === JSON.stringify(currentUser.current)
        )
          return;
        accessRevision.current++;
        setSummary(null);
        setHealth(null);
        if (!payload.authenticated) {
          stream.close();
          setUser(null);
          setAuthError("Your panel session has ended. Sign in again.");
        } else if (payload.user) {
          setUser(payload.user);
          void (dashboardRequest.current ?? Promise.resolve()).then(() => loadDashboard(false));
        }
      } catch {
        /* A malformed event cannot grant access. The next server request rechecks it. */
      }
    };
    stream.addEventListener("access", changed);
    return () => {
      stream.removeEventListener("access", changed);
      stream.close();
    };
  }, [user?.email, loadDashboard]);

  useEffect(() => {
    if (!user) return;

    const refreshMs = activePage === "live" ? LIVE_REFRESH_MS : DEFAULT_REFRESH_MS;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDashboard(true);
        emitRefresh();
      }
    }, refreshMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadDashboard(true);
        emitRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
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

  const authenticate = async (email: string, password: string, confirm: string) => {
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
      const endpoint = requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login";
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
    accessRevision.current++;
    if (authMode === "access") {
      window.location.assign("/cdn-cgi/access/logout");
      return;
    }
    setReady(false);
    setUser(null);
    setSummary(null);
    setHealth(null);
    setAuthError(null);
    setSessionError(null);
    try {
      const session = await fetchSession();
      setAuthMode(session.authMode ?? "access");
      setRequiresBootstrap(!session.hasUsers);
      if (session.authenticated && session.user) {
        setUser(session.user);
        setRequiresBootstrap(false);
        await loadDashboard(false);
      }
    } catch {
      setSessionError(
        "Session verification is temporarily unavailable. Your sign-in state has not been changed.",
      );
    } finally {
      setReady(true);
    }
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const startedAt = Date.now();
    // Every mounted page-level data source (licenses, feedback, announcements,
    // suspensions, stats…) re-pulls from the worker too — the one button
    // refreshes the whole page in place, never via a browser reload.
    emitRefresh();
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
    sessionError,
    summary,
    health,
    loadError,
    refreshing,
    authenticate,
    logout,
    retrySession: verifySession,
    refresh,
  } as const;
}
