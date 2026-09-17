/**
 * Confirm tokens for the governed release actions — publish, make-current, unpublish, build,
 * commit and dispatch. Design: docs/release-management-design.md §6 and §11.
 *
 * A confirm token is **not a second authentication factor**: every route it guards already ran
 * `requireDashboardAccess` and `enforceSameOriginMutation`. What it stops is a replayed or
 * cross-tab click — the second window still holding a Publish button from five minutes ago — and
 * what it carries is the modal's effect list, so the owner has seen the server's account of what
 * the click does before the click happens.
 *
 * The token is an HMAC over `JWT_SECRET` of the action, the subject, the actor and the issue
 * time, in the `payload.signature` shape `functions/_lib/discord.ts` already uses for OAuth
 * state. Two things are signed on top of the design's four fields:
 *
 *  - a **nonce**, because two mints in the same millisecond would otherwise be byte-identical and
 *    burning one would burn the other — and §6 says a token is re-mintable;
 *  - a **digest of the effects**, so a write route can assert the list it recomputes is still the
 *    list the modal printed. That check is opt-in (`expectedEffects`), because live state may
 *    legitimately move inside the 120 s window.
 */
import { timingSafeEqualText } from "./http";
import type { RuntimeEnv } from "./types";
import {
  hasDiscordEffect,
  type ConfirmAction,
  type ConfirmEffect,
  type ConfirmTokenResponse,
} from "../../shared/releases-contract";
import { parseWorkflowReleaseTrigger, type GithubBlob, type ReadOptions } from "./github-release";

export const CONFIRM_TOKEN_TTL_SECONDS = 120;

/** The workflow whose `release` trigger decides whether publishing posts to Discord. */
export const DISCORD_RELEASE_WORKFLOW_PATH = ".github/workflows/discord-release.yml";

/**
 * The actions whose effect list must carry a `kind: "discord"` line. Publishing fires a GitHub
 * release event and therefore a Discord post; `make-current` fires none and has to say so, because
 * "no post" is exactly what an operator rolling a release back needs to be told.
 */
const DISCORD_REQUIRED_ACTIONS: readonly ConfirmAction[] = ["publish", "make-current"];

const PUBLISH_DISCORD_TEXT =
  "Discord: a release post goes to the updates channel and the RIP webhook " +
  "(discord-release.yml, on release published).";
const MAKE_CURRENT_DISCORD_TEXT = "Discord: nothing is posted — update.xml only.";

const encoder = new TextEncoder();

/* ───────────────────────────── The Discord invariant ───────────────────────────── */

/** Just enough of the GitHub client for the workflow read; keeps a URL out of this module. */
export interface WorkflowFileReader {
  getContent(path: string, options?: ReadOptions & { ref?: string }): Promise<GithubBlob | null>;
}

/**
 * The one `kind: "discord"` line a `publish` confirm carries, computed from the live workflow
 * file. The write routes must call this rather than compose the sentence themselves — that is
 * what `assertDiscordEffect` (and, through it, `mintConfirmToken`) enforces.
 *
 * **If the file cannot be read the warning is emitted anyway**: a surprise post is worse than a
 * redundant warning. The only cases that promise silence are the ones the file itself states —
 * the `release` trigger removed, or an `if:` guard excluding this exact tag.
 */
export async function discordEffectForPublish(
  reader: WorkflowFileReader,
  tag: string,
): Promise<ConfirmEffect> {
  let yaml: string | null = null;
  try {
    yaml = (await reader.getContent(DISCORD_RELEASE_WORKFLOW_PATH))?.content ?? null;
  } catch {
    yaml = null;
  }
  if (yaml === null) return { kind: "discord", text: PUBLISH_DISCORD_TEXT };

  const trigger = parseWorkflowReleaseTrigger(yaml);
  if (!trigger.wired) {
    return {
      kind: "discord",
      text: "Discord: nothing is posted — discord-release.yml no longer runs on a release event.",
    };
  }
  if (trigger.excludedTags.includes(tag)) {
    return {
      kind: "discord",
      text: `Discord: nothing is posted for ${tag} — discord-release.yml skips that tag (tag_name != '${tag}').`,
    };
  }
  return { kind: "discord", text: PUBLISH_DISCORD_TEXT };
}

/** `make-current` rewrites update.xml and fires no release event, so its line says exactly that. */
export function discordEffectForMakeCurrent(): ConfirmEffect {
  return { kind: "discord", text: MAKE_CURRENT_DISCORD_TEXT };
}

