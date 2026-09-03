import type {
  AppSessionRecord,
  ErrorEventDetail,
  InstallRecord,
  UserActivityPayload,
} from "./telemetry";

export type Customer360Selector =
  | "session_id"
  | "install_id"
  | "hwid"
  | "license_key"
  | "order_id"
  | "feedback_id";

export type CustomerConfidence = "verified_customer" | "linked_license" | "device_only";

export interface DiagnosticCheck {
  key: string;
  label: string;
  status: "pass" | "warning" | "fail" | "unknown";
  value?: string | number | boolean | null;
  detail?: string;
}

export interface DiagnosticProvider {
  provider: string;
  version?: string;
  status: "ok" | "warning" | "error" | "unavailable";
  duration_ms?: number;
  summary?: string;
  checks: DiagnosticCheck[];
}

export interface DiagnosticBundle {
  report_id: string;
  generated_at: string;
  providers: DiagnosticProvider[];
}

/** Database-shaped license returned by the admin license and Customer 360 APIs. */
export interface AdminLicenseRecord {
  id: number;
  license_key: string;
  type: string;
  duration_days: number | null;
  hwid: string | null;
  status: string;
  custom_options: string;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  usage_count: number;
  max_uses: number;
  user_label?: string | null;
  client_country?: string | null;
  client_ip?: string | null;
  app_version?: string | null;
  session_last_seen?: string | null;
  session_id?: string | null;
  order_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_discord?: string | null;
  order_source?: string | null;
  order_note?: string | null;
  order_meta?: string | null;
  purchased_at?: string | null;
  verified_discord?: string | null;
  install_id?: string | null;
  [key: string]: unknown;
}

export interface Customer360Order {
  order_id: string;
  order_source: string | null;
  purchased_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_discord: string | null;
  order_note: string | null;
  license_ids: number[];
  license_count: number;
  [key: string]: unknown;
}

export interface Customer360Usage {
  feature: string;
  period: string;
  count: number;
  updated_at: string;
  limit: number | null;
  remaining: number | null;
  [key: string]: unknown;
}

export interface Customer360Feedback {
  id?: number | string;
  report_id?: string | null;
  message?: string | null;
  category?: string | null;
  status?: string | null;
  contact?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  auth_mode?: string | null;
  verified_install_id?: string | null;
  diagnostics?: DiagnosticBundle | null;
  [key: string]: unknown;
}

export type Customer360DatabaseRow = Record<string, unknown>;

export interface Customer360Customer {
  anchor: {
    requested_by: Customer360Selector;
    requested_value: string;
    requested_session_id: string | null;
    identity: string;
    hwid: string | null;
    install_id: string | null;
    confidence: CustomerConfidence;
  };
  profile: {
    user_label: string | null;
    customer_name: string | null;
    email: string | null;
    discord: string | null;
    verified_discord: string | null;
    contact: string | null;
  };
  summary: {
    is_active: boolean;
    license_tier: string;
    app_version: string | null;
    display_version: string | null;
    platform: string | null;
    os_version: string | null;
    device_model: string | null;
    country: string | null;
    city: string | null;
    region: string | null;
    timezone: string | null;
    first_seen: string | null;
    last_seen: string | null;
    total_sessions: number;
    total_duration_seconds: number;
    error_count: number;
  };
  settings: {
    rpc_enabled: boolean | null;
    features: Record<string, unknown>;
    [key: string]: unknown;
  };
  diagnostics: DiagnosticBundle | null;
  activity: UserActivityPayload | null;
  usage: Customer360Usage[];
  orders: Customer360Order[];
  licenses: AdminLicenseRecord[];
  access: Customer360DatabaseRow[];
  discord_links: Customer360DatabaseRow[];
  feedback: Customer360Feedback[];
  errors: ErrorEventDetail[];
  installs: InstallRecord[];
  sessions: AppSessionRecord[];
  section_errors: Record<string, string>;
}

export interface Customer360Response {
  ok: boolean;
  customer?: Customer360Customer;
  error?: string;
}

export interface LicenseSearchResponse {
  ok: boolean;
  query?: { order_id: string | null; customer: string | null };
  licenses?: AdminLicenseRecord[];
  total?: number;
  error?: string;
}

export interface IssueLicenseInput {
  order_id: string;
  customer_name?: string;
  customer_email?: string;
  customer_discord?: string;
  order_note?: string;
  type: "lifetime" | "trial";
  duration_days?: number;
  max_uses?: number;
  custom_options?: Record<string, unknown>;
  custom_key?: string;
  idempotency_key: string;
}

export interface LicenseOperationResponse {
  ok: boolean;
  replayed?: boolean;
  operation_id?: string;
  action?: string;
  changed?: boolean;
  activated?: boolean;
  target?: { install_id: string | null; hwid: string | null };
  license?: AdminLicenseRecord;
  error?: string;
}
