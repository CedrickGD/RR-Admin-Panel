import "./styles.css";

type TelemetryStatus = "ok" | "degraded" | "down";
type OverallStatus = TelemetryStatus | "unknown";
type ViewMode = "overview" | "telemetry" | "analytics" | "settings";
type AppUserRole = "admin" | "viewer";
type AuthMode = "app" | "access";
type ThemeMode = "dark" | "light";
type Timeframe = "24h" | "7d" | "30d" | "all";

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
  overallStatus: OverallStatus;
  latest: TelemetryEvent[];
  recent: TelemetryEvent[];
  stats: {
    totalEvents: number;
    lastIngestAt: string | null;
    sources: number;
    services: number;
  };
}

interface HealthPayload {
  ok: boolean;
  api: "alive";
  storage: {
    backend: "d1" | "kv";
    available: boolean;
  };
  lastIngestAt: string | null;
  count: number;
  build: {
    commit: string;
    branch: string;
    environment: string;
    generatedAt: string;
  };
}

interface AuthUser {
  email: string;
  role: AppUserRole;
}

interface SessionPayload {
  ok: boolean;
  authenticated: boolean;
  hasUsers: boolean;
  authMode?: AuthMode;
  user?: AuthUser;
  error?: string;
}

interface AuthActionPayload {
  ok: boolean;
  user?: AuthUser;
  expiresAt?: string;
  error?: string;
}

interface AdminDataPayload {
  ok: boolean;
  summary: SummaryPayload;
  health: HealthPayload;
  user: AuthUser;
  accessIdentity: string | null;
  sessionExpiresAt: string | null;
  authMode?: AuthMode;
  error?: string;
}

interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutPanel {
  title: string;
  subtitle: string;
  totalLabel: string;
  slices: DonutSlice[];
}

interface TrendPoint {
  label: string;
  total: number;
  incidents: number;
  timestamp: number;
}

interface TimeWindowStats {
  last24h: number;
  last7d: number;
  last30d: number;
  lifetime: number;
}

interface TopEntry {
  label: string;
  count: number;
  share: number;
}

const REFRESH_MS = 30_000;
const THEME_STORAGE_KEY = "rr-admin-theme";
const DONUT_COLORS = ["#2ec5ff", "#20e3b2", "#ffbc42", "#ff6a88", "#7fdbff", "#64dfdf", "#b2f7ef"];

const appRoot = mustFind<HTMLDivElement>("#app");

let currentUser: AuthUser | null = null;
let requiresBootstrap = false;
let authErrorMessage: string | null = null;
let authBusy = false;
let authMode: AuthMode = "access";

let viewMode: ViewMode = "overview";
let summary: SummaryPayload | null = null;
let health: HealthPayload | null = null;
let accessIdentity: string | null = null;
let sessionExpiresAt: string | null = null;
let dashboardErrorMessage: string | null = null;
let settingsMessage: string | null = null;

let telemetrySearch = "";
let telemetryFilter: TelemetryStatus | "all" = "all";
let selectedTimeframe: Timeframe = "7d";
let themeMode: ThemeMode = loadThemePreference();
let refreshTimer: number | null = null;

applyTheme(themeMode);
void bootstrap();

async function bootstrap(): Promise<void> {
  const session = await fetchSessionState();
  authMode = session.authMode ?? "access";

  if (session.authenticated && session.user) {
    currentUser = session.user;
    authErrorMessage = null;
    mountDashboardShell();
    await fetchProtectedData(false);
    return;
  }

  if (authMode === "access") {
    mountAccessLoginHint();
    return;
  }

  requiresBootstrap = !session.hasUsers;
  mountAuthShell();
}

async function fetchSessionState(): Promise<SessionPayload> {
  try {
    const response = await fetch("/api/auth/session", { method: "GET" });
    const body = await parseJson<SessionPayload>(response);

    if (!response.ok || typeof body?.authenticated !== "boolean") {
      return {
        ok: false,
        authenticated: false,
        hasUsers: true,
        authMode: "access"
      };
    }

    return body;
  } catch {
    return {
      ok: false,
      authenticated: false,
      hasUsers: true,
      authMode: "access"
    };
  }
}

function mountAccessLoginHint(): void {
  stopRefreshLoop();

  appRoot.innerHTML = `
    <section class="auth-shell">
      <article class="panel glass auth-card">
        <p class="eyebrow">RazorReaper Infrastructure</p>
        <h1>Cloudflare Access Required</h1>
        <p class="auth-copy">
          This dashboard is configured for Cloudflare Access only. Complete Access sign-in and reload.
        </p>
        <button id="reloadButton" type="button">Reload</button>
      </article>
    </section>
  `;

  const reloadButton = mustFind<HTMLButtonElement>("#reloadButton");
  reloadButton.addEventListener("click", () => {
    window.location.reload();
  });
}
function mountAuthShell(): void {
  stopRefreshLoop();

  const modeTitle = requiresBootstrap ? "Create Admin Account" : "Sign In";
  const modeCopy = requiresBootstrap
    ? "First run detected. Create the first admin account with your own email and password."
    : "Sign in with your dashboard credentials.";
  const actionLabel = requiresBootstrap ? "Create Account" : "Sign In";

  appRoot.innerHTML = `
    <section class="auth-shell">
      <article class="panel glass auth-card">
        <p class="eyebrow">RazorReaper Infrastructure</p>
        <h1>${modeTitle}</h1>
        <p class="auth-copy">${modeCopy}</p>

        <form id="authForm" class="auth-form">
          <label for="authEmail">Email</label>
          <input id="authEmail" name="email" type="email" autocomplete="email" required placeholder="you@example.com" />

          <label for="authPassword">Password</label>
          <input id="authPassword" name="password" type="password" autocomplete="${requiresBootstrap ? "new-password" : "current-password"}" required minlength="10" maxlength="256" />

          ${
            requiresBootstrap
              ? `
              <label for="authPasswordConfirm">Confirm Password</label>
              <input id="authPasswordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" required minlength="10" maxlength="256" />
            `
              : ""
          }

          <button id="authSubmit" type="submit">${actionLabel}</button>
        </form>

        <p id="authError" class="error-text">${escapeHtml(authErrorMessage ?? "")}</p>
      </article>
    </section>
  `;

  const form = mustFind<HTMLFormElement>("#authForm");
  form.addEventListener("submit", (event) => {
    void handleAuthSubmit(event);
  });
}

