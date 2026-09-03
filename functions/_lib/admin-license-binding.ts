import { INSTALL_ID_PATTERN } from "../../shared/install-auth";
import { ensureInstallsSchema } from "../../shared/installs-store";
import { requireAdminRole, requireDashboardAccess } from "./admin";
import {
  decodeKeyParam,
  error,
  isObject,
  json,
  jsonBodyErrorMessage,
  nowIso,
  readJsonBody,
} from "./http";
import { ensureLicenseOrderColumns } from "./licenses";
import {
  buildCompleteLicenseOperationStatement,
  completeLicenseOperation,
  ensureLicenseOperationsSchema,
  operationResultForStorage,
  readIdempotencyKey,
  requestFingerprint,
  reserveLicenseOperation,
  withOperationReplay,
  type LicenseOperationAction,
  type LicenseOperationReservation,
} from "./license-operations";
import { internalError } from "./responses";
import type { D1Database, D1PreparedStatement, RuntimeEnv } from "./types";

interface HandlerContext {
  request: Request;
  env: RuntimeEnv;
  params: { key: string };
}

interface LicenseRow extends Record<string, unknown> {
  id: number;
  license_key: string;
  type: string;
  duration_days: number | null;
  hwid: string | null;
  max_uses: number;
  usage_count: number;
  status: string;
  activated_at: string | null;
  expires_at: string | null;
  order_id: string | null;
}

interface InstallTargetRow {
  install_id: string;
  hwid: string | null;
  revoked_at: string | null;
  license_id: number | string | null;
}

interface Target {
  installId: string | null;
  hwid: string;
  registeredInstall: InstallTargetRow | null;
}

interface BindingClaimRow {
  license_id: number | string;
  hwid: string;
  slot_number: number | string;
  operation_id: string;
}

interface InstallClaimRow {
  install_id: string;
  license_id: number | string;
  operation_id: string;
}

const HWID_PATTERN = /^[^\s\p{Cc}]{1,64}$/u;
const REASON_MAX_LENGTH = 500;

