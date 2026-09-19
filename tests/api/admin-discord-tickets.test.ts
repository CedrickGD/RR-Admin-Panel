import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { onRequestGet as listTickets } from "../../functions/api/admin/discord-tickets/index";
import {
  TICKET_DELETE_AUDIT_ACTION,
  onRequestDelete as deleteTicket,
} from "../../functions/api/admin/discord-tickets/[id]/index";
import { onRequestGet as getTranscript } from "../../functions/api/admin/discord-tickets/[id]/transcript";
import { createMockD1, type MockD1, type MockD1Resolvers } from "../helpers/mock-d1";
import {
  TEST_ACCESS_TEAM_DOMAIN,
  accessIdentityHeaders,
  createSyntheticRequest,
  getTestAccessSigner,
  testAccessEnv,
} from "../helpers/request";

/**
 * The panel side of the ticket archive. The transcript is HTML a third party wrote, so the one
 * thing these cases really guard is that it leaves as a download and never as something a browser
 * would execute inside the panel's origin.
 */
const ADMIN = "admin@example.com";
const VIEWER = "viewer@example.com";
const LICENSE_KEY = "RR-AAAA-BBBB-CCCC";
const TICKET_LIST = /^SELECT id, channel_id, ticket_no/;
const TICKET_COUNT = /^SELECT COUNT\(\*\) AS c FROM discord_tickets/;
const TICKET_DELETE = /^DELETE FROM discord_tickets/;
const AUDIT_INSERT = /^INSERT INTO panel_audit/;

const TICKET = {
  id: 5,
  channel_id: "987654321098765432",
  ticket_no: 42,
  channel_name: "closed-0042",
  discord_id: "123456789012345678",
  discord_tag: "buyer",
  category: "bug",
  status: "closed",
  opened_at: "2026-09-19T09:00:00.000Z",
  closed_at: "2026-09-19T10:00:00.000Z",
  closed_by: "AI",
  ai_replies: 3,
  message_count: 12,
  provider: "claude",
  size_bytes: 28,
  created_at: "2026-09-19T10:00:01.000Z",
  updated_at: "2026-09-19T10:00:01.000Z",
};

beforeAll(async () => {
  const signer = await getTestAccessSigner();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `https://${TEST_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify(signer.jwks), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected network request: ${url}`);
    }),
  );
});

afterAll(() => vi.unstubAllGlobals());

function db(resolvers: MockD1Resolvers = {}): MockD1 {
  return createMockD1({
    ...resolvers,
    // A case's own resolvers come first: they override the defaults below, not the other way round.
    first: [
      ...(resolvers.first ?? []),
      { match: TICKET_COUNT, result: { c: 3 } },
      {
        match: /SELECT channel_id FROM discord_tickets WHERE id = \?/,
        result: { channel_id: TICKET.channel_id },
      },
      {
        match: /SELECT ticket_no, channel_name, transcript_html FROM discord_tickets/,
        result: {
          ticket_no: 42,
          channel_name: "closed-0042",
          transcript_html: "<h1>Ticket 42</h1><script>alert(1)</script>",
        },
      },
    ],
    all: [...(resolvers.all ?? []), { match: TICKET_LIST, result: { results: [TICKET] } }],
  });
}

function env(mock: MockD1) {
  return testAccessEnv(`${ADMIN},${VIEWER}`, {
    DB: mock.db,
    ACCESS_ADMIN_EMAIL: ADMIN,
    ACCESS_ALLOWED_EMAIL: `${ADMIN},${VIEWER}`,
  });
}

function ops(mock: MockD1, pattern: RegExp) {
  return mock.operations.filter((operation) => pattern.test(operation.normalizedSql));
}

