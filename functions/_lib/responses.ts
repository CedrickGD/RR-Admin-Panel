import { error } from "./http";
import { redactValue } from "./redaction";

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const FALLBACK_MESSAGE = "Internal server error.";
const MAX_CAUSE_TEXT_LENGTH = 1024;
const MAX_CAUSE_PROTOTYPE_DEPTH = 4;
const MIN_CAUSE_FRAGMENT_LENGTH = 8;
const SAFE_PUBLIC_MESSAGES = new Set([
  FALLBACK_MESSAGE,
  "Internal service failure.",
  "Unable to complete the request.",
  "Unable to save the operation.",
]);

export function internalError(request: Request, publicMessage: string, cause: unknown): Response {
  const requestId = resolveRequestId(request);
  const safeMessage = normalizePublicMessage(publicMessage, cause);
  const safeCause = redactValue(cause);

  console.error("internal_error", { requestId, cause: safeCause });

  return error(500, safeMessage, { requestId }, { [REQUEST_ID_HEADER]: requestId });
}

function resolveRequestId(request: Request): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim() ?? "";
  return REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

function normalizePublicMessage(publicMessage: string, cause: unknown): string {
  if (typeof publicMessage !== "string" || !SAFE_PUBLIC_MESSAGES.has(publicMessage)) {
    return FALLBACK_MESSAGE;
  }

  const publicComparable = comparableText(publicMessage);
  if (
    readCauseTexts(cause).some((causeText) => {
      const causeComparable = comparableText(causeText);
      return (
        causeComparable.length >= MIN_CAUSE_FRAGMENT_LENGTH &&
        (publicComparable.includes(causeComparable) || causeComparable.includes(publicComparable))
      );
    })
  ) {
    return FALLBACK_MESSAGE;
  }

  return publicMessage;
}

function readCauseTexts(cause: unknown): string[] {
  if (typeof cause === "string") {
    return [boundCauseText(cause)];
  }
  if (
    typeof cause === "number" ||
    typeof cause === "bigint" ||
    typeof cause === "boolean" ||
    typeof cause === "symbol"
  ) {
    return [String(cause)];
  }
  if (typeof cause !== "object" || cause === null) {
    return [];
  }

  const texts: string[] = [];
  let current: object | null = cause;
  for (let depth = 0; current !== null && depth < MAX_CAUSE_PROTOTYPE_DEPTH; depth += 1) {
    for (const key of ["message", "stack"] as const) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        descriptor = undefined;
      }
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
        texts.push(boundCauseText(descriptor.value));
      }
    }

    try {
      current = Object.getPrototypeOf(current) as object | null;
    } catch {
      current = null;
    }
  }
  return texts;
}

function boundCauseText(value: string): string {
  return Array.from(value).slice(0, MAX_CAUSE_TEXT_LENGTH).join("");
}

function comparableText(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
