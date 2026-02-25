import "./styles.css";

type TelemetryStatus = "ok" | "degraded" | "down";
type OverallStatus = TelemetryStatus | "unknown";
type ViewMode = "status" | "telemetry" | "settings";
type AppUserRole = "admin" | "viewer";

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

const REFRESH_MS = 30_000;
const DONUT_COLORS = ["#6d61ff", "#4fd0ff", "#ffd166", "#ff7aa2", "#67e8b5", "#ff9f43", "#c084fc"];

const appRoot = mustFind<HTMLDivElement>("#app");

let currentUser: AuthUser | null = null;
let requiresBootstrap = false;
let authErrorMessage: string | null = null;
let authBusy = false;

let viewMode: ViewMode = "status";
let summary: SummaryPayload | null = null;
let health: HealthPayload | null = null;
let accessIdentity: string | null = null;
let sessionExpiresAt: string | null = null;
let dashboardErrorMessage: string | null = null;
let settingsMessage: string | null = null;

let telemetrySearch = "";
let telemetryFilter: TelemetryStatus | "all" = "all";
let refreshTimer: number | null = null;

void bootstrap();

async function bootstrap(): Promise<void> {
  const session = await fetchSessionState();

  if (session.authenticated && session.user) {
    currentUser = session.user;
    authErrorMessage = null;
    mountDashboardShell();
    await fetchProtectedData(false);
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
        hasUsers: true
      };
    }

    return body;
  } catch {
    return {
      ok: false,
      authenticated: false,
      hasUsers: true
    };
  }
}

function mountAuthShell(): void {
  stopRefreshLoop();

  const modeTitle = requiresBootstrap ? "Create Admin Account" : "Sign In";
  const modeCopy = requiresBootstrap
    ? "First launch detected. Create the initial admin user with your own email and password."
    : "Sign in with your dashboard account credentials.";
  const actionLabel = requiresBootstrap ? "Create Account" : "Sign In";

  appRoot.innerHTML = `
    <section class="auth-shell">
      <article class="glass panel auth-card">
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
    viewMode = "status";
    summary = null;
    health = null;
    accessIdentity = null;
    sessionExpiresAt = body.expiresAt ?? null;
    telemetrySearch = "";
    telemetryFilter = "all";

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
    viewMode = "status";
  }

  const settingsTab = currentUser.role === "admin" ? `<button class="tab" type="button" data-view="settings">Settings</button>` : "";
  const overallStatus = summary?.overallStatus ?? "unknown";
  const lastSync = summary?.generatedAt ? `Last synced ${formatDateTime(summary.generatedAt)}` : "Not synced yet";

  appRoot.innerHTML = `
    <div class="app-shell">
      <header class="glass panel topbar">
        <div>
          <p class="eyebrow">RazorReaper Infrastructure</p>
          <h1>RR Hosting Status</h1>
        </div>
        <div class="top-meta">
          <span id="overallBadge" class="status-pill status-${overallStatus}">${overallStatus.toUpperCase()}</span>
          <p id="lastRefresh" class="meta-label">${escapeHtml(lastSync)}</p>
          <p class="meta-label user-meta">${escapeHtml(currentUser.email)} (${escapeHtml(currentUser.role)})</p>
          <button id="logoutButton" class="ghost-button" type="button">Sign Out</button>
        </div>
      </header>

      <nav class="glass panel tabs" id="tabs">
        <button class="tab ${viewMode === "status" ? "active" : ""}" type="button" data-view="status">Hosting Status</button>
        <button class="tab ${viewMode === "telemetry" ? "active" : ""}" type="button" data-view="telemetry">Telemetry</button>
        ${settingsTab}
      </nav>

      <main id="viewMount"></main>
    </div>
  `;

  const tabs = mustFind("#tabs");
  const logoutButton = mustFind<HTMLButtonElement>("#logoutButton");

  tabs.addEventListener("click", (event) => {
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

  logoutButton.addEventListener("click", () => {
    void handleLogout();
  });

  renderDashboardView();
}

async function handleLogout(): Promise<void> {
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
  viewMode = "status";
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
  viewMode = "status";
  dashboardErrorMessage = null;
  settingsMessage = null;
  authErrorMessage = "Session expired. Please sign in again.";

  const session = await fetchSessionState();
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
      <section class="glass panel empty-state">
        <h2>Dashboard Error</h2>
        <p>${escapeHtml(dashboardErrorMessage)}</p>
      </section>
    `;
    return;
  }

  if (!summary || !health) {
    viewMount.innerHTML = `
      <section class="glass panel empty-state">
        <h2>Loading Dashboard</h2>
        <p>Fetching telemetry and runtime status...</p>
      </section>
    `;
    return;
  }

  if (viewMode === "status") {
    renderStatusView(viewMount, summary, health);
    return;
  }

  if (viewMode === "telemetry") {
    renderTelemetryView(viewMount, summary);
    return;
  }

  renderSettingsView(viewMount, summary, health);
}

