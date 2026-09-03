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
CREATE INDEX IF NOT EXISTS idx_sessions_identity_started ON app_sessions(COALESCE(hwid, install_id), started_at DESC);

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
  expires_at TEXT,
  -- Order tracking: who purchased this key and under which storefront order.
  -- Store-issued keys fill these automatically from the delivery call
  -- (/api/store/generate-key); admin keys are stamped at generation or edited
  -- from the Licenses page. order_meta keeps a sanitized snapshot of the raw
  -- storefront payload for auditing; purchased_at is when the key was issued
  -- to a buyer (vs created_at, which is just row creation).
  order_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_discord TEXT,
  order_source TEXT,                 -- 'store' | 'admin'
  order_note TEXT,
  order_meta TEXT,
  purchased_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_licenses_hwid ON licenses(hwid);
CREATE INDEX IF NOT EXISTS idx_licenses_order ON licenses(order_id);

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

-- Optional structured diagnostic reports. The established feedback table remains unchanged;
-- these one-to-one/one-to-many tables enrich a feedback row only when a modern client opts in.
CREATE TABLE IF NOT EXISTS feedback_report_meta (
  feedback_id INTEGER PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('signed', 'legacy_unsigned')),
  verified_install_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback_diagnostics (
  feedback_id INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  consent INTEGER NOT NULL CHECK (consent = 1),
  received_at TEXT NOT NULL,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback_diagnostic_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL,
  provider_index INTEGER NOT NULL,
  provider TEXT NOT NULL,
  version TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error', 'unavailable')),
  duration_ms INTEGER,
  summary TEXT,
  checks_json TEXT NOT NULL,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
  UNIQUE (feedback_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_feedback_diagnostics_generated ON feedback_diagnostics(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_diagnostic_providers_feedback ON feedback_diagnostic_providers(feedback_id, provider_index);

-- Access control: an admin can suspend (timed) or ban (permanent) a user's access to the desktop
-- app. Keyed by `identity` = the telemetry rollup key (hwid ?? install_id), so it reaches FREE
-- users too — not just license holders (a license revoke only cuts off paying users). The app
-- polls /api/access/status by hwid+install_id and hard-blocks when a row here is in force.
-- had_paid_license snapshots the paid-license warning the admin acted against.
CREATE TABLE IF NOT EXISTS access_suspensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity TEXT NOT NULL UNIQUE,
  hwid TEXT,
  install_id TEXT,
  user_label TEXT,
  mode TEXT NOT NULL DEFAULT 'ban' CHECK (mode IN ('ban', 'suspend')),
  reason TEXT,
  banned_until TEXT,                 -- null = permanent ban; set = timed suspension window end
  is_active INTEGER NOT NULL DEFAULT 1,
  had_paid_license INTEGER NOT NULL DEFAULT 0,
  paid_license_keys TEXT,            -- comma-separated snapshot of the keys bound at suspend time
  created_by TEXT,                   -- admin email
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  lifted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_suspensions_active ON access_suspensions(is_active, identity);
CREATE INDEX IF NOT EXISTS idx_access_suspensions_hwid ON access_suspensions(hwid);

-- Discord paid-community gate: a verified link between a Discord account and a license. Created by
-- the bot's /verify command or the OAuth web flow. The bot grants a "Verified" role while the row
-- is active and the underlying license still validates (not revoked/expired/suspended).
CREATE TABLE IF NOT EXISTS discord_links (
  discord_id TEXT PRIMARY KEY,
  discord_tag TEXT,
  license_key TEXT NOT NULL,
  hwid TEXT,
  verified_at TEXT NOT NULL,
  revoked_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  source TEXT                        -- 'slash' | 'oauth'
);

CREATE INDEX IF NOT EXISTS idx_discord_links_license ON discord_links(license_key);

-- Immutable request identity plus completion result for admin license mutations. A unique
-- idempotency key prevents retries from issuing or consuming a seat twice.
CREATE TABLE IF NOT EXISTS license_admin_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('issue', 'activate', 'bind')),
  actor_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected', 'failed')),
  license_id INTEGER,
  license_key_masked TEXT,
  order_id TEXT,
  target_install_id TEXT,
  target_hwid TEXT,
  reason TEXT,
  changed INTEGER,
  result_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_license_admin_operations_order ON license_admin_operations(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_admin_operations_license ON license_admin_operations(license_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_admin_operations_target ON license_admin_operations(target_hwid, created_at DESC);

CREATE TABLE IF NOT EXISTS license_order_fulfillments (
  order_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  license_id INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS license_binding_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  hwid TEXT NOT NULL,
  slot_number INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (license_id, hwid),
  UNIQUE (license_id, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_license_binding_claims_hwid ON license_binding_claims(hwid);

CREATE TABLE IF NOT EXISTS license_install_claims (
  install_id TEXT PRIMARY KEY,
  license_id INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_install_claims_license ON license_install_claims(license_id);