/** Shared implementation for the explicit admin activate and bind routes. */
export async function handleAdminLicenseBinding(
  context: HandlerContext,
  action: Extract<LicenseOperationAction, "activate" | "bind">,
): Promise<Response> {
  let reservation: LicenseOperationReservation | null = null;
  let db: D1Database | null = null;
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    const roleDenied = requireAdminRole(access.access);
    if (roleDenied) return roleDenied;

    db = context.env.DB ?? null;
    if (!db) return error(500, "Database not available");

    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonBody<unknown>(context.request);
      if (!isObject(parsed)) return error(400, "Request body must be a JSON object.");
      body = parsed;
    } catch (cause) {
      return error(400, jsonBodyErrorMessage(cause));
    }

    const key = decodeKeyParam(context.params.key);
    if (!key || key.length > 128) return error(400, "License key is required.");
    const idempotencyKey = readIdempotencyKey(context.request, body);
    if (!idempotencyKey) {
      return error(400, "A matching valid Idempotency-Key header or idempotency_key is required.");
    }
    const reason = optionalReason(body.reason);
    if (reason === false) return error(400, `reason must be <= ${REASON_MAX_LENGTH} characters.`);

    const requestedInstallId = optionalInstallId(body.install_id);
    if (requestedInstallId === false || (action === "activate" && !requestedInstallId)) {
      return error(400, "A valid install_id is required.");
    }
    const requestedHwid = optionalHwid(body.hwid);
    if (requestedHwid === false || (action === "bind" && !requestedHwid)) {
      return error(400, "A valid hwid is required.");
    }

    await ensureLicenseOrderColumns(db);
    await ensureLicenseOperationsSchema(db);
    await ensureInstallsSchema(db);

    const fingerprint = await requestFingerprint(action, { ...body, license_key: key });
    const reserved = await reserveLicenseOperation(db, {
      action,
      actorEmail: access.access.user.email,
      idempotencyKey,
      requestHash: fingerprint,
      targetInstallId: requestedInstallId || null,
      targetHwid: requestedHwid || null,
      reason: reason || null,
      createdAt: nowIso(),
    });
    if (reserved.kind === "conflict") return error(409, reserved.message);
    if (reserved.kind === "replay") {
      return json(withOperationReplay(reserved.result, reserved.operationId), reserved.statusCode);
    }
    reservation = reserved.reservation;

    let license = await db
      .prepare(`SELECT * FROM licenses WHERE license_key = ? LIMIT 1`)
      .bind(key)
      .first<LicenseRow>();
    if (!license) {
      return reject(db, reservation, 404, "license_not_found", key, null, null);
    }
    if (license.status === "revoked") {
      return reject(db, reservation, 403, "license_revoked", key, license, null);
    }
    if (license.status === "expired" || isPast(license.expires_at)) {
      return reject(db, reservation, 403, "license_expired", key, license, null);
    }
    if (license.status !== "active") {
      return reject(db, reservation, 409, "license_not_active", key, license, null);
    }

    const targetResult = await resolveTarget(db, action, requestedInstallId, requestedHwid);
    if (!targetResult.ok) {
      return reject(
        db,
        reservation,
        targetResult.status,
        targetResult.code,
        key,
        license,
        targetResult.target,
      );
    }
    const target = targetResult.target;
    const installLicenseId = toNullableInteger(target.registeredInstall?.license_id);
    if (installLicenseId !== null && installLicenseId !== Number(license.id)) {
      return reject(
        db,
        reservation,
        409,
        "install_linked_to_another_license",
        key,
        license,
        target,
      );
    }

    let existingHwids = uniqueHwids(license.hwid);
    let alreadyBound = existingHwids.some(
      (existing) => existing.toLowerCase() === target.hwid.toLowerCase(),
    );

    const [seatClaim, installClaim] = await Promise.all([
      findSeatClaim(db, Number(license.id), target.hwid),
      target.installId ? findInstallClaim(db, target.installId) : Promise.resolve(null),
    ]);
    if (installClaim && toNullableInteger(installClaim.license_id) !== Number(license.id)) {
      return reject(
        db,
        reservation,
        409,
        "install_linked_to_another_license",
        key,
        license,
        target,
      );
    }
    // A committed seat claim means another operation won just before this request read the
    // license. Refresh once; a claim without its matching license value is an invariant breach.
    if (seatClaim && !alreadyBound) {
      const refreshed = await db
        .prepare(`SELECT * FROM licenses WHERE id = ? LIMIT 1`)
        .bind(license.id)
        .first<LicenseRow>();
      if (!refreshed || !hasHwid(refreshed.hwid, target.hwid)) {
        return reject(
          db,
          reservation,
          409,
          "binding_claim_inconsistent",
          key,
          refreshed ?? license,
          target,
        );
      }
      license = refreshed;
      existingHwids = uniqueHwids(license.hwid);
      alreadyBound = true;
    }
    if (
      !alreadyBound &&
      Number(license.max_uses) !== -1 &&
      existingHwids.length >= Number(license.max_uses)
    ) {
      return reject(db, reservation, 409, "license_seat_limit_reached", key, license, target);
    }

    const operationTime = nowIso();
    const nextHwids = alreadyBound ? existingHwids : [...existingHwids, target.hwid];
    const nextExpiresAt =
      license.expires_at ??
      calculateExpiry(operationTime, toNullableInteger(license.duration_days));
    const licenseChanged = !alreadyBound;
    const installChanged = Boolean(
      target.registeredInstall && target.installId && installLicenseId === null,
    );
    const anticipatedLicense: LicenseRow = licenseChanged
      ? {
          ...license,
          hwid: nextHwids.join(","),
          usage_count: nextHwids.length,
          activated_at: license.activated_at ?? operationTime,
          expires_at: nextExpiresAt,
          status: "active",
        }
      : license;
    const responseBody: Record<string, unknown> = {
      ok: true,
      replayed: false,
      operation_id: reservation.operationId,
      action,
      changed: licenseChanged || installChanged,
      activated: licenseChanged && !license.activated_at,
      target: { install_id: target.installId, hwid: target.hwid },
      license: anticipatedLicense,
    };

    const statements: D1PreparedStatement[] = [];
    if (licenseChanged && !seatClaim) {
      statements.push(
        db
          .prepare(
            `INSERT INTO license_binding_claims
              (license_id, hwid, slot_number, operation_id, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            license.id,
            target.hwid,
            nextHwids.length,
            reservation.operationId,
            access.access.user.email,
            operationTime,
          ),
      );
    }
    if (installChanged && target.installId && !installClaim) {
      statements.push(
        db
          .prepare(
            `INSERT INTO license_install_claims
              (install_id, license_id, operation_id, created_by, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(
            target.installId,
            license.id,
            reservation.operationId,
            access.access.user.email,
            operationTime,
          ),
      );
    }
    if (licenseChanged) {
      statements.push(
        db
          .prepare(
            `UPDATE licenses
             SET hwid = ?, usage_count = ?, activated_at = COALESCE(activated_at, ?),
                 expires_at = ?, status = 'active'
             WHERE id = ? AND COALESCE(hwid, '') = ?`,
          )
          .bind(
            nextHwids.join(","),
            nextHwids.length,
            operationTime,
            nextExpiresAt,
            license.id,
            license.hwid ?? "",
          ),
      );
    }
    if (installChanged && target.installId) {
      statements.push(
        db
          .prepare(
            `UPDATE installs SET license_id = ?
             WHERE install_id = ? AND revoked_at IS NULL AND license_id IS NULL`,
          )
          .bind(license.id, target.installId),
      );
    }
    statements.push(
      buildCompleteLicenseOperationStatement(db, reservation, {
        status: "completed",
        result: operationResultForStorage(responseBody, 200),
        completedAt: operationTime,
        licenseId: Number(license.id),
        licenseKey: key,
        orderId: license.order_id,
        targetInstallId: target.installId,
        targetHwid: target.hwid,
        changed: licenseChanged || installChanged,
      }),
    );

    try {
      await db.batch(statements);
    } catch (batchError) {
      const [racedInstallClaim, racedSlot] = await Promise.all([
        target.installId ? findInstallClaim(db, target.installId) : Promise.resolve(null),
        licenseChanged
          ? findSeatClaimBySlot(db, Number(license.id), nextHwids.length)
          : Promise.resolve(null),
      ]);
      if (
        racedInstallClaim &&
        toNullableInteger(racedInstallClaim.license_id) !== Number(license.id)
      ) {
        return reject(
          db,
          reservation,
          409,
          "install_linked_to_another_license",
          key,
          license,
          target,
        );
      }
      if (racedSlot && racedSlot.hwid.toLowerCase() !== target.hwid.toLowerCase()) {
        return reject(db, reservation, 409, "license_changed_concurrently", key, license, target);
      }
      const raced = await readBindingState(db, Number(license.id), target);
      if (raced.installLicenseId !== null && raced.installLicenseId !== Number(license.id)) {
        return reject(
          db,
          reservation,
          409,
          "install_linked_to_another_license",
          key,
          raced.license ?? license,
          target,
        );
      }
      if (raced.license && hasHwid(raced.license.hwid, target.hwid) && raced.installMatches) {
        const racedResponse = {
          ...responseBody,
          changed: false,
          activated: false,
          license: raced.license,
        };
        await completeLicenseOperation(db, reservation, {
          status: "completed",
          result: operationResultForStorage(racedResponse, 200),
          completedAt: nowIso(),
          licenseId: Number(license.id),
          licenseKey: key,
          orderId: license.order_id,
          targetInstallId: target.installId,
          targetHwid: target.hwid,
          changed: false,
        });
        return json(racedResponse);
      }
      throw batchError;
    }

    const committed = await readBindingState(db, Number(license.id), target);
    if (
      !committed.license ||
      !hasHwid(committed.license.hwid, target.hwid) ||
      !committed.installMatches
    ) {
      await compensateBinding(db, reservation, license, anticipatedLicense, target, {
        seatClaimCreated: licenseChanged && !seatClaim,
        installClaimCreated: installChanged && !installClaim,
        installChanged,
      });
      return json(
        {
          ok: false,
          error: "binding_consistency_check_failed",
          replayed: false,
          operation_id: reservation.operationId,
        },
        409,
      );
    }

    responseBody.license = committed.license;
    await completeLicenseOperation(db, reservation, {
      status: "completed",
      result: operationResultForStorage(responseBody, 200),
      completedAt: operationTime,
      licenseId: Number(license.id),
      licenseKey: key,
      orderId: license.order_id,
      targetInstallId: target.installId,
      targetHwid: target.hwid,
      changed: licenseChanged || installChanged,
    });
    return json(responseBody);
  } catch (cause) {
    if (db && reservation) {
      try {
        await completeLicenseOperation(db, reservation, {
          status: "failed",
          result: operationResultForStorage(
            { ok: false, error: "license_operation_failed", operation_id: reservation.operationId },
            500,
          ),
          completedAt: nowIso(),
          changed: false,
        });
      } catch {
        // Preserve the original failure for the shared sanitized error handler.
      }
    }
    return internalError(context.request, "Unable to complete the license operation.", cause);
  }
}