async function handleAuthSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (authBusy) {
    return;
  }

  const form = event.currentTarget as HTMLFormElement | null;
  if (!form) {
    return;
  }

  const formData = new FormData(form);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (!email || !password) {
    authErrorMessage = "Email and password are required.";
    mountAuthShell();
    return;
  }

  if (requiresBootstrap && password !== passwordConfirm) {
    authErrorMessage = "Passwords do not match.";
    mountAuthShell();
    return;
  }

  authBusy = true;
  const submitButton = document.querySelector<HTMLButtonElement>("#authSubmit");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = requiresBootstrap ? "Creating..." : "Signing in...";
  }

  try {
    const endpoint = requiresBootstrap ? "/api/auth/bootstrap" : "/api/auth/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });

    const body = await parseJson<AuthActionPayload>(response);
    if (!response.ok || !body?.user) {
      authErrorMessage = body?.error ?? "Authentication failed.";
      mountAuthShell();
      return;
    }

    currentUser = body.user;
    requiresBootstrap = false;
    authErrorMessage = null;
    dashboardErrorMessage = null;
    settingsMessage = null;
    viewMode = "overview";
    summary = null;
    health = null;
    accessIdentity = null;
    sessionExpiresAt = body.expiresAt ?? null;
    telemetrySearch = "";
    telemetryFilter = "all";
    selectedTimeframe = "7d";

    mountDashboardShell();
    await fetchProtectedData(false);
  } catch {
    authErrorMessage = "Authentication request failed.";
    mountAuthShell();
  } finally {
    authBusy = false;
  }
}

function mountDashboardShell(): void {
  if (!currentUser) {
    mountAuthShell();
    return;
  }

  if (currentUser.role !== "admin" && viewMode === "settings") {
    viewMode = "overview";
  }

  const settingsLink =
    currentUser.role === "admin"
      ? `<button class="nav-link ${viewMode === "settings" ? "active" : ""}" type="button" data-view="settings">Settings</button>`
      : "";

  const overallStatus = summary?.overallStatus ?? "unknown";
  const viewTitle = getViewTitle(viewMode);
  const lastSync = summary?.generatedAt ? `Synced ${formatDateTime(summary.generatedAt)}` : "Not synced yet";
  const authChip = authMode === "access" ? "Cloudflare Access" : "App Session";

  appRoot.innerHTML = `
    <div class="dash-shell">
      <aside class="panel glass sidebar">
        <div class="brand-mark">RR</div>
        <div class="brand-copy">
          <h1>RazorReaper</h1>
          <p>Telemetry Console</p>
        </div>

        <nav class="sidebar-nav" id="sidebarNav">
          <button class="nav-link ${viewMode === "overview" ? "active" : ""}" type="button" data-view="overview">Overview</button>
          <button class="nav-link ${viewMode === "telemetry" ? "active" : ""}" type="button" data-view="telemetry">Telemetry</button>
          <button class="nav-link ${viewMode === "analytics" ? "active" : ""}" type="button" data-view="analytics">Analytics</button>
          ${settingsLink}
        </nav>

        <div class="sidebar-footer">
          <p class="mini-label">Signed in</p>
          <strong>${escapeHtml(currentUser.email)}</strong>
          <span class="role-pill role-${currentUser.role}">${escapeHtml(currentUser.role)}</span>
        </div>
      </aside>

      <section class="main-shell">
        <header class="panel glass topbar">
          <div>
            <p class="eyebrow">RazorReaper Infrastructure</p>
            <h2>${escapeHtml(viewTitle)}</h2>
          </div>

          <div class="top-meta">
            <span class="status-pill status-${overallStatus}">${overallStatus.toUpperCase()}</span>
            <p class="meta-label">${escapeHtml(lastSync)}</p>
            <p class="meta-label">${escapeHtml(authChip)}</p>
          </div>

          <div class="toolbar">
            <label class="toolbar-field" for="timeframeSelect">
              <span>Timespan</span>
              <select id="timeframeSelect">
                ${renderTimeframeOption("24h", selectedTimeframe)}
                ${renderTimeframeOption("7d", selectedTimeframe)}
                ${renderTimeframeOption("30d", selectedTimeframe)}
                ${renderTimeframeOption("all", selectedTimeframe)}
              </select>
            </label>

            <button id="refreshButton" type="button">Refresh</button>
            <button id="themeButton" type="button">${themeMode === "dark" ? "Light Mode" : "Dark Mode"}</button>
            ${authMode === "app" ? `<button id="logoutButton" class="ghost-button" type="button">Sign Out</button>` : ""}
          </div>
        </header>

        <main id="viewMount" class="view-mount"></main>
      </section>
    </div>
  `;

  const sidebarNav = mustFind("#sidebarNav");
  const timeframeSelect = mustFind<HTMLSelectElement>("#timeframeSelect");
  const refreshButton = mustFind<HTMLButtonElement>("#refreshButton");
  const themeButton = mustFind<HTMLButtonElement>("#themeButton");

  sidebarNav.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
    if (!button) {
      return;
    }

    const requested = button.dataset.view as ViewMode | undefined;
    if (!requested) {
      return;
    }

    if (requested === "settings" && currentUser?.role !== "admin") {
      return;
    }

    if (requested !== viewMode) {
      viewMode = requested;
      mountDashboardShell();
    }
  });

  timeframeSelect.addEventListener("change", () => {
    selectedTimeframe = timeframeSelect.value as Timeframe;
    renderDashboardView();
  });

  refreshButton.addEventListener("click", () => {
    void fetchProtectedData(false);
  });

  themeButton.addEventListener("click", () => {
    themeMode = themeMode === "dark" ? "light" : "dark";
    applyTheme(themeMode);
    mountDashboardShell();
  });

  if (authMode === "app") {
    const logoutButton = mustFind<HTMLButtonElement>("#logoutButton");
    logoutButton.addEventListener("click", () => {
      void handleLogout();
    });
  }

  renderDashboardView();
}
async function handleLogout(): Promise<void> {
  if (authMode !== "app") {
    return;
  }

  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // no-op
  }

  currentUser = null;
  summary = null;
  health = null;
  accessIdentity = null;
  sessionExpiresAt = null;
  viewMode = "overview";
  dashboardErrorMessage = null;
  settingsMessage = null;

  const session = await fetchSessionState();
  requiresBootstrap = !session.hasUsers;
  mountAuthShell();
}

