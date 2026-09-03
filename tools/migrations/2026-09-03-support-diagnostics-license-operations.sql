-- Additive support diagnostics + audited license workflow tables.
-- Existing feedback and license rows/columns are intentionally untouched.
-- Safe to re-run: every statement is CREATE ... IF NOT EXISTS.

PRAGMA foreign_keys = ON;

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
