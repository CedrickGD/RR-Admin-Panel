import {
  Activity,
  ArrowUpRight,
  Cpu,
  Github,
  Globe,
  LogOut,
  MessageSquare,
  Moon,
  RefreshCw,
  Server,
  ShieldAlert,
  Sun,
  Zap
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type TelemetryStatus = "ok" | "degraded" | "down";
type AuthMode = "app" | "access";
type ThemeMode = "dark" | "light";
type Timeframe = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y";

interface TelemetryEvent {
  id: string;
  source: string;
  service: string;
  timestamp: string;
  status: TelemetryStatus;
  metrics: Record<string, unknown>;
  message: string | null;
  receivedAt: string;
}

interface SummaryPayload {
  generatedAt: string;
  storage: "d1" | "kv";
  overallStatus: TelemetryStatus | "unknown";
  recent: TelemetryEvent[];
  stats: {
    totalEvents: number;
    lastIngestAt: string | null;
    sources: number;
    services: number;
  };
}

interface HealthPayload {
  api: "alive";
  storage: { backend: "d1" | "kv"; available?: boolean };
  build: { commit: string; branch?: string; environment?: string; generatedAt?: string };
}

interface AuthUser {
  email: string;
  role: "admin" | "viewer";
}

interface SessionPayload {
  authenticated: boolean;
  hasUsers: boolean;
  authMode?: AuthMode;
  user?: AuthUser;
}

interface AuthActionPayload {
  user?: AuthUser;
  error?: string;
}

interface AdminDataPayload {
  summary: SummaryPayload;
  health: HealthPayload;
  user: AuthUser;
  authMode?: AuthMode;
  error?: string;
}

interface ChartPoint {
  label: string;
  value: number;
}

interface PieSlice {
  name: string;
  value: number;
}

const REFRESH_MS = 30_000;
const THEME_KEY = "rr-admin-theme";
const TIMEFRAMES: Timeframe[] = ["1D", "5D", "1M", "6M", "YTD", "1Y"];
const PIE_COLORS = ["hsl(var(--primary))", "#67e8b5", "#ffd166", "#a66ef6", "#ff7aa2", "#7fdbff"];

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme());
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
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

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // no-op
    }
  }, [theme]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    const id = window.setInterval(() => {
      setTick((current) => current + 1);
    }, REFRESH_MS);

    return () => window.clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (!user || tick === 0) {
      return;
    }

    void loadDashboard(true);
  }, [tick, user]);

  const scopedEvents = useMemo(() => filterEvents(summary?.recent ?? [], timeframe), [summary, timeframe]);
  const chartData = useMemo(() => buildChart(summary?.recent ?? [], timeframe), [summary, timeframe]);
  const serviceSplit = useMemo(() => buildTopSlices(scopedEvents, (event) => event.service, 4), [scopedEvents]);
  const sourceSplit = useMemo(() => buildTopSlices(scopedEvents, (event) => event.source, 4), [scopedEvents]);
  const platformLabel = useMemo(
    () => mostCommonMetric(summary?.recent ?? [], ["platform", "os_platform", "os"], "windows"),
    [summary]
  );
  const versionLabel = useMemo(
    () => mostCommonMetric(summary?.recent ?? [], ["app_version", "version", "client_version"], "unknown"),
    [summary]
  );
  const processArch = useMemo(
    () => mostCommonMetric(summary?.recent ?? [], ["process_arch", "arch"], "x64"),
    [summary]
  );

  const currentCount = scopedEvents.length;
  const previousCount = filterPrevious(summary?.recent ?? [], timeframe).length;
  const percentDelta = previousCount > 0 ? (((currentCount - previousCount) / previousCount) * 100).toFixed(2) : null;

  if (!ready) {
    return <ScreenMessage title="Loading session..." />;
  }

  if (!user) {
    if (authMode === "access") {
      return (
        <ScreenMessage
          icon={<ShieldAlert className="w-10 h-10 text-primary mx-auto" />}
          title="Cloudflare Access Required"
          body="This dashboard is currently in Access mode. Complete Access sign-in and reload."
          actionLabel="Reload"
          onAction={() => window.location.reload()}
        />
      );
    }

    return (
      <AuthScreen
        requiresBootstrap={requiresBootstrap}
        busy={authBusy}
        error={authError}
        onSubmit={(email, password, confirm) => void handleAuthenticate(email, password, confirm)}
      />
    );
  }

  return (
    <div className="min-h-screen app-bg text-foreground selection:bg-primary/30">
      <div className="mesh-bg" aria-hidden="true" />

      <header className="fixed top-0 z-50 w-full glass-panel border-b border-border/50">
        <div className="h-14 px-6 max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary border border-primary/30">
                <Activity className="h-5 w-5" />
              </div>
              <span className="font-bold tracking-tight text-lg neon-text">
                RazorReaper<span className="text-primary font-light">Telemetry</span>
              </span>
            </div>

            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground ml-6">
              <span className="text-foreground">Overview</span>
              <span className="opacity-70">Workers</span>
              <span className="opacity-70">Network</span>
              <span className="opacity-70">Logs</span>
              <span className="opacity-70">Settings</span>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-4 text-sm text-muted-foreground mr-2">
              <a href="#" className="mini-link">
                <MessageSquare className="h-4 w-4" />
                Feedback
              </a>
              <a href="https://github.com/CedrickGD/RazorReaper" target="_blank" rel="noreferrer" className="mini-link">
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </div>

            <button className="btn-ghost" onClick={() => void loadDashboard(false)} type="button" title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              className="btn-ghost"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              type="button"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {authMode === "app" ? (
              <button className="btn-ghost" onClick={() => void handleLogout()} type="button" title="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="pt-24 pb-12 px-6 max-w-[1600px] mx-auto space-y-8">
        {loadError ? <div className="glass-card rounded-xl p-4 border border-rose-500/30 text-rose-300">{loadError}</div> : null}

        <section className="flex flex-col gap-4 float-in">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                Global Network Traffic
              </h1>
              <div className="mt-2 flex items-baseline gap-4 flex-wrap">
                <span className="text-4xl md:text-5xl font-mono tracking-tight font-bold">
                  {currentCount.toLocaleString()} <span className="text-2xl text-muted-foreground">events</span>
                </span>
                {percentDelta ? (
                  <span
                    className={`flex items-center font-medium px-2 py-1 rounded-md text-sm ${
                      Number(percentDelta) >= 0 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 mr-1" />
                    {Number(percentDelta) >= 0 ? "+" : ""}
                    {percentDelta}%
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No prior window</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Last updated: {formatDate(summary?.generatedAt ?? null)}</p>
            </div>

            <div className="text-sm text-muted-foreground text-right">
              <p>{user.email}</p>
              <p className="uppercase text-xs">{user.role}</p>
            </div>
          </div>

          <div className="timeframe-wrap flex items-center gap-1 border border-border/50 bg-card/30 p-1 rounded-lg w-fit max-w-full overflow-x-auto backdrop-blur-md">
            {TIMEFRAMES.map((value) => (
              <button
                key={value}
                onClick={() => setTimeframe(value)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  timeframe === value
                    ? "bg-primary/20 text-primary border border-primary/30 shadow-[0_0_10px_rgba(109,17,237,0.2)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
        </section>

        <section className="glass-card rounded-2xl p-6 h-[400px] w-full float-in delay-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="traffic-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} dx={-10} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  borderRadius: "8px",
                  color: "hsl(var(--foreground))"
                }}
                itemStyle={{ color: "hsl(var(--primary))", fontWeight: "bold" }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#traffic-area)"
                activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 float-in delay-2">
          <StatCard
            label="Active Workers"
            value={String(summary?.stats.sources ?? 0)}
            sub="Unique sources"
            icon={<Server className="w-5 h-5" />}
            tone="blue"
          />
          <StatCard
            label="Total Events"
            value={(summary?.stats.totalEvents ?? 0).toLocaleString()}
            sub={`Scope: ${timeframe}`}
            icon={<Zap className="w-5 h-5" />}
            tone="amber"
          />
          <StatCard
            label="App Version"
            value={versionLabel}
            sub="Latest Seen"
            icon={<Cpu className="w-5 h-5" />}
            tone="primary"
          />
          <StatCard
            label="Platform"
            value={platformLabel}
            sub={`${processArch} runtime`}
            icon={<Globe className="w-5 h-5" />}
            tone="emerald"
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 float-in delay-3">
          <div className="glass-card rounded-xl p-6 lg:col-span-1 space-y-5">
            <div>
              <h3 className="text-lg font-medium">Event Distribution</h3>
              <p className="text-xs text-muted-foreground">By service in selected timeframe</p>
            </div>
            <div className="h-[220px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={serviceSplit} cx="50%" cy="50%" innerRadius={60} outerRadius={88} paddingAngle={4} dataKey="value" stroke="none">
                    {serviceSplit.map((_, index) => (
                      <Cell key={`service-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--foreground))"
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-mono font-bold">{currentCount}</span>
                <span className="text-xs text-muted-foreground">events</span>
              </div>
            </div>

            <div className="space-y-2">
              {serviceSplit.map((slice, index) => (
                <div key={slice.name} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                    {slice.name}
                  </span>
                  <strong>{slice.value}</strong>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Top Sources</p>
              <div className="space-y-2">
                {sourceSplit.map((slice) => (
                  <div key={slice.name} className="text-xs flex justify-between">
                    <span className="truncate max-w-[70%] text-muted-foreground">{slice.name}</span>
                    <span className="font-mono">{slice.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-xl p-0 lg:col-span-2 overflow-hidden flex flex-col">
            <div className="p-6 pb-2 border-b border-border/50 flex justify-between items-center">
              <h3 className="text-lg font-medium flex items-center gap-2">
                Telemetry Stream
                <span className="flex h-2 w-2 relative">
                  <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
              </h3>
              <div className="text-xs text-muted-foreground font-mono">Showing last 50 events</div>
            </div>
            <div className="table-scroll overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
                  <tr>
                    <th className="px-6 py-3 font-medium">Event</th>
                    <th className="px-6 py-3 font-medium">Worker</th>
                    <th className="px-6 py-3 font-medium hidden md:table-cell">Platform</th>
                    <th className="px-6 py-3 font-medium hidden md:table-cell">Version</th>
                    <th className="px-6 py-3 font-medium">Time (UTC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {(summary?.recent ?? []).slice(0, 50).map((event) => {
                    const eventLabel = normalizeEventName(event.service);
                    const platformValue = readMetric(event.metrics, ["platform", "os_platform", "os"], "windows");
                    const versionValue = readMetric(event.metrics, ["app_version", "version", "client_version"], "n/a");
                    const badgeClass = `event-badge ${resolveEventTone(eventLabel)}`;

                    return (
                    <tr key={event.id} className="hover:bg-primary/5 transition-colors">
                      <td className="px-6 py-4">
                        <span className={badgeClass}>{eventLabel}</span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs">{event.source}</td>
                      <td className="px-6 py-4 text-muted-foreground hidden md:table-cell">{platformValue}</td>
                      <td className="px-6 py-4 text-muted-foreground hidden md:table-cell">{versionValue}</td>
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs">{formatUtc(event.timestamp)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <footer className="text-xs text-muted-foreground">
          API: {health?.api ?? "-"} | Storage: {health?.storage.backend.toUpperCase() ?? "-"} | Build: <span className="font-mono">{health?.build.commit.slice(0, 12) ?? "-"}</span>
        </footer>
      </main>
    </div>
  );

  async function bootstrap(): Promise<void> {
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
  }

  async function loadDashboard(silent: boolean): Promise<void> {
    try {
      const response = await fetch("/api/admin/data", { method: "GET" });
      const body = await parseJson<AdminDataPayload>(response);

      if (response.status === 401) {
        setUser(null);
        setSummary(null);
        setHealth(null);
        const session = await fetchSession();
        setAuthMode(session.authMode ?? "access");
        setRequiresBootstrap(!session.hasUsers);
        setAuthError(session.authMode === "app" ? "Session expired. Please sign in again." : null);
        return;
      }

      if (!response.ok || !body?.summary || !body?.health || !body?.user) {
        throw new Error(body?.error ?? "Failed to load dashboard data.");
      }

      setSummary(body.summary);
      setHealth(body.health);
      setUser(body.user);
      setAuthMode(body.authMode ?? authMode);
      setLoadError(null);
    } catch (loadFailure) {
      if (!silent) {
        setLoadError(loadFailure instanceof Error ? loadFailure.message : "Failed to load dashboard data.");
      }
    }
  }

  async function handleAuthenticate(email: string, password: string, confirm: string): Promise<void> {
    if (authBusy) {
      return;
    }

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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password
        })
      });

      const body = await parseJson<AuthActionPayload>(response);
      if (!response.ok || !body?.user) {
        setAuthError(body?.error ?? "Authentication failed.");
        return;
      }

      setUser(body.user);
      setRequiresBootstrap(false);
      await loadDashboard(false);
    } catch {
      setAuthError("Authentication request failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout(): Promise<void> {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // no-op
    }

    setUser(null);
    setSummary(null);
    setHealth(null);
    const session = await fetchSession();
    setAuthMode(session.authMode ?? "access");
    setRequiresBootstrap(!session.hasUsers);
  }
}

function ScreenMessage(props: {
  icon?: ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="min-h-screen app-bg text-foreground flex items-center justify-center p-6">
      <div className="glass-card rounded-2xl p-8 max-w-xl w-full text-center space-y-4">
        {props.icon ?? <Activity className="w-8 h-8 text-primary mx-auto" />}
        <h1 className="text-2xl font-bold">{props.title}</h1>
        {props.body ? <p className="text-muted-foreground">{props.body}</p> : null}
        {props.actionLabel && props.onAction ? (
          <button className="btn-primary mx-auto" onClick={props.onAction} type="button">
            {props.actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AuthScreen(props: {
  requiresBootstrap: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, confirm: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    props.onSubmit(email, password, confirm);
  }

  return (
    <div className="min-h-screen app-bg text-foreground flex items-center justify-center p-6">
      <article className="glass-card rounded-2xl p-8 max-w-xl w-full space-y-4">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">RazorReaper Infrastructure</p>
        <h1 className="text-2xl font-bold">{props.requiresBootstrap ? "Create Admin Account" : "Sign In"}</h1>
        <p className="text-muted-foreground">
          {props.requiresBootstrap
            ? "First run detected. Create the first admin account with your own email and password."
            : "Sign in with your dashboard credentials."}
        </p>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <input className="input-field" type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <input className="input-field" type="password" placeholder="password" autoComplete={props.requiresBootstrap ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} />
          {props.requiresBootstrap ? (
            <input className="input-field" type="password" placeholder="confirm password" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          ) : null}
          <button className="btn-primary w-full" type="submit" disabled={props.busy}>
            {props.busy ? "Please wait..." : props.requiresBootstrap ? "Create Account" : "Sign In"}
          </button>
        </form>

        {props.error ? <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">{props.error}</p> : null}
      </article>
    </div>
  );
}

function StatCard(props: {
  label: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone: "blue" | "amber" | "primary" | "emerald";
}) {
  const toneClass =
    props.tone === "blue"
      ? "bg-blue-500/10 text-blue-500"
      : props.tone === "amber"
      ? "bg-amber-500/10 text-amber-500"
      : props.tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-500"
      : "bg-primary/10 text-primary";

  return (
    <article className="glass-card kpi-card p-5 rounded-xl relative overflow-hidden">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2 rounded-lg ${toneClass}`}>{props.icon}</div>
      </div>
      <h3 className="text-muted-foreground text-sm font-medium">{props.label}</h3>
      <p className="text-3xl font-mono font-bold tracking-tight mt-1">{props.value}</p>
      <p className="text-xs text-muted-foreground mt-1">{props.sub}</p>
    </article>
  );
}

function getInitialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function getWindow(timeframe: Timeframe): { start: number; end: number } {
  const end = Date.now();
  const day = 24 * 60 * 60 * 1000;

  if (timeframe === "1D") {
    return { start: end - day, end };
  }

  if (timeframe === "5D") {
    return { start: end - 5 * day, end };
  }

  if (timeframe === "1M") {
    return { start: end - 30 * day, end };
  }

  if (timeframe === "6M") {
    return { start: end - 180 * day, end };
  }

  if (timeframe === "1Y") {
    return { start: end - 365 * day, end };
  }

  const now = new Date(end);
  return {
    start: new Date(now.getFullYear(), 0, 1).getTime(),
    end
  };
}

function filterEvents(events: TelemetryEvent[], timeframe: Timeframe): TelemetryEvent[] {
  const { start, end } = getWindow(timeframe);

  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
  });
}

function filterPrevious(events: TelemetryEvent[], timeframe: Timeframe): TelemetryEvent[] {
  const { start, end } = getWindow(timeframe);
  const span = end - start;

  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return Number.isFinite(timestamp) && timestamp >= start - span && timestamp < start;
  });
}

function buildChart(events: TelemetryEvent[], timeframe: Timeframe): ChartPoint[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  let count = 24;
  let step = 60 * 60 * 1000;
  let format: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

  if (timeframe === "5D") {
    count = 60;
    step = 2 * 60 * 60 * 1000;
    format = { month: "short", day: "numeric", hour: "2-digit" };
  } else if (timeframe === "1M") {
    count = 30;
    step = day;
    format = { month: "short", day: "numeric" };
  } else if (timeframe === "6M") {
    count = 26;
    step = 7 * day;
    format = { month: "short", day: "numeric" };
  } else if (timeframe === "YTD" || timeframe === "1Y") {
    count = 12;
    step = 30 * day;
    format = { month: "short" };
  }

  const start = now - (count - 1) * step;
  const buckets = Array.from({ length: count }, (_, index) => ({
    label: new Date(start + index * step).toLocaleString(undefined, format),
    value: 0
  }));

  for (const event of events) {
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) {
      continue;
    }

    const bucket = Math.min(count - 1, Math.max(0, Math.floor((timestamp - start) / step)));
    buckets[bucket].value += 1;
  }

  return buckets;
}

function buildTopSlices(
  events: TelemetryEvent[],
  keySelector: (event: TelemetryEvent) => string,
  limit: number
): PieSlice[] {
  const counts = new Map<string, number>();

  for (const event of events) {
    const key = keySelector(event).trim() || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const top = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));

  if (top.length === 0) {
    return [{ name: "no-data", value: 1 }];
  }

  return top;
}

function mostCommonMetric(events: TelemetryEvent[], keys: string[], fallback: string): string {
  const counts = new Map<string, number>();

  for (const event of events) {
    const value = readMetric(event.metrics, keys, "");
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return fallback;
  }

  const winner = [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
  return winner;
}

function readMetric(metrics: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return fallback;
}

function normalizeEventName(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return "event";
  }
  return value.replaceAll(" ", "_");
}

function resolveEventTone(eventName: string): string {
  if (eventName.includes("app_start") || eventName.includes("install")) {
    return "event-good";
  }
  if (eventName.includes("heartbeat")) {
    return "event-primary";
  }
  if (eventName.includes("error") || eventName.includes("down")) {
    return "event-bad";
  }
  return "event-neutral";
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

function formatUtc(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Date(timestamp).toISOString().replace("T", " ").replace(".000Z", "Z");
}

async function fetchSession(): Promise<SessionPayload> {
  try {
    const response = await fetch("/api/auth/session", { method: "GET" });
    const body = await parseJson<SessionPayload>(response);

    if (!response.ok || typeof body?.authenticated !== "boolean") {
      return {
        authenticated: false,
        hasUsers: true,
        authMode: "access"
      };
    }

    return body;
  } catch {
    return {
      authenticated: false,
      hasUsers: true,
      authMode: "access"
    };
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