async function fetchProtectedData(silent: boolean): Promise<void> {
  try {
    const response = await fetch("/api/admin/data", { method: "GET" });
    const body = await parseJson<AdminDataPayload>(response);

    if (response.status === 401) {
      await handleSessionExpired();
      return;
    }

    if (!response.ok || !body?.summary || !body?.health || !body?.user) {
      throw new Error(body?.error ?? "Failed to load protected dashboard data.");
    }

    summary = body.summary;
    health = body.health;
    accessIdentity = body.accessIdentity;
    sessionExpiresAt = body.sessionExpiresAt ?? null;
    authMode = body.authMode ?? authMode;
    currentUser = body.user;
    dashboardErrorMessage = null;

    mountDashboardShell();
    ensureRefreshLoop();
  } catch (error) {
    if (!silent) {
      dashboardErrorMessage = error instanceof Error ? error.message : "Unable to load dashboard data.";
      renderDashboardView();
    }
  }
}

async function handleSessionExpired(): Promise<void> {
  stopRefreshLoop();
  currentUser = null;
  summary = null;
  health = null;
  accessIdentity = null;
  sessionExpiresAt = null;
  viewMode = "overview";
  dashboardErrorMessage = null;
  settingsMessage = null;

  const session = await fetchSessionState();
  authMode = session.authMode ?? "access";

  if (authMode === "access") {
    authErrorMessage = null;
    mountAccessLoginHint();
    return;
  }

  authErrorMessage = "Session expired. Please sign in again.";
  requiresBootstrap = !session.hasUsers;
  mountAuthShell();
}

function ensureRefreshLoop(): void {
  if (refreshTimer !== null) {
    return;
  }

  refreshTimer = window.setInterval(() => {
    void fetchProtectedData(true);
  }, REFRESH_MS);
}

function stopRefreshLoop(): void {
  if (refreshTimer === null) {
    return;
  }

  window.clearInterval(refreshTimer);
  refreshTimer = null;
}

function renderDashboardView(): void {
  const viewMount = mustFind("#viewMount");

  if (dashboardErrorMessage) {
    viewMount.innerHTML = `
      <section class="panel glass empty-state">
        <h2>Dashboard Error</h2>
        <p>${escapeHtml(dashboardErrorMessage)}</p>
      </section>
    `;
    return;
  }

  if (!summary || !health) {
    viewMount.innerHTML = `
      <section class="panel glass empty-state">
        <h2>Loading Dashboard</h2>
        <p>Fetching telemetry and runtime status...</p>
      </section>
    `;
    return;
  }

  if (viewMode === "overview") {
    renderOverviewView(viewMount, summary, health);
    return;
  }

  if (viewMode === "telemetry") {
    renderTelemetryView(viewMount, summary);
    return;
  }

  if (viewMode === "analytics") {
    renderAnalyticsView(viewMount, summary);
    return;
  }

  renderSettingsView(viewMount, summary, health);
}

