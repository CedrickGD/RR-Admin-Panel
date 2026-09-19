-- Discord support tickets, archived by the bot when a ticket closes.
--
-- NOTE: the Pages Functions / rr-api self-apply all of this at runtime
-- (functions/_lib/discord-tickets.ts, ensureDiscordTicketsSchema). Running this file manually is
-- only needed for a database the app never touches, and it is safe to skip on a live deployment.
--
-- Every statement is idempotent, so the whole file can be run more than once.
--
-- The archive is keyed on channel_id: the bot retries a failed upload, and a ticket that is later
-- deleted is uploaded again with status = 'deleted'. There is no foreign key to discord_links —
-- "which accounts belong to this license" is answered by that table at query time, so a link that
-- is later rebound does not orphan the archive.

CREATE TABLE IF NOT EXISTS discord_tickets (
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
);

CREATE INDEX IF NOT EXISTS idx_discord_tickets_member ON discord_tickets(discord_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_discord_tickets_status ON discord_tickets(status, id DESC);
