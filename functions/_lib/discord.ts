import { countActiveLinksForLicense, ensureAccessSchema, findActiveSuspension, isSuspensionActive } from "./access";
import { nowIso } from "./http";
import type { RuntimeEnv } from "./types";

/**
 * Discord-side helpers for the paid-community gate. Two verification paths share the same license
 * check (`resolveLicenseForVerification`):
 *   • the bot's /verify slash command  → POST /api/discord/verify (license key, shared secret)
 *   • the OAuth web flow (stage 2)      → /api/discord/oauth-start → /callback (guilds.join)
 * Role changes are done straight against the Discord REST API with the bot token, so neither path
 * depends on the gateway bot being reachable at that instant.
 */

const DISCORD_API = "https://discord.com/api/v10";

export interface LicenseVerifyResult {
  ok: boolean;
  reason?: string;
  license?: {
    license_key: string;
    hwid: string | null;
    status: string;
    expires_at: string | null;
    type: string;
  };
}

/**
 * Decide whether a license entitles its holder to the Verified role: it must exist, be active,
 * not be expired, and — if it is already bound to hardware — NO bound machine may be under an
 * active suspension/ban. Binding to an hwid is NOT required (a customer may link Discord before
 * ever activating the desktop app).
 *
 * When `forDiscordId` is given, the license's seat limit is enforced against Discord links too:
 * a single-seat key already linked to a different Discord account is rejected, so one shared key
 * cannot verify unlimited community members. Re-verifying the SAME account always passes.
 */
export async function resolveLicenseForVerification(
  env: RuntimeEnv,
  licenseKey: string,
  forDiscordId?: string,
): Promise<LicenseVerifyResult> {
  const db = env.DB;
  if (!db) return { ok: false, reason: "server_unavailable" };

  const key = licenseKey.trim();
  if (!key) return { ok: false, reason: "missing_key" };

  const license = await db
    .prepare("SELECT license_key, hwid, status, expires_at, type, max_uses FROM licenses WHERE license_key = ?")
    .bind(key)
    .first<{ license_key: string; hwid: string | null; status: string; expires_at: string | null; type: string; max_uses: number }>();

  if (!license) return { ok: false, reason: "invalid_key" };
  if (license.status === "revoked") return { ok: false, reason: "revoked" };
  if (license.status === "expired") return { ok: false, reason: "expired" };
  if (license.expires_at && license.expires_at < nowIso()) return { ok: false, reason: "expired" };

  // If the license is bound to hardware, a suspension on ANY bound machine blocks Discord access.
  // licenses.hwid is a comma-separated list for multi-seat/master keys — check every seat, not
  // just the first, or a ban on seat 2 would never be seen.
  if (license.hwid) {
    await ensureAccessSchema(env);
    const seats = license.hwid.split(",").map((h) => h.trim()).filter((h) => h.length > 0);
    for (const seat of seats) {
      const suspension = await findActiveSuspension(env, { hwid: seat, identity: seat });
      if (isSuspensionActive(suspension)) return { ok: false, reason: "suspended" };
    }
  }

  // Seat limit against Discord accounts: a key may verify at most max_uses distinct Discord ids
  // (max_uses = -1 means unlimited, mirroring the hwid-binding semantics in license/activate).
  if (forDiscordId && license.max_uses !== -1) {
    const otherLinks = await countActiveLinksForLicense(env, license.license_key, forDiscordId);
    if (otherLinks >= Math.max(license.max_uses, 1)) {
      return { ok: false, reason: "seat_limit" };
    }
  }

  return { ok: true, license };
}

function botHeaders(env: RuntimeEnv): HeadersInit {
  return {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/** Grant the Verified role to a guild member. Returns true on success (204) or if already held. */
export async function discordAddVerifiedRole(env: RuntimeEnv, userId: string): Promise<boolean> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_VERIFIED_ROLE_ID) return false;
  const res = await fetch(
    `${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${env.DISCORD_VERIFIED_ROLE_ID}`,
    { method: "PUT", headers: botHeaders(env) },
  );
  return res.status === 204 || res.ok;
}

/** Remove the Verified role (used when a link is revoked or the license is suspended). */
export async function discordRemoveVerifiedRole(env: RuntimeEnv, userId: string): Promise<boolean> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_VERIFIED_ROLE_ID) return false;
  const res = await fetch(
    `${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${env.DISCORD_VERIFIED_ROLE_ID}`,
    { method: "DELETE", headers: botHeaders(env) },
  );
  return res.status === 204 || res.ok;
}

/**
 * Add a user to the guild (or no-op if already a member) already carrying the Verified role, using
 * the OAuth access token + guilds.join scope. This is the modern replacement for a single-use
 * invite: the join is bound to the exact account that OAuth'd with a valid license, so there is no
 * shareable invite link to leak. 201 = added, 204 = already a member (then role is added separately).
 */