function renderOverviewView(viewMount: HTMLElement, nextSummary: SummaryPayload, nextHealth: HealthPayload): void {
  const scopedEvents = filterEventsByTimeframe(nextSummary.recent, selectedTimeframe);
  const trend = buildTrendSeries(scopedEvents, selectedTimeframe);
  const donutPanels = buildDonutPanels(scopedEvents);

  const cards = nextSummary.latest
    .slice(0, 8)
    .map((entry) => {
      const uptime = calculateUptime(entry, nextSummary.recent);
      return `
        <article class="panel glass service-card">
          <div class="service-head">
            <p>${escapeHtml(entry.service)}</p>
            <span class="status-pill status-${entry.status}">${entry.status.toUpperCase()}</span>
          </div>
          <p class="service-sub">${escapeHtml(entry.source)}</p>
          <p class="service-meta">Last seen: ${formatDateTime(entry.timestamp)}</p>
          <p class="service-meta">24h uptime: ${uptime}</p>
          <p class="service-msg">${escapeHtml(entry.message ?? "No message")}</p>
        </article>
      `;
    })
    .join("");

  const statusCount = {
    ok: scopedEvents.filter((event) => event.status === "ok").length,
    degraded: scopedEvents.filter((event) => event.status === "degraded").length,
    down: scopedEvents.filter((event) => event.status === "down").length
  };

  viewMount.innerHTML = `
    <section class="kpi-grid">
      <article class="panel glass kpi-card">
        <p>Storage Backend</p>
        <h3>${nextSummary.storage.toUpperCase()}</h3>
      </article>
      <article class="panel glass kpi-card">
        <p>Total Events</p>
        <h3>${formatCompact(nextSummary.stats.totalEvents)}</h3>
      </article>
      <article class="panel glass kpi-card">
        <p>Events (${selectedTimeframe})</p>
        <h3>${formatCompact(scopedEvents.length)}</h3>
      </article>
      <article class="panel glass kpi-card">
        <p>Tracked Services</p>
        <h3>${formatCompact(nextSummary.stats.services)}</h3>
      </article>
      <article class="panel glass kpi-card">
        <p>Status OK</p>
        <h3>${formatCompact(statusCount.ok)}</h3>
      </article>
      <article class="panel glass kpi-card">
        <p>Status Degraded</p>
        <h3>${formatCompact(statusCount.degraded)}</h3>
      </article>
      <article class="panel glass kpi-card">
        <p>Status Down</p>
        <h3>${formatCompact(statusCount.down)}</h3>
      </article>
      <article class="panel glass kpi-card">
        <p>Last Ingest</p>
        <h3>${formatDateTime(nextSummary.stats.lastIngestAt)}</h3>
      </article>
    </section>

    <section class="panel glass health-strip">
      <span class="status-pill ${nextHealth.ok ? "status-ok" : "status-down"}">${nextHealth.ok ? "API Alive" : "API Degraded"}</span>
      <p>Build: ${escapeHtml(nextHealth.build.commit.slice(0, 12))} (${escapeHtml(nextHealth.build.branch)})</p>
      <p>Environment: ${escapeHtml(nextHealth.build.environment)}</p>
      <p>Storage Available: ${nextHealth.storage.available ? "Yes" : "No"}</p>
    </section>

    ${renderTrendChart("overviewTrend", "Event Momentum", `Stock-style trend for ${selectedTimeframe}`, trend)}

    <section class="donut-grid">
      ${donutPanels.map((panel) => renderDonutPanel(panel)).join("")}
    </section>

    <section class="service-grid">${cards || `<p class="empty-inline">No telemetry yet. Send first ingest payload.</p>`}</section>
  `;

  bindChartTooltips();
}

function renderTelemetryView(viewMount: HTMLElement, nextSummary: SummaryPayload): void {
  const rows = nextSummary.recent
    .filter((entry) => {
      if (telemetryFilter !== "all" && entry.status !== telemetryFilter) {
        return false;
      }

      if (!telemetrySearch) {
        return true;
      }

      const stack = `${entry.source} ${entry.service} ${entry.message ?? ""} ${JSON.stringify(entry.metrics)}`.toLowerCase();
      return stack.includes(telemetrySearch.toLowerCase());
    })
    .slice(0, 300)
    .map((entry) => {
      const metricsPreview = Object.entries(entry.metrics)
        .slice(0, 5)
        .map(([key, value]) => `<span><b>${escapeHtml(key)}</b>: ${escapeHtml(String(value))}</span>`)
        .join(" ");

      return `
        <tr>
          <td>${formatDateTime(entry.timestamp)}</td>
          <td>${escapeHtml(entry.source)}</td>
          <td>${escapeHtml(entry.service)}</td>
          <td><span class="status-pill status-${entry.status}">${entry.status}</span></td>
          <td>${escapeHtml(entry.message ?? "")}</td>
          <td class="metrics-cell">${metricsPreview || "<span>-</span>"}</td>
        </tr>
      `;
    })
    .join("");

  const safeRows = rows || `<tr><td colspan="6" class="no-rows">No events match this filter.</td></tr>`;

  viewMount.innerHTML = `
    <section class="panel glass telemetry-controls">
      <div class="control-group">
        <label for="searchInput">Search</label>
        <input id="searchInput" type="search" value="${escapeHtml(telemetrySearch)}" placeholder="source, service, message, metric key..." />
      </div>
      <div class="control-group">
        <label for="statusFilter">Status</label>
        <select id="statusFilter">
          ${renderFilterOption("all", "All", telemetryFilter)}
          ${renderFilterOption("ok", "OK", telemetryFilter)}
          ${renderFilterOption("degraded", "Degraded", telemetryFilter)}
          ${renderFilterOption("down", "Down", telemetryFilter)}
        </select>
      </div>
    </section>

    <section class="panel glass table-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Source</th>
            <th>Service</th>
            <th>Status</th>
            <th>Message</th>
            <th>Metrics</th>
          </tr>
        </thead>
        <tbody>${safeRows}</tbody>
      </table>
    </section>
  `;

  const searchInput = mustFind<HTMLInputElement>("#searchInput");
  const statusFilterInput = mustFind<HTMLSelectElement>("#statusFilter");

  searchInput.addEventListener("input", () => {
    telemetrySearch = searchInput.value;
    renderTelemetryView(viewMount, nextSummary);
  });

  statusFilterInput.addEventListener("change", () => {
    telemetryFilter = statusFilterInput.value as TelemetryStatus | "all";
    renderTelemetryView(viewMount, nextSummary);
  });
}

