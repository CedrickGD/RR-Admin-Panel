// Fake telemetry for the console UI kit — plausible, ~220-user scale.
// (Compiled into the bundle; screens import from here.)

export const NAV_GROUPS = [
  {
    label: "Monitor",
    items: [
      { key: "overview", label: "Overview", icon: "chart-no-axes-column" },
      { key: "traffic", label: "Traffic", icon: "clock-3" },
      { key: "versions", label: "Versions", icon: "layers" },
      { key: "heatmap", label: "Heatmap", icon: "map" },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "live", label: "Live", icon: "radio" },
      { key: "sessions", label: "Sessions", icon: "history" },
      { key: "errors", label: "Errors", icon: "triangle-alert" },
      { key: "settings", label: "Settings", icon: "settings-2" },
    ],
  },
];

export const HOURS = Array.from({ length: 24 }, (_, i) => {
  const wave = 4 + 5 * Math.sin((i - 4) / 3.2);
  const users = Math.max(0, Math.round(wave + (i % 5 === 0 ? 2 : 0)));
  return {
    label: `${String(i).padStart(2, "0")}:00`,
    users,
    started: i % 3 === 0 ? Math.max(1, Math.round(users / 3)) : i % 2,
    errors: i === 9 ? 2 : i === 17 ? 1 : 0,
  };
});

export const LIVE_SESSIONS = [
  { id: "s_9f2e81c4", user: "wraith", discord: "wraith#2041", rpc: true, location: "Berlin, BE, Germany", version: "1.6.2", platform: "Windows 11", duration: "42m 18s", lastEvent: "Dino scan", presence: "online", started: "2026-06-10 13:02", timezone: "Europe/Berlin", ip: "84.•••.•••.12", events: 214, errors: 0 },
  { id: "s_77ab03d9", user: "kestrel", discord: "kestrel", rpc: true, location: "Austin, TX, United States", version: "1.6.2", platform: "Windows 11", duration: "1h 12m", lastEvent: "Map overlay", presence: "online", started: "2026-06-10 12:31", timezone: "America/Chicago", ip: "97.•••.•••.88", events: 451, errors: 1 },
  { id: "s_c41d22f0", user: "9A4F-D201", discord: "", rpc: false, location: "São Paulo, SP, Brazil", version: "1.5.3", platform: "Windows 10", duration: "open", lastEvent: "Session start", presence: "idle", started: "2026-06-10 13:39", timezone: "America/Sao_Paulo", ip: "186.•••.•••.4", events: 12, errors: 0 },
];

export const RECENT_ERRORS = [
  { id: "e1", title: "NullReferenceException", meta: "overlay_renderer · Object reference not set to an instance", time: "2m", tone: "bad" },
  { id: "e2", title: "TimeoutException", meta: "ark_rcon_client · Handshake exceeded 5000ms", time: "41m", tone: "bad" },
  { id: "e3", title: "JsonReaderException", meta: "config_loader · Unexpected token at line 14", time: "3h", tone: "bad" },
];

export const ACTIVITY = [
  { id: "a1", title: "Session started", meta: "wraith#2041 · 1.6.2 · Germany", time: "9m", tone: "ok" },
  { id: "a2", title: "NullReferenceException", meta: "overlay_renderer · kestrel", time: "2m", tone: "bad" },
  { id: "a3", title: "Version 1.6.2 released", meta: "44% adoption in 48h", time: "2d", tone: "accent" },
  { id: "a4", title: "Session ended", meta: "9A4F-77F0 · 28m 02s", time: "16m", tone: "neutral" },
];

export const VERSIONS = [
  { label: "1.6.2", users: 144, share: 1 },
  { label: "1.6.1", users: 38, share: 0.26 },
  { label: "1.6.0", users: 14, share: 0.1 },
  { label: "1.5.3", users: 21, share: 0.15 },
  { label: "Legacy (pre-1.4)", users: 12, share: 0.08 },
];

export const COUNTRIES = [
  { label: "Germany", users: 64, share: 1 },
  { label: "United States", users: 51, share: 0.8 },
  { label: "Brazil", users: 27, share: 0.42 },
  { label: "Poland", users: 19, share: 0.3 },
  { label: "Australia", users: 14, share: 0.22 },
];

export const ACCENT_PRESETS = [
  { label: "Pink", hue: 335 }, { label: "Purple", hue: 262 }, { label: "Blue", hue: 221 },
  { label: "Cyan", hue: 186 }, { label: "Teal", hue: 160 }, { label: "Green", hue: 142 },
  { label: "Orange", hue: 25 }, { label: "Red", hue: 4 }, { label: "Indigo", hue: 240 }, { label: "Gold", hue: 45 },
];

export const SESSION_SPARK = [4, 7, 5, 9, 8, 12, 10, 14, 11, 16, 13, 18];
export const ERROR_SPARK = [0, 1, 0, 0, 2, 1, 0, 3, 1, 0, 1, 0];
