export type RedactedValue =
  | null
  | boolean
  | number
  | string
  | RedactedValue[]
  | { [key: string]: RedactedValue };

export interface RedactionLimits {
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  maxKeyLength?: number;
  maxStringLength?: number;
}

interface NormalizedLimits {
  maxDepth: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxKeyLength: number;
  maxStringLength: number;
}

interface RedactionContext {
  limits: NormalizedLimits;
  active: WeakSet<object>;
  visited: WeakSet<object>;
  remainingWorkItems: number;
  remainingOutputCodePoints: number;
}

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = "[MAX_DEPTH]";
const CIRCULAR = "[CIRCULAR]";
const REPEATED = "[REPEATED]";
const ACCESSOR = "[ACCESSOR]";
const UNINSPECTABLE = "[UNINSPECTABLE]";
const WORK_LIMIT = "[WORK_LIMIT]";
const OUTPUT_TRUNCATED = "[OUTPUT_TRUNCATED]";

const MAX_WORK_ITEMS = 2048;
const MAX_OUTPUT_CODE_POINTS = 12_000;
const MAX_SERIALIZED_OUTPUT_BYTES = 16 * 1024;

const DEFAULT_LIMITS: NormalizedLimits = {
  maxDepth: 6,
  maxArrayItems: 50,
  maxObjectKeys: 50,
  maxKeyLength: 128,
  maxStringLength: 1024,
};

const HARD_LIMITS: NormalizedLimits = {
  maxDepth: 12,
  maxArrayItems: 100,
  maxObjectKeys: 100,
  maxKeyLength: 256,
  maxStringLength: 4096,
};

const SENSITIVE_KEY_TERMS = [
  "authorization",
  "cookie",
  "secret",
  "token",
  "password",
  "passwd",
  "apikey",
  "clientsecret",
  "webhook",
  "licensekey",
  "credential",
  "signature",
  "signedheaders",
  "cfaccessjwtassertion",
];

const CONTROL_SPLIT_SENSITIVE_LABELS = [
  "cfaccessjwtassertion",
  "clientsecrets",
  "clientsecret",
  "signedheaders",
  "authorization",
  "licensekeys",
  "licensekey",
  "webhookurls",
  "webhookurl",
  "credentials",
  "credential",
  "passwords",
  "password",
  "signatures",
  "signature",
  "webhooks",
  "webhook",
  "apikeys",
  "apikey",
  "cookies",
  "cookie",
  "secrets",
  "secret",
  "tokens",
  "token",
  "passwds",
  "passwd",
] as const;

const PROTOTYPE_RISK_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CONTROL_OR_FORMAT_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const ASCII_ALPHANUMERIC_PATTERN = /[a-z0-9]/iu;
const LABEL_SEPARATOR_PATTERN = /[ ._-]/u;
const TEXT_ENCODER = new TextEncoder();
const BOXED_UNINSPECTABLE = Symbol("boxed-uninspectable");

export function redactValue(value: unknown, limits?: RedactionLimits): RedactedValue {
  const normalizedLimits = normalizeLimits(limits);
  const context: RedactionContext = {
    limits: normalizedLimits,
    active: new WeakSet<object>(),
    visited: new WeakSet<object>(),
    remainingWorkItems: MAX_WORK_ITEMS,
    remainingOutputCodePoints: MAX_OUTPUT_CODE_POINTS,
  };
  const result = redact(value, context, 0);
  const serialized = JSON.stringify(result);

  return TEXT_ENCODER.encode(serialized).byteLength <= MAX_SERIALIZED_OUTPUT_BYTES
    ? result
    : boundLiteral(OUTPUT_TRUNCATED, normalizedLimits.maxStringLength);
}

function redact(value: unknown, context: RedactionContext, depth: number): RedactedValue {
  if (context.remainingWorkItems <= 0) {
    return emitMarker(WORK_LIMIT, context);
  }
  context.remainingWorkItems -= 1;

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value, context);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : emitMarker("[NON_FINITE_NUMBER]", context);
  }

  if (typeof value === "bigint") {
    return emitString(`${value.toString()}n`, context);
  }

  if (typeof value === "undefined") {
    return emitMarker("[UNDEFINED]", context);
  }

  if (typeof value === "symbol") {
    return emitString(value.toString(), context);
  }

  if (typeof value === "function") {
    return emitMarker("[FUNCTION]", context);
  }

  if (depth >= context.limits.maxDepth) {
    return emitMarker(MAX_DEPTH, context);
  }

  const objectValue = value as object;
  const boxed = unwrapBoxedPrimitive(objectValue);
  if (boxed === BOXED_UNINSPECTABLE) {
    return emitMarker(UNINSPECTABLE, context);
  }
  if (boxed !== objectValue) {
    return redact(boxed, context, depth);
  }

  if (context.active.has(objectValue)) {
    return emitMarker(CIRCULAR, context);
  }
  if (context.visited.has(objectValue)) {
    return emitMarker(REPEATED, context);
  }
  context.visited.add(objectValue);
  context.active.add(objectValue);

  try {
    if (isErrorValue(objectValue)) {
      return redactError(objectValue, context, depth);
    }

    let isArray: boolean;
    try {
      isArray = Array.isArray(objectValue);
    } catch {
      return emitMarker(UNINSPECTABLE, context);
    }

    return isArray
      ? redactArray(objectValue as unknown[], context, depth)
      : redactObject(objectValue, context, depth);
  } finally {
    context.active.delete(objectValue);
  }
}