describe("GET /api/admin/discord-tickets", () => {
  it("filters by license key through the link table and reports the true total", async () => {
    const mock = db();

    const response = await listTickets({
      request: createSyntheticRequest({
        path: "/api/admin/discord-tickets",
        query: { license_key: LICENSE_KEY },
        headers: await accessIdentityHeaders(ADMIN),
      }),
      env: env(mock),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: true, total: 3, tickets: [TICKET] });
    // The transcript never rides along in the list.
    expect(body).not.toContain("transcript_html");
    const list = ops(mock, TICKET_LIST);
    expect(list).toHaveLength(1);
    expect(list[0].normalizedSql).toContain(
      "discord_id IN (SELECT discord_id FROM discord_links WHERE license_key IN (?))",
    );
    expect(list[0].values).toEqual([LICENSE_KEY]);
  });

  it("lists the newest tickets overall when no filter is given", async () => {
    const mock = db();

    await listTickets({
      request: createSyntheticRequest({
        path: "/api/admin/discord-tickets",
        headers: await accessIdentityHeaders(ADMIN),
      }),
      env: env(mock),
    });

    const list = ops(mock, TICKET_LIST)[0];
    expect(list.normalizedSql).not.toContain("WHERE");
    expect(list.normalizedSql).toContain("ORDER BY id DESC LIMIT 100");
  });
});

describe("GET /api/admin/discord-tickets/:id/transcript", () => {
  it("hands the HTML over as an inert download, never as something the panel renders", async () => {
    const mock = db();

    const response = await getTranscript({
      request: createSyntheticRequest({
        path: "/api/admin/discord-tickets/5/transcript",
        headers: await accessIdentityHeaders(ADMIN),
      }),
      env: env(mock),
      params: { id: "5" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="rr-ticket-42.html"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(await response.text()).toContain("Ticket 42");
  });

  it("404s an unknown ticket and 400s a non-numeric id", async () => {
    const missing = await getTranscript({
      request: createSyntheticRequest({
        path: "/api/admin/discord-tickets/9/transcript",
        headers: await accessIdentityHeaders(ADMIN),
      }),
      env: env(
        db({
          first: [
            {
              match: /SELECT ticket_no, channel_name, transcript_html FROM discord_tickets/,
              result: null,
            },
          ],
        }),
      ),
      params: { id: "9" },
    });
    expect(missing.status).toBe(404);

    const bad = await getTranscript({
      request: createSyntheticRequest({
        path: "/api/admin/discord-tickets/abc/transcript",
        headers: await accessIdentityHeaders(ADMIN),
      }),
      env: env(db()),
      params: { id: "abc" },
    });
    expect(bad.status).toBe(400);
  });
});

describe("DELETE /api/admin/discord-tickets/:id", () => {
  async function remove(mock: MockD1, email = ADMIN, id = "5") {
    return deleteTicket({
      request: createSyntheticRequest({
        method: "DELETE",
        path: `/api/admin/discord-tickets/${id}`,
        headers: await accessIdentityHeaders(email),
      }),
      env: env(mock),
      params: { id },
    });
  }

  it("needs the support write permission", async () => {
    const mock = db();

    expect((await remove(mock, VIEWER)).status).toBe(403);
    expect(ops(mock, TICKET_DELETE)).toHaveLength(0);
  });

  it("removes the row and records who did it", async () => {
    const mock = db();

    const response = await remove(mock);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 5 });
    expect(ops(mock, TICKET_DELETE)).toHaveLength(1);
    const audit = ops(mock, AUDIT_INSERT);
    expect(audit).toHaveLength(1);
    expect(audit[0].values.slice(0, 3)).toEqual([
      ADMIN,
      TICKET.channel_id,
      TICKET_DELETE_AUDIT_ACTION,
    ]);
  });

  it("404s an id that matched nothing instead of reporting a delete", async () => {
    const mock = db({
      first: [{ match: /SELECT channel_id FROM discord_tickets WHERE id = \?/, result: null }],
    });

    expect((await remove(mock, ADMIN, "77")).status).toBe(404);
    expect(ops(mock, TICKET_DELETE)).toHaveLength(0);
    expect(ops(mock, AUDIT_INSERT)).toHaveLength(0);
  });
});
