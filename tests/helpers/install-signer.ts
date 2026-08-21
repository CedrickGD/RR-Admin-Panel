import {
  INSTALL_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  base64UrlEncode,
  buildSigningString,
  sha256Hex,
  type PublicKeyJwk,
} from "../../shared/install-auth";

const encoder = new TextEncoder();

export interface InstallKeyPair {
  privateKey: CryptoKey;
  publicKeyJwk: PublicKeyJwk;
}

export interface SignRequestInput {
  method: string;
  pathname: string;
  timestamp: string;
  bodyText: string;
}

export interface SignedHeadersInput extends SignRequestInput {
  installId: string;
}

/** Generates an extractable ECDSA P-256 keypair the way the desktop client does. */
export async function generateInstallKeyPair(): Promise<InstallKeyPair> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  if (!exported.x || !exported.y) {
    throw new Error("Exported JWK is missing the curve point.");
  }
  return {
    privateKey: keyPair.privateKey,
    publicKeyJwk: { kty: "EC", crv: "P-256", x: exported.x, y: exported.y },
  };
}

/** Signs the rr.install.v1 signing string; WebCrypto's ECDSA output already is P1363 `r||s`. */
export async function signRequest(privateKey: CryptoKey, input: SignRequestInput): Promise<string> {
  const bodyHash = await sha256Hex(input.bodyText);
  const signingString = buildSigningString(input.method, input.pathname, input.timestamp, bodyHash);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingString),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

export async function signedHeaders(
  privateKey: CryptoKey,
  input: SignedHeadersInput,
  initialHeaders?: HeadersInit,
): Promise<Headers> {
  const headers = new Headers(initialHeaders);
  headers.set(INSTALL_HEADER, input.installId);
  headers.set(TIMESTAMP_HEADER, input.timestamp);
  headers.set(SIGNATURE_HEADER, await signRequest(privateKey, input));
  return headers;
}

export async function exportPrivateKeyPkcs8Base64(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  return bytesToBase64(new Uint8Array(pkcs8));
}

export async function importPrivateKeyPkcs8Base64(text: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(text),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