function redactArray(values: unknown[], context: RedactionContext, depth: number): RedactedValue[] {
  const length = safeArrayLength(values);
  const truncated = length > context.limits.maxArrayItems;
  const itemCapacity = truncated
    ? Math.max(context.limits.maxArrayItems - 1, 0)
    : context.limits.maxArrayItems;
  const count = Math.min(length, itemCapacity);
  const result: RedactedValue[] = [];

  for (let index = 0; index < count; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    } catch {
      result.push(emitMarker(UNINSPECTABLE, context));
      continue;
    }

    if (!descriptor) {
      result.push(emitMarker("[EMPTY]", context));
    } else if ("value" in descriptor) {
      result.push(redact(descriptor.value, context, depth + 1));
    } else {
      result.push(emitMarker(ACCESSOR, context));
    }
  }

  if (truncated && context.limits.maxArrayItems > 0) {
    result.push(emitMarker(TRUNCATED, context));
  }
  return result;
}

function redactObject(
  value: object,
  context: RedactionContext,
  depth: number,
): { [key: string]: RedactedValue } | string {
  let keys: string[];
  try {
    keys = Reflect.ownKeys(value).filter(
      (key): key is string => typeof key === "string" && isEnumerable(value, key),
    );
  } catch {
    return emitMarker(UNINSPECTABLE, context);
  }

  const truncated = keys.length > context.limits.maxObjectKeys;
  const keyCapacity = truncated
    ? Math.max(context.limits.maxObjectKeys - 1, 0)
    : context.limits.maxObjectKeys;
  const output: { [key: string]: RedactedValue } = {};

  for (const key of keys.slice(0, keyCapacity)) {
    const outputKey = emitKey(key, context);
    let redacted: RedactedValue;

    if (PROTOTYPE_RISK_KEYS.has(key) || exceedsCodePointLimit(key, context.limits.maxKeyLength)) {
      redacted = emitMarker(REDACTED, context);
    } else if (isSensitiveKey(key)) {
      redacted = emitMarker(REDACTED, context);
    } else {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        descriptor = undefined;
      }

      if (!descriptor) {
        redacted = emitMarker(UNINSPECTABLE, context);
      } else if ("value" in descriptor) {
        redacted = redact(descriptor.value, context, depth + 1);
      } else {
        redacted = emitMarker(ACCESSOR, context);
      }
    }

    defineSafe(output, outputKey, redacted);
  }

  if (truncated && context.limits.maxObjectKeys > 0) {
    defineSafe(output, emitKey("$truncated", context), emitMarker(TRUNCATED, context));
  }
  return output;
}

function redactError(
  value: Error,
  context: RedactionContext,
  depth: number,
): { [key: string]: RedactedValue } | string {
  let keys: string[];
  try {
    keys = Reflect.ownKeys(value).filter(
      (key): key is string =>
        typeof key === "string" &&
        !["name", "message", "stack"].includes(key) &&
        isEnumerable(value, key),
    );
  } catch {
    return emitMarker(UNINSPECTABLE, context);
  }

  const entries = ["name", "message", ...keys];
  const truncated = entries.length > context.limits.maxObjectKeys;
  const entryCapacity = truncated
    ? Math.max(context.limits.maxObjectKeys - 1, 0)
    : context.limits.maxObjectKeys;
  const output: { [key: string]: RedactedValue } = {};

  for (const key of entries.slice(0, entryCapacity)) {
    const outputKey = emitKey(key, context);
    if (key === "name" || key === "message") {
      const fallback = key === "name" ? "Error" : "Unknown error";
      defineSafe(output, outputKey, redactString(safeErrorText(value, key, fallback), context));
      continue;
    }

    if (
      PROTOTYPE_RISK_KEYS.has(key) ||
      exceedsCodePointLimit(key, context.limits.maxKeyLength) ||
      isSensitiveKey(key)
    ) {
      defineSafe(output, outputKey, emitMarker(REDACTED, context));
      continue;
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      descriptor = undefined;
    }
    defineSafe(
      output,
      outputKey,
      descriptor && "value" in descriptor
        ? redact(descriptor.value, context, depth + 1)
        : descriptor
          ? emitMarker(ACCESSOR, context)
          : emitMarker(UNINSPECTABLE, context),
    );
  }

  if (truncated && context.limits.maxObjectKeys > 0) {
    defineSafe(output, emitKey("$truncated", context), emitMarker(TRUNCATED, context));
  }
  return output;
}

