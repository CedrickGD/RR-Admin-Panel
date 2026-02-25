import "./styles.css";

type TelemetryStatus = "ok" | "degraded" | "down";
type OverallStatus = TelemetryStatus | "unknown";
type ViewMode = "status" | "telemetry" | "settings";

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

interface AdminDataPayload {
  summary: SummaryPayload;
  health: HealthPayload;
  accessIdentity: string | null;
}

const REFRESH_MS = 30_000;

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App container not found.");
}

appRoot.innerHTML = `
  <div class="app-shell">
    <header class="glass panel topbar">
      <div>
        <p class="eyebrow">RazorReaper Infrastructure</p>
        <h1>RR Hosting Status</h1>
      </div>
      <div class="top-meta">
        <span id="overallBadge" class="status-pill status-unknown">Unknown</span>
        <p id="lastRefresh" class="meta-label">Not synced yet</p>
      </div>
    </header>

    <nav class="glass panel tabs" id="tabs">
      <button class="tab active" type="button" data-view="status">Hosting Status</button>
      <button class="tab" type="button" data-view="telemetry">Telemetry</button>
      <button class="tab" type="button" data-view="settings">Settings</button>
    </nav>

    <main id="viewMount"></main>
  </div>
`;

const viewMount = mustFind("#viewMount");
const tabs = mustFind("#tabs");
const overallBadge = mustFind("#overallBadge");
const lastRefreshLabel = mustFind("#lastRefresh");

let viewMode: ViewMode = "status";
let summary: SummaryPayload | null = null;
let health: HealthPayload | null = null;
let accessIdentity: string | null = null;
let telemetrySearch = "";
let telemetryFilter: TelemetryStatus | "all" = "all";
let refreshTimer: number | null = null;

tabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]");
  if (!button) {
    return;
  }

  const nextView = button.dataset.view as ViewMode;
  if (!nextView || nextView === viewMode) {
    return;
  }

  viewMode = nextView;
  updateTabState();
  renderView();
});

void bootstrap();

async function bootstrap(): Promise<void> {
  updateTabState();
  renderView();
  await fetchProtectedData(false);
}

async function fetchProtectedData(silent: boolean): Promise<void> {
  try {
    const response = await fetch("/api/admin/data", { method: "GET" });

    const body = await parseJson<AdminDataPayload & { error?: string }>(response);
    if (!response.ok || !body?.summary || !body?.health) {
      throw new Error(body?.error ?? "Failed to load protected dashboard data.");
    }

    summary = body.summary;
    health = body.health;
    accessIdentity = body.accessIdentity;
    setOverallBadge(summary.overallStatus);
    lastRefreshLabel.textContent = `Last synced ${formatDateTime(summary.generatedAt)}`;
    renderView();
    ensureRefreshLoop();
  } catch (error) {
    if (!silent) {
      lastRefreshLabel.textContent = error instanceof Error ? error.message : "Unable to fetch dashboard data.";
    }
  }
}

function ensureRefreshLoop(): void {
  if (refreshTimer !== null) {
    return;
  }

  refreshTimer = window.setInterval(() => {
    void fetchProtectedData(true);
  }, REFRESH_MS);
}

function renderView(): void {
  if (!summary || !health) {
    viewMount.innerHTML = `
      <section class="glass panel empty-state">
        <h2>Dashboard Locked</h2>
        <p>Cloudflare Access authentication is required to load protected status and telemetry data.</p>
      </section>
    `;
    return;
  }

  if (viewMode === "status") {
    renderStatusView(summary, health);
    return;
  }

  if (viewMode === "telemetry") {
    renderTelemetryView(summary);
    return;
  }

  renderSettingsView(summary, health);
}

function renderStatusView(nextSummary: SummaryPayload, nextHealth: HealthPayload): void {
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

    <section class="status-grid">${safeCards}</section>
  `;
}

function renderTelemetryView(nextSummary: SummaryPayload): void {
  const filters = `
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
  `;

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
    .slice(0, 200)
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
    ${filters}
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
    renderTelemetryView(nextSummary);
  });

  statusFilterInput.addEventListener("change", () => {
    telemetryFilter = statusFilterInput.value as TelemetryStatus | "all";
    renderTelemetryView(nextSummary);
  });
}

function renderSettingsView(nextSummary: SummaryPayload, nextHealth: HealthPayload): void {
  const identity = accessIdentity ?? "No identity header detected";
  viewMount.innerHTML = `
    <section class="settings-grid">
      <article class="glass panel settings-card">
        <h2>Access</h2>
        <p>Cloudflare Access Identity: <b>${escapeHtml(identity)}</b></p>
        <p>Admin session layer: <b>Disabled (Access-only mode)</b></p>
      </article>

      <article class="glass panel settings-card">
        <h2>Runtime</h2>
        <p>Storage Backend: <b>${nextSummary.storage.toUpperCase()}</b></p>
        <p>Stored Events: <b>${nextSummary.stats.totalEvents}</b></p>
        <p>Build Commit: <b>${escapeHtml(nextHealth.build.commit)}</b></p>
        <p>Branch: <b>${escapeHtml(nextHealth.build.branch)}</b></p>
      </article>
    </section>
  `;
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

function setOverallBadge(status: OverallStatus): void {
  overallBadge.className = `status-pill status-${status}`;
  overallBadge.textContent = status.toUpperCase();
}

function updateTabState(): void {
  const buttons = tabs.querySelectorAll<HTMLButtonElement>(".tab");
  for (const button of buttons) {
    button.classList.toggle("active", button.dataset.view === viewMode);
  }
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
