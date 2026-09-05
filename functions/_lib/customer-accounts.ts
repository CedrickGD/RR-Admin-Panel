import { validateAppearance } from "../../shared/appearance";
import type { D1Database, RuntimeEnv } from "./types";
import { discordExchangeCode, discordGetUser, verifyHtmlPage } from "./discord";
import { error, json } from "./http";
import { parseJsonObject, requireInstallAuth } from "./install-auth";
import { enforceRateLimit } from "./ratelimit";
import { ensureInstallsSchema } from "../../shared/installs-store";

export const ACCOUNT_PATH = "/api/discord/account";
export const ACCOUNT_COOKIE = "rr_account_browser";
const LOGIN_SECONDS = 600;
const SESSION_SECONDS = 90 * 86400;
const ready = new WeakMap<D1Database, Promise<void>>();
export const ACCOUNT_DDL = [
  `CREATE TABLE IF NOT EXISTS customer_accounts (
    id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, discord_username TEXT NOT NULL,
    display_name TEXT NOT NULL, discord_avatar TEXT, avatar_data TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS customer_account_devices (
    install_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id),
    linked_at TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_devices_account ON customer_account_devices(account_id)`,
  `CREATE TABLE IF NOT EXISTS customer_account_logins (
    request_hash TEXT PRIMARY KEY, install_id TEXT NOT NULL, user_code TEXT NOT NULL,
    expires_at INTEGER NOT NULL, state_hash TEXT, browser_hash TEXT, account_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_logins_state ON customer_account_logins(state_hash)`,
];
export function ensureCustomerAccounts(db: D1Database): Promise<void> {
  let task = ready.get(db);
  if (!task) {
    task = ensureInstallsSchema(db)
      .then(() => db.batch(ACCOUNT_DDL.map((sql) => db.prepare(sql))))
      .then(() => undefined);
    ready.set(db, task);
    task.catch(() => ready.delete(db));
  }
  return task;
}
export interface CustomerAccount {
  id: string;
  discord_id: string;
  discord_username: string;
  display_name: string;
  discord_avatar: string | null;
  avatar_data: string | null;
  created_at: string;
  updated_at: string;
}
interface Login {
  request_hash: string;
  install_id: string;
  user_code: string;
  expires_at: number;
  state_hash: string | null;
  browser_hash: string | null;
  account_id: string | null;
}
const seconds = () => Math.floor(Date.now() / 1000);
export function randomAccountToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function accountHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function cookie(request: Request): string {
  return (
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${ACCOUNT_COOKIE}=`))
      ?.slice(ACCOUNT_COOKIE.length + 1) ?? ""
  );
}
function setCookie(value: string, maxAge = LOGIN_SECONDS): string {
  return `${ACCOUNT_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/discord; Max-Age=${maxAge}`;
}
function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
export function accountProfile(account: CustomerAccount, admin = false) {
  return {
    id: account.id,
    displayName: account.display_name,
    discordId: account.discord_id,
    discordUsername: account.discord_username,
    avatar: admin
      ? account.avatar_data || account.discord_avatar
        ? `/api/admin/customer-avatar?id=${encodeURIComponent(account.id)}&v=${encodeURIComponent(account.updated_at)}`
        : null
      : account.avatar_data || account.discord_avatar,
    createdAt: account.created_at,
  };
}
export async function accountForInstall(
  db: D1Database,
  installId: string,
): Promise<CustomerAccount | null> {
  return db
    .prepare(
      `SELECT a.* FROM customer_accounts a JOIN customer_account_devices d ON d.account_id=a.id
    WHERE d.install_id=? AND d.expires_at>?`,
    )
    .bind(installId, seconds())
    .first<CustomerAccount>();
}
export function validateAccountUpdate(input: Record<string, unknown>) {
  if (Object.keys(input).some((key) => !["displayName", "avatar"].includes(key)))
    throw new Error("Unknown profile field.");
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (
    displayName.length < 2 ||
    displayName.length > 60 ||
    /[\u0000-\u001f\u007f]/.test(displayName)
  )
    throw new Error("Use a display name between 2 and 60 characters.");
  let avatar: string | null | undefined;
  if (input.avatar !== undefined) {
    if (input.avatar === null || input.avatar === "") avatar = null;
    else {
      if (typeof input.avatar !== "string" || input.avatar.length > 350000)
        throw new Error("Choose an image under 250 KB.");
      avatar = validateAppearance({ image: input.avatar }).image;
    }
  }
  return { displayName, avatar };
}

/** Signed device proof is required for every app request; no shared secret or claimed HWID grants account access. */
export async function accountApi(
  context: { request: Request; env: RuntimeEnv },
  action: string,
): Promise<Response> {
  const { request, env } = context;
  const methods: Record<string, string[]> = {
    start: ["POST"],
    poll: ["POST"],
    confirm: ["POST"],
    me: ["GET", "PUT", "DELETE"],
  };
  if (!methods[action]?.includes(request.method)) return error(405, "Method not allowed.");
  const limited = enforceRateLimit(request, {
    route: `customer-account/${action}`,
    limit: action === "poll" ? 45 : 15,
    windowSeconds: 60,
  });
  if (limited) return limited;
  const auth = await requireInstallAuth(context, "required", {
    maxBodyBytes: action === "me" ? 360000 : 4096,
  });
  if (!auth.ok) return auth.response;
  const db = env.DB!;
  const installId = auth.installId!;
  await ensureCustomerAccounts(db);
  const body = parseJsonObject(auth.bodyText) ?? {};
  if (action === "start") {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI)
      return error(503, "Account sign-in is not configured yet.");
    const token = randomAccountToken(),
      hash = await accountHash(token);
    const userCode = token.slice(0, 4).toUpperCase() + "-" + token.slice(4, 8).toUpperCase();
    await db.batch([
      db
        .prepare("DELETE FROM customer_account_logins WHERE install_id=? OR expires_at<=?")
        .bind(installId, seconds()),
      db
        .prepare(
          "INSERT INTO customer_account_logins(request_hash,install_id,user_code,expires_at) VALUES(?,?,?,?)",
        )
        .bind(hash, installId, userCode, seconds() + LOGIN_SECONDS),
    ]);
    return noStore(
      json({
        ok: true,
        requestId: token,
        userCode,
        expiresIn: LOGIN_SECONDS,
        verificationUrl: new URL(
          `${ACCOUNT_PATH}/authorize?request=${token}`,
          request.url,
        ).toString(),
      }),
    );
  }
  if (action === "poll" || action === "confirm") {
    if (typeof body.requestId !== "string" || !/^[a-f0-9]{64}$/.test(body.requestId))
      return error(400, "Invalid sign-in request.");
    const hash = await accountHash(body.requestId);
    const login = await db
      .prepare(
        "SELECT * FROM customer_account_logins WHERE request_hash=? AND install_id=? AND expires_at>?",
      )
      .bind(hash, installId, seconds())
      .first<Login>();
    if (!login) return error(410, "Sign-in expired. Please start again.");
    if (!login.account_id) return noStore(json({ ok: true, status: "pending" }));
    const account = await db
      .prepare("SELECT * FROM customer_accounts WHERE id=?")
      .bind(login.account_id)
      .first<CustomerAccount>();
    if (!account) return error(410, "Sign-in expired. Please start again.");
    if (action === "poll")
      return noStore(json({ ok: true, status: "confirm", account: accountProfile(account) }));
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO customer_account_devices(install_id,account_id,linked_at,expires_at)
        SELECT install_id,account_id,?,? FROM customer_account_logins WHERE request_hash=? AND install_id=? AND expires_at>? AND account_id IS NOT NULL
        ON CONFLICT(install_id) DO UPDATE SET account_id=excluded.account_id,linked_at=excluded.linked_at,expires_at=excluded.expires_at`,
        )
        .bind(new Date().toISOString(), seconds() + SESSION_SECONDS, hash, installId, seconds()),
      db
        .prepare("DELETE FROM customer_account_logins WHERE request_hash=? AND install_id=?")
        .bind(hash, installId),
    ]);
    if (result[0].meta?.changes !== 1) return error(410, "Sign-in expired. Please start again.");
    return noStore(json({ ok: true, account: accountProfile(account) }));
  }
  const account = await accountForInstall(db, installId);
  if (!account)
    return noStore(
      json({ ok: false, error: "Sign in to your account.", code: "account_signed_out" }, 403),
    );
  if (request.method === "DELETE") {
    await db.batch([
      db
        .prepare("UPDATE customer_account_devices SET expires_at=0 WHERE install_id=?")
        .bind(installId),
      db.prepare("DELETE FROM customer_account_logins WHERE install_id=?").bind(installId),
    ]);
    return noStore(json({ ok: true }));
  }
  if (request.method === "PUT") {
    let update;
    try {
      update = validateAccountUpdate(body);
    } catch (e) {
      return error(400, (e as Error).message);
    }
    await db
      .prepare("UPDATE customer_accounts SET display_name=?,avatar_data=?,updated_at=? WHERE id=?")
      .bind(
        update.displayName,
        update.avatar === undefined ? account.avatar_data : update.avatar,
        new Date().toISOString(),
        account.id,
      )
      .run();
  }
  const refreshed = (await accountForInstall(db, installId))!;
  const devices = await db
    .prepare(
      `SELECT d.install_id AS installId,i.app_version AS appVersion,d.linked_at AS linkedAt,
    CASE WHEN d.expires_at>? THEN 1 ELSE 0 END AS signedIn
    FROM customer_account_devices d JOIN installs i ON i.install_id=d.install_id WHERE d.account_id=? ORDER BY d.linked_at DESC`,
    )
    .bind(seconds(), account.id)
    .all();
  return noStore(json({ ok: true, account: accountProfile(refreshed), devices: devices.results }));
}