export class ConfirmEffectsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmEffectsError";
  }
}

/**
 * The guard §6 calls an invariant: a publish or make-current effect list without a Discord line is
 * a programming error, not a user error, so it throws rather than returning a 4xx. `mintConfirmToken`
 * runs it on every mint, which is what makes it impossible for a write route to forget the call.
 */
export function assertDiscordEffect(
  action: ConfirmAction,
  effects: readonly ConfirmEffect[],
): void {
  if (!DISCORD_REQUIRED_ACTIONS.includes(action)) return;
  if (!hasDiscordEffect(effects)) {
    throw new ConfirmEffectsError(
      `A "${action}" confirm must carry a discord effect; build it with discordEffectForPublish or discordEffectForMakeCurrent.`,
    );
  }
}

/* ─────────────────────────────── Token mint and verify ─────────────────────────────── */

export class ConfirmSecretError extends Error {
  constructor() {
    super("Server is missing JWT_SECRET.");
    this.name = "ConfirmSecretError";
  }
}

export interface ConfirmTokenInput {
  action: ConfirmAction;
  /** Draft id, release id, file path or workflow id — whatever the action names. */
  subject: string;
  /** Panel e-mail of whoever clicked. */
  actor: string;
  /** Server-generated, from live state. The modal prints these verbatim and in order. */
  effects: ConfirmEffect[];
}

