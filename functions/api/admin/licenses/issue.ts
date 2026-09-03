import { requireAdminRole, requireDashboardAccess } from "../../../_lib/admin";
import {
  error,
  isObject,
  json,
  jsonBodyErrorMessage,
  nowIso,
  readJsonBody,
} from "../../../_lib/http";
import { ensureLicenseOrderColumns, normalizeOrderField } from "../../../_lib/licenses";
import {
  buildCompleteLicenseOperationStatement,
  completeLicenseOperation,
  ensureLicenseOperationsSchema,
  operationResultForStorage,
  readIdempotencyKey,
  requestFingerprint,
  reserveLicenseOperation,
  withOperationReplay,
  type LicenseOperationReservation,
} from "../../../_lib/license-operations";
import { internalError } from "../../../_lib/responses";
import type { D1RunResult, RuntimeEnv } from "../../../_lib/types";

type HandlerContext = { request: Request; env: RuntimeEnv };

interface LicenseRow {
  id: number;
  license_key: string;
  type: string;
  duration_days: number | null;
  hwid: string | null;
  max_uses: number;
  usage_count: number;
  status: string;
  custom_options: string;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  order_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_discord: string | null;
  order_source: string | null;
  order_note: string | null;
  order_meta: string | null;
  purchased_at: string | null;
}

