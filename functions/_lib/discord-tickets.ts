import { toIsoOrNull } from "./content";
import { nowIso } from "./http";
import type { D1Database, RuntimeEnv } from "./types";
import { isDiscordSnowflake } from "../../shared/discord-id";

/**
 * Discord support tickets, archived by the bot when a ticket closes.
 *
 * The panel stores the rendered transcript as one HTML blob next to the ticket's facts, so support
 * can answer "what did we already tell this customer" without opening Discord. The blob is only
 * ever handed back as a DOWNLOAD (`functions/api/admin/discord-tickets/[id]/transcript.ts`) — the
 * panel never renders foreign HTML inline.
 *
 * Schema is self-healing like every other table here (ensureAccessSchema is the model): the same
 * DDL lives in schema.sql and tools/migrations/2026-09-19-discord-tickets.sql for a database the
 * app never touches.
 */

/** A transcript of a long ticket runs to a few hundred KB; JSON adds escaping on top. */
export const MAX_TICKET_BODY_BYTES = 800 * 1024;

export const TICKET_STATUSES = ["closed", "deleted", "false_topic"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Everything a ticket row carries except the transcript itself. */
export interface DiscordTicketSummary {
  id: number;
  channel_id: string;
  ticket_no: number | null;
  channel_name: string | null;
  discord_id: string | null;
  discord_tag: string | null;
  category: string | null;
  status: TicketStatus;
  opened_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  ai_replies: number;
  message_count: number;
  provider: string | null;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface DiscordTicketInput {
  channel_id: string;
  ticket_no: number | null;
  channel_name: string | null;
  discord_id: string | null;
  discord_tag: string | null;
  category: string | null;
  status: TicketStatus;
  opened_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  ai_replies: number;
  message_count: number;
  provider: string | null;
  transcript_html: string;
}

const SUMMARY_COLUMNS = `id, channel_id, ticket_no, channel_name, discord_id, discord_tag, category, status,
   opened_at, closed_at, closed_by, ai_replies, message_count, provider, size_bytes,
   created_at, updated_at`;

const TICKET_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS discord_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL UNIQUE,
    ticket_no INTEGER,
    channel_name TEXT,
    discord_id TEXT,
    discord_tag TEXT,
    category TEXT,
    status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('closed', 'deleted', 'false_topic')),
    opened_at TEXT,
    closed_at TEXT,
    closed_by TEXT,
    ai_replies INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    provider TEXT,
    transcript_html TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discord_tickets_member ON discord_tickets(discord_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_discord_tickets_status ON discord_tickets(status, id DESC)`,
];

// Per database, not per module — the tests open a fresh in-memory database per case.
const ticketSchemaReady = new WeakMap<object, Promise<void>>();

export async function ensureDiscordTicketsSchema(env: RuntimeEnv): Promise<void> {
  const db = requireDb(env);
  let ready = ticketSchemaReady.get(db);
  if (!ready) {
    ready = (async () => {
      for (const statement of TICKET_SCHEMA_STATEMENTS) await db.prepare(statement).run();
    })();
    ticketSchemaReady.set(db, ready);
    ready.catch(() => ticketSchemaReady.delete(db));
  }
  await ready;
}

/**
 * Validate one upload body. Pure, so the shape rules are testable without a database — and so an
 * over-long field is a 400 naming it rather than a truncated row nobody notices.
 */
export function normalizeTicketInput(
  body: unknown,
): { ok: true; value: DiscordTicketInput } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;

  const channelId = text(raw.channel_id, 32);
  if (!channelId || !isDiscordSnowflake(channelId)) {
    return { ok: false, message: "channel_id must be a Discord channel id (17-20 digits)." };
  }
  const status = typeof raw.status === "string" ? raw.status : "";
  if (!(TICKET_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: `status must be one of ${TICKET_STATUSES.join(", ")}.` };
  }
  const discordId = text(raw.discord_id, 32);
  if (discordId && !isDiscordSnowflake(discordId)) {
    return { ok: false, message: "discord_id must be a Discord user id (17-20 digits)." };
  }
  const transcript = typeof raw.transcript_html === "string" ? raw.transcript_html : "";

  return {
    ok: true,
    value: {
      channel_id: channelId,
      ticket_no: nonNegativeInt(raw.ticket_no),
      channel_name: text(raw.channel_name, 100),
      discord_id: discordId,
      discord_tag: text(raw.discord_tag, 64),
      category: text(raw.category, 32),
      status: status as TicketStatus,
      opened_at: toIsoOrNull(raw.opened_at),
      closed_at: toIsoOrNull(raw.closed_at),
      closed_by: text(raw.closed_by, 64),
      ai_replies: nonNegativeInt(raw.ai_replies) ?? 0,
      message_count: nonNegativeInt(raw.message_count) ?? 0,
      provider: text(raw.provider, 32),
      transcript_html: transcript,
    },
  };
}

/**
 * Write one ticket, keyed on its channel. The bot retries a failed upload, and a ticket that is
 * later deleted is uploaded again with `status = "deleted"` — so this is an upsert, never an
 * insert, and a retry lands on the same row instead of duplicating the archive.
 */
export async function upsertDiscordTicket(
  env: RuntimeEnv,
  input: DiscordTicketInput,
): Promise<number> {
  const db = requireDb(env);
  await ensureDiscordTicketsSchema(env);
  const now = nowIso();
  const sizeBytes = new TextEncoder().encode(input.transcript_html).byteLength;
  await db
    .prepare(
      `INSERT INTO discord_tickets
        (channel_id, ticket_no, channel_name, discord_id, discord_tag, category, status,
         opened_at, closed_at, closed_by, ai_replies, message_count, provider,
         transcript_html, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         ticket_no = excluded.ticket_no,
         channel_name = excluded.channel_name,
         discord_id = COALESCE(excluded.discord_id, discord_tickets.discord_id),
         discord_tag = COALESCE(excluded.discord_tag, discord_tickets.discord_tag),
         category = COALESCE(excluded.category, discord_tickets.category),
         status = excluded.status,
         opened_at = COALESCE(excluded.opened_at, discord_tickets.opened_at),
         closed_at = COALESCE(excluded.closed_at, discord_tickets.closed_at),
         closed_by = COALESCE(excluded.closed_by, discord_tickets.closed_by),
         ai_replies = excluded.ai_replies,
         message_count = excluded.message_count,
         provider = COALESCE(excluded.provider, discord_tickets.provider),
         -- An empty retry body must never wipe a transcript that already arrived.
         transcript_html = CASE WHEN excluded.size_bytes > 0
           THEN excluded.transcript_html ELSE discord_tickets.transcript_html END,
         size_bytes = CASE WHEN excluded.size_bytes > 0
           THEN excluded.size_bytes ELSE discord_tickets.size_bytes END,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.channel_id,
      input.ticket_no,
      input.channel_name,
      input.discord_id,
      input.discord_tag,
      input.category,
      input.status,
      input.opened_at,
      input.closed_at,
      input.closed_by,
      input.ai_replies,
      input.message_count,
      input.provider,
      input.transcript_html,
      sizeBytes,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare(`SELECT id FROM discord_tickets WHERE channel_id = ? LIMIT 1`)
    .bind(input.channel_id)
    .first<{ id: number }>();
  return Number(row?.id ?? 0);
}

export interface TicketFilter {
  licenseKey?: readonly string[];
  discordId?: readonly string[];
}

/** Newest first. No filter = the newest 100 tickets overall, with the true total next to them. */
export async function listDiscordTickets(
  env: RuntimeEnv,
  filter: TicketFilter = {},
): Promise<{ total: number; tickets: DiscordTicketSummary[] }> {
  const db = requireDb(env);
  await ensureDiscordTicketsSchema(env);

  const conditions: string[] = [];
  const values: unknown[] = [];
  const discordIds = unique(filter.discordId);
  const licenseKeys = unique(filter.licenseKey);
  if (discordIds.length > 0) {
    conditions.push(`discord_id IN (${discordIds.map(() => "?").join(", ")})`);
    values.push(...discordIds);
  }
  if (licenseKeys.length > 0) {
    // The link table already answers "which accounts belong to this key" — no second copy here.
    conditions.push(
      `discord_id IN (SELECT discord_id FROM discord_links
        WHERE license_key IN (${licenseKeys.map(() => "?").join(", ")}))`,
    );
    values.push(...licenseKeys);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" OR ")}` : "";

  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM discord_tickets ${where}`)
    .bind(...values)
    .first<{ c: number }>();
  const rows = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM discord_tickets ${where} ORDER BY id DESC LIMIT 100`)
    .bind(...values)
    .all<DiscordTicketSummary>();

  return { total: Number(total?.c ?? 0), tickets: rows.results };
}

export async function loadDiscordTicketTranscript(
  env: RuntimeEnv,
  id: number,
): Promise<{
  ticket_no: number | null;
  channel_name: string | null;
  transcript_html: string;
} | null> {
  const db = requireDb(env);
  await ensureDiscordTicketsSchema(env);
  return db
    .prepare(`SELECT ticket_no, channel_name, transcript_html FROM discord_tickets WHERE id = ?`)
    .bind(id)
    .first<{ ticket_no: number | null; channel_name: string | null; transcript_html: string }>();
}

/** Returns the deleted row's channel id, or null when the id matched nothing. */
export async function deleteDiscordTicket(env: RuntimeEnv, id: number): Promise<string | null> {
  const db = requireDb(env);
  await ensureDiscordTicketsSchema(env);
  const row = await db
    .prepare(`SELECT channel_id FROM discord_tickets WHERE id = ?`)
    .bind(id)
    .first<{ channel_id: string }>();
  if (!row) return null;
  await db.prepare(`DELETE FROM discord_tickets WHERE id = ?`).bind(id).run();
  return row.channel_id;
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function nonNegativeInt(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function requireDb(env: RuntimeEnv): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is required.");
  return env.DB;
}