/** The signed payload. Short keys because it travels in a JSON body on every confirm. */
interface ConfirmPayload {
  a: ConfirmAction;
  s: string;
  c: string;
  /** Issued-at, epoch ms. */
  i: number;
  n: string;
  /** Digest of the effect list, so a route can check the modal showed what it now recomputes. */
  e: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): string {
  return atob(value.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

/**
 * A stable digest of the effect list — kind and text, in order, because the modal prints them in
 * order and a reordered list is a different warning.
 */
export async function effectsDigest(effects: readonly ConfirmEffect[]): Promise<string> {
  // JSON, not a separator character: a kind or a text can never forge a boundary in it.
  const canonical = JSON.stringify(effects.map((effect) => [effect.kind, effect.text]));
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return base64url(new Uint8Array(digest));
}

function requireSecret(env: RuntimeEnv): string {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) throw new ConfirmSecretError();
  return secret;
}

/**
 * Mints the token the modal's confirm button sends back, together with the effect list it prints.
 * Asserts the Discord invariant first: a publish confirm that forgot the line never gets a token.
 */
export async function mintConfirmToken(
  env: RuntimeEnv,
  input: ConfirmTokenInput,
  nowMs: number = Date.now(),
): Promise<ConfirmTokenResponse> {
  assertDiscordEffect(input.action, input.effects);
  const secret = requireSecret(env);
  const payload: ConfirmPayload = {
    a: input.action,
    s: input.subject,
    c: input.actor,
    i: nowMs,
    n: crypto.randomUUID(),
    e: await effectsDigest(input.effects),
  };
  const data = base64url(encoder.encode(JSON.stringify(payload)));
  const token = `${data}.${await sign(secret, data)}`;
  return {
    ok: true,
    token,
    expiresAt: new Date(nowMs + CONFIRM_TOKEN_TTL_SECONDS * 1000).toISOString(),
    effects: input.effects,
  };
}

export type ConfirmFailureReason =
  | "no-secret"
  | "malformed"
  | "signature"
  | "mismatch"
  | "expired"
  | "used"
  | "effects-changed";

export type ConfirmVerification =
  | { ok: true; action: ConfirmAction; subject: string; actor: string; issuedAt: string }
  | { ok: false; reason: ConfirmFailureReason };

export interface ConfirmExpectation {
  action: ConfirmAction;
  subject: string;
  actor: string;
  /** When given, the list the route recomputed must still digest to the one that was minted. */
  expectedEffects?: readonly ConfirmEffect[];
}

export interface ConfirmVerifyOptions {
  /**
   * Burn the token on success. Default true. **Publish passes `false`** for every step but the
   * last: the contract lets a failed publish resume with the same token until it expires
   * (`PublishRequest.confirmToken`), and burning it at step 1 would make the resume impossible.
   * The sequence calls `burnConfirmToken` once it records `recorded`.
   */
  burn?: boolean;
}

/**
 * Burnt tokens, best effort. This is a per-isolate `Map`, exactly the documented limitation
 * `functions/_lib/ratelimit.ts` carries: Cloudflare may run many isolates and a replay that lands
 * on a different one is not caught. It is still worth having — the replay this defends against is
 * a stale browser tab, which reuses its connection and so overwhelmingly hits the same isolate —
 * and it costs no I/O. The 120 s TTL is the real bound on a replay, not this set.
 */
const burntTokens = new Map<string, number>();
const MAX_BURNT_TOKENS = 5_000;

export function resetConfirmTokenStateForTests(): void {
  burntTokens.clear();
}

/** Drops entries whose TTL has passed; a burnt token past its expiry is refused by the clock. */
function pruneBurnt(nowMs: number): void {
  for (const [token, expiresAtMs] of burntTokens) {
    if (expiresAtMs <= nowMs) burntTokens.delete(token);
  }
}

export function burnConfirmToken(token: string, nowMs: number = Date.now()): void {
  pruneBurnt(nowMs);
  if (burntTokens.size >= MAX_BURNT_TOKENS) {
    const oldest = burntTokens.keys().next();
    if (!oldest.done) burntTokens.delete(oldest.value);
  }
  burntTokens.set(token, nowMs + CONFIRM_TOKEN_TTL_SECONDS * 1000);
}

function decodePayload(
  token: string,
): { data: string; signature: string; payload: ConfirmPayload } | null {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  try {
    const payload = JSON.parse(base64urlDecode(data)) as Partial<ConfirmPayload>;
    if (
      typeof payload.a !== "string" ||
      typeof payload.s !== "string" ||
      typeof payload.c !== "string" ||
      typeof payload.i !== "number" ||
      typeof payload.n !== "string" ||
      typeof payload.e !== "string"
    ) {
      return null;
    }
    return { data, signature, payload: payload as ConfirmPayload };
  } catch {
    // Bad base64, bad JSON — both are "malformed", and neither may throw out of a handler.
    return null;
  }
}

/**
 * Verifies and (by default) burns. The order matters: the signature is checked before anything
 * the payload claims is believed, and the token is burnt only after it has fully passed — an
 * attacker must not be able to burn someone else's live token by replaying a mangled copy.
 */
export async function verifyConfirmToken(
  env: RuntimeEnv,
  token: string,
  expectation: ConfirmExpectation,
  options: ConfirmVerifyOptions = {},
  nowMs: number = Date.now(),
): Promise<ConfirmVerification> {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) return { ok: false, reason: "no-secret" };

  const decoded = decodePayload(token);
  if (!decoded) return { ok: false, reason: "malformed" };
  if (!timingSafeEqualText(await sign(secret, decoded.data), decoded.signature)) {
    return { ok: false, reason: "signature" };
  }

  const { payload } = decoded;
  if (
    payload.a !== expectation.action ||
    payload.s !== expectation.subject ||
    payload.c !== expectation.actor
  ) {
    return { ok: false, reason: "mismatch" };
  }
  const expiresAtMs = payload.i + CONFIRM_TOKEN_TTL_SECONDS * 1000;
  if (!(nowMs < expiresAtMs)) return { ok: false, reason: "expired" };

  pruneBurnt(nowMs);
  if (burntTokens.has(token)) return { ok: false, reason: "used" };

  if (
    expectation.expectedEffects &&
    (await effectsDigest(expectation.expectedEffects)) !== payload.e
  ) {
    return { ok: false, reason: "effects-changed" };
  }

  if (options.burn !== false) burnConfirmToken(token, nowMs);
  return {
    ok: true,
    action: payload.a,
    subject: payload.s,
    actor: payload.c,
    issuedAt: new Date(payload.i).toISOString(),
  };
}

/** One sentence per refusal, safe to return to the browser. */
export const CONFIRM_FAILURE_MESSAGES: Record<ConfirmFailureReason, string> = {
  "no-secret": "Server is missing JWT_SECRET.",
  malformed: "The confirmation is not readable — reopen the dialog.",
  signature: "The confirmation is not readable — reopen the dialog.",
  mismatch: "That confirmation was minted for a different action — reopen the dialog.",
  expired: "The confirmation expired — reopen the dialog and confirm again.",
  used: "That confirmation was already used — reopen the dialog.",
  "effects-changed": "What this action does has changed since the dialog opened — reopen it.",
};
