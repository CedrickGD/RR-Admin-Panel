import type { D1Database, D1PreparedStatement, D1RunResult } from "./types";

export type LicenseOperationAction = "issue" | "activate" | "bind";

export interface LicenseOperationReservation {
  operationId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface StoredLicenseOperation {
  operation_id: string;
  idempotency_key: string;
  request_hash: string;
  action: LicenseOperationAction;
  status: "pending" | "completed" | "rejected" | "failed";
  result_json: string | null;
}

export type ReserveOperationResult =
  | { kind: "reserved"; reservation: LicenseOperationReservation }
  | {
      kind: "replay";
      operationId: string;
      statusCode: number;
      result: Record<string, unknown>;
    }
  | { kind: "conflict"; message: string };

const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

const LICENSE_OPERATIONS_DDL = [
  `CREATE TABLE IF NOT EXISTS license_admin_operations (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_license_admin_operations_order ON license_admin_operations(order_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_license_admin_operations_license ON license_admin_operations(license_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_license_admin_operations_target ON license_admin_operations(target_hwid, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS license_order_fulfillments (
    order_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE,
    license_id INTEGER,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS license_binding_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id INTEGER NOT NULL,
    hwid TEXT NOT NULL,
    slot_number INTEGER NOT NULL,
    operation_id TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (license_id, hwid),
    UNIQUE (license_id, slot_number)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_license_binding_claims_hwid ON license_binding_claims(hwid)`,
  `CREATE TABLE IF NOT EXISTS license_install_claims (
    install_id TEXT PRIMARY KEY,
    license_id INTEGER NOT NULL,
    operation_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_license_install_claims_license ON license_install_claims(license_id)`,
];

export async function ensureLicenseOperationsSchema(db: D1Database): Promise<void> {
  for (const statement of LICENSE_OPERATIONS_DDL) {
    await db.prepare(statement).run();
  }
}

export function readIdempotencyKey(request: Request, body: Record<string, unknown>): string | null {
  const header = request.headers.get("idempotency-key")?.trim() ?? "";
  const bodyValue = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  if (header && bodyValue && header !== bodyValue) return null;
  const value = header || bodyValue;
  return IDEMPOTENCY_PATTERN.test(value) ? value : null;
}

export async function requestFingerprint(
  action: LicenseOperationAction,
  body: Record<string, unknown>,
): Promise<string> {
  const canonical = JSON.stringify([action, canonicalize(body)]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reserveLicenseOperation(
  db: D1Database,
  input: {
    action: LicenseOperationAction;
    actorEmail: string;
    idempotencyKey: string;
    requestHash: string;
    orderId?: string | null;
    targetInstallId?: string | null;
    targetHwid?: string | null;
    reason?: string | null;
    createdAt: string;
  },
): Promise<ReserveOperationResult> {
  const existing = await findOperation(db, input.idempotencyKey);
  if (existing) return replayOrConflict(existing, input.action, input.requestHash);

  const operationId = `LO-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  try {
    const inserted = await db
      .prepare(
        `INSERT INTO license_admin_operations
          (operation_id, idempotency_key, request_hash, action, actor_email, status,
           order_id, target_install_id, target_hwid, reason, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .bind(
        operationId,
        input.idempotencyKey,
        input.requestHash,
        input.action,
        input.actorEmail,
        input.orderId ?? null,
        input.targetInstallId ?? null,
        input.targetHwid ?? null,
        input.reason ?? null,
        input.createdAt,
      )
      .run<D1RunResult>();
    if ((inserted.meta?.changes ?? 1) > 0) {
      return {
        kind: "reserved",
        reservation: {
          operationId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        },
      };
    }
  } catch {
    // A concurrent request may have won the unique idempotency-key insert. Read and replay it.
  }

  const raced = await findOperation(db, input.idempotencyKey);
  if (raced) return replayOrConflict(raced, input.action, input.requestHash);
  throw new Error("Unable to reserve the license operation.");
}

export async function completeLicenseOperation(
  db: D1Database,
  reservation: LicenseOperationReservation,
  input: {
    status: "completed" | "rejected" | "failed";
    result: Record<string, unknown>;
    completedAt: string;
    licenseId?: number | null;
    licenseKey?: string | null;
    orderId?: string | null;
    targetInstallId?: string | null;
    targetHwid?: string | null;
    changed?: boolean | null;
  },
): Promise<void> {
  await buildCompleteLicenseOperationStatement(db, reservation, input).run();
}

export function buildCompleteLicenseOperationStatement(
  db: D1Database,
  reservation: LicenseOperationReservation,
  input: {
    status: "completed" | "rejected" | "failed";
    result: Record<string, unknown>;
    completedAt: string;
    licenseId?: number | null;
    licenseKey?: string | null;
    orderId?: string | null;
    targetInstallId?: string | null;
    targetHwid?: string | null;
    changed?: boolean | null;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE license_admin_operations
       SET status = ?, license_id = ?, license_key_masked = ?, order_id = COALESCE(?, order_id),
           target_install_id = COALESCE(?, target_install_id), target_hwid = COALESCE(?, target_hwid),
           changed = ?, result_json = ?, completed_at = ?
       WHERE operation_id = ? AND idempotency_key = ? AND request_hash = ?`,
    )
    .bind(
      input.status,
      input.licenseId ?? null,
      input.licenseKey ? maskLicenseKey(input.licenseKey) : null,
      input.orderId ?? null,
      input.targetInstallId ?? null,
      input.targetHwid ?? null,
      input.changed === null || input.changed === undefined ? null : input.changed ? 1 : 0,
      JSON.stringify(input.result),
      input.completedAt,
      reservation.operationId,
      reservation.idempotencyKey,
      reservation.requestHash,
    );
}

export function withOperationReplay(
  result: Record<string, unknown>,
  operationId: string,
): Record<string, unknown> {
  return { ...result, operation_id: operationId, replayed: true };
}

/** Stored results carry their original HTTP status privately so replays preserve semantics. */
export function operationResultForStorage(
  result: Record<string, unknown>,
  statusCode: number,
): Record<string, unknown> {
  return { ...result, _http_status: statusCode };
}

export function maskLicenseKey(key: string): string {
  const compact = key.trim();
  if (compact.length <= 8) return `••••${compact.slice(-2)}`;
  return `${compact.slice(0, 4)}••••${compact.slice(-4)}`;
}

async function findOperation(
  db: D1Database,
  idempotencyKey: string,
): Promise<StoredLicenseOperation | null> {
  return db
    .prepare(
      `SELECT operation_id, idempotency_key, request_hash, action, status, result_json
       FROM license_admin_operations WHERE idempotency_key = ? LIMIT 1`,
    )
    .bind(idempotencyKey)
    .first<StoredLicenseOperation>();
}

function replayOrConflict(
  operation: StoredLicenseOperation,
  action: LicenseOperationAction,
  requestHash: string,
): ReserveOperationResult {
  if (operation.action !== action || operation.request_hash !== requestHash) {
    return { kind: "conflict", message: "Idempotency key was already used for another request." };
  }
  if (!operation.result_json) {
    return {
      kind: "conflict",
      message: "An operation with this idempotency key is still pending.",
    };
  }
  try {
    const parsed = JSON.parse(operation.result_json) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const stored = parsed as Record<string, unknown>;
      const statusCode =
        typeof stored._http_status === "number" &&
        Number.isInteger(stored._http_status) &&
        stored._http_status >= 200 &&
        stored._http_status <= 599
          ? stored._http_status
          : 200;
      const { _http_status: _ignored, ...result } = stored;
      return {
        kind: "replay",
        operationId: operation.operation_id,
        statusCode,
        result,
      };
    }
  } catch {
    // A corrupt audit result must never cause the mutating request to run twice.
  }
  return { kind: "conflict", message: "The previous operation result is unavailable." };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "idempotency_key")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}