/** Browser-side consent has its own CSRF cookie; the signed app must confirm the returned identity before linking. */
export async function accountAuthorize(context: {
  request: Request;
  env: RuntimeEnv;
}): Promise<Response> {
  const { request, env } = context;
  if (!env.DB || !env.DISCORD_CLIENT_ID || !env.DISCORD_REDIRECT_URI)
    return error(503, "Account sign-in is unavailable.");
  if (!["GET", "POST"].includes(request.method)) return error(405, "Method not allowed.");
  const limited = enforceRateLimit(request, {
    route: "customer-account/authorize",
    limit: 15,
    windowSeconds: 60,
  });
  if (limited) return limited;
  const url = new URL(request.url);
  let form = new URLSearchParams();
  if (request.method === "POST") {
    const { readBodyTextLimited } = await import("../../shared/telemetry-contract");
    const body = await readBodyTextLimited(request, 4096);
    if (!body.ok) return error(413, "Request too large.");
    form = new URLSearchParams(body.text);
  }
  const token =
    (request.method === "POST" ? form.get("request") : url.searchParams.get("request")) ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return error(400, "Invalid sign-in request.");
  await ensureCustomerAccounts(env.DB);
  const hash = await accountHash(token);
  const login = await env.DB.prepare(
    "SELECT * FROM customer_account_logins WHERE request_hash=? AND expires_at>? AND account_id IS NULL",
  )
    .bind(hash, seconds())
    .first<Login>();
  if (!login)
    return noStore(
      verifyHtmlPage(false, "Sign-in expired", "Start account sign-in again inside RazorReaper."),
    );
  if (request.method === "GET") {
    const nonce = randomAccountToken();
    const response = new Response(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RazorReaper account</title>
      <style>body{margin:0;background:#0c0c0f;color:#fafafa;font:16px/1.6 system-ui;display:grid;min-height:100vh;place-items:center}main{max-width:460px;padding:32px}h1{font-size:28px}strong{font-size:30px;letter-spacing:4px}button{background:#c744af;color:white;border:0;border-radius:8px;padding:13px 20px;font:inherit;cursor:pointer}p{color:#d2d2d8}</style>
      <main><h1>Your RazorReaper account</h1><p>Check that this code matches the one shown in the RazorReaper app you opened:</p><strong>${login.user_code}</strong>
      <p>Continue only if you started this sign-in yourself. Your Discord identity will be linked to that installation. You can choose your own profile image in the app.</p>
      <form method="post" action="${ACCOUNT_PATH}/authorize"><input type="hidden" name="request" value="${token}"><input type="hidden" name="csrf" value="${nonce}"><button>Continue with Discord</button></form></main></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": setCookie(nonce),
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        },
      },
    );
    return noStore(response);
  }
  const nonce = cookie(request);
  if (
    !/^[a-f0-9]{64}$/.test(nonce) ||
    nonce !== form.get("csrf") ||
    request.headers.get("origin") !== url.origin
  )
    return error(403, "The browser session changed. Open sign-in again from the app.");
  const state = `account.${randomAccountToken()}`;
  await env.DB.prepare(
    "UPDATE customer_account_logins SET state_hash=?,browser_hash=? WHERE request_hash=? AND expires_at>?",
  )
    .bind(await accountHash(state), await accountHash(nonce), hash, seconds())
    .run();
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  }).toString();
  return noStore(new Response(null, { status: 302, headers: { Location: authorize.toString() } }));
}
export async function accountCallback(context: {
  request: Request;
  env: RuntimeEnv;
}): Promise<Response> {
  const { request, env } = context,
    db = env.DB;
  const fail = () =>
    noStore(
      verifyHtmlPage(
        false,
        "Sign-in could not be completed",
        "Start sign-in again inside RazorReaper.",
      ),
    );
  if (!db) return fail();
  const url = new URL(request.url),
    state = url.searchParams.get("state") ?? "",
    nonce = cookie(request);
  if (!/^account\.[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(nonce)) return fail();
  await ensureCustomerAccounts(db);
  const login = await db
    .prepare(
      "SELECT * FROM customer_account_logins WHERE state_hash=? AND browser_hash=? AND expires_at>? AND account_id IS NULL",
    )
    .bind(await accountHash(state), await accountHash(nonce), seconds())
    .first<Login>();
  if (!login) return fail();
  // Consume the OAuth state before calling the provider; duplicate callbacks cannot link twice.
  const consumed = await db
    .prepare(
      "UPDATE customer_account_logins SET state_hash=NULL WHERE request_hash=? AND state_hash=?",
    )
    .bind(login.request_hash, await accountHash(state))
    .run();
  if (consumed.meta?.changes !== 1 || url.searchParams.has("error")) return fail();
  const code = url.searchParams.get("code");
  if (!code) return fail();
  const token = await discordExchangeCode(env, code);
  const user = token ? await discordGetUser(token.access_token) : null;
  if (!user || !/^\d{5,24}$/.test(user.id) || typeof user.username !== "string") return fail();
  const avatarHash = (user as typeof user & { avatar?: string }).avatar;
  const avatar =
    avatarHash && /^(a_)?[a-f0-9]{32}$/.test(avatarHash)
      ? `https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}.png?size=256`
      : null;
  const now = new Date().toISOString();
  const displayName = (user.global_name || user.username).slice(0, 60);
  await db
    .prepare(
      `INSERT INTO customer_accounts(id,discord_id,discord_username,display_name,discord_avatar,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET discord_username=excluded.discord_username,discord_avatar=excluded.discord_avatar,updated_at=excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), user.id, user.username, displayName, avatar, now, now)
    .run();
  await db
    .prepare(
      `UPDATE customer_account_logins SET account_id=(SELECT id FROM customer_accounts WHERE discord_id=?)
    WHERE request_hash=? AND expires_at>?`,
    )
    .bind(user.id, login.request_hash, seconds())
    .run();
  const response = noStore(
    verifyHtmlPage(
      true,
      "Return to RazorReaper",
      "Confirm your Discord profile in the app to finish creating or signing in to your account.",
    ),
  );
  response.headers.set("Set-Cookie", setCookie("", 0));
  return response;
}