function renderStatusView(viewMount: HTMLElement, nextSummary: SummaryPayload, nextHealth: HealthPayload): void {
  const cards = nextSummary.latest
    .map((entry) => {
      const uptime = calculateUptime(entry, nextSummary.recent);
      return `
        <article class="glass tile">
          <div class="tile-head">
            <p>${escapeHtml(entry.service)}</p>
            <span class="status-pill status-${entry.status}">${entry.status.toUpperCase()}</span>
          </div>
          <p class="tile-sub">${escapeHtml(entry.source)}</p>
          <p class="tile-meta">Last seen: ${formatDateTime(entry.timestamp)}</p>
          <p class="tile-meta">24h uptime: ${uptime}</p>
          <p class="tile-message">${escapeHtml(entry.message ?? "No message")}</p>
        </article>
      `;
    })
    .join("");

  const safeCards = cards || `<p class="empty-inline">No telemetry yet. Send first ingest payload.</p>`;
  const donutPanels = buildDonutPanels(nextSummary);

  viewMount.innerHTML = `
    <section class="kpi-grid">
      <article class="glass panel kpi">
        <p>Storage Backend</p>
        <h3>${nextSummary.storage.toUpperCase()}</h3>
      </article>
      <article class="glass panel kpi">
        <p>Total Events</p>
        <h3>${nextSummary.stats.totalEvents}</h3>
      </article>
      <article class="glass panel kpi">
        <p>Tracked Services</p>
        <h3>${nextSummary.stats.services}</h3>
      </article>
      <article class="glass panel kpi">
        <p>Last Ingest</p>
        <h3>${formatDateTime(nextSummary.stats.lastIngestAt)}</h3>
      </article>
    </section>

    <section class="glass panel health-strip">
      <span class="status-pill ${nextHealth.ok ? "status-ok" : "status-down"}">${nextHealth.ok ? "API Alive" : "API Degraded"}</span>
      <p>Build: ${escapeHtml(nextHealth.build.commit.slice(0, 12))} (${escapeHtml(nextHealth.build.branch)})</p>
      <p>Environment: ${escapeHtml(nextHealth.build.environment)}</p>
      <p>Storage Available: ${nextHealth.storage.available ? "Yes" : "No"}</p>
    </section>

    <section class="donut-grid">
      ${donutPanels.map((panel) => renderDonutPanel(panel)).join("")}
    </section>

    <section class="status-grid">${safeCards}</section>
  `;
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
        .slice(0, 4)
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
    <section class="glass panel telemetry-controls">
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

    <section class="glass panel table-wrap">
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

function renderSettingsView(viewMount: HTMLElement, nextSummary: SummaryPayload, nextHealth: HealthPayload): void {
  if (!currentUser) {
    viewMount.innerHTML = `
      <section class="glass panel empty-state">
        <h2>Not Authenticated</h2>
        <p>Sign in again to access settings.</p>
      </section>
    `;
    return;
  }

  if (currentUser.role !== "admin") {
    viewMount.innerHTML = `
      <section class="glass panel empty-state">
        <h2>Restricted</h2>
        <p>Settings are only available to admin users.</p>
      </section>
    `;
    return;
  }

  const identity = accessIdentity ?? "Cloudflare Access identity unavailable";
  const sessionExpiryText = sessionExpiresAt ? formatDateTime(sessionExpiresAt) : "Unknown";

  viewMount.innerHTML = `
    <section class="settings-grid">
      <article class="glass panel settings-card">
        <h2>Account</h2>
        <p>Signed in as <b>${escapeHtml(currentUser.email)}</b></p>
        <p>Role: <b>${escapeHtml(currentUser.role)}</b></p>
        <p>Session expires: <b>${escapeHtml(sessionExpiryText)}</b></p>

        <form id="passwordForm" class="password-form">
          <label for="oldPassword">Current password</label>
          <input id="oldPassword" name="oldPassword" type="password" autocomplete="current-password" required minlength="10" maxlength="256" />

          <label for="newPassword">New password</label>
          <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="256" />

          <label for="confirmPassword">Confirm new password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="256" />

          <button id="passwordSubmit" type="submit">Update Password</button>
        </form>

        <p class="error-text">${escapeHtml(settingsMessage ?? "")}</p>
      </article>

      <article class="glass panel settings-card">
        <h2>Runtime</h2>
        <p>Storage Backend: <b>${nextSummary.storage.toUpperCase()}</b></p>
        <p>Stored Events: <b>${nextSummary.stats.totalEvents}</b></p>
        <p>Build Commit: <b>${escapeHtml(nextHealth.build.commit)}</b></p>
        <p>Branch: <b>${escapeHtml(nextHealth.build.branch)}</b></p>
        <p>Cloudflare Access Identity: <b>${escapeHtml(identity)}</b></p>
      </article>
    </section>
  `;

  const passwordForm = mustFind<HTMLFormElement>("#passwordForm");
  passwordForm.addEventListener("submit", (event) => {
    void handlePasswordChange(event);
  });
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

function buildDonutPanels(nextSummary: SummaryPayload): DonutPanel[] {
  const recent = nextSummary.recent;

  const statusCounts = new Map<string, number>();
  statusCounts.set("OK", recent.filter((event) => event.status === "ok").length);
  statusCounts.set("Degraded", recent.filter((event) => event.status === "degraded").length);
  statusCounts.set("Down", recent.filter((event) => event.status === "down").length);

  const statusPanel: DonutPanel = {
    title: "Status Split",
    subtitle: "Recent event health distribution",
    totalLabel: "events",
    slices: [
      { label: "OK", value: statusCounts.get("OK") ?? 0, color: "#67e8b5" },
      { label: "Degraded", value: statusCounts.get("Degraded") ?? 0, color: "#ffd166" },
      { label: "Down", value: statusCounts.get("Down") ?? 0, color: "#ff7aa2" }
    ]
  };

  const sourcePanel: DonutPanel = {
    title: "Source Share",
    subtitle: "Top telemetry sources",
    totalLabel: "events",
    slices: collapseTopEntries(buildCountMap(recent, (event) => event.source), 4).map((entry, index) => ({
      label: entry.label,
      value: entry.value,
      color: DONUT_COLORS[index % DONUT_COLORS.length]
    }))
  };

  const servicePanel: DonutPanel = {
    title: "Service Share",
    subtitle: "Top tracked services",
    totalLabel: "events",
    slices: collapseTopEntries(buildCountMap(recent, (event) => event.service), 4).map((entry, index) => ({
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
    <article class="glass panel donut-card">
      <div class="donut-head">
        <h3>${escapeHtml(panel.title)}</h3>
        <p>${escapeHtml(panel.subtitle)}</p>
      </div>
      <div class="donut-content">
        <div class="donut-ring" style="--donut:${gradient};">
          <div class="donut-hole">
            <strong>${total}</strong>
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

function calculateUptime(entry: TelemetryEvent, recent: TelemetryEvent[]): string {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const relevant = recent.filter((item) => item.source === entry.source && item.service === entry.service && Date.parse(item.timestamp) >= dayAgo);

  if (relevant.length === 0) {
    return "N/A";
  }

  const okCount = relevant.filter((item) => item.status === "ok").length;
  return `${Math.round((okCount / relevant.length) * 100)}%`;
}

function renderFilterOption(value: string, label: string, current: string): string {
  const selected = value === current ? "selected" : "";
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
