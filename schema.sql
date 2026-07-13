PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  service TEXT NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
  metrics_json TEXT NOT NULL DEFAULT '{}',
  message TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON telemetry_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_source_service ON telemetry_events(source, service, ts DESC);

CREATE TABLE IF NOT EXISTS app_sessions (
  session_id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  hwid TEXT,
  source TEXT NOT NULL,
  user_label TEXT,
  client_ip TEXT,
  client_country TEXT,
  client_city TEXT,
  client_region TEXT,
  client_latitude REAL,
  client_longitude REAL,
  client_timezone TEXT,
  client_geo_source TEXT,
  client_geo_signal_source TEXT,
  client_accuracy_meters REAL,
  client_geo_captured_at TEXT,
  app_version TEXT,
  display_version TEXT,
  platform TEXT,
  os_version TEXT,
  device_model TEXT,
  rpc_enabled INTEGER,
  features_json TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_event TEXT,
  last_status TEXT NOT NULL CHECK (last_status IN ('ok', 'degraded', 'down')),
  error_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_active_last_seen ON app_sessions(is_active, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON app_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_install ON app_sessions(install_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')) DEFAULT 'admin',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

CREATE TABLE IF NOT EXISTS telemetry_counters (
  counter_key TEXT PRIMARY KEY,
  counter_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'lifetime', 
  duration_days INTEGER,
  hwid TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  custom_options TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  activated_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_hwid ON licenses(hwid);

-- Admin-authored announcements shown as a banner in the desktop app. A row is displayed
-- when is_active = 1 and now is within the optional [starts_at, expires_at] window.
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'critical')),
  is_active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,          -- null = show immediately
  expires_at TEXT,         -- null = show until manually deactivated/deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active, expires_at);

-- In-app user feedback. Identity columns are best-effort (attached by the client) so the
-- admin can follow up; contact is an optional user-provided Discord/email handle.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  contact TEXT,
  hwid TEXT,
  install_id TEXT,
  license_key TEXT,
  machine_name TEXT,
  app_version TEXT,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);