export async function discordJoinGuildWithRole(env: RuntimeEnv, userId: string, accessToken: string): Promise<boolean> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return false;
  const body: Record<string, unknown> = { access_token: accessToken };
  if (env.DISCORD_VERIFIED_ROLE_ID) body.roles = [env.DISCORD_VERIFIED_ROLE_ID];

  const res = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
    method: "PUT",
    headers: botHeaders(env),
    body: JSON.stringify(body),
  });

  if (res.status === 201) return true; // newly added, role applied
  if (res.status === 204) {
    // Already a member — PUT doesn't re-apply roles on an existing member, so add it explicitly.
    return discordAddVerifiedRole(env, userId);
  }
  return false;
}

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

/** Exchange an OAuth authorization code for an access token. */
export async function discordExchangeCode(env: RuntimeEnv, code: string): Promise<DiscordTokenResponse | null> {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) return null;
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.DISCORD_REDIRECT_URI,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) return null;
  return (await res.json()) as DiscordTokenResponse;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
}

/** Resolve the authenticated user's id/username from an access token. */
export async function discordGetUser(accessToken: string): Promise<DiscordUser | null> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as DiscordUser;
}

export function discordDisplayTag(user: DiscordUser): string {
  if (user.global_name) return user.global_name;
  if (user.discriminator && user.discriminator !== "0") return `${user.username}#${user.discriminator}`;
  return user.username;
}

/** Persist (or refresh) a verified Discord ↔ license link. */
export async function upsertDiscordLink(
  env: RuntimeEnv,
  args: { discordId: string; discordTag: string | null; licenseKey: string; hwid: string | null; source: string },
): Promise<void> {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB is required.");
  await ensureAccessSchema(env);
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO discord_links (discord_id, discord_tag, license_key, hwid, verified_at, revoked_at, is_active, source)
       VALUES (?, ?, ?, ?, ?, NULL, 1, ?)
       ON CONFLICT(discord_id) DO UPDATE SET
         discord_tag = excluded.discord_tag,
         license_key = excluded.license_key,
         hwid = COALESCE(excluded.hwid, discord_links.hwid),
         verified_at = excluded.verified_at,
         revoked_at = NULL,
         is_active = 1,
         source = excluded.source`,
    )
    .bind(args.discordId, args.discordTag, args.licenseKey, args.hwid, now, args.source)
    .run();
}

// ── OAuth CSRF state: HMAC-signed, short-lived token that also carries the license key so the
// callback can re-validate without a server-side session store. ──
const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): string {
  return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signState(secret: string, licenseKey: string, ttlSeconds = 600): Promise<string> {
  const payload = JSON.stringify({ k: licenseKey, e: Date.now() + ttlSeconds * 1000, n: crypto.randomUUID() });
  const data = b64url(enc.encode(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}

export async function verifyState(secret: string, token: string): Promise<{ licenseKey: string } | null> {
  // Any malformed token (bad base64 in either segment, bad JSON, wrong HMAC, expired) must degrade
  // to null — the callback renders a friendly "link expired" page off that. atob throws on
  // out-of-alphabet characters, so the decode belongs inside the try like everything else.
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, bufferFromB64url(sig), enc.encode(data));
    if (!valid) return null;
    const payload = JSON.parse(b64urlDecode(data)) as { k?: unknown; e?: unknown };
    if (typeof payload.e !== "number" || payload.e < Date.now()) return null;
    if (typeof payload.k !== "string" || !payload.k) return null;
    return { licenseKey: payload.k };
  } catch {
    return null;
  }
}

function bufferFromB64url(value: string): ArrayBuffer {
  const bin = b64urlDecode(value);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return buf;
}

/** Minimal self-contained HTML result page for the OAuth web flow (Access-bypassed path). */
export function verifyHtmlPage(ok: boolean, heading: string, message: string): Response {
  const accent = ok ? "#22c55e" : "#ef4444";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RazorReaper · Discord Verification</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#0b0d12; color:#e6e8ee; font:15px/1.6 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif; }
  .card { max-width:420px; padding:36px 32px; border:1px solid #1e2230; border-radius:16px;
    background:#12141c; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  .dot { width:56px; height:56px; border-radius:16px; margin:0 auto 18px; display:flex; align-items:center;
    justify-content:center; background:${accent}1a; color:${accent}; font-size:28px; }
  h1 { font-size:1.35rem; margin:0 0 8px; }
  p { color:#a7adbd; margin:0; }
</style></head><body>
  <div class="card">
    <div class="dot">${ok ? "✓" : "✕"}</div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Map an internal verify reason code to a short human message for the bot / web page. */
export function verifyReasonMessage(reason: string | undefined): string {
  switch (reason) {
    case "invalid_key":
      return "That license key was not found. Double-check it from your purchase confirmation.";
    case "revoked":
      return "This license has been revoked and can no longer be used.";
    case "expired":
      return "This license has expired.";
    case "suspended":
      return "Access for this license is currently suspended.";
    case "seat_limit":
      return "This license is already linked to another Discord account.";
    case "missing_key":
      return "Please provide your license key.";
    case "server_unavailable":
      return "Verification is temporarily unavailable. Try again shortly.";
    default:
      return "Verification failed.";
  }
}
