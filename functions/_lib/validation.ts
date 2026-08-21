const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const CONTROL_OR_FORMAT_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;

export type ValidationErrorCode =
  | "body_required"
  | "body_too_large"
  | "invalid_json"
  | "object_required"
  | "invalid_type"
  | "value_required"
  | "too_short"
  | "too_long"
  | "control_character"
  | "invalid_format"
  | "not_finite"
  | "not_integer"
  | "out_of_range";

export interface ValidationError {
  code: ValidationErrorCode;
  field: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

export interface IdentifierBounds {
  field: string;
  minLength?: number;
  maxLength: number;
  pattern?: RegExp;
}

export interface NumberBounds {
  field: string;
  min: number;
  max: number;
  integer?: boolean;
}

export type IntegerBounds = Omit<NumberBounds, "integer">;

export async function readObjectBody(
  request: Request,
  maxBytes = 16 * 1024,
): Promise<ValidationResult<Record<string, unknown>>> {
  assertBodyLimit(maxBytes);

  const declaredLength = request.headers.get("content-length")?.trim() ?? "";
  if (/^\d+$/u.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maxBytes) {
      return failure("body_too_large", "$body", `Request body must not exceed ${maxBytes} bytes.`);
    }
  }

  const bytesResult = await readBoundedBytes(request, maxBytes);
  if (!bytesResult.ok) {
    return bytesResult;
  }

  let raw: string;
  try {
    raw = UTF8_DECODER.decode(bytesResult.value);
  } catch {
    return failure("invalid_json", "$body", "Request body must contain valid UTF-8 JSON.");
  }

  if (!raw.trim()) {
    return failure("body_required", "$body", "Request body is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return failure("invalid_json", "$body", "Request body must contain valid JSON.");
  }

  if (!isPlainJsonObject(parsed)) {
    return failure("object_required", "$body", "Request body must be a JSON object.");
  }

  return { ok: true, value: parsed };
}

export function parseBoundedIdentifier(
  value: unknown,
  bounds: IdentifierBounds,
): ValidationResult<string> {
  assertIdentifierBounds(bounds);

  if (typeof value !== "string") {
    return failure("invalid_type", bounds.field, `${bounds.field} must be a string.`);
  }

  if (hasControlCharacter(value)) {
    return failure(
      "control_character",
      bounds.field,
      `${bounds.field} must not contain control characters.`,
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    return failure("value_required", bounds.field, `${bounds.field} is required.`);
  }

  const length = Array.from(normalized).length;
  const minLength = bounds.minLength ?? 1;
  if (length < minLength) {
    return failure(
      "too_short",
      bounds.field,
      `${bounds.field} must contain at least ${minLength} characters.`,
    );
  }

  if (length > bounds.maxLength) {
    return failure(
      "too_long",
      bounds.field,
      `${bounds.field} must contain at most ${bounds.maxLength} characters.`,
    );
  }

  if (bounds.pattern) {
    const stablePattern = new RegExp(
      bounds.pattern.source,
      bounds.pattern.flags.replaceAll(/[gy]/gu, ""),
    );
    if (!stablePattern.test(normalized)) {
      return failure("invalid_format", bounds.field, `${bounds.field} has an invalid format.`);
    }
  }

  return { ok: true, value: normalized };
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => CONTROL_OR_FORMAT_CHARACTER_PATTERN.test(character));
}

export function parseBoundedNumber(value: unknown, bounds: NumberBounds): ValidationResult<number> {
  assertNumberBounds(bounds);

  if (typeof value !== "number") {
    return failure("invalid_type", bounds.field, `${bounds.field} must be a number.`);
  }

  if (!Number.isFinite(value)) {
    return failure("not_finite", bounds.field, `${bounds.field} must be finite.`);
  }

  if (bounds.integer && !Number.isInteger(value)) {
    return failure("not_integer", bounds.field, `${bounds.field} must be an integer.`);
  }

  if (value < bounds.min || value > bounds.max) {
    return failure(
      "out_of_range",
      bounds.field,
      `${bounds.field} must be between ${bounds.min} and ${bounds.max}.`,
    );
  }

  return { ok: true, value };
}

export function parseBoundedInteger(
  value: unknown,
  bounds: IntegerBounds,
): ValidationResult<number> {
  return parseBoundedNumber(value, { ...bounds, integer: true });
}

async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<ValidationResult<Uint8Array>> {
  if (!request.body) {
    return { ok: true, value: new Uint8Array() };
  }

  if (request.bodyUsed) {
    return failure("invalid_json", "$body", "Request body could not be read as JSON.");
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return failure("invalid_json", "$body", "Request body could not be read as JSON.");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return failure(
          "body_too_large",
          "$body",
          `Request body must not exceed ${maxBytes} bytes.`,
        );
      }
      chunks.push(value);
    }
  } catch {
    return failure("invalid_json", "$body", "Request body could not be read as JSON.");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: bytes };
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertBodyLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive safe integer.");
  }
}

function assertIdentifierBounds(bounds: IdentifierBounds): void {
  const minLength = bounds.minLength ?? 1;
  if (
    !bounds.field ||
    !Number.isSafeInteger(minLength) ||
    !Number.isSafeInteger(bounds.maxLength) ||
    minLength < 1 ||
    bounds.maxLength < minLength
  ) {
    throw new RangeError("Identifier bounds must define a field and valid positive lengths.");
  }
}

function assertNumberBounds(bounds: NumberBounds): void {
  if (
    !bounds.field ||
    !Number.isFinite(bounds.min) ||
    !Number.isFinite(bounds.max) ||
    bounds.min > bounds.max
  ) {
    throw new RangeError("Number bounds must define a field and a valid finite range.");
  }
}

function failure(
  code: ValidationErrorCode,
  field: string,
  message: string,
): { ok: false; error: ValidationError } {
  return { ok: false, error: { code, field, message } };
}