export async function onRequestPost(context: HandlerContext): Promise<Response> {
  let reservation: LicenseOperationReservation | null = null;
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    const roleDenied = requireAdminRole(access.access);
    if (roleDenied) return roleDenied;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonBody<unknown>(context.request);
      if (!isObject(parsed)) return error(400, "Request body must be a JSON object.");
      body = parsed;
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }

    const idempotencyKey = readIdempotencyKey(context.request, body);
    if (!idempotencyKey) {
      return error(400, "A matching valid Idempotency-Key header or idempotency_key is required.");
    }

    const orderId = normalizeOrderField("order_id", body.order_id);
    if (!orderId) return error(400, "order_id is required.");
    const customerName = normalizeOrderField("customer_name", body.customer_name);
    const customerEmail = normalizeOrderField("customer_email", body.customer_email);
    const customerDiscord = normalizeOrderField("customer_discord", body.customer_discord);
    const orderNote = normalizeOrderField("order_note", body.order_note);

    const type = body.type === undefined ? "lifetime" : body.type;
    if (type !== "lifetime" && type !== "trial") {
      return error(400, "type must be lifetime or trial.");
    }
    const durationDays = validateDuration(type, body.duration_days);
    if (durationDays === false) {
      return error(
        400,
        "duration_days must be null for lifetime or a positive number up to 3650 for trial.",
      );
    }
    const maxUses = validateMaxUses(body.max_uses);
    if (maxUses === null) return error(400, "max_uses must be -1 or an integer from 1 to 1000.");
    const customOptions = validateCustomOptions(body.custom_options);
    if (customOptions === null)
      return error(400, "custom_options must be a JSON object of at most 2048 bytes.");
    const customKey = validateCustomKey(body.custom_key);
    if (customKey === false) return error(400, "custom_key must be 8-128 visible characters.");

    await ensureLicenseOrderColumns(db);
    await ensureLicenseOperationsSchema(db);

    const fingerprint = await requestFingerprint("issue", body);
    const reserved = await reserveLicenseOperation(db, {
      action: "issue",
      actorEmail: access.access.user.email,
      idempotencyKey,
      requestHash: fingerprint,
      orderId,
      createdAt: nowIso(),
    });
    if (reserved.kind === "conflict") return error(409, reserved.message);
    if (reserved.kind === "replay") {
      return json(withOperationReplay(reserved.result, reserved.operationId), reserved.statusCode);
    }
    reservation = reserved.reservation;

    // Idempotency protects retries of one request. Order fulfillment is a separate invariant:
    // a fresh key must not silently mint a second license for an already-served order.
    const existingForOrder = await db
      .prepare(`SELECT * FROM licenses WHERE order_id = ? ORDER BY id DESC`)
      .bind(orderId)
      .all<LicenseRow>();
    if (existingForOrder.results.length > 0) {
      const duplicateResult: Record<string, unknown> = {
        ok: false,
        error: "order_already_fulfilled",
        replayed: false,
        operation_id: reservation.operationId,
        existing_licenses: existingForOrder.results,
      };
      await completeLicenseOperation(db, reservation, {
        status: "rejected",
        result: operationResultForStorage(duplicateResult, 409),
        completedAt: nowIso(),
        orderId,
        changed: false,
      });
      return json(duplicateResult, 409);
    }

    const key = customKey || randomLicenseKey();
    const createdAt = nowIso();
    const licenseResult: LicenseRow = {
      id: 0,
      license_key: key,
      type,
      duration_days: durationDays,
      hwid: null,
      max_uses: maxUses,
      usage_count: 0,
      status: "active",
      custom_options: customOptions,
      created_at: createdAt,
      activated_at: null,
      expires_at: null,
      order_id: orderId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_discord: customerDiscord,
      order_source: "admin",
      order_note: orderNote,
      order_meta: null,
      purchased_at: createdAt,
    };
    const responseBody: Record<string, unknown> = {
      ok: true,
      replayed: false,
      operation_id: reservation.operationId,
      license: licenseResult,
    };

    let batchResult: D1RunResult[];
    try {
      batchResult = await db.batch<D1RunResult>([
        // This additive guard closes the different-idempotency-key race without imposing a
        // unique index on historical licenses (which may already contain duplicate order ids).
        db
          .prepare(
            `INSERT INTO license_order_fulfillments
              (order_id, operation_id, license_id, created_by, created_at)
             VALUES (?, ?, NULL, ?, ?)`,
          )
          .bind(orderId, reservation.operationId, access.access.user.email, createdAt),
        db
          .prepare(
            `INSERT INTO licenses (
             license_key, type, duration_days, hwid, max_uses, usage_count, status,
             custom_options, created_at, activated_at, expires_at, order_id, customer_name,
             customer_email, customer_discord, order_source, order_note, order_meta, purchased_at
           ) VALUES (?, ?, ?, NULL, ?, 0, 'active', ?, ?, NULL, NULL, ?, ?, ?, ?, 'admin', ?, NULL, ?)`,
          )
          .bind(
            key,
            type,
            durationDays,
            maxUses,
            customOptions,
            createdAt,
            orderId,
            customerName,
            customerEmail,
            customerDiscord,
            orderNote,
            createdAt,
          ),
        buildCompleteLicenseOperationStatement(db, reservation, {
          status: "completed",
          result: operationResultForStorage(responseBody, 201),
          completedAt: createdAt,
          licenseKey: key,
          orderId,
          changed: true,
        }),
      ]);
    } catch (batchError) {
      const [racedOrder, racedFulfillment] = await Promise.all([
        db
          .prepare(`SELECT * FROM licenses WHERE order_id = ? ORDER BY id DESC`)
          .bind(orderId)
          .all<LicenseRow>(),
        db
          .prepare(`SELECT operation_id FROM license_order_fulfillments WHERE order_id = ?`)
          .bind(orderId)
          .first<{ operation_id: string }>(),
      ]);
      if (!racedFulfillment && racedOrder.results.length === 0) {
        await completeLicenseOperation(db, reservation, {
          status: "failed",
          result: operationResultForStorage(
            { ok: false, error: "license_issue_failed", operation_id: reservation.operationId },
            500,
          ),
          completedAt: nowIso(),
          orderId,
          changed: false,
        });
        throw batchError;
      }
      const duplicateResult: Record<string, unknown> = {
        ok: false,
        error: "order_already_fulfilled",
        replayed: false,
        operation_id: reservation.operationId,
        existing_licenses: racedOrder.results,
      };
      await completeLicenseOperation(db, reservation, {
        status: "rejected",
        result: operationResultForStorage(duplicateResult, 409),
        completedAt: nowIso(),
        orderId,
        changed: false,
      });
      return json(duplicateResult, 409);
    }

    const insertedId = Number(batchResult[1]?.meta?.last_row_id);
    if (Number.isInteger(insertedId) && insertedId > 0) {
      licenseResult.id = insertedId;
      // Upgrade the replay/audit response with the generated numeric id. The atomic batch above
      // already guarantees the key and a replayable result exist if this best-effort write fails.
      await db.batch([
        db
          .prepare(
            `UPDATE license_admin_operations SET license_id = ?, result_json = ? WHERE operation_id = ?`,
          )
          .bind(
            insertedId,
            JSON.stringify(operationResultForStorage(responseBody, 201)),
            reservation.operationId,
          ),
        db
          .prepare(`UPDATE license_order_fulfillments SET license_id = ? WHERE operation_id = ?`)
          .bind(insertedId, reservation.operationId),
      ]);
    }

    return json(responseBody, 201);
  } catch (cause) {
    return internalError(context.request, "Unable to save the operation.", cause);
  }
}

function validateDuration(type: "lifetime" | "trial", value: unknown): number | null | false {
  if (type === "lifetime") return value === undefined || value === null ? null : false;
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 3650
    ? value
    : false;
}

function validateMaxUses(value: unknown): number | null {
  if (value === undefined) return 1;
  if (value === -1) return -1;
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1000
    ? Number(value)
    : null;
}

function validateCustomOptions(value: unknown): string | null {
  if (value === undefined) return "{}";
  if (!isObject(value)) return null;
  const encoded = JSON.stringify(value);
  return new TextEncoder().encode(encoded).byteLength <= 2048 ? encoded : null;
}

function validateCustomKey(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= 128 && !/[\p{Cc}\p{Cf}]/u.test(trimmed)
    ? trimmed
    : false;
}

function randomLicenseKey(): string {
  return crypto.randomUUID().toUpperCase().split("-").slice(1).join("-");
}