function redactString(value: string, context: RedactionContext): string {
  const boundedInput = takeCodePoints(value, context.limits.maxStringLength);
  let result = boundedInput.value;

  if (hasControlSplitSensitiveLabel(result)) {
    return emitMarker(REDACTED, context);
  }

  result = result.replace(
    /(^|\r?\n)([ \t]*)(authorization|cookies?)([ \t]*:[ \t]*)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/giu,
    (_match, lineStart: string, indentation: string, key: string, separator: string) =>
      `${lineStart}${indentation}${key}${separator}${REDACTED}`,
  );
  result = result.replace(
    /(^|[\r\n])(\s*(?:credential|signedheaders|signature)\s*=\s*)[^\r\n]*/giu,
    (_match, lineStart: string, prefix: string) => `${lineStart}${prefix}${REDACTED}`,
  );
  result = result.replace(
    /(https?:\/\/[^\s"']*\/api(?:\/v\d+)?\/webhooks\/)[^/\s"']+\/[^?\s"']+/giu,
    (_match, prefix: string) => `${prefix}${REDACTED}`,
  );
  result = result.replace(
    /(https?:\/\/hooks\.slack\.com\/services\/)[^\s"'?]+/giu,
    (_match, prefix: string) => `${prefix}${REDACTED}`,
  );
  result = result.replace(
    /\b(bearer|basic)(\s+)[a-z0-9._~+/=-]+/giu,
    (_match, scheme: string, spacing: string) => `${scheme}${spacing}${REDACTED}`,
  );
  result = result.replace(
    /\b((?:session|auth|token|jwt|sid|csrf|secret)[a-z0-9_.-]*\s*=)\s*[^;\s,&]+/giu,
    (_match, prefix: string) => `${prefix}${REDACTED}`,
  );
  result = result.replace(
    /\b(authorization|cookies?|secrets?|tokens?|passwords?|passwds?|api[\s_.-]*keys?|client[\s_.-]*secrets?|webhooks?(?:[\s_.-]*urls?)?|license[\s_.-]*keys?|cf[\s_.-]*access[\s_.-]*jwt[\s_.-]*assertion)([ \t]*[:=][ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^;\r\n&,}]+)/giu,
    (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
  );
  result = result.replace(/\bRR-[A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/giu, REDACTED);
  result = result.replace(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2,}(?:-[A-Z0-9]{8,})?\b/gu, REDACTED);
  result = result.replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/gu, REDACTED);

  return emitString(result, context, boundedInput.truncated);
}

function isSensitiveKey(key: string): boolean {
  const canonical = key
    .normalize("NFKC")
    .replaceAll(/[^a-z0-9]/giu, "")
    .toLowerCase();
  return SENSITIVE_KEY_TERMS.some((term) => canonical.includes(term));
}

function hasControlSplitSensitiveLabel(value: string): boolean {
  if (!CONTROL_OR_FORMAT_CHARACTER_PATTERN.test(value)) {
    return false;
  }

  for (let delimiterIndex = 0; delimiterIndex < value.length; delimiterIndex += 1) {
    if (![":", "="].includes(value[delimiterIndex])) {
      continue;
    }

    for (const label of CONTROL_SPLIT_SENSITIVE_LABELS) {
      if (matchesControlSplitLabel(value, delimiterIndex, label)) {
        return true;
      }
    }
  }
  return false;
}

function matchesControlSplitLabel(value: string, delimiterIndex: number, label: string): boolean {
  let cursor = delimiterIndex - 1;
  while (cursor >= 0 && [" ", "\t"].includes(value[cursor])) {
    cursor -= 1;
  }

  let labelIndex = label.length - 1;
  let hasInternalControl = false;
  while (cursor >= 0 && labelIndex >= 0) {
    const character = value[cursor];
    if (CONTROL_OR_FORMAT_CHARACTER_PATTERN.test(character)) {
      hasInternalControl = true;
      cursor -= 1;
      continue;
    }
    if (LABEL_SEPARATOR_PATTERN.test(character)) {
      cursor -= 1;
      continue;
    }
    if (character.toLocaleLowerCase("en-US") !== label[labelIndex]) {
      return false;
    }
    cursor -= 1;
    labelIndex -= 1;
  }

  return (
    labelIndex < 0 &&
    hasInternalControl &&
    (cursor < 0 || !ASCII_ALPHANUMERIC_PATTERN.test(value[cursor]))
  );
}

function normalizeLimits(limits?: RedactionLimits): NormalizedLimits {
  return {
    maxDepth: normalizeLimit(limits?.maxDepth, DEFAULT_LIMITS.maxDepth, HARD_LIMITS.maxDepth, 0),
    maxArrayItems: normalizeLimit(
      limits?.maxArrayItems,
      DEFAULT_LIMITS.maxArrayItems,
      HARD_LIMITS.maxArrayItems,
      0,
    ),
    maxObjectKeys: normalizeLimit(
      limits?.maxObjectKeys,
      DEFAULT_LIMITS.maxObjectKeys,
      HARD_LIMITS.maxObjectKeys,
      0,
    ),
    maxKeyLength: normalizeLimit(
      limits?.maxKeyLength,
      DEFAULT_LIMITS.maxKeyLength,
      HARD_LIMITS.maxKeyLength,
      1,
    ),
    maxStringLength: normalizeLimit(
      limits?.maxStringLength,
      DEFAULT_LIMITS.maxStringLength,
      HARD_LIMITS.maxStringLength,
      1,
    ),
  };
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  hardMaximum: number,
  minimum: number,
): number {
  return value === undefined || !Number.isSafeInteger(value)
    ? fallback
    : Math.min(Math.max(value, minimum), hardMaximum);
}

function unwrapBoxedPrimitive(value: object): unknown | typeof BOXED_UNINSPECTABLE {
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === String.prototype) {
      return String.prototype.valueOf.call(value);
    }
    if (prototype === Number.prototype) {
      return Number.prototype.valueOf.call(value);
    }
    if (prototype === Boolean.prototype) {
      return Boolean.prototype.valueOf.call(value);
    }
    if (prototype === BigInt.prototype) {
      return BigInt.prototype.valueOf.call(value);
    }
    if (prototype === Symbol.prototype) {
      return Symbol.prototype.valueOf.call(value);
    }
    return value;
  } catch {
    return BOXED_UNINSPECTABLE;
  }
}