function renderAnalyticsView(viewMount: HTMLElement, nextSummary: SummaryPayload): void {
  const scopedEvents = filterEventsByTimeframe(nextSummary.recent, selectedTimeframe);
  const trend = buildTrendSeries(scopedEvents, selectedTimeframe);
  const windows = buildTimeWindowStats(nextSummary.recent, nextSummary.stats.totalEvents);
  const topSources = buildTopEntries(scopedEvents, (event) => event.source, 6);
  const topServices = buildTopEntries(scopedEvents, (event) => event.service, 6);
  const latency = buildLatencyStats(scopedEvents);

  viewMount.innerHTML = `
    <section class="analytics-grid">
      <article class="panel glass analytics-card">
        <p class="mini-label">Event Window</p>
        <h3>${escapeHtml(selectedTimeframe.toUpperCase())}</h3>
        <p>${formatCompact(scopedEvents.length)} events in selected timespan</p>
      </article>
      <article class="panel glass analytics-card">
        <p class="mini-label">Lifetime</p>
        <h3>${formatCompact(windows.lifetime)}</h3>
        <p>Total events stored in runtime backend</p>
      </article>
      <article class="panel glass analytics-card">
        <p class="mini-label">24h</p>
        <h3>${formatCompact(windows.last24h)}</h3>
        <p>Events received in last 24 hours</p>
      </article>
      <article class="panel glass analytics-card">
        <p class="mini-label">7d</p>
        <h3>${formatCompact(windows.last7d)}</h3>
        <p>Events received in last 7 days</p>
      </article>
      <article class="panel glass analytics-card">
        <p class="mini-label">30d</p>
        <h3>${formatCompact(windows.last30d)}</h3>
        <p>Events received in last 30 days</p>
      </article>
      <article class="panel glass analytics-card">
        <p class="mini-label">Latency Avg</p>
        <h3>${latency.samples > 0 ? `${latency.avg.toFixed(1)} ms` : "N/A"}</h3>
        <p>${latency.samples > 0 ? `p95 ${latency.p95.toFixed(1)} ms | max ${latency.max.toFixed(1)} ms` : "No numeric latency metrics found"}</p>
      </article>
    </section>

    ${renderTrendChart("analyticsTrend", "Traffic Curve", `Interactive timeline for ${selectedTimeframe}`, trend)}

    <section class="analytics-grid">
      <article class="panel glass analytics-card">
        <h3>Top Sources</h3>
        ${renderTopList(topSources)}
      </article>
      <article class="panel glass analytics-card">
        <h3>Top Services</h3>
        ${renderTopList(topServices)}
      </article>
    </section>
  `;

  bindChartTooltips();
}

function renderSettingsView(viewMount: HTMLElement, nextSummary: SummaryPayload, nextHealth: HealthPayload): void {
  if (!currentUser) {
    viewMount.innerHTML = `
      <section class="panel glass empty-state">
        <h2>Not Authenticated</h2>
        <p>Sign in again to access settings.</p>
      </section>
    `;
    return;
  }

  if (currentUser.role !== "admin") {
    viewMount.innerHTML = `
      <section class="panel glass empty-state">
        <h2>Restricted</h2>
        <p>Settings are only available to admin users.</p>
      </section>
    `;
    return;
  }

  const identity = accessIdentity ?? "Cloudflare Access identity unavailable";
  const sessionExpiryText = sessionExpiresAt ? formatDateTime(sessionExpiresAt) : "Unknown";
  const passwordSection =
    authMode === "app"
      ? `
        <form id="passwordForm" class="password-form">
          <label for="oldPassword">Current Password</label>
          <input id="oldPassword" name="oldPassword" type="password" autocomplete="current-password" required minlength="10" maxlength="256" />

          <label for="newPassword">New Password</label>
          <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="256" />

          <label for="confirmPassword">Confirm New Password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="256" />

          <button id="passwordSubmit" type="submit">Update Password</button>
        </form>
      `
      : `<p>Auth mode: <b>Cloudflare Access only</b></p>`;

  viewMount.innerHTML = `
    <section class="settings-grid">
      <article class="panel glass settings-card">
        <h2>Account</h2>
        <p>Signed in as <b>${escapeHtml(currentUser.email)}</b></p>
        <p>Role: <b>${escapeHtml(currentUser.role)}</b></p>
        <p>Session expires: <b>${escapeHtml(sessionExpiryText)}</b></p>
        <p>Theme: <b>${escapeHtml(themeMode)}</b></p>
        ${passwordSection}
        <p class="error-text">${escapeHtml(settingsMessage ?? "")}</p>
      </article>

      <article class="panel glass settings-card">
        <h2>Runtime</h2>
        <p>Storage Backend: <b>${nextSummary.storage.toUpperCase()}</b></p>
        <p>Stored Events: <b>${formatCompact(nextSummary.stats.totalEvents)}</b></p>
        <p>Build Commit: <b>${escapeHtml(nextHealth.build.commit)}</b></p>
        <p>Branch: <b>${escapeHtml(nextHealth.build.branch)}</b></p>
        <p>Environment: <b>${escapeHtml(nextHealth.build.environment)}</b></p>
        <p>Access Identity: <b>${escapeHtml(identity)}</b></p>
      </article>
    </section>
  `;

  if (authMode === "app") {
    const passwordForm = mustFind<HTMLFormElement>("#passwordForm");
    passwordForm.addEventListener("submit", (event) => {
      void handlePasswordChange(event);
    });
  }
}

async function handlePasswordChange(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  const form = event.currentTarget as HTMLFormElement | null;
  if (!form) {
    return;
  }

  const formData = new FormData(form);
  const oldPassword = String(formData.get("oldPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!oldPassword || !newPassword) {
    settingsMessage = "Current and new password are required.";
    renderDashboardView();
    return;
  }

  if (newPassword !== confirmPassword) {
    settingsMessage = "New passwords do not match.";
    renderDashboardView();
    return;
  }

  const submitButton = document.querySelector<HTMLButtonElement>("#passwordSubmit");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Updating...";
  }

  try {
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        oldPassword,
        newPassword
      })
    });

    const body = await parseJson<{ ok: boolean; error?: string }>(response);
    if (!response.ok || !body?.ok) {
      settingsMessage = body?.error ?? "Password update failed.";
      renderDashboardView();
      return;
    }

    settingsMessage = "Password updated successfully.";
    renderDashboardView();
  } catch {
    settingsMessage = "Password update request failed.";
    renderDashboardView();
  }
}