async function resolveTarget(
  db: D1Database,
  action: "activate" | "bind",
  requestedInstallId: string | null,
  requestedHwid: string | null,
): Promise<
  { ok: true; target: Target } | { ok: false; status: number; code: string; target: Target | null }
> {
  if (requestedInstallId) {
    const install = await db
      .prepare(
        `SELECT install_id, hwid, revoked_at, license_id
         FROM installs WHERE install_id = ? LIMIT 1`,
      )
      .bind(requestedInstallId)
      .first<InstallTargetRow>();
    if (!install) {
      return { ok: false, status: 404, code: "install_not_found", target: null };
    }
    const target: Target = {
      installId: install.install_id,
      hwid: install.hwid?.trim() ?? "",
      registeredInstall: install,
    };
    if (install.revoked_at) {
      return { ok: false, status: 409, code: "install_revoked", target };
    }
    if (!HWID_PATTERN.test(target.hwid)) {
      return { ok: false, status: 409, code: "install_missing_hwid", target };
    }
    if (requestedHwid && requestedHwid.toLowerCase() !== target.hwid.toLowerCase()) {
      return { ok: false, status: 409, code: "install_hwid_mismatch", target };
    }
    return { ok: true, target };
  }

  if (action === "activate" || !requestedHwid) {
    return { ok: false, status: 400, code: "install_id_required", target: null };
  }

  const install = await db
    .prepare(
      `SELECT install_id, hwid, revoked_at, license_id
       FROM installs WHERE hwid = ?
       ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END, last_seen_at DESC, created_at DESC
       LIMIT 1`,
    )
    .bind(requestedHwid)
    .first<InstallTargetRow>();
  if (install) {
    const target = {
      installId: install.install_id,
      hwid: requestedHwid,
      registeredInstall: install,
    };
    return install.revoked_at
      ? { ok: false, status: 409, code: "install_revoked", target }
      : { ok: true, target };
  }

  const session = await db
    .prepare(
      `SELECT install_id FROM app_sessions
       WHERE hwid = ? ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .bind(requestedHwid)
    .first<{ install_id: string | null }>();
  if (!session) {
    return { ok: false, status: 404, code: "hwid_not_found", target: null };
  }
  return {
    ok: true,
    target: {
      installId: session.install_id?.trim() || null,
      hwid: requestedHwid,
      registeredInstall: null,
    },
  };
}

async function findSeatClaim(
  db: D1Database,
  licenseId: number,
  hwid: string,
): Promise<BindingClaimRow | null> {
  return db
    .prepare(
      `SELECT license_id, hwid, slot_number, operation_id
       FROM license_binding_claims
       WHERE license_id = ? AND lower(hwid) = lower(?) LIMIT 1`,
    )
    .bind(licenseId, hwid)
    .first<BindingClaimRow>();
}

async function findSeatClaimBySlot(
  db: D1Database,
  licenseId: number,
  slotNumber: number,
): Promise<BindingClaimRow | null> {
  return db
    .prepare(
      `SELECT license_id, hwid, slot_number, operation_id
       FROM license_binding_claims
       WHERE license_id = ? AND slot_number = ? LIMIT 1`,
    )
    .bind(licenseId, slotNumber)
    .first<BindingClaimRow>();
}

async function findInstallClaim(
  db: D1Database,
  installId: string,
): Promise<InstallClaimRow | null> {
  return db
    .prepare(
      `SELECT install_id, license_id, operation_id
       FROM license_install_claims WHERE install_id = ? LIMIT 1`,
    )
    .bind(installId)
    .first<InstallClaimRow>();
}

async function readBindingState(
  db: D1Database,
  licenseId: number,
  target: Target,
): Promise<{
  license: LicenseRow | null;
  installLicenseId: number | null;
  installMatches: boolean;
}> {
  const [license, install] = await Promise.all([
    db.prepare(`SELECT * FROM licenses WHERE id = ? LIMIT 1`).bind(licenseId).first<LicenseRow>(),
    target.registeredInstall && target.installId
      ? db
          .prepare(`SELECT license_id FROM installs WHERE install_id = ? LIMIT 1`)
          .bind(target.installId)
          .first<{ license_id: number | string | null }>()
      : Promise.resolve(null),
  ]);
  const installLicenseId = toNullableInteger(install?.license_id);
  return {
    license,
    installLicenseId,
    installMatches: !target.registeredInstall || installLicenseId === licenseId,
  };
}

async function compensateBinding(
  db: D1Database,
  reservation: LicenseOperationReservation,
  original: LicenseRow,
  anticipated: LicenseRow,
  target: Target,
  changes: {
    seatClaimCreated: boolean;
    installClaimCreated: boolean;
    installChanged: boolean;
  },
): Promise<void> {
  const result = {
    ok: false,
    error: "binding_consistency_check_failed",
    replayed: false,
    operation_id: reservation.operationId,
  };
  const statements: D1PreparedStatement[] = [];
  if (anticipated.hwid !== original.hwid) {
    statements.push(
      db
        .prepare(
          `UPDATE licenses
           SET hwid = ?, usage_count = ?, activated_at = ?, expires_at = ?, status = ?
           WHERE id = ? AND COALESCE(hwid, '') = ?`,
        )
        .bind(
          original.hwid,
          original.usage_count,
          original.activated_at,
          original.expires_at,
          original.status,
          original.id,
          anticipated.hwid ?? "",
        ),
    );
  }
  if (changes.installChanged && target.installId) {
    statements.push(
      db
        .prepare(`UPDATE installs SET license_id = NULL WHERE install_id = ? AND license_id = ?`)
        .bind(target.installId, original.id),
    );
  }
  if (changes.seatClaimCreated) {
    statements.push(
      db
        .prepare(`DELETE FROM license_binding_claims WHERE operation_id = ?`)
        .bind(reservation.operationId),
    );
  }
  if (changes.installClaimCreated && target.installId) {
    statements.push(
      db
        .prepare(`DELETE FROM license_install_claims WHERE install_id = ? AND operation_id = ?`)
        .bind(target.installId, reservation.operationId),
    );
  }
  statements.push(
    buildCompleteLicenseOperationStatement(db, reservation, {
      status: "rejected",
      result: operationResultForStorage(result, 409),
      completedAt: nowIso(),
      licenseId: Number(original.id),
      licenseKey: original.license_key,
      orderId: original.order_id,
      targetInstallId: target.installId,
      targetHwid: target.hwid,
      changed: false,
    }),
  );
  await db.batch(statements);
}

async function reject(
  db: D1Database,
  reservation: LicenseOperationReservation,
  status: number,
  code: string,
  licenseKey: string,
  license: LicenseRow | null,
  target: Target | null,
): Promise<Response> {
  const result: Record<string, unknown> = {
    ok: false,
    error: code,
    replayed: false,
    operation_id: reservation.operationId,
  };
  await completeLicenseOperation(db, reservation, {
    status: "rejected",
    result: operationResultForStorage(result, status),
    completedAt: nowIso(),
    licenseId: license ? Number(license.id) : null,
    licenseKey,
    orderId: license?.order_id ?? null,
    targetInstallId: target?.installId ?? null,
    targetHwid: target?.hwid ?? null,
    changed: false,
  });
  return json(result, status);
}

function optionalInstallId(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return INSTALL_ID_PATTERN.test(normalized) ? normalized : false;
}

function optionalHwid(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return HWID_PATTERN.test(normalized) ? normalized : false;
}

function optionalReason(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length <= REASON_MAX_LENGTH && !/[\p{Cc}\p{Cf}]/u.test(trimmed) ? trimmed : false;
}

function uniqueHwids(value: string | null): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value?.split(",") ?? []) {
    const trimmed = candidate.trim();
    const identity = trimmed.toLowerCase();
    if (!HWID_PATTERN.test(trimmed) || seen.has(identity)) continue;
    seen.add(identity);
    result.push(trimmed);
  }
  return result;
}

function hasHwid(value: string | null, expected: string): boolean {
  return uniqueHwids(value).some((candidate) => candidate.toLowerCase() === expected.toLowerCase());
}

function calculateExpiry(now: string, durationDays: number | null): string | null {
  if (!durationDays || durationDays <= 0) return null;
  return new Date(Date.parse(now) + durationDays * 86_400_000).toISOString();
}

function isPast(value: string | null): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
