// rr.install.v1 — per-install ECDSA P-256 request signing.
// Runtime-agnostic (WebCrypto only): shared by the standalone worker, the Pages Functions
// and later rr-api. Contract: docs/superpowers/specs/2026-08-21-install-signing-contract.md.

export const INSTALL_HEADER = "x-rr-install";
export const TIMESTAMP_HEADER = "x-rr-timestamp";
export const SIGNATURE_HEADER = "x-rr-signature";
export const MAX_CLOCK_SKEW_SECONDS = 300;

export const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMESTAMP_PATTERN = /^\d{1,12}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*={0,2}$/;
const CONTROL_CHAR_PATTERN = /[\p{Cc}]/u;
const P256_COORDINATE_BYTES = 32;
const P1363_SIGNATURE_BYTES = 64;
const MAX_HWID_LENGTH = 64;
const MAX_APP_VERSION_LENGTH = 64;
const MAX_LICENSE_KEY_LENGTH = 128;

const encoder = new TextEncoder();

export interface PublicKeyJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export interface InstallRecord {
  installId: string;
  publicKeyJwk: PublicKeyJwk;
  revokedAt: string | null;
}

export type SignedRequestFailureReason =
  | "missing_headers"
  | "bad_install_id"
  | "bad_timestamp"
  | "stale_timestamp"
  | "bad_signature_encoding"
  | "unknown_install"
  | "revoked"
  | "bad_signature";

export type SignedRequestVerdict =
  | { ok: true; installId: string }
  | { ok: false; status: 400 | 401; reason: SignedRequestFailureReason };

export interface VerifySignedRequestDeps {
  lookupInstall: (installId: string) => Promise<InstallRecord | null>;
  nowSeconds?: () => number;
}

export interface RegistrationInput {
  installId: string;
  hwid: string;
  publicKeyJwk: PublicKeyJwk;
  appVersion: string | null;
  licenseKey: string | null;
}

export type RegistrationBodyResult =
  | { ok: true; value: RegistrationInput }
  | { ok: false; message: string };

/** True when the request carries any of the signing headers (a partial set still counts). */
export function hasSignatureHeaders(request: Request): boolean {
  return (
    request.headers.has(INSTALL_HEADER) ||
    request.headers.has(TIMESTAMP_HEADER) ||
    request.headers.has(SIGNATURE_HEADER)
  );
}