function filterEventsByTimeframe(events: TelemetryEvent[], timeframe: Timeframe): TelemetryEvent[] {
  if (timeframe === "all") {
    return [...events];
  }

  const now = Date.now();
  const cutoff =
    timeframe === "24h" ? now - 24 * 60 * 60 * 1000 : timeframe === "7d" ? now - 7 * 24 * 60 * 60 * 1000 : now - 30 * 24 * 60 * 60 * 1000;

  return events.filter((event) => {
    const ts = Date.parse(event.timestamp);
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function buildTimeWindowStats(events: TelemetryEvent[], lifetimeTotal: number): TimeWindowStats {
  const now = Date.now();
  const dayCutoff = now - 24 * 60 * 60 * 1000;
  const weekCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const monthCutoff = now - 30 * 24 * 60 * 60 * 1000;

  let last24h = 0;
  let last7d = 0;
  let last30d = 0;

  for (const event of events) {
    const ts = Date.parse(event.timestamp);
    if (!Number.isFinite(ts)) {
      continue;
    }

    if (ts >= dayCutoff) {
      last24h += 1;
    }
    if (ts >= weekCutoff) {
      last7d += 1;
    }
    if (ts >= monthCutoff) {
      last30d += 1;
    }
  }

  return {
    last24h,
    last7d,
    last30d,
    lifetime: Math.max(lifetimeTotal, events.length)
  };
}

function buildTopEntries(events: TelemetryEvent[], selector: (event: TelemetryEvent) => string, limit: number): TopEntry[] {
  const counts = new Map<string, number>();

  for (const event of events) {
    const key = selector(event).trim() || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = events.length;
  const sorted = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      share: total > 0 ? (count / total) * 100 : 0
    }));

  if (sorted.length > 0) {
    return sorted;
  }

  return [
    {
      label: "No data",
      count: 0,
      share: 0
    }
  ];
}

function buildLatencyStats(events: TelemetryEvent[]): { samples: number; avg: number; p95: number; max: number } {
  const values: number[] = [];

  for (const event of events) {
    const latency = extractLatencyMetric(event.metrics);
    if (latency !== null) {
      values.push(latency);
    }
  }

  if (values.length === 0) {
    return { samples: 0, avg: 0, p95: 0, max: 0 };
  }

  values.sort((left, right) => left - right);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const index95 = Math.min(values.length - 1, Math.floor(values.length * 0.95));

  return {
    samples: values.length,
    avg: sum / values.length,
    p95: values[index95],
    max: values[values.length - 1]
  };
}

function extractLatencyMetric(metrics: Record<string, unknown>): number | null {
  const keys = [
    "latency",
    "latency_ms",
    "duration",
    "duration_ms",
    "response_time",
    "response_time_ms",
    "elapsed",
    "elapsed_ms",
    "time_ms",
    "ms"
  ];

  for (const key of keys) {
    const raw = metrics[key];
    const parsed = parseNumeric(raw);
    if (parsed !== null) {
      return parsed;
    }
  }

  for (const value of Object.values(metrics)) {
    const parsed = parseNumeric(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function renderTopList(entries: TopEntry[]): string {
  return `
    <div class="top-list">
      ${entries
        .map(
          (entry) => `
            <div class="top-list-item">
              <span>${escapeHtml(entry.label)}</span>
              <strong>${formatCompact(entry.count)} <small>${entry.share.toFixed(1)}%</small></strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function buildDonutPanels(events: TelemetryEvent[]): DonutPanel[] {
  const statusPanel: DonutPanel = {
    title: "Status Split",
    subtitle: "Recent event health distribution",
    totalLabel: "events",
    slices: [
      { label: "OK", value: events.filter((event) => event.status === "ok").length, color: "#67e8b5" },
      { label: "Degraded", value: events.filter((event) => event.status === "degraded").length, color: "#ffd166" },
      { label: "Down", value: events.filter((event) => event.status === "down").length, color: "#ff7aa2" }
    ]
  };

  const sourcePanel: DonutPanel = {
    title: "Source Share",
    subtitle: "Top telemetry sources",
    totalLabel: "events",
    slices: collapseTopEntries(buildCountMap(events, (event) => event.source), 4).map((entry, index) => ({
      label: entry.label,
      value: entry.value,
      color: DONUT_COLORS[index % DONUT_COLORS.length]
    }))
  };

  const servicePanel: DonutPanel = {
    title: "Service Share",
    subtitle: "Top tracked services",
    totalLabel: "events",
    slices: collapseTopEntries(buildCountMap(events, (event) => event.service), 4).map((entry, index) => ({
      label: entry.label,
      value: entry.value,
      color: DONUT_COLORS[index % DONUT_COLORS.length]
    }))
  };

  return [statusPanel, sourcePanel, servicePanel];
}

function buildCountMap(events: TelemetryEvent[], keySelector: (event: TelemetryEvent) => string): Map<string, number> {
  const map = new Map<string, number>();

  for (const event of events) {
    const key = keySelector(event) || "unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return map;
}

function collapseTopEntries(map: Map<string, number>, topN: number): Array<{ label: string; value: number }> {
  const sorted = [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);

  const top = sorted.slice(0, topN);
  const restValue = sorted.slice(topN).reduce((sum, entry) => sum + entry.value, 0);

  if (restValue > 0) {
    top.push({ label: "Other", value: restValue });
  }

  if (top.length === 0) {
    top.push({ label: "No data", value: 1 });
  }

  return top;
}

function renderDonutPanel(panel: DonutPanel): string {
  const total = panel.slices.reduce((sum, slice) => sum + slice.value, 0);
  const gradient = buildConicGradient(panel.slices, total);

  const rows = panel.slices
    .map((slice) => {
      const share = total > 0 ? (slice.value / total) * 100 : 0;
      return `
        <div class="donut-row-item">
          <div class="donut-row-label">
            <span class="donut-dot" style="background:${slice.color};"></span>
            <span>${escapeHtml(slice.label)}</span>
          </div>
          <strong>${share.toFixed(1)}%</strong>
        </div>
      `;
    })
    .join("");

  return `
    <article class="panel glass donut-card">
      <div class="donut-head">
        <h3>${escapeHtml(panel.title)}</h3>
        <p>${escapeHtml(panel.subtitle)}</p>
      </div>
      <div class="donut-content">
        <div class="donut-ring" style="--donut:${gradient};">
          <div class="donut-hole">
            <strong>${formatCompact(total)}</strong>
            <span>${escapeHtml(panel.totalLabel)}</span>
          </div>
        </div>
        <div class="donut-rows">${rows}</div>
      </div>
    </article>
  `;
}

function buildConicGradient(slices: DonutSlice[], total: number): string {
  if (!Number.isFinite(total) || total <= 0) {
    return "conic-gradient(#2e1d48 0% 100%)";
  }

  let cursor = 0;
  const segments: string[] = [];

  for (const slice of slices) {
    const percentage = (slice.value / total) * 100;
    if (!Number.isFinite(percentage) || percentage <= 0) {
      continue;
    }

    const nextCursor = Math.min(100, cursor + percentage);
    segments.push(`${slice.color} ${cursor.toFixed(3)}% ${nextCursor.toFixed(3)}%`);
    cursor = nextCursor;
  }

  if (segments.length === 0) {
    return "conic-gradient(#2e1d48 0% 100%)";
  }

  return `conic-gradient(${segments.join(", ")})`;
}

function buildTrendSeries(events: TelemetryEvent[], timeframe: Timeframe): TrendPoint[] {
  const now = Date.now();
  const sortedTimestamps = events
    .map((event) => Date.parse(event.timestamp))
    .filter((ts) => Number.isFinite(ts))
    .sort((left, right) => left - right);

  let bucketCount = 24;
  let bucketSizeMs = 60 * 60 * 1000;
  let start = now - (bucketCount - 1) * bucketSizeMs;

  if (timeframe === "7d") {
    bucketCount = 14;
    bucketSizeMs = 12 * 60 * 60 * 1000;
    start = now - (bucketCount - 1) * bucketSizeMs;
  } else if (timeframe === "30d") {
    bucketCount = 30;
    bucketSizeMs = 24 * 60 * 60 * 1000;
    start = now - (bucketCount - 1) * bucketSizeMs;
  } else if (timeframe === "all") {
    bucketCount = 24;
    const oldest = sortedTimestamps.length > 0 ? sortedTimestamps[0] : now - 14 * 24 * 60 * 60 * 1000;
    const span = Math.max(now - oldest, 24 * 60 * 60 * 1000);
    bucketSizeMs = Math.max(Math.ceil(span / (bucketCount - 1)), 60 * 60 * 1000);
    start = now - (bucketCount - 1) * bucketSizeMs;
  }

  const buckets: TrendPoint[] = Array.from({ length: bucketCount }, (_, index) => {
    const ts = start + index * bucketSizeMs;
    return {
      label: formatTrendLabel(ts, timeframe),
      total: 0,
      incidents: 0,
      timestamp: ts
    };
  });

  for (const event of events) {
    const ts = Date.parse(event.timestamp);
    if (!Number.isFinite(ts) || ts < start) {
      continue;
    }

    const ratio = (ts - start) / bucketSizeMs;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(ratio)));
    buckets[index].total += 1;
    if (event.status !== "ok") {
      buckets[index].incidents += 1;
    }
  }

  return buckets;
}

function formatTrendLabel(timestamp: number, timeframe: Timeframe): string {
  const date = new Date(timestamp);

  if (timeframe === "24h") {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (timeframe === "7d") {
    return date.toLocaleString([], {
      weekday: "short",
      hour: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function renderTrendChart(id: string, title: string, subtitle: string, trend: TrendPoint[]): string {
  const width = 960;
  const height = 270;
  const padding = {
    top: 16,
    right: 20,
    bottom: 34,
    left: 20
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...trend.map((point) => point.total));

  const mapped = trend.map((point, index) => {
    const x = padding.left + (trend.length > 1 ? (index / (trend.length - 1)) * plotWidth : 0);
    const totalY = padding.top + (1 - point.total / maxValue) * plotHeight;
    const incidentY = padding.top + (1 - point.incidents / maxValue) * plotHeight;

    return {
      ...point,
      x,
      totalY,
      incidentY
    };
  });

  const totalLine = buildLinePath(
    mapped.map((point) => ({
      x: point.x,
      y: point.totalY
    }))
  );
  const incidentLine = buildLinePath(
    mapped.map((point) => ({
      x: point.x,
      y: point.incidentY
    }))
  );
  const totalArea = buildAreaPath(
    mapped.map((point) => ({
      x: point.x,
      y: point.totalY
    })),
    padding.top + plotHeight
  );

  const pointNodes = mapped
    .map(
      (point) => `
        <circle
          class="trend-point ${point.incidents > 0 ? "trend-point-incident" : ""}"
          data-label="${escapeHtml(point.label)}"
          data-total="${point.total}"
          data-incidents="${point.incidents}"
          cx="${point.x.toFixed(2)}"
          cy="${point.totalY.toFixed(2)}"
          r="4"
          tabindex="0"
        ></circle>
      `
    )
    .join("");

  const xTicks = mapped
    .filter((_, index) => index % Math.ceil(mapped.length / 6) === 0 || index === mapped.length - 1)
    .map(
      (point) => `
        <span style="left:${((point.x - padding.left) / plotWidth) * 100}%">${escapeHtml(point.label)}</span>
      `
    )
    .join("");

  return `
    <section class="panel glass trend-card" data-trend-card="${escapeHtml(id)}">
      <div class="trend-head">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="trend-body">
        <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="${escapeHtml(title)}">
          <defs>
            <linearGradient id="${id}-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="rgba(76, 222, 128, 0.45)"></stop>
              <stop offset="100%" stop-color="rgba(76, 222, 128, 0.03)"></stop>
            </linearGradient>
          </defs>

          <line class="trend-grid-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          <line class="trend-grid-line" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="trend-grid-line" x1="${padding.left}" y1="${padding.top + plotHeight * 0.5}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight * 0.5}"></line>

          <path class="trend-area" d="${totalArea}" fill="url(#${id}-area)"></path>
          <path class="trend-line" d="${totalLine}"></path>
          <path class="trend-line trend-line-incidents" d="${incidentLine}"></path>
          ${pointNodes}
        </svg>

        <div class="trend-axis">${xTicks}</div>
      </div>
      <div class="trend-legend">
        <span><i class="legend-dot legend-total"></i> Total events</span>
        <span><i class="legend-dot legend-incidents"></i> Incidents</span>
      </div>
      <div class="trend-tooltip" aria-hidden="true"></div>
    </section>
  `;
}

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }

  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function buildAreaPath(points: Array<{ x: number; y: number }>, baseline: number): string {
  if (points.length === 0) {
    return "";
  }

  const head = buildLinePath(points);
  const tail = `L${points[points.length - 1].x.toFixed(2)} ${baseline.toFixed(2)} L${points[0].x.toFixed(2)} ${baseline.toFixed(2)} Z`;
  return `${head} ${tail}`;
}

function bindChartTooltips(): void {
  const cards = document.querySelectorAll<HTMLElement>("[data-trend-card]");

  for (const card of cards) {
    const tooltip = card.querySelector<HTMLElement>(".trend-tooltip");
    const points = card.querySelectorAll<SVGCircleElement>(".trend-point");
    if (!tooltip || points.length === 0) {
      continue;
    }

    const hide = () => {
      tooltip.classList.remove("visible");
      tooltip.setAttribute("aria-hidden", "true");
    };

    const show = (point: SVGCircleElement, event?: MouseEvent) => {
      const label = point.dataset.label ?? "";
      const total = point.dataset.total ?? "0";
      const incidents = point.dataset.incidents ?? "0";

      tooltip.innerHTML = `
        <strong>${escapeHtml(label)}</strong>
        <span>Total: ${escapeHtml(total)}</span>
        <span>Incidents: ${escapeHtml(incidents)}</span>
      `;
      tooltip.classList.add("visible");
      tooltip.setAttribute("aria-hidden", "false");

      const cardRect = card.getBoundingClientRect();
      const pointRect = point.getBoundingClientRect();
      const anchorX = event ? event.clientX : pointRect.left + pointRect.width / 2;
      const anchorY = event ? event.clientY : pointRect.top;
      const left = Math.min(Math.max(24, anchorX - cardRect.left), cardRect.width - 24);
      const top = Math.max(14, anchorY - cardRect.top - 20);

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    for (const point of points) {
      point.addEventListener("mouseenter", (event) => {
        show(point, event);
      });
      point.addEventListener("mousemove", (event) => {
        show(point, event);
      });
      point.addEventListener("mouseleave", hide);
      point.addEventListener("focus", () => {
        show(point);
      });
      point.addEventListener("blur", hide);
    }

    card.addEventListener("mouseleave", hide);
  }
}

function calculateUptime(entry: TelemetryEvent, recent: TelemetryEvent[]): string {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const relevant = recent.filter((item) => item.source === entry.source && item.service === entry.service && Date.parse(item.timestamp) >= dayAgo);

  if (relevant.length === 0) {
    return "N/A";
  }

  const okCount = relevant.filter((item) => item.status === "ok").length;
  return `${Math.round((okCount / relevant.length) * 100)}%`;
}

function getViewTitle(nextView: ViewMode): string {
  if (nextView === "overview") {
    return "System Overview";
  }
  if (nextView === "telemetry") {
    return "Telemetry Events";
  }
  if (nextView === "analytics") {
    return "Analytics";
  }
  return "Settings";
}

function renderFilterOption(value: string, label: string, current: string): string {
  const selected = value === current ? "selected" : "";
  return `<option value="${value}" ${selected}>${label}</option>`;
}

function renderTimeframeOption(value: Timeframe, current: Timeframe): string {
  const selected = value === current ? "selected" : "";
  const label = value === "all" ? "Lifetime" : value.toUpperCase();
  return `<option value="${value}" ${selected}>${label}</option>`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (Math.abs(value) < 1000) {
    return Math.round(value).toString();
  }

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function loadThemePreference(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(nextMode: ThemeMode): void {
  document.documentElement.dataset.theme = nextMode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
  } catch {
    // no-op
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mustFind<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing required node: ${selector}`);
  }
  return node;
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.text();
  if (!payload) {
    return {} as T;
  }

  try {
    return JSON.parse(payload) as T;
  } catch {
    return {} as T;
  }
}
