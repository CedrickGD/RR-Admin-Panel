import { describe, expect, it } from "vitest";

import { onRequestPost as uploadTicket } from "../../functions/api/discord/tickets";
import { MAX_TICKET_BODY_BYTES, normalizeTicketInput } from "../../functions/_lib/discord-tickets";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { createMockD1, type MockD1 } from "../helpers/mock-d1";
import { createSyntheticRequest } from "../helpers/request";

/**
 * The bot uploads one archive entry per closed ticket. It retries a failed upload and uploads the
 * same channel again when the ticket is deleted, so the write has to be an upsert — and an
 * over-long transcript has to come back as 413 so the bot knows to retry it shorter.
 */
const SECRET = "bot-shared-secret-1234567890";
const CHANNEL_ID = "987654321098765432";
const DISCORD_ID = "123456789012345678";
const UPSERT = /^INSERT INTO discord_tickets/;

function body(overrides: Record<string, unknown> = {}) {
  return {
    channel_id: CHANNEL_ID,
    ticket_no: 42,
    channel_name: "closed-0042",
    discord_id: DISCORD_ID,
    discord_tag: "buyer",
    category: "bug",
    status: "closed",
    opened_at: "2026-09-19T09:00:00.000Z",
    closed_at: "2026-09-19T10:00:00.000Z",
    closed_by: "AI",
    ai_replies: 3,
    message_count: 12,
    provider: "claude",
    transcript_html: "<html><body>hi</body></html>",
    ...overrides,
  };
}

function db(): MockD1 {
  return createMockD1({
    first: [{ match: /SELECT id FROM discord_tickets WHERE channel_id = \?/, result: { id: 5 } }],
  });
}

function env(mock: MockD1): RuntimeEnv {
  return { DB: mock.db, VERIFY_SHARED_SECRET: SECRET };
}

function call(mock: MockD1, json: unknown, bearer: string = SECRET) {
  return uploadTicket({
    request: createSyntheticRequest({
      method: "POST",
      path: "/api/discord/tickets",
      headers: { authorization: `Bearer ${bearer}` },
      json,
    }),
    env: env(mock),
  });
}

describe("POST /api/discord/tickets", () => {
  it("rejects a wrong Bearer token before touching the database", async () => {
    const mock = db();
    expect((await call(mock, body(), "nope")).status).toBe(401);
    expect(mock.operations).toHaveLength(0);
  });

  it("stores the ticket as an upsert on the channel and answers with the row id", async () => {
    const mock = db();

    const response = await call(mock, body());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 5 });
    const writes = mock.operations.filter((op) => UPSERT.test(op.normalizedSql));
    expect(writes).toHaveLength(1);
    expect(writes[0].normalizedSql).toContain("ON CONFLICT(channel_id) DO UPDATE SET");
    // channel_id, ticket_no, channel_name, discord_id … and the byte size next to the HTML.
    expect(writes[0].values.slice(0, 4)).toEqual([CHANNEL_ID, 42, "closed-0042", DISCORD_ID]);
    expect(writes[0].values[14]).toBe(28);
  });

  it("refuses a body it cannot key or classify", async () => {
    expect((await call(db(), body({ channel_id: "not-a-snowflake" }))).status).toBe(400);
    expect((await call(db(), body({ status: "open" }))).status).toBe(400);
    expect((await call(db(), body({ discord_id: "@buyer" }))).status).toBe(400);
  });

  it("answers 413 for a transcript past the body cap so the bot can retry it shorter", async () => {
    const mock = db();

    const response = await call(mock, body({ transcript_html: "x".repeat(MAX_TICKET_BODY_BYTES) }));

    expect(response.status).toBe(413);
    expect(mock.operations.filter((op) => UPSERT.test(op.normalizedSql))).toHaveLength(0);
  });
});

describe("normalizeTicketInput", () => {
  it("trims, caps and defaults the optional fields instead of writing junk", () => {
    const result = normalizeTicketInput(
      body({
        channel_name: "c".repeat(200),
        ticket_no: "42",
        ai_replies: -1,
        message_count: null,
        opened_at: "not a date",
        provider: "  gemini  ",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.channel_name).toHaveLength(100);
    expect(result.value.ticket_no).toBe(42);
    expect(result.value.ai_replies).toBe(0);
    expect(result.value.message_count).toBe(0);
    expect(result.value.opened_at).toBeNull();
    expect(result.value.provider).toBe("gemini");
  });

  it("names the field it refused", () => {
    expect(normalizeTicketInput("nope")).toMatchObject({ ok: false });
    expect(normalizeTicketInput(body({ status: "archived" }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("status"),
    });
  });
});