/** `${METHOD}\n${pathname}\n${timestamp}\n${bodySha256Hex}` — no trailing newline. */
export function buildSigningString(
  method: string,
  pathname: string,
  timestamp: string,
  bodySha256Hex: string,
): string {
  return `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${bodySha256Hex}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return bytesToHex(new Uint8Array(digest));
}

export function isValidPublicKeyJwk(value: unknown): value is PublicKeyJwk {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kty !== "EC" || candidate.crv !== "P-256") {
    return false;
  }
  return isCoordinate(candidate.x) && isCoordinate(candidate.y);
}

export async function importP256PublicKey(jwk: PublicKeyJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_LOOKUP: Record<string, number> = Object.fromEntries(
  Array.from(BASE64URL_ALPHABET, (char, index) => [char, index]),
);

export function base64UrlEncode(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index];
    const byte1 = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const byte2 = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (byte0 << 16) | (byte1 << 8) | byte2;
    output += BASE64URL_ALPHABET[(triple >> 18) & 63];
    output += BASE64URL_ALPHABET[(triple >> 12) & 63];
    if (index + 1 < bytes.length) output += BASE64URL_ALPHABET[(triple >> 6) & 63];
    if (index + 2 < bytes.length) output += BASE64URL_ALPHABET[triple & 63];
  }
  return output;
}

/** Decodes base64url (padding optional). Returns null for any invalid character or length. */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== "string" || !BASE64URL_PATTERN.test(text)) {
    return null;
  }
  const unpadded = text.replace(/=+$/, "");
  const remainder = unpadded.length % 4;
  if (remainder === 1) {
    return null;
  }
  const byteLength = Math.floor((unpadded.length * 6) / 8);
  const bytes = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const char of unpadded) {
    buffer = (buffer << 6) | BASE64URL_LOOKUP[char];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }
  return bytes;
}

export async function verifySignedRequest(
  request: Request,
  bodyText: string,
  deps: VerifySignedRequestDeps,
): Promise<SignedRequestVerdict> {
  const rawInstallId = request.headers.get(INSTALL_HEADER);
  const rawTimestamp = request.headers.get(TIMESTAMP_HEADER);
  const rawSignature = request.headers.get(SIGNATURE_HEADER);
  if (rawInstallId === null || rawTimestamp === null || rawSignature === null) {
    return { ok: false, status: 401, reason: "missing_headers" };
  }

  const installId = rawInstallId.trim().toLowerCase();
  if (!INSTALL_ID_PATTERN.test(installId)) {
    return { ok: false, status: 400, reason: "bad_install_id" };
  }

  const timestamp = rawTimestamp.trim();
  if (!TIMESTAMP_PATTERN.test(timestamp)) {
    return { ok: false, status: 400, reason: "bad_timestamp" };
  }
  const now = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: "stale_timestamp" };
  }

  const signature = base64UrlDecode(rawSignature.trim());
  if (!signature || signature.length !== P1363_SIGNATURE_BYTES) {
    return { ok: false, status: 400, reason: "bad_signature_encoding" };
  }

  const install = await deps.lookupInstall(installId);
  if (!install) {
    return { ok: false, status: 401, reason: "unknown_install" };
  }
  if (install.revokedAt !== null && install.revokedAt !== undefined) {
    return { ok: false, status: 401, reason: "revoked" };
  }

  const signingString = buildSigningString(
    request.method,
    new URL(request.url).pathname,
    timestamp,
    await sha256Hex(bodyText),
  );

  let verified = false;
  try {
    const key = await importP256PublicKey(install.publicKeyJwk);
    verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      encoder.encode(signingString),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    return { ok: false, status: 401, reason: "bad_signature" };
  }

  return { ok: true, installId };
}

export function validateRegistrationBody(raw: unknown): RegistrationBodyResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const body = raw as Record<string, unknown>;

  const installIdRaw = typeof body.install_id === "string" ? body.install_id.trim() : "";
  if (!INSTALL_ID_PATTERN.test(installIdRaw)) {
    return { ok: false, message: "install_id must be an RFC-4122 GUID." };
  }
  const installId = installIdRaw.toLowerCase();

  const hwid = typeof body.hwid === "string" ? body.hwid.trim() : "";
  if (
    hwid.length === 0 ||
    hwid.length > MAX_HWID_LENGTH ||
    CONTROL_CHAR_PATTERN.test(hwid) ||
    /\s/u.test(hwid)
  ) {
    return { ok: false, message: "hwid must be 1-64 printable characters without whitespace." };
  }

  if (!isValidPublicKeyJwk(body.public_key)) {
    return { ok: false, message: "public_key must be a P-256 EC JWK with base64url x/y." };
  }
  const publicKeyJwk: PublicKeyJwk = {
    kty: "EC",
    crv: "P-256",
    x: body.public_key.x,
    y: body.public_key.y,
  };

  const appVersion = readOptionalText(body.app_version, MAX_APP_VERSION_LENGTH);
  if (appVersion === false) {
    return { ok: false, message: "app_version must be a string of at most 64 characters." };
  }

  const licenseKey = readOptionalText(body.license_key, MAX_LICENSE_KEY_LENGTH);
  if (licenseKey === false) {
    return { ok: false, message: "license_key must be a string of at most 128 characters." };
  }

  return { ok: true, value: { installId, hwid, publicKeyJwk, appVersion, licenseKey } };
}

function readOptionalText(value: unknown, maxLength: number): string | null | false {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength || CONTROL_CHAR_PATTERN.test(trimmed)) {
    return false;
  }
  return trimmed;
}

function isCoordinate(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const bytes = base64UrlDecode(value);
  return bytes !== null && bytes.length === P256_COORDINATE_BYTES;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
