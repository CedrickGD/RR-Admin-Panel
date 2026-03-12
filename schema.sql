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

CREATE TABLE IF NOT EXISTS latest_status (
  source TEXT NOT NULL,
  service TEXT NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
  metrics_json TEXT NOT NULL DEFAULT '{}',
  message TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, service)
);

CREATE INDEX IF NOT EXISTS idx_latest_updated ON latest_status(updated_at DESC);

CREATE TABLE IF NOT EXISTS app_sessions (
  session_id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  source TEXT NOT NULL,
  user_label TEXT,
  client_ip TEXT,
  client_country TEXT,
  app_version TEXT,
  platform TEXT,
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