function safeArrayLength(value: unknown[]): number {
  try {
    const length = value.length;
    return Number.isSafeInteger(length) && length >= 0 ? length : 0;
  } catch {
    return 0;
  }
}

function safeErrorText(error: Error, key: "name" | "message", fallback: string): string {
  let current: object | null = error;
  try {
    for (let depth = 0; current && depth < 4; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "string" && descriptor.value
          ? descriptor.value
          : fallback;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function isErrorValue(value: object): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function isEnumerable(value: object, key: string): boolean {
  try {
    return Object.prototype.propertyIsEnumerable.call(value, key);
  } catch {
    return false;
  }
}

function emitKey(key: string, context: RedactionContext): string {
  const bounded = takeCodePoints(key, context.limits.maxKeyLength);
  return emitString(bounded.value, context, bounded.truncated, context.limits.maxKeyLength);
}

function emitMarker(marker: string, context: RedactionContext): string {
  return emitString(marker, context);
}

function emitString(
  value: string,
  context: RedactionContext,
  forceEllipsis = false,
  localLimit = context.limits.maxStringLength,
): string {
  const limit = Math.min(localLimit, context.remainingOutputCodePoints);
  const result = boundLiteral(value, limit, forceEllipsis);
  context.remainingOutputCodePoints -= Array.from(result).length;
  return result;
}

function boundLiteral(value: string, limit: number, forceEllipsis = false): string {
  if (limit <= 0) {
    return "";
  }

  const characters = Array.from(value);
  if (characters.length > limit || forceEllipsis) {
    return limit === 1 ? "…" : `${characters.slice(0, limit - 1).join("")}…`;
  }
  return value;
}

function exceedsCodePointLimit(value: string, limit: number): boolean {
  return takeCodePoints(value, limit).truncated;
}

function takeCodePoints(value: string, limit: number): { value: string; truncated: boolean } {
  let result = "";
  let count = 0;
  for (const character of value) {
    if (count >= limit) {
      return { value: result, truncated: true };
    }
    result += character;
    count += 1;
  }
  return { value: result, truncated: false };
}

function defineSafe(
  target: { [key: string]: RedactedValue },
  key: string,
  value: RedactedValue,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}
