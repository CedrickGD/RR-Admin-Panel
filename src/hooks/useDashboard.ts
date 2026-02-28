import { useCallback, useEffect, useState } from "react";
import type {
  AdminDataPayload,
  AuthMode,
  AuthUser,
  HealthPayload,
  SummaryPayload,
} from "../types/telemetry";
import { fetchAdminData, fetchSession, postAuth, postLogout } from "../utils/api";

const REFRESH_MS = 30_000;

export function useDashboard() {
  const [authMode, setAuthMode] = useState<AuthMode>("access");
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [requiresBootstrap, setRequiresBootstrap] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

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

        setSummary(data.summary);
        setHealth(data.health);
        setUser(data.user);
        setAuthMode(data.authMode ?? authMode);
        setLoadError(null);
      } catch (err) {
        if (!silent) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load dashboard data."
          );
        }
      }
    },
    [authMode]
  );

  // Bootstrap auth session
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
  }, [loadDashboard]);

  // Auto-refresh timer
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (!user || tick === 0) return;
    void loadDashboard(true);
  }, [tick, user, loadDashboard]);

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
    const session = await fetchSession();
    setAuthMode(session.authMode ?? "access");
    setRequiresBootstrap(!session.hasUsers);
  };

  const refresh = () => void loadDashboard(false);

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
    authenticate,
    logout,
    refresh,
  } as const;
}
